from tests.sockets.helpers import create_room, join

GAME_EVENTS = {
    "host:calibrate",
    "host:calib_flash",
    "host:start",
    "host:audio_started",
    "host:audio_failed",
    "host:replay_round",
    "host:next",
    "host:play_again",
    "player:calib_tap",
    "player:answer",
}


def correct_option(host_state: dict) -> int:
    rnd = host_state["round"]
    return rnd["options"].index(f"Anime {int(rnd['videoId'][3:])}")


async def lobby(server, *names, **settings) -> str:
    code = (await create_room(server, **settings))["code"]
    for name in names:
        await join(server, code, name)
    return code


async def ok(server, event, sid="host", data=None) -> None:
    ack = await server.handle(event, sid, data)
    assert ack == {"ok": True}, (event, ack)


async def answering(server, emits, *names, **settings) -> str:
    """Tạo phòng, cho người chơi vào, bắt đầu và phát xong câu 1."""
    code = await lobby(server, *names, **settings)
    await ok(server, "host:start")
    await ok(server, "host:audio_started", data={"roundIndex": 0})
    assert emits.last_state("host")["phase"] == "ANSWERING"
    return code


def test_game_handlers_are_registered_as_events(server):
    assert GAME_EVENTS <= set(server.handlers)
    assert GAME_EVENTS <= set(server.sio.handlers["/"])


async def test_calibration_rounds_end_when_the_timer_fires(server, emits, clock):
    code = await lobby(server, "Alice", "Bob")
    await ok(server, "host:calibrate")
    assert emits.last_state("host")["calib"]["round"] == 1
    for round_no in (1, 2, 3):
        assert (await server.handle("player:calib_tap", "sid-Alice", {"round": round_no}))["error"] == "INVALID_STATE"
        await ok(server, "host:calib_flash", data={"round": round_no})
        clock.now += 20
        await ok(server, "player:calib_tap", "sid-Alice", {"round": round_no})
        assert emits.last_state("host")["calib"]["tappedCount"] == 1
        repeat = await server.handle("player:calib_tap", "sid-Alice", {"round": round_no})
        assert repeat == {"ok": False, "error": "ALREADY_ANSWERED"}
        timer = server.timers[code]
        clock.now += 100  # cửa sổ bấm 50 ms đã hết
        await timer
    host_state = emits.last_state("host")
    assert host_state["phase"] == "LOBBY" and host_state["calib"] is None
    delays = {p["name"]: (p["delayMs"], p["calibrated"]) for p in host_state["players"]}
    assert delays == {"Alice": (20, True), "Bob": (20, False)}


async def test_malformed_payloads_are_invalid_state(server):
    await lobby(server, "Alice")
    await ok(server, "host:calibrate")
    assert (await server.handle("host:calib_flash", "host", {"round": "1"}))["error"] == "INVALID_STATE"
    assert (await server.handle("host:calib_flash", "host", {"round": True}))["error"] == "INVALID_STATE"
    assert (await server.handle("host:calib_flash", "host"))["error"] == "INVALID_STATE"


async def test_roles_are_enforced(server):
    await lobby(server, "Alice")
    assert (await server.handle("host:start", "sid-Alice"))["error"] == "INVALID_TOKEN"
    assert (await server.handle("player:answer", "host", {"roundIndex": 0, "optionIndex": 0}))["error"] == (
        "INVALID_TOKEN"
    )


async def test_start_sends_video_to_host_only(server, emits):
    await lobby(server, "Alice", count=4, questionCount=2)
    await ok(server, "host:start")
    host_round = emits.last_state("host")["round"]
    assert (host_round["index"], host_round["total"], host_round["prepareSeq"]) == (0, 2, 1)
    assert host_round["videoId"].startswith("vid")
    alice_state = emits.last_state("sid-Alice")
    assert alice_state["phase"] == "PREPARING"
    assert alice_state["round"]["options"] is None
    assert "videoId" not in str(alice_state)


