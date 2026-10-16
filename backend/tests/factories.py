"""Dữ liệu mẫu dùng chung cho test."""

from collections.abc import Callable
from random import Random

import pytest

from app.game.models import GameError, Settings, Song, Timing
from app.game.room import Room

POPULAR = ["Popular A", "Popular B", "Popular C", "Popular D"]


def make_songs(count: int, duration: int = 200) -> list[Song]:
    return [
        Song(
            video_id=f"vid{i:08d}",
            video_title=f"Title {i}",
            duration_sec=duration,
            anime_name=f"Anime {i}",
            song_label=f"OP{i}",
        )
        for i in range(count)
    ]


def make_room(
    *, songs: list[Song] | None = None, now: int = 0, seed: int = 1, timing: Timing = Timing(), **settings
) -> Room:
    songs = make_songs(5) if songs is None else songs
    settings.setdefault("question_count", min(3, len(songs)))
    return Room(
        code="ABC234",
        host_token="host-token",
        songs=songs,
        settings=Settings(**settings),
        popular=POPULAR,
        rng=Random(seed),
        now=now,
        timing=timing,
    )


def game_error(fn: Callable, *args) -> str:
    """Gọi fn và trả về mã GameError mà nó ném ra."""
    with pytest.raises(GameError) as info:
        fn(*args)
    return info.value.code


def set_payload(count: int = 4, **settings) -> dict:
    """Payload `host:create_room` hợp lệ gồm `count` bài từ make_songs."""
    songs = [
        {
            "videoId": song.video_id,
            "videoTitle": song.video_title,
            "durationSec": song.duration_sec,
            "animeName": song.anime_name,
            "songLabel": song.song_label,
            "needsReview": False,
        }
        for song in make_songs(count)
    ]
    return {"set": {"songs": songs}, "settings": settings}
