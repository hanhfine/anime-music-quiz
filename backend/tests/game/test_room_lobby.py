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


def team_room(count=2, names=("A", "B", "C")):
    room = make_room()
    ids = [room.add_player(name).id for name in names]
    room.set_teams(count)
    return room, ids


def teams_of(room, ids):
    return [room.players[pid].team for pid in ids]


def test_turning_teams_on_places_players_in_join_order():
    room, ids = team_room()
    assert [team.name for team in room.teams] == ["Đội Đỏ", "Đội Chanh"]
    assert teams_of(room, ids) == [0, 1, 0]
    room, ids = team_room(3, names=("A", "B", "C", "D"))
    assert teams_of(room, ids) == [0, 1, 2, 0]


def test_normal_mode_has_no_teams():
    room = make_room()
    player = room.add_player("A")
    assert not room.team_mode and room.teams == [] and player.team is None


def test_new_players_join_the_smallest_team():
    room, (_, _, c) = team_room()
    room.move_player(c, 1)
    assert room.add_player("D").team == 0


def test_more_teams_keep_names_and_members():
    room, ids = team_room()
    room.rename_team(0, "Mèo")
    room.set_teams(4)
    assert [team.name for team in room.teams] == ["Mèo", "Đội Chanh", "Đội Trắng", "Đội Tím"]
    assert teams_of(room, ids) == [0, 1, 0]


def test_fewer_teams_rehome_dropped_members_in_join_order():
    room, ids = team_room(4, names=("A", "B", "C", "D", "E"))
    assert teams_of(room, ids) == [0, 1, 2, 3, 0]
    room.set_teams(2)
    assert len(room.teams) == 2
    # C (đội 2) vào đội ít người hơn là đội 1; D (đội 3) gặp lúc hai đội bằng nhau nên vào đội 0.
    assert teams_of(room, ids) == [0, 1, 1, 0, 0]


def test_turning_teams_off_clears_them_and_names_reset_next_time():
    room, ids = team_room()
    room.rename_team(0, "Mèo")
    room.set_teams(0)
    assert not room.team_mode and teams_of(room, ids) == [None, None, None]
    room.set_teams(2)
    assert room.teams[0].name == "Đội Đỏ"


@pytest.mark.parametrize("count", [1, 5, -1])
def test_invalid_team_counts(count):
    room, _ = team_room()
    assert game_error(room.set_teams, count) == "INVALID_STATE"


def test_shuffle_balances_the_teams():
    room, ids = team_room(names=("A", "B", "C", "D", "E"))
    for pid in ids:
        room.move_player(pid, 0)
    room.shuffle_teams()
    assert [teams_of(room, ids).count(team) for team in (0, 1)] == [3, 2]


def test_host_moves_and_players_choose_teams():
    room, (a, b, c) = team_room()
    room.move_player(a, 1)
    room.choose_team(b, 0)
    assert teams_of(room, [a, b, c]) == [1, 0, 0]


@pytest.mark.parametrize(("player", "team"), [("nobody", 0), (None, 2), (None, -1)])
def test_moving_to_an_unknown_team_or_player_is_refused(player, team):
    room, (a, _, _) = team_room()
    player = player or a
    assert game_error(room.move_player, player, team) == "INVALID_STATE"
    assert game_error(room.choose_team, player, team) == "INVALID_STATE"


@pytest.mark.parametrize("name", ["", "   ", "x" * 21])
def test_team_names_must_be_1_to_20_characters(name):
    room, _ = team_room()
    assert game_error(room.rename_team, 0, name) == "INVALID_NAME"


def test_rename_trims_and_allows_duplicates():
    room, _ = team_room()
    room.rename_team(0, "  Mèo  ")
    room.rename_team(1, "Mèo")
    assert [team.name for team in room.teams] == ["Mèo", "Mèo"]
    assert game_error(room.rename_team, 2, "Chó") == "INVALID_STATE"


def test_team_commands_need_team_mode():
    room = make_room()
    a = room.add_player("A").id
    assert game_error(room.shuffle_teams) == "INVALID_STATE"
    assert game_error(room.move_player, a, 0) == "INVALID_STATE"
    assert game_error(room.choose_team, a, 0) == "INVALID_STATE"
    assert game_error(room.rename_team, 0, "Mèo") == "INVALID_STATE"


def test_team_commands_only_run_in_the_lobby():
    room, (a, _, _) = team_room()
    room.start_calibration()
    assert game_error(room.set_teams, 3) == "INVALID_STATE"
    assert game_error(room.shuffle_teams) == "INVALID_STATE"
    assert game_error(room.move_player, a, 1) == "INVALID_STATE"
    assert game_error(room.choose_team, a, 1) == "INVALID_STATE"
    assert game_error(room.rename_team, 0, "Mèo") == "INVALID_STATE"


def test_players_joining_during_calibration_get_a_team():
    room, _ = team_room()
    room.start_calibration()
    assert room.add_player("D").team == 1


def test_start_needs_every_team_to_have_a_member():
    room, (_, _, c) = team_room()
    room.set_teams(3)
    assert game_error(room.start_game) == "EMPTY_TEAM"
    room.move_player(c, 2)
    room.start_game()
    assert room.phase is Phase.PREPARING


def test_team_leaderboard_uses_competition_ranks():
    room, _ = team_room(3)
    for team, score in zip(room.teams, (500, 900, 900)):
        team.score = score
    assert [(index, rank) for index, _, rank in room.team_leaderboard()] == [(1, 1), (2, 1), (0, 3)]
