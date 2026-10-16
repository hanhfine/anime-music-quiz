from tests.sockets.helpers import create_room, join

LOBBY_EVENTS = {"host:create_room", "host:resume", "host:kick", "host:close_room", "player:join", "player:rejoin"}


def test_handlers_are_registered_as_events(server):
    assert LOBBY_EVENTS <= set(server.handlers)
    assert LOBBY_EVENTS | {"disconnect"} <= set(server.sio.handlers["/"])


async def test_create_room_acks_code_and_sends_host_view(server, emits):
    ack = await create_room(server)
    assert len(ack["code"]) == 6 and ack["hostToken"]
    state = emits.last_state("host")
    assert (state["code"], state["phase"], state["players"]) == (ack["code"], "LOBBY", [])


async def test_create_room_rejects_bad_set(server):
    assert await server.handle("host:create_room", "host", {"set": {"songs": []}}) == {
        "ok": False,
        "error": "INVALID_SET",
    }
    assert (await server.handle("host:create_room", "host"))["error"] == "INVALID_SET"


async def test_events_without_session_are_invalid_token(server):
    assert await server.handle("host:close_room", "nobody") == {"ok": False, "error": "INVALID_TOKEN"}
    assert (await server.handle("host:kick", "nobody", {"playerId": "x"}))["error"] == "INVALID_TOKEN"


async def test_join_sends_role_specific_views(server, emits):
    code = (await create_room(server))["code"]
    ack = await join(server, code, "Alice")
    assert ack["playerId"] and ack["playerToken"]
    host_state = emits.last_state("host")
    assert [(p["name"], p["online"]) for p in host_state["players"]] == [("Alice", True)]
    alice_state = emits.last_state("sid-Alice")
    assert alice_state["me"]["name"] == "Alice"
    assert "players" not in alice_state


async def test_join_code_is_case_insensitive(server):
    code = (await create_room(server))["code"]
    await join(server, f"  {code.lower()} ", "Alice")


async def test_join_errors(server):
    code = (await create_room(server))["code"]
    await join(server, code, "Alice")
    assert (await server.handle("player:join", "s1", {"code": "ZZZZZZ", "name": "Bob"}))["error"] == "ROOM_NOT_FOUND"
    assert (await server.handle("player:join", "s2", {"code": code, "name": "alice"}))["error"] == "NAME_TAKEN"
    assert (await server.handle("player:join", "s3", {"code": code, "name": " "}))["error"] == "INVALID_NAME"
    assert (await server.handle("player:join", "s4", "hello"))["error"] == "INVALID_STATE"
    assert (await server.handle("player:join", "s5", {"code": code, "name": 7}))["error"] == "INVALID_STATE"


async def test_disconnect_marks_player_offline_and_rejoin_restores(server, emits):
    code = (await create_room(server))["code"]
    joined = await join(server, code, "Alice", sid="tab-1")
    await server._on_disconnect("tab-1")
    assert emits.last_state("host")["players"][0]["online"] is False
    ack = await server.handle("player:rejoin", "tab-2", {"code": code, "playerToken": joined["playerToken"]})
    assert ack == {"ok": True, "playerId": joined["playerId"]}
    assert emits.last_state("host")["players"][0]["online"] is True
    assert emits.last_state("tab-2")["me"]["id"] == joined["playerId"]


async def test_rejoin_with_unknown_token(server):
    code = (await create_room(server))["code"]
    ack = await server.handle("player:rejoin", "tab", {"code": code, "playerToken": "nope"})
    assert ack == {"ok": False, "error": "INVALID_TOKEN"}


async def test_player_stays_online_while_another_tab_is_connected(server, emits):
    code = (await create_room(server))["code"]
    joined = await join(server, code, "Alice", sid="tab-1")
    await server.handle("player:rejoin", "tab-2", {"code": code, "playerToken": joined["playerToken"]})
    await server._on_disconnect("tab-1")
    assert emits.last_state("host")["players"][0]["online"] is True


async def test_host_disconnect_and_resume(server, emits):
    created = await create_room(server)
    code = created["code"]
    await join(server, code, "Alice")
    await server._on_disconnect("host")
    assert emits.last_state("sid-Alice")["hostOnline"] is False
    bad = await server.handle("host:resume", "host-2", {"code": code, "hostToken": "wrong"})
    assert bad == {"ok": False, "error": "INVALID_TOKEN"}
    missing = await server.handle("host:resume", "host-2", {"code": "ZZZZZZ", "hostToken": created["hostToken"]})
    assert missing["error"] == "ROOM_NOT_FOUND"
    ok = await server.handle("host:resume", "host-2", {"code": code, "hostToken": created["hostToken"]})
    assert ok == {"ok": True}
    assert emits.last_state("sid-Alice")["hostOnline"] is True
    assert emits.last_state("host-2")["players"][0]["name"] == "Alice"


async def test_kick_closes_the_players_sessions(server, emits):
    code = (await create_room(server))["code"]
    alice = await join(server, code, "Alice")
    await join(server, code, "Bob")
    assert await server.handle("host:kick", "host", {"playerId": alice["playerId"]}) == {"ok": True}
    assert emits.closed("sid-Alice") == [{"reason": "KICKED"}]
    assert [p["name"] for p in emits.last_state("host")["players"]] == ["Bob"]
    again = await server.handle("player:rejoin", "sid-x", {"code": code, "playerToken": alice["playerToken"]})
    assert again["error"] == "KICKED"


async def test_players_cannot_send_host_events(server):
    code = (await create_room(server))["code"]
    alice = await join(server, code, "Alice")
    ack = await server.handle("host:kick", "sid-Alice", {"playerId": alice["playerId"]})
    assert ack == {"ok": False, "error": "INVALID_TOKEN"}


async def test_close_room_notifies_everyone_and_forgets_room(server, emits):
    code = (await create_room(server))["code"]
    await join(server, code, "Alice")
    assert await server.handle("host:close_room", "host") == {"ok": True}
    assert emits.closed("host") == [{"reason": "CLOSED"}]
    assert emits.closed("sid-Alice") == [{"reason": "CLOSED"}]
    assert server.manager.rooms == {} and server.sessions == {}
    assert (await server.handle("player:join", "late", {"code": code, "name": "Bob"}))["error"] == "ROOM_NOT_FOUND"


async def test_cleanup_closes_expired_rooms(server, emits, clock):
    code = (await create_room(server))["code"]
    await server.cleanup()
    assert code in server.manager.rooms
    clock.now += 4 * 60 * 60_000 + 1
    await server.cleanup()
    assert code not in server.manager.rooms
    assert emits.closed("host") == [{"reason": "EXPIRED"}]


async def test_creating_another_room_from_the_same_tab_detaches_the_old_one(server):
    first = (await create_room(server))["code"]
    second = (await create_room(server))["code"]
    assert first != second
    assert server.manager.get(first).host_online is False
    assert server.sessions["host"].code == second
