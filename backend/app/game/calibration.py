"""Đo độ trễ stream: lọc lần bấm, lấy trung vị, độ trễ dự phòng."""

from random import Random
from statistics import median

from app.game.constants import CALIB_WAIT_MAX_MS, CALIB_WAIT_MIN_MS, MAX_DELAY_MS


def random_wait_ms(rng: Random) -> int:
    return rng.randint(CALIB_WAIT_MIN_MS, CALIB_WAIT_MAX_MS)


def tap_sample(flash_at: int, tap_at: int, window_ms: int) -> int | None:
    """Trả về T_tap − T_flash nếu lần bấm nằm trong cửa sổ, ngược lại None."""
    if tap_at < flash_at or tap_at > flash_at + window_ms:
        return None
    return tap_at - flash_at


def measured_delay(samples: list[int]) -> int | None:
    if not samples:
        return None
    return min(MAX_DELAY_MS, max(0, round(median(samples))))


def effective_delays(measured: dict[str, int | None]) -> dict[str, int]:
    """Người chưa đo dùng trung vị của những người đã đo; cả phòng chưa đo thì 0."""
    known = [d for d in measured.values() if d is not None]
    fallback = round(median(known)) if known else 0
    return {key: fallback if delay is None else delay for key, delay in measured.items()}
