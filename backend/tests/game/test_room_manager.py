from random import Random

from app.game.constants import ROOM_CODE_ALPHABET
from app.game.models import Phase, Settings, Timing
from app.game.room_manager import RoomManager
from tests.factories import POPULAR, game_error, make_songs

MINUTE = 60_000
SETTINGS = Settings(question_count=2)


def new_manager(seed=1, timing=Timing()):
    return RoomManager(POPULAR, rng=Random(seed), timing=timing)


def test_create_room_registers_it_with_a_valid_code():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=1_000)
    assert len(room.code) == 6 and set(room.code) <= set(ROOM_CODE_ALPHABET)
    assert manager.rooms[room.code] is room
    assert len(room.host_token) >= 20
    assert room.created_at == 1_000 and room.phase is Phase.LOBBY


def test_rooms_get_the_manager_timing():
    timing = Timing(calib_tap_window_ms=300)
    room = new_manager(timing=timing).create_room(make_songs(3), SETTINGS, now=0)
    assert room.timing is timing


def test_get_normalises_the_code():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    assert manager.get(f"  {room.code.lower()} ") is room
    assert game_error(manager.get, "ZZZZZZ") == "ROOM_NOT_FOUND"


def test_codes_never_collide_with_live_rooms():
    manager = new_manager(seed=5)
    first = manager.create_room(make_songs(3), SETTINGS, now=0)
    manager.rng = Random(5)  # same seed: the first code drawn now equals `first.code`
    second = manager.create_room(make_songs(3), SETTINGS, now=0)
    assert second.code != first.code
    assert len(manager.rooms) == 2


def test_many_rooms_have_unique_codes():
    manager = new_manager()
    codes = {manager.create_room(make_songs(3), SETTINGS, now=0).code for _ in range(200)}
    assert len(codes) == 200


def test_remove():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    manager.remove(room.code)
    manager.remove(room.code)  # removing twice is harmless
    assert room.code not in manager.rooms


def test_expiry_rules():
    manager = new_manager()
    fresh = manager.create_room(make_songs(3), SETTINGS, now=0)
    finished = manager.create_room(make_songs(3), SETTINGS, now=0)
    finished.phase, finished.finished_at = Phase.FINISHED, 10 * MINUTE
    host_gone = manager.create_room(make_songs(3), SETTINGS, now=0)
    host_gone.set_host_online(False, now=20 * MINUTE)

    assert manager.expired(35 * MINUTE) == []  # 25 min finished, 15 min offline: not yet
    assert set(manager.expired(35 * MINUTE + 1)) == {host_gone.code}
    assert set(manager.expired(40 * MINUTE + 1)) == {host_gone.code, finished.code}
    assert fresh.code not in manager.expired(240 * MINUTE)
    assert fresh.code in manager.expired(240 * MINUTE + 1)


def test_host_coming_back_cancels_offline_expiry():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    room.set_host_online(False, now=0)
    room.set_host_online(True, now=MINUTE)
    assert manager.expired(30 * MINUTE) == []
