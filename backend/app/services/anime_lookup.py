"""Gợi ý tên anime từ tiêu đề YouTube bằng AnimeThemes API, kèm tên tiếng Anh từ AniList."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from app.services.anilist import AniListTitles, bilingual_name
from app.services.rate_limiter import TokenBucket
from app.services.title_cleaner import CleanedTitle, clean_title

ANIMETHEMES_URL = "https://api.animethemes.moe/anime"
# Trình soạn gọi 3 gợi ý song song, mỗi gợi ý vài truy vấn: chờ lượt tới 20 s thay vì báo lỗi ngay.
LIMIT_WAIT_SEC = 20.0
REQUEST_TIMEOUT_SEC = 8.0
# Bị AnimeThemes từ chối (429): chờ theo Retry-After rồi thử lại, nhưng không chờ quá lâu.
RATE_LIMIT_RETRIES = 2
DEFAULT_RETRY_AFTER_SEC = 5.0
MAX_RETRY_AFTER_SEC = 20.0
SUGGEST_PAGE_SIZE = 5
SUGGEST_LIMIT = 3
SEARCH_LIMIT = 10


class LookupUnavailable(Exception):
    """AnimeThemes lỗi, hết thời gian chờ, hoặc hết lượt gọi."""


@dataclass(frozen=True)
class Theme:
    slug: str
    song_title: str | None


@dataclass(frozen=True)
class Hit:
    name: str
    themes: tuple[Theme, ...]
    anilist_id: int | None = None


def _parse_hits(data: object) -> list[Hit]:
    hits = []
    for item in data["anime"]:
        themes = tuple(
            Theme(slug=theme["slug"], song_title=(theme.get("song") or {}).get("title"))
            for theme in item.get("animethemes") or []
        )
        anilist_id = next(
            (res.get("external_id") for res in item.get("resources") or [] if res.get("site") == "AniList"), None
        )
        hits.append(Hit(name=item["name"], themes=themes, anilist_id=anilist_id if type(anilist_id) is int else None))
    return hits


def _retry_after(response: httpx.Response) -> float:
    try:
        return max(0.0, float(response.headers["Retry-After"]))
    except (KeyError, ValueError):
        return DEFAULT_RETRY_AFTER_SEC


def _pick_label(hit: Hit, cleaned: CleanedTitle) -> tuple[str | None, bool]:
    """Trả về (nhãn bài, tên bài có khớp tiêu đề không)."""
    parts = [part.casefold() for part in cleaned.parts]
    for theme in hit.themes:
        song = theme.song_title
        if song and len(song) >= 3 and any(song.casefold() in part for part in parts):
            return f"{theme.slug} · {song}", True
    if cleaned.label_hint is None:
        return None, False
    for theme in hit.themes:
        if theme.slug == cleaned.label_hint:
            return (f"{theme.slug} · {theme.song_title}" if theme.song_title else theme.slug), False
    return cleaned.label_hint, False


class AnimeLookup:
    def __init__(
        self,
        client: httpx.AsyncClient,
        limiter: TokenBucket,
        *,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        titles: AniListTitles | None = None,
    ) -> None:
        self.client = client
        self.limiter = limiter
        self.sleep = sleep
        self.titles = titles
        self._cache: dict[tuple[str, int], list[Hit]] = {}

    async def _get_once(self, params: dict) -> httpx.Response:
        if not await self.limiter.acquire(LIMIT_WAIT_SEC):
            raise LookupUnavailable("rate limited")
        return await self.client.get(ANIMETHEMES_URL, params=params, timeout=REQUEST_TIMEOUT_SEC)

    async def _get(self, params: dict) -> httpx.Response:
        for _ in range(RATE_LIMIT_RETRIES):
            response = await self._get_once(params)
            if response.status_code != 429 or _retry_after(response) > MAX_RETRY_AFTER_SEC:
                return response
            await self.sleep(_retry_after(response))
        return await self._get_once(params)

    async def _search(self, query: str, size: int) -> list[Hit]:
        key = (query.casefold(), size)
        if key in self._cache:
            return self._cache[key]
        params = {
            "q": query,
            "include": "animethemes.song,resources",
            "page[size]": size,
            "fields[anime]": "name",
            "fields[animetheme]": "slug",
            "fields[song]": "title",
            "fields[resource]": "site,external_id",
        }
        try:
            response = await self._get(params)
            response.raise_for_status()
            hits = _parse_hits(response.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise LookupUnavailable(str(exc)) from exc
        self._cache[key] = hits
        return hits

    async def _named(self, picked: list[tuple[Hit, str | None]]) -> list[dict]:
        """Ghép tên tiếng Anh vào tên romaji bằng một lượt hỏi AniList; AniList không trả lời thì giữ romaji."""
        ids = [hit.anilist_id for hit, _ in picked if hit.anilist_id is not None]
        english = await self.titles.english(ids) if self.titles and ids else {}
        return [
            {"animeName": bilingual_name(hit.name, english.get(hit.anilist_id)), "songLabel": label}
            for hit, label in picked
        ]

    async def suggest(self, title: str) -> list[dict]:
        """Tối đa 3 tên gợi ý. Ném LookupUnavailable nếu không tra được (khác với "không tìm thấy")."""
        cleaned = clean_title(title)
        results = await asyncio.gather(
            *(self._search(part, SUGGEST_PAGE_SIZE) for part in cleaned.parts), return_exceptions=True
        )
        for result in results:
            if isinstance(result, BaseException):
                raise result
        ranked = []
        for part_index, hits in enumerate(results):
            for hit_index, hit in enumerate(hits):
                label, song_match = _pick_label(hit, cleaned)
                ranked.append(((not song_match, part_index, hit_index), hit, label))
        ranked.sort(key=lambda row: row[0])
        picked: list[tuple[Hit, str | None]] = []
        seen: set[str] = set()
        for _, hit, label in ranked:
            if hit.name.casefold() not in seen:
                seen.add(hit.name.casefold())
                picked.append((hit, label))
        return await self._named(picked[:SUGGEST_LIMIT])

    async def search(self, query: str) -> list[dict]:
        hits = await self._search(query.strip(), SEARCH_LIMIT)
        picked: list[tuple[Hit, str | None]] = []
        seen: set[str] = set()
        for hit in hits:
            if hit.name.casefold() not in seen:
                seen.add(hit.name.casefold())
                picked.append((hit, None))
        return await self._named(picked[:SEARCH_LIMIT])
