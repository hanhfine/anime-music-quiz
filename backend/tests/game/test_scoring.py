from app.game.scoring import answer_deadline, competition_ranks, effective_time_ms, points

CLIP_MS = 15_000


def test_instant_correct_answer_gets_1000():
    assert points(True, 0, CLIP_MS) == 1000


def test_correct_answer_at_clip_end_gets_500():
    assert points(True, CLIP_MS, CLIP_MS) == 500


def test_correct_answer_inside_grace_period_gets_500():
    assert points(True, CLIP_MS + 2_000, CLIP_MS) == 500


def test_correct_answer_halfway_gets_750():
    assert points(True, 7_500, CLIP_MS) == 750


def test_wrong_answer_gets_0():
    assert points(False, 0, CLIP_MS) == 0


def test_effective_time_subtracts_delay():
    assert effective_time_ms(received_at=10_500, t0=10_000, delay_ms=200) == 300


def test_effective_time_never_negative():
    assert effective_time_ms(received_at=10_500, t0=10_000, delay_ms=900) == 0


def test_deadline_adds_clip_and_grace():
    assert answer_deadline(t0=1_000, clip_ms=CLIP_MS, grace_ms=3_000) == 19_000


def test_competition_ranking_shares_ties():
    ranks = competition_ranks({"a": 900, "b": 700, "c": 700, "d": 100})
    assert ranks == {"a": 1, "b": 2, "c": 2, "d": 4}


def test_competition_ranking_all_zero():
    assert competition_ranks({"a": 0, "b": 0}) == {"a": 1, "b": 1}
