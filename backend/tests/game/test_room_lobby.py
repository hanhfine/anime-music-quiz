import pytest

from app.game.models import Phase
from tests.factories import game_error, make_room


def test_new_room_is_lobby_with_online_host():
    room = make_room(now=1_000)
    assert room.phase is Phase.LOBBY
    assert room.host_online and room.created_at == 1_000
    assert room.players == {}


def test_add_player_trims_name_and_issues_credentials():
    room = make_room()
    player = room.add_player("  Linh  ")
    assert player.name == "Linh"
    assert room.players[player.id] is player
    assert len(player.token) >= 20
    assert player.online and player.delay_ms is None and player.score == 0


@pytest.mark.parametrize("name", ["", "   ", "x" * 21])
def test_invalid_names_are_rejected(name):
    assert game_error(make_room().add_player, name) == "INVALID_NAME"


def test_twenty_character_name_is_allowed():
    assert make_room().add_player("x" * 20).name == "x" * 20


def test_names_are_unique_ignoring_case():
    room = make_room()
    room.add_player("Linh")
    assert game_error(room.add_player, " linh ") == "NAME_TAKEN"


def test_room_full():
    room = make_room(max_players=2)
    room.add_player("A")
    room.add_player("B")
    assert game_error(room.add_player, "C") == "ROOM_FULL"


def test_join_is_allowed_while_calibrating():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert room.add_player("B").name == "B"


def test_player_by_token():
    room = make_room()
    player = room.add_player("A")
    assert room.player_by_token(player.token) is player
    assert game_error(room.player_by_token, "nope") == "INVALID_TOKEN"


def test_kicked_player_token_is_refused():
    room = make_room()
    player = room.add_player("A")
    assert room.kick(player.id) is player
    assert player.id not in room.players
    assert game_error(room.player_by_token, player.token) == "KICKED"


def test_kick_unknown_player_is_invalid_state():
    assert game_error(make_room().kick, "missing") == "INVALID_STATE"


def test_host_token_check():
    room = make_room()
    assert room.is_host_token("host-token")
    assert not room.is_host_token("wrong")
    assert not room.is_host_token("hôst-token")  # non-ASCII must not crash


def test_host_offline_tracking():
    room = make_room()
    room.set_host_online(False, now=5_000)
    assert not room.host_online and room.host_offline_since == 5_000
    room.set_host_online(True, now=6_000)
    assert room.host_online and room.host_offline_since is None


def test_calibrate_needs_an_online_player():
    room = make_room()
    assert game_error(room.start_calibration) == "INVALID_STATE"
    player = room.add_player("A")
    room.set_player_online(player.id, False)
    assert game_error(room.start_calibration) == "INVALID_STATE"
    assert room.phase is Phase.LOBBY


def test_calibrate_starts_round_one_with_random_wait():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert room.phase is Phase.CALIBRATING
    assert room.calib.round == 1 and 2_000 <= room.calib.wait_ms <= 4_000
    assert room.calib.flash_at is None
    assert game_error(room.start_calibration) == "INVALID_STATE"


def test_flash_must_match_round_and_happen_once():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert game_error(room.calib_flash, 2, 1_000) == "INVALID_STATE"
    room.calib_flash(1, 1_000)
    assert game_error(room.calib_flash, 1, 1_100) == "INVALID_STATE"
    assert room.calib.flash_at == 1_000


def test_tap_rules():
    room = make_room()
    a, b = room.add_player("A"), room.add_player("B")
    room.start_calibration()
    assert game_error(room.calib_tap, a.id, 1, 500) == "INVALID_STATE"  # before the flash
    room.calib_flash(1, 1_000)
    assert game_error(room.calib_tap, a.id, 2, 1_500) == "INVALID_STATE"  # wrong round
    room.calib_tap(a.id, 1, 1_800)
    assert game_error(room.calib_tap, a.id, 1, 1_900) == "ALREADY_ANSWERED"
    assert game_error(room.calib_tap, b.id, 1, 6_001) == "TOO_LATE"
    assert room.calib.tapped == {a.id}
    assert room.calib.samples == {a.id: [800]}


def test_wakeup_is_end_of_tap_window():
    room = make_room()
    room.add_player("A")
    assert room.next_wakeup() is None
    room.start_calibration()
    assert room.next_wakeup() is None
    room.calib_flash(1, 1_000)
    assert room.next_wakeup() == 6_000
    assert room.tick(5_999) is False
    assert room.tick(6_000) is True
    assert room.calib.round == 2 and room.calib.flash_at is None and room.calib.tapped == set()


def calibrate(room, taps_per_round, start=0):
    """Chạy đủ các lượt đo. Mỗi phần tử của taps_per_round là {player_id: độ trễ ms}."""
    now = start
    room.start_calibration()
    for round_no, taps in enumerate(taps_per_round, start=1):
        now += 10_000
        room.calib_flash(round_no, now)
        for player_id, delay in taps.items():
            room.calib_tap(player_id, round_no, now + delay)
        assert room.tick(now + room.timing.calib_tap_window_ms)
    return now


def test_three_rounds_measure_median_delay_and_return_to_lobby():
    room = make_room()
    a, b, c = room.add_player("A"), room.add_player("B"), room.add_player("C")
    calibrate(room, [{a.id: 800, b.id: 3_500}, {a.id: 1_200, b.id: 3_600}, {a.id: 1_000, b.id: 3_700}])
    assert room.phase is Phase.LOBBY and room.calib is None
    assert (a.delay_ms, b.delay_ms, c.delay_ms) == (1_000, 3_000, None)
    assert room.effective_delays() == {a.id: 1_000, b.id: 3_000, c.id: 2_000}


def test_recalibration_overwrites_previous_result():
    room = make_room()
    a, b = room.add_player("A"), room.add_player("B")
    calibrate(room, [{a.id: 500}, {a.id: 500}, {a.id: 500}])
    calibrate(room, [{b.id: 900}, {}, {}], start=100_000)
    assert a.delay_ms is None and b.delay_ms == 900


def test_kick_during_calibration_drops_taps():
    room = make_room()
    a, _ = room.add_player("A"), room.add_player("B")
    room.start_calibration()
    room.calib_flash(1, 1_000)
    room.calib_tap(a.id, 1, 1_500)
    room.kick(a.id)
    assert room.calib.tapped == set() and room.calib.samples == {}
