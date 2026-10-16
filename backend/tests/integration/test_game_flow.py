from tests.factories import set_payload


def correct_option(host_state: dict) -> int:
    rnd = host_state["round"]
    return rnd["options"].index(f"Anime {int(rnd['videoId'][3:])}")


async def must(client, event, data=None) -> dict:
    ack = await client.emit(event, data)
    assert ack["ok"], (event, ack)
    return ack


async def setup_room(connect, names, **settings):
    host = await connect()
    created = await must(host, "host:create_room", set_payload(4, **settings))
    players = {}
    for name in names:
        player = await connect()
        await must(player, "player:join", {"code": created["code"], "name": name})
        players[name] = player
    await host.wait_for(lambda s: len(s["players"]) == len(names))
    return host, players


async def test_full_game(connect):
    host, players = await setup_room(connect, ["Alice", "Bob", "Chi"], questionCount=2, clipSec=5)

    # Đo độ trễ: Alice và Bob bấm, Chi không bấm.
    await must(host, "host:calibrate")
    for round_no in (1, 2, 3):
        await host.wait_for(lambda s: s["calib"] and s["calib"]["round"] == round_no and not s["calib"]["flashed"])
        await must(host, "host:calib_flash", {"round": round_no})
        for name in ("Alice", "Bob"):
            await must(players[name], "player:calib_tap", {"round": round_no})
    lobby = await host.wait_for(lambda s: s["phase"] == "LOBBY")
    calibrated = {p["name"]: p["calibrated"] for p in lobby["players"]}
    assert calibrated == {"Alice": True, "Bob": True, "Chi": False}

    # 2 câu: Alice và Chi đúng, Bob sai.
    await must(host, "host:start")
    for round_index in (0, 1):
        state = await host.wait_for(lambda s: s["phase"] == "PREPARING" and s["round"]["index"] == round_index)
        await must(host, "host:audio_started", {"roundIndex": round_index})
        right = correct_option(state)
        for name, player in players.items():
            await player.wait_for(lambda s: s["phase"] == "ANSWERING" and s["round"]["index"] == round_index)
            choice = (right + 1) % 4 if name == "Bob" else right
            await must(player, "player:answer", {"roundIndex": round_index, "optionIndex": choice})
        reveal = await host.wait_for(lambda s: s["phase"] == "REVEAL")
        assert reveal["round"]["reveal"]["correctIndex"] == right
        alice = await players["Alice"].wait_for(lambda s: s["phase"] == "REVEAL")
        assert alice["round"]["result"]["correct"] is True
        await must(host, "host:next")

    finished = await host.wait_for(lambda s: s["phase"] == "FINISHED")
    scores = {row["name"]: row["score"] for row in finished["leaderboard"]}
    assert scores["Alice"] > 0 and scores["Chi"] > 0 and scores["Bob"] == 0
    bob = await players["Bob"].wait_for(lambda s: s["phase"] == "FINISHED")
    assert [row["name"] for row in bob["leaderboardTop"]][-1] == "Bob"

    await must(host, "host:play_again")
    again = await host.wait_for(lambda s: s["phase"] == "LOBBY")
    assert all(p["score"] == 0 for p in again["players"])


async def test_audio_failure_shows_notice(connect):
    host, _players = await setup_room(connect, ["Alice"], questionCount=2)
    await must(host, "host:start")
    first = await host.wait_for(lambda s: s["phase"] == "PREPARING")
    await must(host, "host:audio_failed", {"roundIndex": 0, "reason": "150"})
    state = await host.wait_for(lambda s: s["notice"] == "AUDIO_REPLACED")
    assert state["round"]["prepareSeq"] == first["round"]["prepareSeq"] + 1
