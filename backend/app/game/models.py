"""Kiểu dữ liệu của game. Không có logic, không có I/O."""

from dataclasses import dataclass, field
from enum import StrEnum

from app.game.constants import (
    CALIB_ROUNDS,
    CALIB_TAP_WINDOW_MS,
    DEFAULT_CLIP_SEC,
    DEFAULT_MAX_PLAYERS,
    DEFAULT_REVEAL_SEC,
    GRACE_SEC,
)


class Phase(StrEnum):
    LOBBY = "LOBBY"
    CALIBRATING = "CALIBRATING"
    PREPARING = "PREPARING"
    ANSWERING = "ANSWERING"
    REVEAL = "REVEAL"
    FINISHED = "FINISHED"


class GameError(Exception):
    """Lỗi nghiệp vụ; `code` được gửi nguyên văn cho client trong ack."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Song:
    video_id: str
    video_title: str
    duration_sec: int
    anime_name: str
    song_label: str | None = None
    start_sec: float | None = None


@dataclass(frozen=True)
class Settings:
    question_count: int
    clip_sec: int = DEFAULT_CLIP_SEC
    reveal_sec: int = DEFAULT_REVEAL_SEC
    max_players: int = DEFAULT_MAX_PLAYERS
    mode: str = "stream"


@dataclass(frozen=True)
class Timing:
    grace_ms: int = GRACE_SEC * 1000
    calib_rounds: int = CALIB_ROUNDS
    calib_tap_window_ms: int = CALIB_TAP_WINDOW_MS


@dataclass(frozen=True)
class Question:
    song: Song
    start_sec: float
    end_sec: float
    clip_ms: int
    options: tuple[str, ...]
    correct_index: int


@dataclass
class Player:
    id: str
    token: str
    name: str
    online: bool = True
    delay_ms: int | None = None
    score: int = 0
    team: int | None = None  # chỉ số trong Room.teams; None khi chơi thường


@dataclass
class Team:
    name: str
    score: int = 0


@dataclass
class Answer:
    option_index: int
    received_at: int
    gained: int


@dataclass
class CalibState:
    round: int
    wait_ms: int
    flash_at: int | None = None
    tapped: set[str] = field(default_factory=set)
    samples: dict[str, list[int]] = field(default_factory=dict)


@dataclass
class RoundState:
    index: int
    question: Question
    t0: int | None = None
    deadline: int | None = None
    answers: dict[str, Answer] = field(default_factory=dict)
