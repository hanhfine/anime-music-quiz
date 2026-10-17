"""Máy trạng thái của một phòng. Logic thuần: `now` (epoch ms) và `rng` được truyền vào."""

import secrets
from random import Random

from app.game import calibration
from app.game.constants import NAME_MAX_LEN, TEAM_COUNTS, TEAM_DEFAULT_NAMES
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
    Team,
    Timing,
)
from app.game.question_builder import build_game, build_question
from app.game.scoring import answer_deadline, competition_ranks, effective_time_ms, points
from app.game.teams import TeamResult, balanced_assignment, smallest_team, team_result


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
        self.teams: list[Team] = []  # rỗng là chơi thường
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
        if self.team_mode:
            self._place_in_smallest_team(player)
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

    # ---- chia đội ----

    @property
    def team_mode(self) -> bool:
        return bool(self.teams)

    def set_teams(self, count: int) -> None:
        """0 là chơi thường; 2–4 là số đội. Đội giữ lại giữ tên và thành viên."""
        self._require(Phase.LOBBY)
        if count != 0 and count not in TEAM_COUNTS:
            raise GameError("INVALID_STATE")
        if count == 0:
            self.teams = []
            for player in self.players.values():
                player.team = None
            return
        kept = self.teams[:count]
        self.teams = kept + [Team(name) for name in TEAM_DEFAULT_NAMES[len(kept) : count]]
        for player in self.players.values():
            if player.team is not None and player.team >= count:
                player.team = None
        # Người chưa có đội (mới bật chế độ, hoặc đội vừa bị bỏ) được xếp theo thứ tự vào phòng.
        for player in self.players.values():
            if player.team is None:
                self._place_in_smallest_team(player)

    def shuffle_teams(self) -> None:
        self._require_team_lobby()
        assignment = balanced_assignment(list(self.players), len(self.teams), self.rng)
        for player_id, team in assignment.items():
            self.players[player_id].team = team

    def move_player(self, player_id: str, team: int) -> None:
        self._require_team_lobby()
        player = self.players.get(player_id)
        if player is None or not 0 <= team < len(self.teams):
            raise GameError("INVALID_STATE")
        player.team = team

    def choose_team(self, player_id: str, team: int) -> None:
        """Người chơi tự chuyển mình; luật giống quản trò chuyển người."""
        self.move_player(player_id, team)

    def rename_team(self, team: int, name: str) -> None:
        self._require_team_lobby()
        if not 0 <= team < len(self.teams):
            raise GameError("INVALID_STATE")
        clean = name.strip()
        if not 1 <= len(clean) <= NAME_MAX_LEN:
            raise GameError("INVALID_NAME")
        self.teams[team].name = clean

    def team_leaderboard(self) -> list[tuple[int, Team, int]]:
        """(chỉ số đội, đội, hạng), sắp theo hạng rồi chỉ số đội."""
        ranks = competition_ranks({index: team.score for index, team in enumerate(self.teams)})
        rows = [(index, team, ranks[index]) for index, team in enumerate(self.teams)]
        return sorted(rows, key=lambda row: (row[2], row[0]))

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

    def _require_team_lobby(self) -> None:
        self._require(Phase.LOBBY)
        if not self.team_mode:
            raise GameError("INVALID_STATE")

    def _team_sizes(self) -> list[int]:
        sizes = [0] * len(self.teams)
        for player in self.players.values():
            if player.team is not None:
                sizes[player.team] += 1
        return sizes

    def _place_in_smallest_team(self, player: Player) -> None:
        player.team = smallest_team(self._team_sizes())

    def _maybe_reveal_early(self) -> None:
        """Sang REVEAL khi mọi người online đã trả lời (chỉ khi có ít nhất 1 người online).

        Chế độ đội: còn đội đang hòa phiếu thì chờ tới hạn chót để đội tự gỡ.
        """
        if self.phase is not Phase.ANSWERING:
            return
        online = [pid for pid, p in self.players.items() if p.online]
        if not online or not all(pid in self.round.answers for pid in online):
            return
        if self.team_mode and any(result.tied for result in self._team_results().values()):
            return
        self._reveal()

    def _reveal(self) -> None:
        for player_id, answer in self.round.answers.items():
            self.players[player_id].score += answer.gained
        if self.team_mode:
            self.round.team_results = self._team_results()
            for team, result in self.round.team_results.items():
                self.teams[team].score += result.gained
        self.phase = Phase.REVEAL

    def _team_results(self) -> dict[int, TeamResult]:
        """Kết quả mọi đội từ phiếu của thành viên hiện tại, kể cả người đang offline."""
        rnd = self.round
        question = rnd.question
        delays = self.effective_delays()
        votes: dict[int, list[tuple[int, int]]] = {index: [] for index in range(len(self.teams))}
        for player_id, answer in rnd.answers.items():
            t_ms = effective_time_ms(answer.received_at, rnd.t0, delays[player_id])
            votes[self.players[player_id].team].append((answer.option_index, t_ms))
        return {
            team: team_result(team_votes, len(question.options), question.correct_index, question.clip_ms)
            for team, team_votes in votes.items()
        }

    # ---- ván chơi ----

    def start_game(self) -> None:
        self._require(Phase.LOBBY)
        if not self.players:
            raise GameError("INVALID_STATE")
        if 0 in self._team_sizes():
            raise GameError("EMPTY_TEAM")
        self.questions, self.spares = build_game(self.songs, self.settings, self.popular, self.rng)
        self._enter_round(0)

    def audio_started(self, round_index: int, now: int) -> None:
        self._require(Phase.PREPARING)
        self._check_round(round_index)
        rnd = self.round
        rnd.t0 = now
        rnd.deadline = answer_deadline(now, rnd.question.clip_ms, self.timing.grace_ms)
        self.phase = Phase.ANSWERING
        self.notice = None

    def answer(self, player_id: str, round_index: int, option_index: int, now: int) -> None:
        """Chơi thường: bấm là chốt. Chế độ đội: bỏ hoặc đổi phiếu tới hạn chót."""
        self._require(Phase.ANSWERING)
        self._check_round(round_index)
        rnd = self.round
        if not 0 <= option_index < len(rnd.question.options):
            raise GameError("INVALID_STATE")
        previous = rnd.answers.get(player_id)
        if previous is not None and not self.team_mode:
            raise GameError("ALREADY_ANSWERED")
        if now > rnd.deadline:
            raise GameError("TOO_LATE")
        if previous is not None and previous.option_index == option_index:
            return  # bấm lại ô đang bầu: giữ thời điểm cũ để không bị tính chậm
        gained = 0  # chế độ đội tính điểm cho cả đội lúc công bố
        if not self.team_mode:
            t_ms = effective_time_ms(now, rnd.t0, self.effective_delays().get(player_id, 0))
            gained = points(option_index == rnd.question.correct_index, t_ms, rnd.question.clip_ms)
        rnd.answers[player_id] = Answer(option_index, now, gained)
        self._maybe_reveal_early()

    def replay_round(self) -> None:
        self._require(Phase.PREPARING, Phase.ANSWERING, Phase.REVEAL)
        if self.phase is Phase.REVEAL:
            for player_id, answer in self.round.answers.items():
                self.players[player_id].score -= answer.gained
            for team, result in self.round.team_results.items():
                self.teams[team].score -= result.gained
        self._enter_round(self.round.index)

    def audio_failed(self, round_index: int, now: int) -> None:
        self._require(Phase.PREPARING)
        self._check_round(round_index)
        index = self.round.index
        if self.spares:
            song = self.spares.pop(0)
            names = [s.anime_name for s in self.songs]
            self.questions[index] = build_question(song, names, self.popular, self.settings, self.rng)
            self._enter_round(index)
            self.notice = "AUDIO_REPLACED"
            return
        del self.questions[index]
        if index < len(self.questions):
            self._enter_round(index)
        else:
            self._finish(now)
        self.notice = "ROUND_DROPPED"

    def next_round(self, now: int) -> None:
        self._require(Phase.REVEAL)
        if self.round.index + 1 < len(self.questions):
            self._enter_round(self.round.index + 1)
        else:
            self._finish(now)

    def play_again(self) -> None:
        self._require(Phase.FINISHED)
        for player in self.players.values():
            player.score = 0
        for team in self.teams:
            team.score = 0
        self.phase = Phase.LOBBY
        self.questions, self.spares = [], []
        self.round = None
        self.finished_at = None
        self.notice = None

    def leaderboard(self) -> list[tuple[Player, int]]:
        ranks = competition_ranks({pid: p.score for pid, p in self.players.items()})
        rows = [(player, ranks[pid]) for pid, player in self.players.items()]
        return sorted(rows, key=lambda row: (row[1], row[0].name.casefold()))

    def _enter_round(self, index: int) -> None:
        self.round = RoundState(index=index, question=self.questions[index])
        self.phase = Phase.PREPARING
        self.prepare_seq += 1
        self.notice = None

    def _check_round(self, round_index: int) -> None:
        if round_index != self.round.index:
            raise GameError("INVALID_STATE")

    def _finish(self, now: int) -> None:
        self.round = None
        self.phase = Phase.FINISHED
        self.finished_at = now
        self.notice = None
