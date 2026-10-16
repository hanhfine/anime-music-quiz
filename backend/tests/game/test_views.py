import json

from app.game.views import host_view, player_view
from tests.factories import make_room

HOST_KEYS = {"code", "phase", "mode", "settings", "serverNow", "players", "calib", "round", "leaderboard", "notice"}
PLAYER_KEYS = {"code", "phase", "serverNow", "hostOnline", "playerCount", "me", "calib", "round", "leaderboardTop"}
SECRET_KEYS = {"videoId", "startSec", "endSec", "correctIndex", "animeName", "songLabel", "reveal", "result", "gained"}


def non_null_keys(value) -> set[str]:
    """Mọi khóa có giá trị khác None, tìm đệ quy."""
    if isinstance(value, dict):
        own = {key for key, item in value.items() if item is not None}
        return own.union(*(non_null_keys(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(non_null_keys(item) for item in value))
    return set()


def lobby_room(count=3):
    room = make_room(now=1_000)
    ids = [room.add_player(f"P{i}").id for i in range(count)]
    return room, ids


def test_player_view_never_leaks_the_answer_before_reveal():
    room, (a, b, _) = lobby_room()
    snapshots = [player_view(room, a, 1_000)]
    room.start_game()
    snapshots.append(player_view(room, a, 3_000))
    room.audio_started(0, 4_000)
    snapshots.append(player_view(room, a, 4_100))
    room.answer(a, 0, room.round.question.correct_index, 4_500)
    snapshots += [player_view(room, a, 4_600), player_view(room, b, 4_600)]
    video_id = room.round.question.song.video_id
    for view in snapshots:
        assert non_null_keys(view) & SECRET_KEYS == set()
        assert video_id not in json.dumps(view)


def test_player_options_appear_only_once_answering():
    room, (a, _, _) = lobby_room()
    room.start_game()
    view = player_view(room, a, 0)
    assert view["round"]["options"] is None
    assert (view["round"]["index"], view["round"]["total"]) == (0, 3)
    room.audio_started(0, 1_000)
    view = player_view(room, a, 1_000)
    assert view["round"]["options"] == list(room.round.question.options)
    assert view["round"]["deadline"] == 19_000


def test_player_results_at_reveal():
    room, (a, b, c) = lobby_room()
    room.start_game()
    room.audio_started(0, 1_000)
    q = room.round.question
    room.answer(a, 0, q.correct_index, 1_000)
    room.answer(b, 0, (q.correct_index + 1) % 4, 1_000)
    room.tick(19_000)
    ra, rb, rc = (player_view(room, pid, 19_000)["round"]["result"] for pid in (a, b, c))
    assert ra == {
        "correctIndex": q.correct_index,
        "correct": True,
        "gained": 1_000,
        "animeName": q.song.anime_name,
        "songLabel": q.song.song_label,
    }
    assert (rb["correct"], rb["gained"]) == (False, 0)
    assert (rc["correct"], rc["gained"]) == (False, 0)
    me = player_view(room, a, 19_000)["me"]
    assert (me["score"], me["rank"]) == (1_000, 1)


def test_leaderboard_top_is_limited_to_ten_and_only_after_reveal():
    room, ids = lobby_room(count=12)
    assert player_view(room, ids[0], 0)["leaderboardTop"] is None
    room.start_game()
    room.audio_started(0, 1_000)
    room.tick(19_000)
    top = player_view(room, ids[0], 19_000)["leaderboardTop"]
    assert len(top) == 10
    assert set(top[0]) == {"playerId", "name", "score", "rank", "gained"}


def test_player_calibration_view():
    room, (a, b, _) = lobby_room()
    room.start_calibration()
    room.calib_flash(1, 1_000)
    room.calib_tap(a, 1, 1_400)
    assert player_view(room, a, 1_500)["calib"] == {"round": 1, "tapped": True}
    assert player_view(room, b, 1_500)["calib"] == {"round": 1, "tapped": False}


def test_player_view_shape_in_lobby():
    room, (a, _, _) = lobby_room()
    room.set_host_online(False, 500)
    view = player_view(room, a, 1_234)
    assert set(view) == PLAYER_KEYS
    assert (view["serverNow"], view["hostOnline"], view["playerCount"]) == (1_234, False, 3)
    assert view["me"] == {"id": a, "name": "P0", "score": 0, "rank": 1, "delayMs": 0, "calibrated": False}
    assert view["calib"] is None and view["round"] is None


def test_host_view_in_lobby():
    room, (a, b, _) = lobby_room()
    room.players[a].delay_ms = 1_200
    room.set_player_online(b, False)
    view = host_view(room, 5_000)
    assert set(view) == HOST_KEYS
    assert (view["phase"], view["mode"], view["serverNow"]) == ("LOBBY", "stream", 5_000)
    assert view["settings"] == {"questionCount": 3, "clipSec": 15, "revealSec": 15, "maxPlayers": 30, "mode": "stream"}
    pa, pb, pc = view["players"]
    assert pa == {"id": a, "name": "P0", "online": True, "delayMs": 1_200, "calibrated": True, "score": 0}
    assert pb["online"] is False
    assert (pc["delayMs"], pc["calibrated"]) == (1_200, False)  # room-median fallback
    assert view["calib"] is None and view["round"] is None and view["notice"] is None
    assert [row["gained"] for row in view["leaderboard"]] == [None, None, None]


def test_host_view_calibration_counts_taps():
    room, (a, _, _) = lobby_room()
    room.start_calibration()
    wait = room.calib.wait_ms
    assert host_view(room, 0)["calib"] == {"round": 1, "waitMs": wait, "flashed": False, "tappedCount": 0}
    room.calib_flash(1, 1_000)
    room.calib_tap(a, 1, 1_300)
    assert host_view(room, 1_300)["calib"] == {"round": 1, "waitMs": wait, "flashed": True, "tappedCount": 1}


def test_host_view_round_while_answering():
    room, (a, _, _) = lobby_room()
    room.start_game()
    q = room.round.question
    preparing = host_view(room, 0)["round"]
    assert preparing["deadline"] is None and preparing["prepareSeq"] == 1
    room.audio_started(0, 1_000)
    room.answer(a, 0, 0, 1_500)
    assert host_view(room, 1_500)["round"] == {
        "index": 0,
        "total": 3,
        "videoId": q.song.video_id,
        "startSec": q.start_sec,
        "endSec": q.end_sec,
        "options": list(q.options),
        "deadline": 19_000,
        "answeredCount": 1,
        "onlineCount": 3,
        "prepareSeq": 1,
        "reveal": None,
    }


def test_host_view_reveal():
    room, (a, b, c) = lobby_room()
    room.start_game()
    room.audio_started(0, 1_000)
    q = room.round.question
    wrong = (q.correct_index + 1) % 4
    room.answer(a, 0, q.correct_index, 1_000)
    room.answer(b, 0, wrong, 1_000)
    room.answer(c, 0, wrong, 1_000)
    view = host_view(room, 2_000)
    counts = [0, 0, 0, 0]
    counts[q.correct_index], counts[wrong] = 1, 2
    assert view["round"]["reveal"] == {
        "correctIndex": q.correct_index,
        "optionCounts": counts,
        "animeName": q.song.anime_name,
        "songLabel": q.song.song_label,
    }
    rows = [(row["name"], row["rank"], row["gained"]) for row in view["leaderboard"]]
    assert rows == [("P0", 1, 1_000), ("P1", 2, 0), ("P2", 2, 0)]


def test_host_view_shows_notice_and_views_are_json():
    room, (a, _, _) = lobby_room()
    room.start_game()
    room.audio_failed(0, 500)
    view = host_view(room, 500)
    assert view["notice"] == "AUDIO_REPLACED"
    for snapshot in (view, player_view(room, a, 500)):
        assert json.loads(json.dumps(snapshot)) == snapshot
