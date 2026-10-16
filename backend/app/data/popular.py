"""Danh sách tên anime phổ biến, dùng làm đáp án nhiễu khi bộ câu hỏi có ít hơn 4 tên."""

import json
from pathlib import Path

POPULAR_PATH = Path(__file__).with_name("popular_anime.json")


def load_popular_anime(path: Path = POPULAR_PATH) -> list[str]:
    names = json.loads(path.read_text(encoding="utf-8"))
    return [name.strip() for name in names if isinstance(name, str) and name.strip()]
