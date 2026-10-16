"""Token bucket dùng chung toàn server để giới hạn lượt gọi AnimeThemes."""

import asyncio
import time
from collections.abc import Awaitable, Callable


class TokenBucket:
    def __init__(
        self,
        rate: int = 80,
        per_sec: float = 60.0,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.capacity = float(rate)
        self.refill_per_sec = rate / per_sec
        self.tokens = float(rate)
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
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            wait = (1 - self.tokens) / self.refill_per_sec
            if self.clock() + wait > deadline:
                return False
            await self.sleep(wait)
