"""Tính điểm và xếp hạng. Logic thuần: thời gian truyền vào bằng epoch ms."""


def answer_deadline(t0: int, clip_ms: int, grace_ms: int) -> int:
    return t0 + clip_ms + grace_ms


def effective_time_ms(received_at: int, t0: int, delay_ms: int) -> int:
    """Thời gian trả lời sau khi trừ độ trễ stream của người chơi."""
    return max(0, received_at - t0 - delay_ms)


def points(correct: bool, t_ms: int, clip_ms: int) -> int:
    """Đúng: 1000 giảm tuyến tính về 500 khi hết clip. Sai: 0."""
    if not correct:
        return 0
    return round(1000 - 500 * min(t_ms, clip_ms) / clip_ms)


def competition_ranks(scores: dict[str, int]) -> dict[str, int]:
    """Xếp hạng kiểu 1, 2, 2, 4: hạng = 1 + số người có điểm cao hơn hẳn."""
    values = list(scores.values())
    return {key: 1 + sum(1 for v in values if v > score) for key, score in scores.items()}
