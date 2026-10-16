"""Máy trạng thái của một phòng. Logic thuần: `now` (epoch ms) và `rng` được truyền vào."""

import secrets
from random import Random

from app.game import calibration
from app.game.constants import NAME_MAX_LEN
from app.game.models import (
    Answer,
    CalibState,
    GameError,
    Phase,
    Player,
    Question,
    RoundState,
    Settings,
    Song,
    Timing,
)
from app.game.question_builder import build_game, build_question
from app.game.scoring import answer_deadline, competition_ranks, effective_time_ms, points


class Room:
    def __init__(
        self,
        *,
        code: str,
        host_token: str,
        songs: list[Song],
        settings: Settings,
        popular: list[str],
        rng: Random,
        now: int,
        timing: Timing = Timing(),
    ) -> None:
        self.code = code
        self.host_token = host_token
        self.songs = list(songs)
        self.settings = settings
        self.popular = popular
        self.rng = rng
        self.timing = timing
        self.phase = Phase.LOBBY
        self.players: dict[str, Player] = {}
        self.kicked_tokens: set[str] = set()
        self.host_online = True
        self.host_offline_since: int | None = None
        self.created_at = now
        self.finished_at: int | None = None
        self.calib: CalibState | None = None
        self.questions: list[Question] = []
        self.spares: list[Song] = []
        self.round: RoundState | None = None
        self.notice: str | None = None
        self.prepare_seq = 0

    # ---- người chơi và quản trò ----

    def add_player(self, name: str) -> Player:
        if self.phase not in (Phase.LOBBY, Phase.CALIBRATING):
            raise GameError("GAME_STARTED")
        clean = name.strip()
        if not 1 <= len(clean) <= NAME_MAX_LEN:
            raise GameError("INVALID_NAME")
        if len(self.players) >= self.settings.max_players:
            raise GameError("ROOM_FULL")
        if any(p.name.casefold() == clean.casefold() for p in self.players.values()):
            raise GameError("NAME_TAKEN")
        player_id = secrets.token_hex(4)
        while player_id in self.players:
            player_id = secrets.token_hex(4)
        player = Player(id=player_id, token=secrets.token_urlsafe(16), name=clean)
        self.players[player.id] = player
        return player

    def player_by_token(self, token: str) -> Player:
        if token in self.kicked_tokens:
            raise GameError("KICKED")
        for player in self.players.values():
            if secrets.compare_digest(player.token.encode(), token.encode()):
                return player
        raise GameError("INVALID_TOKEN")

    def is_host_token(self, token: str) -> bool:
        return secrets.compare_digest(self.host_token.encode(), token.encode())

    def set_player_online(self, player_id: str, online: bool) -> None:
        player = self.players.get(player_id)
        if player is not None:
            player.online = online
            self._maybe_reveal_early()

    def set_host_online(self, online: bool, now: int) -> None:
        self.host_online = online
        self.host_offline_since = None if online else now

    def kick(self, player_id: str) -> Player:
        player = self.players.pop(player_id, None)
        if player is None:
            raise GameError("INVALID_STATE")
        self.kicked_tokens.add(player.token)
        if self.round is not None:
            self.round.answers.pop(player_id, None)
        if self.calib is not None:
            self.calib.tapped.discard(player_id)
            self.calib.samples.pop(player_id, None)
        self._maybe_reveal_early()
        return player

    def effective_delays(self) -> dict[str, int]:
        return calibration.effective_delays({pid: p.delay_ms for pid, p in self.players.items()})

    # ---- đo độ trễ ----

    def start_calibration(self) -> None:
        self._require(Phase.LOBBY)
        if not any(p.online for p in self.players.values()):
            raise GameError("INVALID_STATE")
        self.phase = Phase.CALIBRATING
        self.calib = CalibState(round=1, wait_ms=calibration.random_wait_ms(self.rng))
        self.notice = None

    def calib_flash(self, round_no: int, now: int) -> None:
        self._require(Phase.CALIBRATING)
        if round_no != self.calib.round or self.calib.flash_at is not None:
            raise GameError("INVALID_STATE")
        self.calib.flash_at = now

    def calib_tap(self, player_id: str, round_no: int, now: int) -> None:
        self._require(Phase.CALIBRATING)
        calib = self.calib
        if round_no != calib.round or calib.flash_at is None:
            raise GameError("INVALID_STATE")
        if player_id in calib.tapped:
            raise GameError("ALREADY_ANSWERED")
        sample = calibration.tap_sample(calib.flash_at, now, self.timing.calib_tap_window_ms)
        if sample is None:
            raise GameError("TOO_LATE")
        calib.tapped.add(player_id)
        calib.samples.setdefault(player_id, []).append(sample)

    def _finish_calibration_round(self) -> None:
        calib = self.calib
        if calib.round < self.timing.calib_rounds:
            self.calib = CalibState(
                round=calib.round + 1,
                wait_ms=calibration.random_wait_ms(self.rng),
                samples=calib.samples,
            )
            return
        # Lần đo mới ghi đè lần cũ, kể cả với người không có mẫu nào.
        for player in self.players.values():
            player.delay_ms = calibration.measured_delay(calib.samples.get(player.id, []))
        self.calib = None
        self.phase = Phase.LOBBY

    # ---- mốc thời gian ----

    def next_wakeup(self) -> int | None:
        """Mốc epoch ms mà `tick` cần được gọi, hoặc None nếu không có gì phải chờ."""
        if self.phase is Phase.CALIBRATING and self.calib.flash_at is not None:
            return self.calib.flash_at + self.timing.calib_tap_window_ms
        if self.phase is Phase.ANSWERING:
            return self.round.deadline
        return None

    def tick(self, now: int) -> bool:
        """Xử lý mốc thời gian đã tới. Trả về True nếu phòng thay đổi."""
        wakeup = self.next_wakeup()
        if wakeup is None or now < wakeup:
            return False
        if self.phase is Phase.CALIBRATING:
            self._finish_calibration_round()
        else:
            self._reveal()
        return True

    # ---- nội bộ ----

    def _require(self, *phases: Phase) -> None:
        if self.phase not in phases:
            raise GameError("INVALID_STATE")

    def _maybe_reveal_early(self) -> None:
        """Sang REVEAL khi mọi người online đã trả lời (chỉ khi có ít nhất 1 người online)."""
        if self.phase is not Phase.ANSWERING:
            return
        online = [pid for pid, p in self.players.items() if p.online]
        if online and all(pid in self.round.answers for pid in online):
            self._reveal()

    def _reveal(self) -> None:
        for player_id, answer in self.round.answers.items():
            self.players[player_id].score += answer.gained
        self.phase = Phase.REVEAL
