import httpx
import pytest
import respx

from app.services.anime_lookup import ANIMETHEMES_URL, AnimeLookup, LookupUnavailable
from app.services.rate_limiter import TokenBucket


def anime(name, *themes, anilist=None):
    resources = [{"site": "MyAnimeList", "external_id": 1}]
    if anilist is not None:
        resources.append({"site": "AniList", "external_id": anilist})
    return {
        "name": name,
        "animethemes": [{"slug": slug, "song": {"title": title} if title else None} for slug, title in themes],
        "resources": resources,
    }


SNK = anime("Shingeki no Kyojin", ("OP1", "Guren no Yumiya"), ("OP2", "Jiyuu no Tsubasa"))
SNK_FINAL = anime("Shingeki no Kyojin: The Final Season", ("OP1", "My War"))
SNK_MOVIE = anime("Shingeki no Kyojin Movie 1", ("ED1", "Ujigami no Aru Hito"))
JJK = anime("Jujutsu Kaisen", ("OP1", "Kaikai Kitan"), ("ED1", None))


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as router:
        yield router


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def fake():
    return FakeTime()


@pytest.fixture
async def lookup(fake):
    async with httpx.AsyncClient() as client:
        yield AnimeLookup(client, TokenBucket(), sleep=fake.sleep)


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
    assert params["include"] == "animethemes.song,resources"
    assert params["fields[anime]"] == "name"
    assert params["fields[animetheme]"] == "slug"
    assert params["fields[song]"] == "title"
    assert params["fields[resource]"] == "site,external_id"


async def test_results_are_cached_per_cleaned_query(api, lookup):
    called = route(api, "Naruto", anime("Naruto"))
    await lookup.search("Naruto")
    await lookup.search("  NARUTO ")
    assert called.call_count == 1


async def test_http_errors_raise_unavailable_instead_of_an_empty_list(api, lookup):
    route(api, "Naruto", anime("Naruto"), status=500)
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Naruto")
    with pytest.raises(LookupUnavailable):
        await lookup.search("Naruto")


