import httpx
import pytest
import respx

from app.services.youtube import API_BASE, ParsedUrl, YouTubeError, YouTubeService, parse_duration, parse_url

VIDEO = "8OkpRK2_gVs"
PLAYLIST = "PLabcdefghij1234"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (f"https://www.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"youtube.com/watch?v={VIDEO}&t=42", ParsedUrl("video", VIDEO)),
        (f"https://youtu.be/{VIDEO}?si=abc", ParsedUrl("video", VIDEO)),
        (f"https://m.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"https://music.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"https://www.youtube.com/shorts/{VIDEO}", ParsedUrl("video", VIDEO)),
        (f"  https://www.youtube.com/playlist?list={PLAYLIST}  ", ParsedUrl("playlist", PLAYLIST)),
        (f"https://www.youtube.com/watch?v={VIDEO}&list={PLAYLIST}", ParsedUrl("playlist", PLAYLIST)),
    ],
)
def test_parse_url_accepts_youtube_links(url, expected):
    assert parse_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "",
        "hello",
        "https://vimeo.com/123",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/channel/UC1234567890",
        f"https://notyoutube.com/watch?v={VIDEO}",
        "https://www.youtube.com/playlist?list=bad!",
    ],
)
def test_parse_url_rejects_other_links(url):
    with pytest.raises(YouTubeError) as info:
        parse_url(url)
    assert (info.value.code, info.value.status) == ("INVALID_URL", 400)


@pytest.mark.parametrize(
    ("iso", "seconds"),
    [("PT4M12S", 252), ("PT1H2M3S", 3723), ("PT45S", 45), ("P1DT1S", 86401), ("P0D", 0), ("garbage", 0)],
)
def test_parse_duration(iso, seconds):
    assert parse_duration(iso) == seconds


def vid(i: int) -> str:
    return f"vid{i:08d}"


def playlist_item(video_id, title="Song", privacy="public"):
    return {"snippet": {"title": title, "resourceId": {"videoId": video_id}}, "status": {"privacyStatus": privacy}}


def video(video_id, title="Song", duration="PT3M", embeddable=True, privacy="public", region=None):
    details = {"duration": duration}
    if region is not None:
        details["regionRestriction"] = region
    return {
        "id": video_id,
        "snippet": {"title": title},
        "contentDetails": details,
        "status": {"embeddable": embeddable, "privacyStatus": privacy},
    }


class FakeYouTube:
    """Giả lập 2 endpoint YouTube Data API bằng respx."""

    def __init__(self, router, pages, videos):
        self.pages = pages
        self.videos = {v["id"]: v for v in videos}
        self.playlist_route = router.get(f"{API_BASE}/playlistItems").mock(side_effect=self._playlist)
        self.videos_route = router.get(f"{API_BASE}/videos").mock(side_effect=self._videos)

    def _playlist(self, request):
        assert request.url.params["key"] == "test-key"
        index = int(request.url.params.get("pageToken", "0"))
        body = {"items": self.pages[index]}
        if index + 1 < len(self.pages):
            body["nextPageToken"] = str(index + 1)
        return httpx.Response(200, json=body)

    def _videos(self, request):
        ids = request.url.params["id"].split(",")
        assert len(ids) <= 50
        return httpx.Response(200, json={"items": [self.videos[i] for i in ids if i in self.videos]})


@pytest.fixture
def router():
    with respx.mock(assert_all_called=False) as mock:
        yield mock


@pytest.fixture
async def service():
    async with httpx.AsyncClient() as client:
        yield YouTubeService("test-key", "VN", client)


async def test_playlist_is_paginated_and_videos_are_batched(router, service):
    pages = [[playlist_item(vid(i)) for i in range(50)], [playlist_item(vid(i)) for i in range(50, 60)]]
    fake = FakeYouTube(router, pages, [video(vid(i), title=f"Song {i}", duration="PT4M12S") for i in range(60)])
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert result["kind"] == "playlist" and result["skipped"] == []
    assert len(result["tracks"]) == 60
    assert result["tracks"][0] == {"videoId": vid(0), "videoTitle": "Song 0", "durationSec": 252}
    assert fake.playlist_route.call_count == 2
    assert fake.videos_route.call_count == 2


