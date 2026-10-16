"""Quản lý các phòng đang sống: cấp mã phòng, tra cứu, tìm phòng hết hạn."""

import secrets
from random import Random, SystemRandom

from app.game.constants import (
    FINISHED_TTL_MS,
    HOST_OFFLINE_TTL_MS,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    ROOM_MAX_AGE_MS,
)
from app.game.models import GameError, Phase, Settings, Song, Timing
from app.game.room import Room


def _is_expired(room: Room, now: int) -> bool:
    if now - room.created_at > ROOM_MAX_AGE_MS:
        return True
    if room.phase is Phase.FINISHED and room.finished_at is not None and now - room.finished_at > FINISHED_TTL_MS:
        return True
    offline_since = room.host_offline_since
    return not room.host_online and offline_since is not None and now - offline_since > HOST_OFFLINE_TTL_MS


class RoomManager:
    def __init__(self, popular: list[str], rng: Random | None = None, timing: Timing = Timing()) -> None:
        self.popular = popular
        self.rng = rng if rng is not None else SystemRandom()
        self.timing = timing
        self.rooms: dict[str, Room] = {}

    def _new_code(self) -> str:
        while True:
            code = "".join(self.rng.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))
            if code not in self.rooms:
                return code

    def create_room(self, songs: list[Song], settings: Settings, now: int) -> Room:
        code = self._new_code()
        room = Room(
            code=code,
            host_token=secrets.token_urlsafe(16),
            songs=songs,
            settings=settings,
            popular=self.popular,
            rng=Random(self.rng.getrandbits(64)),
            now=now,
            timing=self.timing,
        )
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Room:
        room = self.rooms.get(code.strip().upper())
        if room is None:
            raise GameError("ROOM_NOT_FOUND")
        return room

    def remove(self, code: str) -> None:
        self.rooms.pop(code, None)

    def expired(self, now: int) -> list[str]:
        return [code for code, room in self.rooms.items() if _is_expired(room, now)]
