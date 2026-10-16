"""Cấu hình đọc từ biến môi trường."""

import os
from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    youtube_api_key: str
    youtube_region: str = "VN"


def load_config(env: Mapping[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    return Config(
        youtube_api_key=env.get("YOUTUBE_API_KEY", "").strip(),
        youtube_region=(env.get("YOUTUBE_REGION", "").strip() or "VN").upper(),
    )
