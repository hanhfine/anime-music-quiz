"""Lấy danh sách bài từ link YouTube (1 video hoặc playlist) qua YouTube Data API v3."""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx

API_BASE = "https://www.googleapis.com/youtube/v3"
MAX_PLAYLIST_ITEMS = 200
PAGE_SIZE = 50
REQUEST_TIMEOUT_SEC = 10.0
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{10,64}$")
_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")
_QUOTA_REASONS = {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}
_NOT_FOUND_REASONS = {"playlistNotFound", "playlistItemsNotAccessible", "videoNotFound"}


class YouTubeError(Exception):
    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ParsedUrl:
    kind: str  # "video" | "playlist"
    id: str


@dataclass(frozen=True)
class _Entry:
    video_id: str
    title: str
    privacy: str


def parse_url(url: str) -> ParsedUrl:
    text = url.strip()
    if "://" not in text:
        text = "https://" + text
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        host = host.removeprefix(prefix)
    if host not in ("youtube.com", "youtu.be"):
        raise YouTubeError("INVALID_URL", 400)
    query = parse_qs(parsed.query)
    list_id = query.get("list", [""])[0]
    if list_id:
        if _PLAYLIST_ID.match(list_id):
            return ParsedUrl("playlist", list_id)
        raise YouTubeError("INVALID_URL", 400)
    video_id = ""
    segments = [s for s in parsed.path.split("/") if s]
    if host == "youtu.be" and segments:
        video_id = segments[0]
    elif parsed.path == "/watch":
        video_id = query.get("v", [""])[0]
    elif len(segments) >= 2 and segments[0] == "shorts":
        video_id = segments[1]
    if _VIDEO_ID.match(video_id):
        return ParsedUrl("video", video_id)
    raise YouTubeError("INVALID_URL", 400)


def parse_duration(iso: str) -> int:
    match = _DURATION.match(iso or "")
    if not match:
        return 0
    days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def _error_reasons(response: httpx.Response) -> set[str]:
    try:
        return {error.get("reason", "") for error in response.json()["error"]["errors"]}
    except (ValueError, KeyError, TypeError, AttributeError):
        return set()


class YouTubeService:
    def __init__(self, api_key: str, region: str, client: httpx.AsyncClient) -> None:
        self.api_key = api_key
        self.region = region
        self.client = client

    async def import_url(self, url: str) -> dict:
        target = parse_url(url)
        if target.kind == "video":
            videos = await self._videos([target.id])
            if target.id not in videos:
                raise YouTubeError("NOT_FOUND", 404)
            entries = [_Entry(target.id, videos[target.id]["snippet"]["title"], "public")]
        else:
            entries = await self._playlist_entries(target.id)
            videos = await self._videos([e.video_id for e in entries])
        tracks: list[dict] = []
        skipped: list[dict] = []
        for entry in entries:
            item = videos.get(entry.video_id)
            if item is None:
                reason = "PRIVATE" if entry.privacy == "private" else "DELETED"
                skipped.append({"videoId": entry.video_id, "title": entry.title, "reason": reason})
                continue
            title = item["snippet"]["title"]
            reason = self._skip_reason(item)
            if reason:
                skipped.append({"videoId": entry.video_id, "title": title, "reason": reason})
            else:
                duration = parse_duration(item["contentDetails"].get("duration", ""))
                tracks.append({"videoId": entry.video_id, "videoTitle": title, "durationSec": duration})
        return {"kind": target.kind, "tracks": tracks, "skipped": skipped}

    def _skip_reason(self, item: dict) -> str | None:
        status = item.get("status", {})
        details = item.get("contentDetails", {})
        if status.get("privacyStatus") == "private":
            return "PRIVATE"
        if not status.get("embeddable", False):
            return "NOT_EMBEDDABLE"
        restriction = details.get("regionRestriction", {})
        if self.region in restriction.get("blocked", []):
            return "REGION_BLOCKED"
        allowed = restriction.get("allowed")
        if allowed is not None and self.region not in allowed:
            return "REGION_BLOCKED"
        if parse_duration(details.get("duration", "")) == 0:
            return "NOT_EMBEDDABLE"  # live hoặc sắp phát
        return None

    async def _playlist_entries(self, playlist_id: str) -> list[_Entry]:
        entries: list[_Entry] = []
        seen: set[str] = set()
        page_token = None
        while len(entries) < MAX_PLAYLIST_ITEMS:
            params = {"part": "snippet,status", "playlistId": playlist_id, "maxResults": PAGE_SIZE}
            if page_token:
                params["pageToken"] = page_token
            data = await self._get("playlistItems", params)
            for item in data.get("items", []):
                video_id = item["snippet"]["resourceId"].get("videoId")
                if not video_id or video_id in seen or len(entries) >= MAX_PLAYLIST_ITEMS:
                    continue
                seen.add(video_id)
                privacy = item.get("status", {}).get("privacyStatus", "")
                entries.append(_Entry(video_id, item["snippet"].get("title", ""), privacy))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return entries

    async def _videos(self, ids: list[str]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for start in range(0, len(ids), PAGE_SIZE):
            batch = ids[start : start + PAGE_SIZE]
            params = {"part": "snippet,contentDetails,status", "id": ",".join(batch), "maxResults": PAGE_SIZE}
            data = await self._get("videos", params)
            for item in data.get("items", []):
                found[item["id"]] = item
        return found

    async def _get(self, path: str, params: dict) -> dict:
        try:
            response = await self.client.get(
                f"{API_BASE}/{path}", params={**params, "key": self.api_key}, timeout=REQUEST_TIMEOUT_SEC
            )
        except httpx.HTTPError as exc:
            raise YouTubeError("UPSTREAM_ERROR", 502) from exc
        if response.status_code == 200:
            try:
                return response.json()
            except ValueError as exc:
                raise YouTubeError("UPSTREAM_ERROR", 502) from exc
        reasons = _error_reasons(response)
        if response.status_code == 403 and reasons & _QUOTA_REASONS:
            raise YouTubeError("YOUTUBE_QUOTA", 503)
        if response.status_code == 404 or reasons & _NOT_FOUND_REASONS:
            raise YouTubeError("NOT_FOUND", 404)
        raise YouTubeError("UPSTREAM_ERROR", 502)
