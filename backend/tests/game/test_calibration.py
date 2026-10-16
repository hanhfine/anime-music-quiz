from random import Random

from app.game.calibration import effective_delays, measured_delay, random_wait_ms, tap_sample


def test_tap_inside_window_gives_sample():
    assert tap_sample(flash_at=1_000, tap_at=1_800, window_ms=5_000) == 800


def test_tap_before_flash_is_rejected():
    assert tap_sample(flash_at=1_000, tap_at=999, window_ms=5_000) is None


def test_tap_window_edge_is_inclusive_then_rejected():
    assert tap_sample(flash_at=1_000, tap_at=6_000, window_ms=5_000) == 5_000
    assert tap_sample(flash_at=1_000, tap_at=6_001, window_ms=5_000) is None


def test_measured_delay_is_median():
    assert measured_delay([900, 1_200, 1_000]) == 1_000


def test_measured_delay_even_count_averages_middle():
    assert measured_delay([800, 1_000]) == 900


def test_measured_delay_is_capped_at_3_seconds():
    assert measured_delay([3_500, 4_000, 4_900]) == 3_000


def test_measured_delay_without_samples_is_none():
    assert measured_delay([]) is None


def test_uncalibrated_player_gets_room_median():
    assert effective_delays({"a": 1_000, "b": 2_000, "c": None}) == {"a": 1_000, "b": 2_000, "c": 1_500}


def test_nobody_calibrated_means_zero_delay():
    assert effective_delays({"a": None, "b": None}) == {"a": 0, "b": 0}


def test_random_wait_stays_in_range():
    rng = Random(1)
    waits = [random_wait_ms(rng) for _ in range(200)]
    assert min(waits) >= 2_000 and max(waits) <= 4_000
    assert len(set(waits)) > 10
