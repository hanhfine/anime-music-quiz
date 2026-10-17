"""Snapshot gửi cho từng vai trò. Bản cho người chơi không bao giờ lộ đáp án trước REVEAL."""

from app.game.constants import LEADERBOARD_TOP
from app.game.models import Phase, Settings
from app.game.room import Room
from app.game.teams import tally


def _settings(settings: Settings) -> dict:
    return {
        "questionCount": settings.question_count,
        "clipSec": settings.clip_sec,
        "revealSec": settings.reveal_sec,
        "maxPlayers": settings.max_players,
        "mode": settings.mode,
    }


def _gained(room: Room, player_id: str) -> int | None:
    if room.phase is not Phase.REVEAL:
        return None
    answer = room.round.answers.get(player_id)
    return answer.gained if answer else 0


def _leaderboard(room: Room) -> list[dict]:
    return [
        {
            "playerId": player.id,
            "name": player.name,
            "score": player.score,
            "rank": rank,
            "gained": _gained(room, player.id),
        }
        for player, rank in room.leaderboard()
    ]


def _teams(room: Room, *, by_id: bool) -> list[dict] | None:
    """Theo chỉ số đội. Màn quản trò nhận id thành viên, điện thoại nhận tên."""
    if not room.team_mode:
        return None
    ranks = {index: rank for index, _, rank in room.team_leaderboard()}
    results = room.round.team_results if room.phase is Phase.REVEAL else {}
    rows = []
    for index, team in enumerate(room.teams):
        members = [player for player in room.players.values() if player.team == index]
        row = {
            "index": index,
            "name": team.name,
            "score": team.score,
            "rank": ranks[index],
            "gained": results[index].gained if index in results else None,
        }
        if by_id:
            row["memberIds"] = [player.id for player in members]
        else:
            row["members"] = [player.name for player in members]
        rows.append(row)
    return rows


def _team_picks(room: Room) -> list[dict] | None:
    """Đáp án từng đội chốt; chỉ gọi lúc REVEAL."""
    if not room.team_mode:
        return None
    return [
        {"team": team, "option": result.option, "tied": result.tied, "gained": result.gained}
        for team, result in sorted(room.round.team_results.items())
    ]


def _host_calib(room: Room) -> dict | None:
    calib = room.calib
    if calib is None:
        return None
    return {
        "round": calib.round,
        "waitMs": calib.wait_ms,
        "flashed": calib.flash_at is not None,
        "tappedCount": len(calib.tapped),
    }


def _host_round(room: Room) -> dict | None:
    rnd = room.round
    if rnd is None:
        return None
    question = rnd.question
    reveal = None
    if room.phase is Phase.REVEAL:
        counts = [0] * len(question.options)
        for answer in rnd.answers.values():
            counts[answer.option_index] += 1
        reveal = {
            "correctIndex": question.correct_index,
            "optionCounts": counts,
            "animeName": question.song.anime_name,
            "songLabel": question.song.song_label,
            "teamPicks": _team_picks(room),
        }
    return {
        "index": rnd.index,
        "total": len(room.questions),
        "videoId": question.song.video_id,
        "startSec": question.start_sec,
        "endSec": question.end_sec,
        "options": list(question.options),
        "deadline": rnd.deadline,
        "answeredCount": len(rnd.answers),
        "onlineCount": sum(1 for p in room.players.values() if p.online),
        "prepareSeq": room.prepare_seq,
        "reveal": reveal,
    }


def host_view(room: Room, now: int) -> dict:
    delays = room.effective_delays()
    return {
        "code": room.code,
        "phase": room.phase.value,
        "mode": room.settings.mode,
        "settings": _settings(room.settings),
        "serverNow": now,
        "players": [
            {
                "id": player.id,
                "name": player.name,
                "online": player.online,
                "delayMs": delays[player.id],
                "calibrated": player.delay_ms is not None,
                "score": player.score,
                "team": player.team,
            }
            for player in room.players.values()
        ],
        "teams": _teams(room, by_id=True),
        "calib": _host_calib(room),
        "round": _host_round(room),
        "leaderboard": _leaderboard(room),
        "notice": room.notice,
    }


def _team_votes(room: Room, player_id: str) -> list[int] | None:
    """Số phiếu từng ô của đội người nhận; chỉ khi đang trả lời hoặc công bố."""
    team = room.players[player_id].team
    if team is None or room.phase not in (Phase.ANSWERING, Phase.REVEAL):
        return None
    options = [
        answer.option_index for pid, answer in room.round.answers.items() if room.players[pid].team == team
    ]
    counts, _, _ = tally(options, len(room.round.question.options))
    return counts


def _team_result(room: Room, player_id: str) -> dict | None:
    """Kết quả đội của người nhận; chỉ gọi lúc REVEAL."""
    team = room.players[player_id].team
    if team is None:
        return None
    result = room.round.team_results[team]
    return {
        "option": result.option,
        "tied": result.tied,
        "correct": result.option == room.round.question.correct_index,
        "gained": result.gained,
    }


def _player_round(room: Room, player_id: str) -> dict | None:
    rnd = room.round
    if rnd is None:
        return None
    question = rnd.question
    mine = rnd.answers.get(player_id)
    result = None
    if room.phase is Phase.REVEAL:
        result = {
            "correctIndex": question.correct_index,
            "correct": mine is not None and mine.option_index == question.correct_index,
            "gained": mine.gained if mine else 0,
            "animeName": question.song.anime_name,
            "songLabel": question.song.song_label,
            "team": _team_result(room, player_id),
        }
    show_options = room.phase in (Phase.ANSWERING, Phase.REVEAL)
    return {
        "index": rnd.index,
        "total": len(room.questions),
        "options": list(question.options) if show_options else None,
        "deadline": rnd.deadline,
        "myAnswer": mine.option_index if mine else None,
        "teamVotes": _team_votes(room, player_id),
        "result": result,
    }


def player_view(room: Room, player_id: str, now: int) -> dict:
    player = room.players[player_id]
    rank = next(r for p, r in room.leaderboard() if p.id == player_id)
    calib = room.calib
    show_board = room.phase in (Phase.REVEAL, Phase.FINISHED)
    return {
        "code": room.code,
        "phase": room.phase.value,
        "serverNow": now,
        "hostOnline": room.host_online,
        "playerCount": len(room.players),
        "me": {
            "id": player.id,
            "name": player.name,
            "score": player.score,
            "rank": rank,
            "delayMs": room.effective_delays()[player_id],
            "calibrated": player.delay_ms is not None,
            "team": player.team,
        },
        "teams": _teams(room, by_id=False),
        "calib": None if calib is None else {"round": calib.round, "tapped": player_id in calib.tapped},
        "round": _player_round(room, player_id),
        "leaderboardTop": _leaderboard(room)[:LEADERBOARD_TOP] if show_board else None,
    }
