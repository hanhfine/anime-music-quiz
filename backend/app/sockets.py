"""Lớp mỏng nối Socket.IO với game: phiên kết nối, gọi `Room`, đẩy snapshot theo vai trò, hẹn giờ."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import socketio

from app.game.constants import CLEANUP_INTERVAL_SEC
from app.game.models import GameError
from app.game.room import Room
from app.game.room_manager import RoomManager
from app.game.validation import parse_create_room
from app.game.views import host_view, player_view

logger = logging.getLogger(__name__)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class Session:
    code: str
    role: str  # "host" | "player"
    player_id: str | None = None


def _field(data: object, key: str, kind: type) -> object:
    """Lấy data[key] đúng kiểu; payload hỏng → INVALID_STATE."""
    if not isinstance(data, dict):
        raise GameError("INVALID_STATE")
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, kind):
        raise GameError("INVALID_STATE")
    return value


def _str(data: object, key: str) -> str:
    return _field(data, key, str)


def _int(data: object, key: str) -> int:
    return _field(data, key, int)


class GameServer:
    """Mỗi phương thức `host_<x>` / `player_<x>` là handler của sự kiện `host:<x>` / `player:<x>`.

    Handler trả về dict (gộp vào ack `{"ok": true, ...}`) hoặc ném GameError (ack `{"ok": false, "error"}`).
    """

    def __init__(self, manager: RoomManager, clock: Callable[[], int] = now_ms) -> None:
        self.manager = manager
        self.clock = clock
        self.sio = socketio.AsyncServer(async_mode="asgi")
        self.sessions: dict[str, Session] = {}
        self.members: dict[str, set[str]] = {}
        self.timers: dict[str, asyncio.Task] = {}
        self.handlers: dict[str, Callable[[str, object], Awaitable[dict | None]]] = {}
        for name in dir(type(self)):
            if name.startswith(("host_", "player_")):
                event = name.replace("_", ":", 1)
                self.handlers[event] = getattr(self, name)
                self.sio.on(event, self._bind(event))
        self.sio.on("disconnect", self._on_disconnect)

    def _bind(self, event: str):
        async def on_event(sid, *args):
            return await self.handle(event, sid, args[0] if args else None)

        return on_event

    async def handle(self, event: str, sid: str, data: object = None) -> dict:
        try:
            result = await self.handlers[event](sid, data)
        except GameError as exc:
            return {"ok": False, "error": exc.code}
        return {"ok": True, **(result or {})}

    # ---- phiên kết nối ----

    def _host(self, sid: str) -> Room:
        session = self.sessions.get(sid)
        if session is None or session.role != "host":
            raise GameError("INVALID_TOKEN")
        return self.manager.get(session.code)

    async def _attach(self, sid: str, session: Session) -> None:
        old_room = self._detach(sid)
        if old_room is not None and old_room.code != session.code:
            await self._broadcast(old_room)
        self.sessions[sid] = session
        self.members.setdefault(session.code, set()).add(sid)

    def _forget(self, sid: str) -> Session | None:
        session = self.sessions.pop(sid, None)
        if session is not None:
            members = self.members.get(session.code, set())
            members.discard(sid)
            if not members:
                self.members.pop(session.code, None)
        return session

    def _detach(self, sid: str) -> Room | None:
        """Gỡ phiên của sid. Nếu đó là kết nối cuối của host/người chơi thì đánh dấu offline và trả về phòng."""
        session = self._forget(sid)
        if session is None:
            return None
        try:
            room = self.manager.get(session.code)
        except GameError:
            return None
        if any(self.sessions.get(other) == session for other in self.members.get(session.code, ())):
            return None
        if session.role == "host":
            room.set_host_online(False, self.clock())
        else:
            room.set_player_online(session.player_id, False)
        return room

    async def _on_disconnect(self, sid: str, *_reason) -> None:
        room = self._detach(sid)
        if room is not None:
            await self._broadcast(room)

    # ---- đẩy snapshot và hẹn giờ ----

    async def _broadcast(self, room: Room) -> None:
        now = self.clock()
        for sid in list(self.members.get(room.code, ())):
            session = self.sessions.get(sid)
            if session is None:
                continue
            if session.role == "host":
                await self.sio.emit("room:state", host_view(room, now), to=sid)
            elif session.player_id in room.players:
                await self.sio.emit("room:state", player_view(room, session.player_id, now), to=sid)
        self._schedule(room)

    def _schedule(self, room: Room) -> None:
        timer = self.timers.pop(room.code, None)
        if timer is not None:
            timer.cancel()
        wakeup = room.next_wakeup()
        if wakeup is not None:
            delay = max(0, wakeup - self.clock()) / 1000
            self.timers[room.code] = asyncio.create_task(self._wake(room.code, delay))

    async def _wake(self, code: str, delay: float) -> None:
        await asyncio.sleep(delay)
        self.timers.pop(code, None)
        try:
            room = self.manager.get(code)
        except GameError:
            return
        if room.tick(self.clock()):
            await self._broadcast(room)
        else:
            self._schedule(room)

    # ---- dọn phòng ----

    async def cleanup_loop(self, interval_sec: float = CLEANUP_INTERVAL_SEC) -> None:
        while True:
            await asyncio.sleep(interval_sec)
            try:
                await self.cleanup()
            except Exception:
                logger.exception("cleanup failed")

    async def cleanup(self) -> None:
        for code in self.manager.expired(self.clock()):
            await self._close(code, "EXPIRED")

    async def _close(self, code: str, reason: str) -> None:
        timer = self.timers.pop(code, None)
        if timer is not None:
            timer.cancel()
        self.manager.remove(code)
        for sid in list(self.members.get(code, ())):
            self._forget(sid)
            await self.sio.emit("room:closed", {"reason": reason}, to=sid)

    # ---- quản trò: phòng ----

    async def host_create_room(self, sid: str, data: object) -> dict:
        songs, settings = parse_create_room(data)
        room = self.manager.create_room(songs, settings, self.clock())
        await self._attach(sid, Session(room.code, "host"))
        await self._broadcast(room)
        return {"code": room.code, "hostToken": room.host_token}

    async def host_resume(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        if not room.is_host_token(_str(data, "hostToken")):
            raise GameError("INVALID_TOKEN")
        await self._attach(sid, Session(room.code, "host"))
        room.set_host_online(True, self.clock())
        await self._broadcast(room)
        return {}

    async def host_kick(self, sid: str, data: object) -> dict:
        room = self._host(sid)
        player = room.kick(_str(data, "playerId"))
        for other in list(self.members.get(room.code, ())):
            session = self.sessions.get(other)
            if session is not None and session.player_id == player.id:
                self._forget(other)
                await self.sio.emit("room:closed", {"reason": "KICKED"}, to=other)
        await self._broadcast(room)
        return {}

    async def host_close_room(self, sid: str, data: object) -> dict:
        room = self._host(sid)
        await self._close(room.code, "CLOSED")
        return {}

    # ---- người chơi: vào phòng ----

    async def player_join(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        player = room.add_player(_str(data, "name"))
        await self._attach(sid, Session(room.code, "player", player.id))
        await self._broadcast(room)
        return {"playerId": player.id, "playerToken": player.token}

    async def player_rejoin(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        player = room.player_by_token(_str(data, "playerToken"))
        await self._attach(sid, Session(room.code, "player", player.id))
        room.set_player_online(player.id, True)
        await self._broadcast(room)
        return {"playerId": player.id}
