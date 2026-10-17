from app.game.models import Phase
from app.game.teams import TeamResult
from tests.factories import game_error, make_room, make_songs


def started_room(names=("A", "B"), **settings):
    room = make_room(**settings)
    ids = [room.add_player(name).id for name in names]
    room.start_game()
    return room, ids


def correct_index(room):
    return room.round.question.correct_index


def wrong_index(room):
    return (room.round.question.correct_index + 1) % 4


def play_round(room, now, correct=()):
    """audio_started lúc `now`; người trong `correct` trả lời đúng ngay; rồi tới hạn chót."""
    index = room.round.index
    room.audio_started(index, now)
    for player_id in correct:
        room.answer(player_id, index, correct_index(room), now)
    room.tick(room.round.deadline)


def team_game(names=("A", "B", "C"), count=2, now=10_000, **settings):
    """Phòng chơi theo đội (A, C đội 0; B đội 1), đã phát nhạc lúc `now`, hạn chót now + 18000."""
    room = make_room(**settings)
    ids = [room.add_player(name).id for name in names]
    room.set_teams(count)
    room.start_game()
    room.audio_started(0, now)
    return room, ids


def test_start_needs_a_player():
    assert game_error(make_room().start_game) == "INVALID_STATE"


def test_offline_players_still_count_for_start():
    room = make_room()
    player = room.add_player("A")
    room.set_player_online(player.id, False)
    room.start_game()
    assert room.phase is Phase.PREPARING


def test_start_builds_questions_and_enters_preparing():
    room, _ = started_room()
    assert room.phase is Phase.PREPARING
    assert len(room.questions) == 3 and len(room.spares) == 2
    assert room.round.index == 0 and room.round.question is room.questions[0]
    assert room.prepare_seq == 1


def test_commands_refused_once_the_game_runs():
    room, _ = started_room()
    assert game_error(room.start_game) == "INVALID_STATE"
    assert game_error(room.start_calibration) == "INVALID_STATE"
    assert game_error(room.add_player, "Late") == "GAME_STARTED"
    assert game_error(room.next_round, 0) == "INVALID_STATE"
    assert game_error(room.play_again) == "INVALID_STATE"


def test_audio_started_opens_answers_with_deadline():
    room, _ = started_room()
    assert game_error(room.audio_started, 1, 10_000) == "INVALID_STATE"
    room.audio_started(0, 10_000)
    assert room.phase is Phase.ANSWERING
    assert room.round.t0 == 10_000
    assert room.round.deadline == 10_000 + 15_000 + 3_000
    assert room.next_wakeup() == 28_000
    assert game_error(room.audio_started, 0, 10_100) == "INVALID_STATE"


def test_answer_scores_with_player_delay_and_adds_points_at_reveal():
    room, (a, b) = started_room()
    room.players[a].delay_ms = 1_000
    room.players[b].delay_ms = 0
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 11_000)
    assert room.round.answers[a].gained == 1_000
    assert room.players[a].score == 0  # chỉ cộng điểm lúc REVEAL
    room.answer(b, 0, wrong_index(room), 17_500)
    assert room.phase is Phase.REVEAL
    assert (room.players[a].score, room.players[b].score) == (1_000, 0)


def test_answer_errors():
    room, (a, b, _) = started_room(names=("A", "B", "C"))
    assert game_error(room.answer, a, 0, 0, 5_000) == "INVALID_STATE"  # still PREPARING
    room.audio_started(0, 10_000)
    assert game_error(room.answer, a, 1, 0, 10_500) == "INVALID_STATE"  # wrong round
    assert game_error(room.answer, a, 0, 4, 10_500) == "INVALID_STATE"  # no option 4
    room.answer(a, 0, 0, 10_500)
    assert game_error(room.answer, a, 0, 1, 10_600) == "ALREADY_ANSWERED"
    assert game_error(room.answer, b, 0, 0, 28_001) == "TOO_LATE"
    assert room.phase is Phase.ANSWERING


def test_answer_at_the_deadline_is_accepted_for_500():
    room, (a, _) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 28_000)
    assert room.round.answers[a].gained == 500


def test_deadline_tick_reveals_without_all_answers():
    room, (a, _) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 10_000)
    assert room.tick(27_999) is False
    assert room.tick(28_000) is True
    assert room.phase is Phase.REVEAL
    assert room.next_wakeup() is None


def test_early_reveal_only_waits_for_online_players():
    room, (a, b) = started_room()
    room.set_player_online(b, False)
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    assert room.phase is Phase.REVEAL


def test_last_unanswered_player_going_offline_triggers_reveal():
    room, (a, b) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    room.set_player_online(b, False)
    assert room.phase is Phase.REVEAL


