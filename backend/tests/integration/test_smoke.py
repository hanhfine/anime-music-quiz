import httpx

from tests.factories import set_payload


async def test_health_over_http(server_url):
    async with httpx.AsyncClient() as http:
        response = await http.get(f"{server_url}/api/health")
    assert response.json() == {"ok": True}


async def test_lobby_round_trip(connect):
    host = await connect()
    created = await host.emit("host:create_room", set_payload(4))
    assert created["ok"], created
    await host.wait_for(lambda s: s["phase"] == "LOBBY")

    player = await connect()
    joined = await player.emit("player:join", {"code": created["code"], "name": "Alice"})
    assert joined["ok"], joined
    await player.wait_for(lambda s: s["me"]["name"] == "Alice")
    await host.wait_for(lambda s: [p["name"] for p in s["players"]] == ["Alice"])

    await player.sio.disconnect()
    await host.wait_for(lambda s: s["players"][0]["online"] is False)

    assert await host.emit("host:close_room") == {"ok": True}
    await host.wait_until(lambda: host.closed == [{"reason": "CLOSED"}])


async def test_rejoin_kick_and_join_errors(connect):
    host = await connect()
    code = (await host.emit("host:create_room", set_payload(4)))["code"]
    first_tab = await connect()
    joined = await first_tab.emit("player:join", {"code": code, "name": "Alice"})
    await first_tab.sio.disconnect()
    await host.wait_for(lambda s: s["players"] and s["players"][0]["online"] is False)

    second_tab = await connect()
    rejoined = await second_tab.emit("player:rejoin", {"code": code, "playerToken": joined["playerToken"]})
    assert rejoined == {"ok": True, "playerId": joined["playerId"]}
    await second_tab.wait_for(lambda s: s["me"]["name"] == "Alice")
    await host.wait_for(lambda s: s["players"][0]["online"] is True)

    taken = await (await connect()).emit("player:join", {"code": code, "name": "ALICE"})
    assert taken == {"ok": False, "error": "NAME_TAKEN"}
    missing = await (await connect()).emit("player:join", {"code": "ZZZZZZ", "name": "Bob"})
    assert missing == {"ok": False, "error": "ROOM_NOT_FOUND"}

    assert await host.emit("host:kick", {"playerId": joined["playerId"]}) == {"ok": True}
    await second_tab.wait_until(lambda: second_tab.closed == [{"reason": "KICKED"}])
    await host.wait_for(lambda s: s["players"] == [])