async def test_answers_are_scored_and_round_reveals_early(server, emits, clock):
    await answering(server, emits, "Alice", "Bob", count=4, questionCount=2, clipSec=5)
    host_state = emits.last_state("host")
    assert host_state["round"]["deadline"] == clock.now + 5000 + 3000
    alice_round = emits.last_state("sid-Alice")["round"]
    assert len(alice_round["options"]) == 4 and alice_round["result"] is None
    right = correct_option(host_state)
    clock.now += 1000
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert emits.last_state("host")["round"]["answeredCount"] == 1
    assert emits.last_state("sid-Alice")["round"]["myAnswer"] == right
    again = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert again == {"ok": False, "error": "ALREADY_ANSWERED"}
    await ok(server, "player:answer", "sid-Bob", {"roundIndex": 0, "optionIndex": (right + 1) % 4})
    host_state = emits.last_state("host")
    assert host_state["phase"] == "REVEAL"
    assert host_state["round"]["reveal"]["correctIndex"] == right
    assert [(r["name"], r["score"], r["rank"]) for r in host_state["leaderboard"]] == [
        ("Alice", 900, 1),
        ("Bob", 0, 2),
    ]
    alice_result = emits.last_state("sid-Alice")["round"]["result"]
    assert (alice_result["correct"], alice_result["gained"]) == (True, 900)
    await ok(server, "host:next")
    assert emits.last_state("host")["round"]["index"] == 1
    assert emits.last_state("sid-Bob")["phase"] == "PREPARING"


async def test_answer_errors(server, emits):
    await lobby(server, "Alice")
    await ok(server, "host:start")
    early = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": 0})
    assert early["error"] == "INVALID_STATE"
    await ok(server, "host:audio_started", data={"roundIndex": 0})
    wrong_round = await server.handle("player:answer", "sid-Alice", {"roundIndex": 1, "optionIndex": 0})
    assert wrong_round["error"] == "INVALID_STATE"
    malformed = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0})
    assert malformed["error"] == "INVALID_STATE"


async def test_deadline_reveals_round_when_the_timer_fires(server, emits, clock):
    code = await answering(server, emits, "Alice", clipSec=5)
    clock.now += 8001
    server._schedule(server.manager.get(code))  # tái hẹn theo đồng hồ giả → chạy ngay
    await server.timers[code]
    state = emits.last_state("sid-Alice")
    assert state["phase"] == "REVEAL"
    assert state["round"]["result"]["gained"] == 0


async def test_last_unanswered_player_leaving_reveals_round(server, emits):
    await answering(server, emits, "Alice", "Bob")
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    await server._on_disconnect("sid-Bob")
    assert emits.last_state("host")["phase"] == "REVEAL"


async def test_audio_failed_replaces_song_and_sets_notice(server, emits):
    await lobby(server, "Alice", count=4, questionCount=2)
    await ok(server, "host:start")
    before = emits.last_state("host")["round"]
    await ok(server, "host:audio_failed", data={"roundIndex": 0, "reason": "150"})
    state = emits.last_state("host")
    assert (state["phase"], state["notice"]) == ("PREPARING", "AUDIO_REPLACED")
    assert state["round"]["prepareSeq"] == before["prepareSeq"] + 1
    assert state["round"]["videoId"] != before["videoId"]


async def test_replay_round_from_reveal_undoes_points(server, emits):
    await answering(server, emits, "Alice")
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert emits.last_state("sid-Alice")["me"]["score"] > 0
    await ok(server, "host:replay_round")
    state = emits.last_state("sid-Alice")
    assert (state["phase"], state["round"]["index"], state["me"]["score"]) == ("PREPARING", 0, 0)


async def test_finish_and_play_again(server, emits):
    await answering(server, emits, "Alice", questionCount=1)
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    await ok(server, "host:next")
    finished = emits.last_state("sid-Alice")
    assert finished["phase"] == "FINISHED"
    assert finished["leaderboardTop"][0]["name"] == "Alice"
    await ok(server, "host:play_again")
    again = emits.last_state("sid-Alice")
    assert (again["phase"], again["me"]["score"]) == ("LOBBY", 0)
