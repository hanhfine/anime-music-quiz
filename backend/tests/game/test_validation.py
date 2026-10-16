import pytest

from app.game.models import Settings, Song
from app.game.validation import parse_create_room
from tests.factories import game_error


def song(i=0, **overrides):
    data = {
        "videoId": f"vid{i:08d}",
        "videoTitle": f"Title {i}",
        "durationSec": 200,
        "animeName": f"Anime {i}",
        "songLabel": "OP1",
        "startSec": None,
        "needsReview": False,
    }
    return data | overrides


def payload(songs=None, **settings):
    songs = [song(i) for i in range(3)] if songs is None else songs
    question_set = {"version": 1, "id": "x", "name": "Bộ", "updatedAt": "2026-10-16T12:00:00Z", "songs": songs}
    return {"set": question_set, "settings": settings}


def test_valid_payload_is_converted():
    songs, settings = parse_create_room(payload([song(0, animeName="  Naruto ", startSec=42)], clipSec=20))
    assert songs == [
        Song(
            video_id="vid00000000",
            video_title="Title 0",
            duration_sec=200,
            anime_name="Naruto",
            song_label="OP1",
            start_sec=42,
        )
    ]
    assert settings == Settings(question_count=1, clip_sec=20, reveal_sec=15, max_players=30, mode="stream")


def test_question_count_defaults_to_at_most_ten():
    _, few = parse_create_room(payload([song(i) for i in range(3)]))
    _, many = parse_create_room(payload([song(i) for i in range(12)]))
    assert (few.question_count, many.question_count) == (3, 10)


def test_missing_settings_use_defaults():
    _, settings = parse_create_room({"set": payload()["set"]})
    assert settings == Settings(question_count=3)


@pytest.mark.parametrize(
    "bad_song",
    [
        song(needsReview=True),
        song(animeName="   "),
        song(videoId="short"),
        song(durationSec=0),
    ],
)
def test_bad_songs_are_rejected(bad_song):
    assert game_error(parse_create_room, payload([bad_song])) == "INVALID_SET"


def test_song_count_limits():
    assert game_error(parse_create_room, payload([])) == "INVALID_SET"
    assert game_error(parse_create_room, payload([song(i) for i in range(501)])) == "INVALID_SET"
    songs, _ = parse_create_room(payload([song(i) for i in range(500)]))
    assert len(songs) == 500


@pytest.mark.parametrize(
    "settings",
    [
        {"questionCount": 0},
        {"questionCount": 4},
        {"clipSec": 4},
        {"clipSec": 31},
        {"revealSec": -1},
        {"revealSec": 31},
        {"maxPlayers": 1},
        {"maxPlayers": 51},
        {"mode": "self"},
    ],
)
def test_out_of_range_settings_are_rejected(settings):
    assert game_error(parse_create_room, payload(**settings)) == "INVALID_SET"


def test_setting_limits_are_inclusive():
    _, low = parse_create_room(payload(questionCount=1, clipSec=5, revealSec=0, maxPlayers=2))
    _, high = parse_create_room(payload(questionCount=3, clipSec=30, revealSec=30, maxPlayers=50))
    assert (low.clip_sec, low.reveal_sec, low.max_players) == (5, 0, 2)
    assert (high.question_count, high.clip_sec, high.reveal_sec, high.max_players) == (3, 30, 30, 50)


@pytest.mark.parametrize("bad", [None, "x", [], {}, {"set": {"songs": "nope"}}])
def test_malformed_payloads_are_rejected(bad):
    assert game_error(parse_create_room, bad) == "INVALID_SET"
