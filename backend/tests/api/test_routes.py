import httpx
import pytest
from fastapi import FastAPI

from app.api.routes import build_router
from app.services.youtube import YouTubeError, parse_url

IMPORT_RESULT = {
    "kind": "video",
    "tracks": [{"videoId": "8OkpRK2_gVs", "videoTitle": "Guren no Yumiya", "durationSec": 312}],
    "skipped": [],
}


class StubYouTube:
    def __init__(self):
        self.urls = []
        self.error = None

    async def import_url(self, url):
        self.urls.append(url)
        parse_url(url)  # giữ hành vi thật: link sai → YouTubeError("INVALID_URL", 400)
        if self.error:
            raise self.error
        return IMPORT_RESULT


class StubLookup:
    def __init__(self):
        self.calls = []

    async def suggest(self, title):
        self.calls.append(("suggest", title))
        return [{"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"}]

    async def search(self, q):
        self.calls.append(("search", q))
        return [{"animeName": "Naruto", "songLabel": None}]


@pytest.fixture
def youtube():
    return StubYouTube()


@pytest.fixture
def lookup():
    return StubLookup()


@pytest.fixture
async def client(youtube, lookup):
    app = FastAPI()
    app.include_router(build_router(youtube, lookup))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def test_health(client):
    response = await client.get("/api/health")
    assert (response.status_code, response.json()) == (200, {"ok": True})


async def test_import_returns_service_result(client, youtube):
    response = await client.post("/api/import", json={"url": "https://youtu.be/8OkpRK2_gVs"})
    assert (response.status_code, response.json()) == (200, IMPORT_RESULT)
    assert youtube.urls == ["https://youtu.be/8OkpRK2_gVs"]


@pytest.mark.parametrize(
    ("code", "status"),
    [("NOT_FOUND", 404), ("YOUTUBE_QUOTA", 503), ("UPSTREAM_ERROR", 502), ("INVALID_URL", 400)],
)
async def test_import_maps_youtube_errors(client, youtube, code, status):
    youtube.error = YouTubeError(code, status)
    response = await client.post("/api/import", json={"url": "https://youtu.be/8OkpRK2_gVs"})
    assert (response.status_code, response.json()) == (status, {"error": code})


async def test_import_without_url_is_invalid_url(client):
    response = await client.post("/api/import", json={})
    assert (response.status_code, response.json()) == (400, {"error": "INVALID_URL"})


async def test_suggest(client, lookup):
    response = await client.get("/api/anime/suggest", params={"title": "Shingeki no Kyojin OP 1"})
    assert response.status_code == 200
    assert response.json() == {
        "candidates": [{"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"}]
    }
    assert lookup.calls == [("suggest", "Shingeki no Kyojin OP 1")]


async def test_suggest_with_empty_title_skips_lookup(client, lookup):
    response = await client.get("/api/anime/suggest", params={"title": "  "})
    assert (response.status_code, response.json()) == (200, {"candidates": []})
    assert lookup.calls == []


async def test_search(client, lookup):
    response = await client.get("/api/anime/search", params={"q": "naruto"})
    assert (response.status_code, response.json()) == (200, {"candidates": [{"animeName": "Naruto", "songLabel": None}]})
    assert lookup.calls == [("search", "naruto")]


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "   "}])
async def test_search_requires_query(client, lookup, params):
    response = await client.get("/api/anime/search", params=params)
    assert (response.status_code, response.json()) == (400, {"error": "EMPTY_QUERY"})
    assert lookup.calls == []