async def test_network_errors_and_bad_json_raise_unavailable(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(side_effect=httpx.ConnectError("down"))
    api.get(ANIMETHEMES_URL, params={"q": "Bleach"}).respond(200, json={"unexpected": True})
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Naruto")
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Bleach")


async def test_one_failed_part_makes_the_whole_suggestion_unavailable(api, lookup):
    route(api, "Shingeki no Kyojin", SNK)
    route(api, "Guren no Yumiya", status=500)
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Shingeki no Kyojin OP1 Full - Guren no Yumiya")


async def test_failures_are_not_cached(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(
        side_effect=[httpx.Response(500), httpx.Response(200, json={"anime": [anime("Naruto")]})]
    )
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Naruto")
    assert await lookup.suggest("Naruto") == [{"animeName": "Naruto", "songLabel": None}]


def too_many(retry_after: str | None = None) -> httpx.Response:
    return httpx.Response(429, headers={"Retry-After": retry_after} if retry_after else {})


async def test_rate_limited_requests_wait_for_retry_after_then_retry(api, lookup, fake):
    called = api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(
        side_effect=[too_many("3"), too_many(), httpx.Response(200, json={"anime": [anime("Naruto")]})]
    )
    assert await lookup.suggest("Naruto") == [{"animeName": "Naruto", "songLabel": None}]
    assert called.call_count == 3
    assert fake.sleeps == [3.0, 5.0]  # không có Retry-After thì chờ 5 s


async def test_gives_up_after_two_retries(api, lookup, fake):
    called = api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(side_effect=[too_many("1")] * 3)
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Naruto")
    assert called.call_count == 3
    assert fake.sleeps == [1.0, 1.0]


async def test_does_not_wait_when_retry_after_is_too_long(api, lookup, fake):
    called = api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(side_effect=[too_many("60")])
    with pytest.raises(LookupUnavailable):
        await lookup.suggest("Naruto")
    assert called.call_count == 1
    assert fake.sleeps == []


async def test_waits_for_the_shared_limiter_instead_of_failing(api, fake):
    route(api, "Naruto", anime("Naruto"))
    limiter = TokenBucket(4, 60.0, burst=1, clock=fake.clock, sleep=fake.sleep)
    await limiter.acquire(timeout=0)
    async with httpx.AsyncClient() as client:
        lookup = AnimeLookup(client, limiter, sleep=fake.sleep)
        assert await lookup.suggest("Naruto") == [{"animeName": "Naruto", "songLabel": None}]
    assert fake.now == 15.0  # lượt kế tiếp sau 60 s / 4


async def test_unavailable_without_calling_when_the_limiter_wait_is_too_long(api, fake):
    called = route(api, "Naruto", anime("Naruto"))
    limiter = TokenBucket(1, 60.0, burst=1, clock=fake.clock, sleep=fake.sleep)
    await limiter.acquire(timeout=0)
    async with httpx.AsyncClient() as client:
        lookup = AnimeLookup(client, limiter, sleep=fake.sleep)
        with pytest.raises(LookupUnavailable):
            await lookup.suggest("Naruto")
    assert called.call_count == 0


async def test_search_returns_up_to_ten_names_without_labels(api, lookup):
    route(api, "Gundam", *[anime(f"Gundam {i}", ("OP1", "x")) for i in range(10)], anime("gundam 0"))
    result = await lookup.search("Gundam")
    assert len(result) == 10
    assert result[0] == {"animeName": "Gundam 0", "songLabel": None}


class FakeTitles:
    """Thay AniListTitles: trả tên tiếng Anh có sẵn và ghi lại các lượt hỏi."""

    def __init__(self, names: dict[int, str]) -> None:
        self.names = names
        self.calls: list[list[int]] = []

    async def english(self, ids: list[int]) -> dict[int, str]:
        self.calls.append(ids)
        return {anilist_id: self.names[anilist_id] for anilist_id in ids if anilist_id in self.names}


@pytest.fixture
async def titled():
    titles = FakeTitles({16498: "Attack on Titan", 110277: "Attack on Titan Final Season", 20: "Naruto"})
    async with httpx.AsyncClient() as client:
        yield AnimeLookup(client, TokenBucket(), titles=titles), titles


async def test_suggest_adds_english_names_with_one_anilist_query(api, titled):
    lookup, titles = titled
    route(
        api,
        "Shingeki no Kyojin",
        anime("Shingeki no Kyojin: The Final Season", ("OP1", "My War"), anilist=110277),
        anime("Shingeki no Kyojin", ("OP1", "Guren no Yumiya"), anilist=16498),
        anime("Shingeki no Kyojin Movie 1", anilist=20958),
    )
    assert await lookup.suggest("Shingeki no Kyojin OP1") == [
        {"animeName": "Shingeki no Kyojin: The Final Season (Attack on Titan Final Season)", "songLabel": "OP1 · My War"},
        {"animeName": "Shingeki no Kyojin (Attack on Titan)", "songLabel": "OP1 · Guren no Yumiya"},
        {"animeName": "Shingeki no Kyojin Movie 1", "songLabel": "OP1"},
    ]
    assert titles.calls == [[110277, 16498, 20958]]


async def test_search_adds_english_names(api, titled):
    lookup, _ = titled
    route(api, "Naruto", anime("Naruto", anilist=20), anime("Shingeki no Kyojin", anilist=16498))
    assert await lookup.search("Naruto") == [
        {"animeName": "Naruto", "songLabel": None},
        {"animeName": "Shingeki no Kyojin (Attack on Titan)", "songLabel": None},
    ]


async def test_skips_anilist_when_no_hit_has_an_anilist_id(api, titled):
    lookup, titles = titled
    route(api, "Gundam", anime("Gundam"))
    assert await lookup.suggest("Gundam") == [{"animeName": "Gundam", "songLabel": None}]
    assert titles.calls == []
