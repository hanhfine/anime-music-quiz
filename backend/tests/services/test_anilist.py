import json

import httpx
import pytest
import respx

from app.services.anilist import ANILIST_URL, AniListTitles, bilingual_name
from app.services.rate_limiter import TokenBucket


@pytest.mark.parametrize(
    ("romaji", "english", "expected"),
    [
        ("Shingeki no Kyojin", "Attack on Titan", "Shingeki no Kyojin (Attack on Titan)"),
        ("Sousou no Frieren", " Frieren: Beyond Journey’s End ", "Sousou no Frieren (Frieren: Beyond Journey’s End)"),
        ("One Piece", "ONE PIECE", "One Piece"),
        ("Spy x Family", "SPY x FAMILY", "Spy x Family"),
        ("Hunter x Hunter (2011)", "Hunter x Hunter", "Hunter x Hunter (2011)"),
        ("Naruto", None, "Naruto"),
        ("Naruto", "  ", "Naruto"),
    ],
)
def test_bilingual_name_adds_the_english_name_only_when_it_says_something_new(romaji, english, expected):
    assert bilingual_name(romaji, english) == expected


def media(anilist_id, english):
    return {"id": anilist_id, "title": {"english": english}}


def reply(*items):
    return httpx.Response(200, json={"data": {"Page": {"media": list(items)}}})


def sent_ids(route) -> list[int]:
    return json.loads(route.calls.last.request.content)["variables"]["ids"]


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
async def titles():
    async with httpx.AsyncClient() as client:
        yield AniListTitles(client, TokenBucket())


async def test_english_names_come_from_one_batched_query(api, titles):
    called = api.post(ANILIST_URL).mock(return_value=reply(media(16498, "Attack on Titan"), media(20, None)))
    assert await titles.english([16498, 20]) == {16498: "Attack on Titan"}
    assert called.call_count == 1
    assert sent_ids(called) == [20, 16498]


async def test_answers_are_cached_even_without_an_english_name(api, titles):
    called = api.post(ANILIST_URL).mock(
        side_effect=[reply(media(16498, "Attack on Titan"), media(20, None)), reply(media(21, "ONE PIECE"))]
    )
    await titles.english([16498, 20, 999])
    assert await titles.english([20, 16498, 999]) == {16498: "Attack on Titan"}
    assert called.call_count == 1
    assert await titles.english([16498, 21]) == {16498: "Attack on Titan", 21: "ONE PIECE"}
    assert sent_ids(called) == [21]


@pytest.mark.parametrize(
    "failure",
    [httpx.Response(500), httpx.Response(429), httpx.ConnectError("down"), httpx.Response(200, json={"errors": []})],
)
async def test_failures_give_no_names_and_are_not_cached(api, titles, failure):
    called = api.post(ANILIST_URL).mock(side_effect=[failure, reply(media(16498, "Attack on Titan"))])
    assert await titles.english([16498]) == {}
    assert await titles.english([16498]) == {16498: "Attack on Titan"}
    assert called.call_count == 2


async def test_no_query_without_ids(api, titles):
    called = api.post(ANILIST_URL).mock(return_value=reply())
    assert await titles.english([]) == {}
    assert called.call_count == 0


async def test_gives_up_without_calling_when_the_limiter_wait_is_too_long(api):
    called = api.post(ANILIST_URL).mock(return_value=reply(media(16498, "Attack on Titan")))
    now = [0.0]

    async def sleep(seconds: float) -> None:
        now[0] += seconds

    limiter = TokenBucket(1, 60.0, burst=1, clock=lambda: now[0], sleep=sleep)
    await limiter.acquire(timeout=0)
    async with httpx.AsyncClient() as client:
        assert await AniListTitles(client, limiter).english([16498]) == {}
    assert called.call_count == 0