async def test_playlist_stops_at_200_items_and_dedupes(router, service):
    pages = [[playlist_item(vid(p * 50 + i)) for i in range(50)] for p in range(5)]
    pages[0][1] = playlist_item(vid(0))  # trùng bài đầu tiên
    fake = FakeYouTube(router, pages, [video(vid(i)) for i in range(250)])
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    # 4 trang đầu chỉ có 199 bài khác nhau → lấy thêm trang 5 rồi dừng ở đúng 200
    assert fake.playlist_route.call_count == 5
    assert len(result["tracks"]) == 200
    assert len({t["videoId"] for t in result["tracks"]}) == 200
    assert result["tracks"][-1]["videoId"] == vid(200)


async def test_playlist_skip_reasons(router, service):
    items = [
        playlist_item(vid(0), "OK"),
        playlist_item(vid(1), "Deleted video", privacy="privacyStatusUnspecified"),
        playlist_item(vid(2), "Private video", privacy="private"),
        playlist_item(vid(3), "No embed"),
        playlist_item(vid(4), "Blocked in VN"),
        playlist_item(vid(5), "Only in JP"),
        playlist_item(vid(6), "Live"),
        playlist_item(vid(7), "Allowed in VN"),
    ]
    videos = [
        video(vid(0), "OK"),
        video(vid(3), "No embed", embeddable=False),
        video(vid(4), "Blocked in VN", region={"blocked": ["VN", "US"]}),
        video(vid(5), "Only in JP", region={"allowed": ["JP"]}),
        video(vid(6), "Live", duration="P0D"),
        video(vid(7), "Allowed in VN", region={"allowed": ["JP", "VN"]}),
    ]
    FakeYouTube(router, [items], videos)
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert [t["videoId"] for t in result["tracks"]] == [vid(0), vid(7)]
    assert result["skipped"] == [
        {"videoId": vid(1), "title": "Deleted video", "reason": "DELETED"},
        {"videoId": vid(2), "title": "Private video", "reason": "PRIVATE"},
        {"videoId": vid(3), "title": "No embed", "reason": "NOT_EMBEDDABLE"},
        {"videoId": vid(4), "title": "Blocked in VN", "reason": "REGION_BLOCKED"},
        {"videoId": vid(5), "title": "Only in JP", "reason": "REGION_BLOCKED"},
        {"videoId": vid(6), "title": "Live", "reason": "NOT_EMBEDDABLE"},
    ]


async def test_single_video(router, service):
    FakeYouTube(router, [], [video(VIDEO, "Guren no Yumiya", duration="PT5M12S")])
    result = await service.import_url(f"https://youtu.be/{VIDEO}")
    assert result == {
        "kind": "video",
        "tracks": [{"videoId": VIDEO, "videoTitle": "Guren no Yumiya", "durationSec": 312}],
        "skipped": [],
    }


async def test_single_video_that_cannot_be_embedded_is_skipped(router, service):
    FakeYouTube(router, [], [video(VIDEO, "No embed", embeddable=False)])
    result = await service.import_url(f"https://youtu.be/{VIDEO}")
    assert result["tracks"] == []
    assert result["skipped"] == [{"videoId": VIDEO, "title": "No embed", "reason": "NOT_EMBEDDABLE"}]


async def test_missing_single_video_is_not_found(router, service):
    FakeYouTube(router, [], [])
    with pytest.raises(YouTubeError) as info:
        await service.import_url(f"https://youtu.be/{VIDEO}")
    assert (info.value.code, info.value.status) == ("NOT_FOUND", 404)


def api_error(status, reason):
    return httpx.Response(status, json={"error": {"code": status, "errors": [{"reason": reason}]}})


@pytest.mark.parametrize(
    ("response", "code", "status"),
    [
        (api_error(403, "quotaExceeded"), "YOUTUBE_QUOTA", 503),
        (api_error(403, "dailyLimitExceeded"), "YOUTUBE_QUOTA", 503),
        (api_error(403, "playlistItemsNotAccessible"), "NOT_FOUND", 404),
        (api_error(404, "playlistNotFound"), "NOT_FOUND", 404),
        (api_error(400, "keyInvalid"), "UPSTREAM_ERROR", 502),
        (httpx.Response(500, text="oops"), "UPSTREAM_ERROR", 502),
        (httpx.ConnectError("down"), "UPSTREAM_ERROR", 502),
    ],
)
async def test_api_errors_are_mapped(router, service, response, code, status):
    router.get(f"{API_BASE}/playlistItems").mock(side_effect=[response])
    with pytest.raises(YouTubeError) as info:
        await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert (info.value.code, info.value.status) == (code, status)
