"""Sinh câu hỏi: chọn bài, chọn đoạn clip, chọn đáp án nhiễu. Logic thuần, rng truyền vào."""

from collections.abc import Callable
from math import ceil, floor
from random import Random

from app.game.models import Question, Settings, Song


def _norm(name: str) -> str:
    return name.strip().casefold()


def _keys(name: str) -> list[str]:
    key = _norm(name)
    if not key.endswith(")") or " (" not in key:
        return [key]
    romaji, english = key[:-1].split(" (", 1)
    return [key, romaji.strip(), english.strip()]


def _same_anime(names: list[str]) -> Callable[[str], str]:
    """Gom các cách gọi một bộ: "Romaji (English)" nối "Romaji" với "English". Trả về hàm tên -> mã nhóm."""
    parent: dict[str, str] = {}

    def find(key: str) -> str:
        while parent.setdefault(key, key) != key:
            key = parent[key]
        return key

    for name in names:
        first, *rest = _keys(name)
        for key in rest:
            parent[find(key)] = find(first)
    return lambda name: find(_norm(name))


def clip_window(song: Song, clip_sec: int, reveal_sec: int, rng: Random) -> tuple[float, float, int]:
    """Trả về (start_sec, end_sec, clip_ms) cho một bài."""
    duration = song.duration_sec
    if duration <= clip_sec:
        start, clip = 0.0, duration
    elif song.start_sec is not None:
        start, clip = float(min(max(song.start_sec, 0), duration - clip_sec)), clip_sec
    else:
        lo, hi = ceil(0.15 * duration), floor(0.85 * duration - clip_sec)
        start = float(rng.randint(lo, hi)) if lo <= hi else (duration - clip_sec) / 2
        clip = clip_sec
    end = min(float(duration), start + clip + reveal_sec)
    return start, end, clip * 1000


def build_options(
    correct: str, set_names: list[str], popular: list[str], rng: Random
) -> tuple[tuple[str, ...], int]:
    """4 đáp án đã xáo trộn và vị trí đáp án đúng."""
    answer = correct.strip()
    group = _same_anime([answer, *set_names, *popular])
    taken = {group(answer)}

    def fresh(names: list[str]) -> list[str]:
        out = []
        for name in names:
            if group(name) not in taken:
                taken.add(group(name))
                out.append(name.strip())
        return out

    others = fresh(set_names)
    distractors = rng.sample(others, min(3, len(others)))
    if len(distractors) < 3:
        distractors += rng.sample(fresh(popular), 3 - len(distractors))
    options = [answer, *distractors]
    rng.shuffle(options)
    return tuple(options), options.index(answer)


def build_question(
    song: Song, set_names: list[str], popular: list[str], settings: Settings, rng: Random
) -> Question:
    start, end, clip_ms = clip_window(song, settings.clip_sec, settings.reveal_sec, rng)
    options, correct_index = build_options(song.anime_name, set_names, popular, rng)
    return Question(
        song=song,
        start_sec=start,
        end_sec=end,
        clip_ms=clip_ms,
        options=options,
        correct_index=correct_index,
    )


def build_game(
    songs: list[Song], settings: Settings, popular: list[str], rng: Random
) -> tuple[list[Question], list[Song]]:
    """Bốc `question_count` bài không lặp; phần còn lại là bài dự phòng."""
    order = rng.sample(songs, len(songs))
    chosen, spares = order[: settings.question_count], order[settings.question_count :]
    names = [song.anime_name for song in songs]
    return [build_question(song, names, popular, settings, rng) for song in chosen], spares
