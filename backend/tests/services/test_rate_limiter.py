from app.services.rate_limiter import TokenBucket


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


def bucket(fake: FakeTime, rate: int = 80) -> TokenBucket:
    return TokenBucket(rate, 60.0, clock=fake.clock, sleep=fake.sleep)


async def test_full_bucket_allows_a_burst_then_refuses_without_waiting():
    fake = FakeTime()
    limiter = bucket(fake)
    assert all([await limiter.acquire(timeout=0) for _ in range(80)])
    assert await limiter.acquire(timeout=0) is False
    assert fake.now == 0.0


async def test_waits_for_the_next_token_when_allowed():
    fake = FakeTime()
    limiter = bucket(fake)
    for _ in range(80):
        await limiter.acquire(timeout=0)
    assert await limiter.acquire(timeout=5) is True
    assert abs(fake.now - 0.75) < 1e-9  # 60 s / 80 tokens


async def test_gives_up_when_the_wait_exceeds_the_timeout():
    fake = FakeTime()
    limiter = bucket(fake, rate=1)
    assert await limiter.acquire(timeout=5)
    assert await limiter.acquire(timeout=5) is False  # next token needs 60 s
    assert fake.now == 0.0


async def test_refill_is_capped_at_capacity():
    fake = FakeTime()
    limiter = bucket(fake, rate=2)
    await limiter.acquire(timeout=0)
    await limiter.acquire(timeout=0)
    fake.now = 600.0
    assert [await limiter.acquire(timeout=0) for _ in range(3)] == [True, True, False]