def test_kicking_last_unanswered_player_triggers_reveal():
    room, (a, b) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    room.kick(b)
    assert room.phase is Phase.REVEAL


def test_nobody_online_waits_for_the_deadline():
    room, (a, b) = started_room()
    room.set_player_online(a, False)
    room.set_player_online(b, False)
    room.audio_started(0, 10_000)
    assert room.phase is Phase.ANSWERING
    room.tick(28_000)
    assert room.phase is Phase.REVEAL


def test_next_round_then_finish():
    room, (a, _) = started_room()
    play_round(room, 10_000, correct=[a])
    room.next_round(40_000)
    assert room.phase is Phase.PREPARING and room.round.index == 1 and room.prepare_seq == 2
    play_round(room, 50_000)
    room.next_round(80_000)
    play_round(room, 90_000)
    room.next_round(120_000)
    assert room.phase is Phase.FINISHED
    assert room.finished_at == 120_000 and room.round is None
    assert room.players[a].score == 1_000


def test_replay_from_answering_discards_answers():
    room, (a, _) = started_room()
    question = room.round.question
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 10_000)
    room.replay_round()
    assert room.phase is Phase.PREPARING
    assert room.round.index == 0 and room.round.question is question
    assert room.round.answers == {} and room.round.t0 is None
    assert room.prepare_seq == 2


def test_replay_from_reveal_refunds_points():
    room, (a, b) = started_room()
    play_round(room, 10_000, correct=[a, b])
    assert room.players[a].score == 1_000
    room.replay_round()
    assert (room.players[a].score, room.players[b].score) == (0, 0)
    assert room.phase is Phase.PREPARING


def test_replay_from_preparing_reloads():
    room, _ = started_room()
    room.replay_round()
    assert room.phase is Phase.PREPARING and room.prepare_seq == 2


def test_replay_outside_a_round_is_invalid():
    room = make_room()
    room.add_player("A")
    assert game_error(room.replay_round) == "INVALID_STATE"


def test_audio_failed_swaps_in_a_spare():
    room, _ = started_room()
    first_spare = room.spares[0]
    room.audio_failed(0, 5_000)
    assert room.phase is Phase.PREPARING and room.round.index == 0
    assert room.round.question.song == first_spare
    assert room.questions[0].song == first_spare
    assert len(room.questions) == 3 and len(room.spares) == 1
    assert room.notice == "AUDIO_REPLACED" and room.prepare_seq == 2
    assert len(set(room.round.question.options)) == 4


def test_audio_failed_without_spares_drops_the_round():
    room, _ = started_room(songs=make_songs(3), question_count=3)
    second = room.questions[1]
    room.audio_failed(0, 5_000)
    assert len(room.questions) == 2
    assert room.round.index == 0 and room.round.question is second
    assert room.notice == "ROUND_DROPPED"


def test_audio_failed_on_last_round_without_spares_finishes():
    room, _ = started_room(songs=make_songs(1), question_count=1)
    room.audio_failed(0, 5_000)
    assert room.phase is Phase.FINISHED and room.questions == []
    assert room.notice == "ROUND_DROPPED"


def test_audio_failed_only_while_preparing():
    room, _ = started_room()
    assert game_error(room.audio_failed, 1, 5_000) == "INVALID_STATE"
    room.audio_started(0, 10_000)
    assert game_error(room.audio_failed, 0, 11_000) == "INVALID_STATE"


def test_notice_clears_when_audio_starts():
    room, _ = started_room()
    room.audio_failed(0, 5_000)
    room.audio_started(0, 10_000)
    assert room.notice is None


def test_play_again_resets_scores_but_keeps_players_and_delays():
    room, (a, b) = started_room(songs=make_songs(2), question_count=1)
    room.players[a].delay_ms = 700
    play_round(room, 10_000, correct=[a])
    room.next_round(40_000)
    room.play_again()
    assert room.phase is Phase.LOBBY and room.round is None and room.finished_at is None
    assert set(room.players) == {a, b}
    assert room.players[a].score == 0 and room.players[a].delay_ms == 700
    room.start_game()
    assert room.phase is Phase.PREPARING and len(room.questions) == 1


def test_leaderboard_uses_competition_ranking_and_name_order():
    room, (bao, an, cuong) = started_room(names=("bao", "An", "Cuong"))
    play_round(room, 10_000, correct=[bao, an])
    board = [(player.name, rank) for player, rank in room.leaderboard()]
    assert board == [("An", 1), ("bao", 1), ("Cuong", 3)]


