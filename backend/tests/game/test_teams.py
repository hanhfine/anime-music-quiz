from random import Random

import pytest

from app.game.teams import TeamResult, balanced_assignment, smallest_team, tally, team_result


@pytest.mark.parametrize(("sizes", "expected"), [([2, 1, 1], 1), ([0, 0], 0), ([3, 2, 4, 2], 1)])
def test_smallest_team_prefers_the_lower_index_on_ties(sizes, expected):
    assert smallest_team(sizes) == expected


@pytest.mark.parametrize(("players", "count"), [(7, 3), (8, 4), (1, 2), (5, 2)])
def test_balanced_assignment_differs_by_at_most_one(players, count):
    ids = [f"p{i}" for i in range(players)]
    assignment = balanced_assignment(ids, count, Random(1))
    assert set(assignment) == set(ids)
    sizes = [list(assignment.values()).count(team) for team in range(count)]
    assert max(sizes) - min(sizes) <= 1


def test_balanced_assignment_uses_the_rng_and_keeps_the_input():
    ids = [f"p{i}" for i in range(6)]
    results = {tuple(sorted(balanced_assignment(ids, 2, Random(seed)).items())) for seed in range(10)}
    assert len(results) > 1
    assert ids == [f"p{i}" for i in range(6)]


def test_tally_finds_a_clear_winner():
    assert tally([2, 0, 2], 4) == ([1, 0, 2, 0], 2, False)


def test_tally_reports_a_tie():
    assert tally([1, 3], 4) == ([0, 1, 0, 1], None, True)


def test_tally_without_votes_is_not_a_tie():
    assert tally([], 4) == ([0, 0, 0, 0], None, False)


def test_team_result_averages_only_the_winning_votes():
    # Ô 1 thắng 2–1; trung bình (2000 + 4000) / 2 = 3000 ms → 1000 - 500 * 3000 / 15000 = 900.
    assert team_result([(1, 2_000), (1, 4_000), (0, 0)], 4, 1, 15_000) == TeamResult(1, False, 900)


def test_team_result_scores_zero_when_wrong_tied_or_empty():
    assert team_result([(2, 1_000)], 4, 1, 15_000) == TeamResult(2, False, 0)
    assert team_result([(0, 1_000), (1, 1_000)], 4, 1, 15_000) == TeamResult(None, True, 0)
    assert team_result([], 4, 1, 15_000) == TeamResult(None, False, 0)
