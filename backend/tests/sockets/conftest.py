from random import Random

import pytest

from app.game.models import Timing
from app.game.room_manager import RoomManager
from app.sockets import GameServer
from tests.factories import POPULAR
from tests.sockets.helpers import Emits, FakeClock


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def emits():
    return Emits()


@pytest.fixture
def server(clock, emits):
    manager = RoomManager(POPULAR, rng=Random(7), timing=Timing(calib_tap_window_ms=50))
    game = GameServer(manager, clock=clock)
    game.sio.emit = emits
    return game
