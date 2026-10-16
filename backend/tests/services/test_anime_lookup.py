import httpx
import pytest
import respx

from app.services.anime_lookup import ANIMETHEMES_URL, AnimeLookup
from app.services.rate_limiter import TokenBucket


def anime(name, *themes):
    return {
        "name": name,
        "animethemes": [{"slug": slug, "song": {"title": title} if title else None} for slug, title in themes],
    }


SNK = anime("Shingeki no Kyojin", ("OP1", "Guren no Yumiya"), ("OP2", "Jiyuu no Tsubasa"))
SNK_FINAL = anime("Shingeki no Kyojin: The Final Season", ("OP1", "My War"))
SNK_MOVIE = anime("Shingeki no Kyojin Movie 1", ("ED1", "Ujigami no Aru Hito"))
JJK = anime("Jujutsu Kaisen", ("OP1", "Kaikai Kitan"), ("ED1", None))


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
async def lookup():
    async with httpx.AsyncClient() as client:
        yield AnimeLookup(client, TokenBucket())


def route(api, query, *results, status=200):
    return api.get(ANIMETHEMES_URL, params={"q": query}).respond(status, json={"anime": list(results)})


async def test_suggest_merges_parts_ranks_song_matches_first_and_dedupes(api, lookup):
    route(api, "Shingeki no Kyojin", SNK_FINAL, SNK)
    route(api, "Guren no Yumiya", SNK_MOVIE, SNK)
    result = await lookup.suggest("Shingeki no Kyojin OP1 Full - Guren no Yumiya")
    assert result == [
        {"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"},
        {"animeName": "Shingeki no Kyojin: The Final Season", "songLabel": "OP1 · My War"},
        {"animeName": "Shingeki no Kyojin Movie 1", "songLabel": "OP1"},
    ]


async def test_suggest_falls_back_to_the_label_hint(api, lookup):
    route(api, "Jujutsu Kaisen", JJK)
    assert await lookup.suggest("Jujutsu Kaisen - Opening 1 (HD)") == [
        {"animeName": "Jujutsu Kaisen", "songLabel": "OP1 · Kaikai Kitan"}
    ]


async def test_suggest_without_any_label(api, lookup):
    route(api, "Neon Genesis Evangelion", anime("Neon Genesis Evangelion", ("OP1", "Zankoku na Tenshi no Thesis")))
    assert await lookup.suggest("Neon Genesis Evangelion - Opening (4K)") == [
        {"animeName": "Neon Genesis Evangelion", "songLabel": None}
    ]


async def test_suggest_returns_at_most_three(api, lookup):
    route(api, "Gundam", *[anime(f"Gundam {i}") for i in range(5)])
    assert len(await lookup.suggest("Gundam")) == 3


async def test_request_uses_sparse_fields(api, lookup):
    called = route(api, "Gundam", anime("Gundam"))
    await lookup.suggest("Gundam")
    params = called.calls.last.request.url.params
    assert params["include"] == "animethemes.song"
    assert params["fields[anime]"] == "name"
    assert params["fields[animetheme]"] == "slug"
    assert params["fields[song]"] == "title"


async def test_results_are_cached_per_cleaned_query(api, lookup):
    called = route(api, "Naruto", anime("Naruto"))
    await lookup.search("Naruto")
    await lookup.search("  NARUTO ")
    assert called.call_count == 1


@pytest.mark.parametrize("status", [429, 500])
async def test_http_errors_give_no_candidates(api, lookup, status):
    route(api, "Naruto", anime("Naruto"), status=status)
    assert await lookup.suggest("Naruto") == []
    assert await lookup.search("Naruto") == []


async def test_network_errors_and_bad_json_give_no_candidates(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(side_effect=httpx.ConnectError("down"))
    api.get(ANIMETHEMES_URL, params={"q": "Bleach"}).respond(200, json={"unexpected": True})
    assert await lookup.suggest("Naruto") == []
    assert await lookup.suggest("Bleach") == []


async def test_failures_are_not_cached(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(
        side_effect=[httpx.Response(500), httpx.Response(200, json={"anime": [anime("Naruto")]})]
    )
    assert await lookup.suggest("Naruto") == []
    assert await lookup.suggest("Naruto") == [{"animeName": "Naruto", "songLabel": None}]


async def test_exhausted_rate_limit_gives_no_candidates_without_calling(api):
    called = route(api, "Naruto", anime("Naruto"))
    async with httpx.AsyncClient() as client:
        limiter = TokenBucket(1, 60.0)
        await limiter.acquire(timeout=0)
        lookup = AnimeLookup(client, limiter)
        assert await lookup.suggest("Naruto") == []
    assert called.call_count == 0


async def test_search_returns_up_to_ten_names_without_labels(api, lookup):
    route(api, "Gundam", *[anime(f"Gundam {i}", ("OP1", "x")) for i in range(10)], anime("gundam 0"))
    result = await lookup.search("Gundam")
    assert len(result) == 10
    assert result[0] == {"animeName": "Gundam 0", "songLabel": None}
