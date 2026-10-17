"""Logic thuần của chế độ đội: xếp đội, đếm phiếu, tính điểm đội."""

from dataclasses import dataclass
from random import Random

from app.game.scoring import points


@dataclass(frozen=True)
class TeamResult:
    option: int | None  # đáp án đội chốt; None nếu hòa hoặc không ai bỏ phiếu
    tied: bool
    gained: int


def smallest_team(sizes: list[int]) -> int:
    """Chỉ số đội ít người nhất; bằng nhau thì lấy chỉ số nhỏ hơn."""
    return min(range(len(sizes)), key=lambda i: (sizes[i], i))


def balanced_assignment(player_ids: list[str], count: int, rng: Random) -> dict[str, int]:
    """Xáo thứ tự rồi chia vòng tròn: số người giữa các đội chênh nhau tối đa 1."""
    shuffled = list(player_ids)
    rng.shuffle(shuffled)
    return {player_id: i % count for i, player_id in enumerate(shuffled)}


def tally(options: list[int], option_count: int) -> tuple[list[int], int | None, bool]:
    """(số phiếu từng ô, ô thắng hoặc None, có hòa không)."""
    counts = [0] * option_count
    for option in options:
        counts[option] += 1
    top = max(counts, default=0)
    if top == 0:
        return counts, None, False
    leaders = [i for i, count in enumerate(counts) if count == top]
    if len(leaders) > 1:
        return counts, None, True
    return counts, leaders[0], False


def team_result(votes: list[tuple[int, int]], option_count: int, correct_index: int, clip_ms: int) -> TeamResult:
    """votes: (ô, thời gian hiệu dụng ms) của từng phiếu."""
    _, winner, tied = tally([option for option, _ in votes], option_count)
    if winner is None or winner != correct_index:
        return TeamResult(winner, tied, 0)
    times = [t_ms for option, t_ms in votes if option == winner]
    return TeamResult(winner, False, points(True, round(sum(times) / len(times)), clip_ms))
