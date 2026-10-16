"""Đồng hồ giả, bộ ghi emit và vài thao tác hay dùng khi test GameServer không qua mạng."""

from app.sockets import GameServer
from tests.factories import set_payload


class FakeClock:
    def __init__(self, now: int = 1_000_000) -> None:
        self.now = now

    def __call__(self) -> int:
        return self.now


class Emits:
    """Thay cho `sio.emit`: ghi lại (event, data, to)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, object, str | None]] = []

    async def __call__(self, event, data=None, to=None, **_kwargs) -> None:
        self.events.append((event, data, to))

    def states(self, sid: str) -> list[dict]:
        return [data for event, data, to in self.events if event == "room:state" and to == sid]

    def last_state(self, sid: str) -> dict:
        states = self.states(sid)
        assert states, f"{sid} chưa nhận room:state nào"
        return states[-1]

    def closed(self, sid: str) -> list[dict]:
        return [data for event, data, to in self.events if event == "room:closed" and to == sid]


async def create_room(server: GameServer, sid: str = "host", count: int = 4, **settings) -> dict:
    ack = await server.handle("host:create_room", sid, set_payload(count, **settings))
    assert ack["ok"], ack
    return ack


async def join(server: GameServer, code: str, name: str, sid: str | None = None) -> dict:
    ack = await server.handle("player:join", sid or f"sid-{name}", {"code": code, "name": name})
    assert ack["ok"], ack
    return ack
