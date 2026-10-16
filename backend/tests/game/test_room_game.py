from app.game.models import Phase
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