def test_team_players_can_change_their_vote_until_the_deadline():
    room, (a, _, _) = team_game()
    room.answer(a, 0, wrong_index(room), 11_000)
    room.answer(a, 0, correct_index(room), 12_000)
    vote = room.round.answers[a]
    assert (vote.option_index, vote.received_at) == (correct_index(room), 12_000)
    assert game_error(room.answer, a, 0, wrong_index(room), 28_001) == "TOO_LATE"


def test_voting_for_the_same_tile_again_keeps_the_first_time():
    room, (a, _, _) = team_game()
    room.answer(a, 0, correct_index(room), 11_000)
    room.answer(a, 0, correct_index(room), 13_000)
    assert room.round.answers[a].received_at == 11_000


def test_team_scores_use_the_mean_time_of_the_winning_votes():
    room, (a, b, c) = team_game()
    room.answer(a, 0, correct_index(room), 12_000)
    room.answer(b, 0, wrong_index(room), 10_500)
    room.answer(c, 0, correct_index(room), 14_000)
    assert room.phase is Phase.REVEAL
    results = room.round.team_results
    # Đội 0: trung bình (2000 + 4000) / 2 = 3000 ms → 900 điểm.
    assert results[0] == TeamResult(correct_index(room), False, 900)
    assert results[1] == TeamResult(wrong_index(room), False, 0)
    assert [team.score for team in room.teams] == [900, 0]
    assert [room.players[pid].score for pid in (a, b, c)] == [0, 0, 0]
    assert {answer.gained for answer in room.round.answers.values()} == {0}


def test_team_scores_subtract_each_voter_delay():
    room, (a, b) = team_game(names=("A", "B"))
    room.players[a].delay_ms = 1_000
    room.players[b].delay_ms = 0
    room.answer(b, 0, correct_index(room), 10_000)
    room.answer(a, 0, correct_index(room), 14_000)
    # A: 14000 - 10000 - 1000 = 3000 ms → 900. B: 0 ms → 1000.
    assert [team.score for team in room.teams] == [900, 1_000]


def test_a_tied_team_blocks_the_early_reveal_and_scores_zero():
    room, (a, b, c) = team_game()
    room.answer(b, 0, correct_index(room), 10_000)
    room.answer(a, 0, correct_index(room), 11_000)
    room.answer(c, 0, wrong_index(room), 11_000)
    assert room.phase is Phase.ANSWERING
    room.tick(28_000)
    assert room.round.team_results[0] == TeamResult(None, True, 0)
    assert [team.score for team in room.teams] == [0, 1_000]


def test_breaking_the_tie_reveals_at_once():
    room, (a, b, c) = team_game()
    room.answer(b, 0, correct_index(room), 10_000)
    room.answer(a, 0, correct_index(room), 11_000)
    room.answer(c, 0, wrong_index(room), 11_000)
    assert room.phase is Phase.ANSWERING
    room.answer(c, 0, correct_index(room), 13_000)
    assert room.phase is Phase.REVEAL


def test_offline_votes_still_count_but_kicked_votes_do_not():
    room, (a, b, c) = team_game()
    room.answer(c, 0, wrong_index(room), 10_000)
    room.set_player_online(c, False)
    room.answer(a, 0, correct_index(room), 10_000)
    room.answer(b, 0, correct_index(room), 10_000)
    assert room.phase is Phase.ANSWERING  # phiếu của C vẫn tính nên đội 0 đang hòa
    room.kick(c)
    assert room.phase is Phase.REVEAL
    assert [team.score for team in room.teams] == [1_000, 1_000]


def test_a_team_without_votes_scores_zero():
    room, (a, _, _) = team_game()
    room.answer(a, 0, correct_index(room), 10_000)
    room.tick(28_000)
    assert room.round.team_results[1] == TeamResult(None, False, 0)
    assert [team.score for team in room.teams] == [1_000, 0]


def test_replaying_a_revealed_round_takes_back_team_points():
    room, ids = team_game()
    for pid in ids:
        room.answer(pid, 0, correct_index(room), 10_000)
    assert [team.score for team in room.teams] == [1_000, 1_000]
    room.replay_round()
    assert [team.score for team in room.teams] == [0, 0]
    assert room.round.team_results == {}


def test_play_again_resets_team_scores_but_keeps_the_teams():
    room, ids = team_game(question_count=1)
    for pid in ids:
        room.answer(pid, 0, correct_index(room), 10_000)
    room.next_round(30_000)
    assert room.phase is Phase.FINISHED
    room.play_again()
    assert [(team.name, team.score) for team in room.teams] == [("Đội Đỏ", 0), ("Đội Chanh", 0)]
    assert [room.players[pid].team for pid in ids] == [0, 1, 0]
