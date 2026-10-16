"""Kiểm tra payload `host:create_room` (server kiểm tra lại những gì frontend đã kiểm tra)."""

from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.game.constants import (
    CLIP_SEC_MAX,
    CLIP_SEC_MIN,
    DEFAULT_CLIP_SEC,
    DEFAULT_MAX_PLAYERS,
    DEFAULT_QUESTION_COUNT,
    DEFAULT_REVEAL_SEC,
    MAX_PLAYERS_MAX,
    MAX_PLAYERS_MIN,
    MAX_SONGS,
    REVEAL_SEC_MAX,
    REVEAL_SEC_MIN,
)
from app.game.models import GameError, Settings, Song


class SongIn(BaseModel):
    videoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    videoTitle: str = ""
    durationSec: int = Field(ge=1)
    animeName: str
    songLabel: str | None = None
    startSec: float | None = None
    needsReview: bool = False


class SetIn(BaseModel):
    songs: list[SongIn] = Field(min_length=1, max_length=MAX_SONGS)


class SettingsIn(BaseModel):
    questionCount: int | None = None
    clipSec: int = Field(DEFAULT_CLIP_SEC, ge=CLIP_SEC_MIN, le=CLIP_SEC_MAX)
    revealSec: int = Field(DEFAULT_REVEAL_SEC, ge=REVEAL_SEC_MIN, le=REVEAL_SEC_MAX)
    maxPlayers: int = Field(DEFAULT_MAX_PLAYERS, ge=MAX_PLAYERS_MIN, le=MAX_PLAYERS_MAX)
    mode: Literal["stream"] = "stream"


class CreateRoomIn(BaseModel):
    question_set: SetIn = Field(alias="set")
    settings: SettingsIn = Field(default_factory=SettingsIn)


def parse_create_room(payload: object) -> tuple[list[Song], Settings]:
    try:
        data = CreateRoomIn.model_validate(payload)
    except ValidationError as exc:
        raise GameError("INVALID_SET") from exc
    songs_in = data.question_set.songs
    if any(s.needsReview or not s.animeName.strip() for s in songs_in):
        raise GameError("INVALID_SET")
    count = data.settings.questionCount
    if count is None:
        count = min(DEFAULT_QUESTION_COUNT, len(songs_in))
    if not 1 <= count <= len(songs_in):
        raise GameError("INVALID_SET")
    songs = [
        Song(
            video_id=s.videoId,
            video_title=s.videoTitle,
            duration_sec=s.durationSec,
            anime_name=s.animeName.strip(),
            song_label=s.songLabel,
            start_sec=s.startSec,
        )
        for s in songs_in
    ]
    settings = Settings(
        question_count=count,
        clip_sec=data.settings.clipSec,
        reveal_sec=data.settings.revealSec,
        max_players=data.settings.maxPlayers,
        mode=data.settings.mode,
    )
    return songs, settings
