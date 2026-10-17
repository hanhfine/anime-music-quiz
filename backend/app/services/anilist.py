"""Tên tiếng Anh của anime từ AniList, ghép vào tên romaji lấy từ AnimeThemes."""

import httpx

from app.services.rate_limiter import TokenBucket

ANILIST_URL = "https://graphql.anilist.co"
# Tên tiếng Anh chỉ là phần thêm: chờ lượt có giới hạn, hết lượt hoặc lỗi thì gợi ý vẫn dùng tên romaji.
LIMIT_WAIT_SEC = 10.0
REQUEST_TIMEOUT_SEC = 5.0
QUERY = "query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) { id title { english } } } }"


def _letters(text: str) -> str:
    return "".join(ch for ch in text.casefold() if ch.isalnum())


def bilingual_name(romaji: str, english: str | None) -> str:
    """"Romaji (English)"; chỉ giữ romaji khi không có tên tiếng Anh hoặc tên đó đã nằm trong tên romaji."""
    english = (english or "").strip()
    if _letters(english) in _letters(romaji):
        return romaji
    return f"{romaji} ({english})"


class AniListTitles:
    def __init__(self, client: httpx.AsyncClient, limiter: TokenBucket) -> None:
        self.client = client
        self.limiter = limiter
        # Lưu cả ID không có tên tiếng Anh (None) để khỏi hỏi lại.
        self._cache: dict[int, str | None] = {}

    async def english(self, ids: list[int]) -> dict[int, str]:
        """Tên tiếng Anh theo ID AniList, chỉ gồm ID có tên. Không ném lỗi: tra không được thì trả ít hơn."""
        missing = sorted({anilist_id for anilist_id in ids if anilist_id not in self._cache})
        if missing:
            await self._fetch(missing)
        return {anilist_id: name for anilist_id in ids if (name := self._cache.get(anilist_id))}

    async def _fetch(self, ids: list[int]) -> None:
        if not await self.limiter.acquire(LIMIT_WAIT_SEC):
            return
        try:
            response = await self.client.post(
                ANILIST_URL, json={"query": QUERY, "variables": {"ids": ids}}, timeout=REQUEST_TIMEOUT_SEC
            )
            response.raise_for_status()
            found = {item["id"]: item["title"]["english"] for item in response.json()["data"]["Page"]["media"]}
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            return
        for anilist_id in ids:
            self._cache[anilist_id] = found.get(anilist_id)
