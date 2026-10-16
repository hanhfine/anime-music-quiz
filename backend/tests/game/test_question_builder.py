from random import Random

from app.data.popular import load_popular_anime
from app.game.models import Settings, Song
from app.game.question_builder import build_game, build_options, clip_window

POPULAR = ["Popular A", "Popular B", "Popular C", "Popular D"]


def make_song(i: int, name: str | None = None, duration: int = 200, start: float | None = None) -> Song:
    return Song(
        video_id=f"vid{i:08d}",
        video_title=f"Title {i}",
        duration_sec=duration,
        anime_name=name or f"Anime {i}",
        start_sec=start,
    )


def test_build_game_picks_distinct_songs_and_keeps_the_rest_as_spares():
    songs = [make_song(i) for i in range(8)]
    questions, spares = build_game(songs, Settings(question_count=5), POPULAR, Random(42))
    ids = [q.song.video_id for q in questions]
    assert len(ids) == 5 and len(set(ids)) == 5
    assert {s.video_id for s in spares} == {s.video_id for s in songs} - set(ids)


def test_build_game_order_is_random():
    songs = [make_song(i) for i in range(8)]
    orders = {
        tuple(q.song.video_id for q in build_game(songs, Settings(question_count=8), POPULAR, Random(seed))[0])
        for seed in range(5)
    }
    assert len(orders) > 1


def test_every_question_has_four_distinct_options_including_the_answer():
    songs = [make_song(i) for i in range(8)]
    questions, _ = build_game(songs, Settings(question_count=8), POPULAR, Random(7))
    for q in questions:
        assert len(q.options) == 4
        assert len({o.casefold() for o in q.options}) == 4
        assert q.options[q.correct_index] == q.song.anime_name


def test_distractors_dedupe_by_casefold_and_fill_from_popular():
    set_names = ["Naruto", " naruto ", "Bleach"]
    popular = ["NARUTO", "bleach", "One Piece", "Gintama", "Haikyuu"]
    options, correct = build_options("Naruto", set_names, popular, Random(1))
    keys = [o.casefold() for o in options]
    assert options[correct] == "Naruto"
    assert len(set(keys)) == 4
    assert keys.count("naruto") == 1 and keys.count("bleach") == 1
    assert set(keys) <= {"naruto", "bleach", "one piece", "gintama", "haikyuu"}


def test_random_start_stays_inside_window():
    song = make_song(0, duration=200)
    for seed in range(50):
        start, end, clip_ms = clip_window(song, 15, 15, Random(seed))
        assert 30 <= start <= 155  # [0.15·200, 0.85·200 − 15]
        assert start == int(start)
        assert clip_ms == 15_000
        assert end == start + 30


def test_too_short_window_falls_back_to_middle():
    song = make_song(0, duration=20)  # [3, 2] is empty
    assert clip_window(song, 15, 15, Random(0)) == (2.5, 20.0, 15_000)


def test_song_shorter_than_clip_starts_at_zero_and_clip_is_the_song():
    song = make_song(0, duration=10)
    assert clip_window(song, 15, 15, Random(0)) == (0.0, 10.0, 10_000)


def test_fixed_start_is_clamped():
    late = make_song(0, duration=100, start=95)
    assert clip_window(late, 15, 15, Random(0)) == (85.0, 100.0, 15_000)
    early = make_song(1, duration=100, start=-5)
    assert clip_window(early, 15, 15, Random(0))[0] == 0.0


def test_end_without_reveal_is_clip_end():
    song = make_song(0, duration=100, start=10)
    assert clip_window(song, 15, 0, Random(0)) == (10.0, 25.0, 15_000)


def test_popular_file_has_enough_unique_names():
    names = load_popular_anime()
    assert len({n.casefold() for n in names}) >= 150
