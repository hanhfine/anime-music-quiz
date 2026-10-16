"""Token bucket dùng chung toàn server để giới hạn lượt gọi AnimeThemes."""

import asyncio
import time
from collections.abc import Awaitable, Callable

# Bỏ qua sai số số thực khi cộng dồn lượt, kẻo phải chờ những khoảng ~1e-16 s mãi không đủ 1 lượt.
EPSILON = 1e-9


class TokenBucket:
    # Mặc định 70 lượt/phút, dồn tối đa 10: mọi cửa sổ 60 s có ≤ 80 lượt, dưới mức 90 của AnimeThemes.
    def __init__(
        self,
        rate: int = 70,
        per_sec: float = 60.0,
        *,
        burst: int = 10,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.capacity = float(burst)
        self.refill_per_sec = rate / per_sec
        self.tokens = float(burst)
        self.clock = clock
        self.sleep = sleep
        self.updated = clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.refill_per_sec)
        self.updated = now

    async def acquire(self, timeout: float) -> bool:
        """Lấy 1 lượt, chờ tối đa `timeout` giây. Trả về False nếu phải chờ lâu hơn."""
        deadline = self.clock() + timeout
        while True:
            self._refill()
            if self.tokens >= 1 - EPSILON:
                self.tokens = max(0.0, self.tokens - 1)
                return True
            wait = (1 - self.tokens) / self.refill_per_sec
            if self.clock() + wait > deadline:
                return False
            await self.sleep(wait)
