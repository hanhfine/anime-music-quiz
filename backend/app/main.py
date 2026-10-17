"""Điểm vào ASGI: FastAPI (REST + bản build React) bọc trong Socket.IO. Chạy đúng 1 worker."""

import asyncio
import contextlib
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import socketio
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from app.api.routes import build_router
from app.config import Config, load_config
from app.data.popular import load_popular_anime
from app.game.models import Timing
from app.game.room_manager import RoomManager
from app.services.anilist import AniListTitles
from app.services.anime_lookup import AnimeLookup
from app.services.rate_limiter import TokenBucket
from app.services.youtube import YouTubeService
from app.sockets import GameServer

STATIC_DIR = Path(__file__).with_name("static")


def _mount_spa(api: FastAPI, static_dir: Path) -> None:
    """Phục vụ file tĩnh; đường dẫn khác (trừ /api) trả index.html để React Router xử lý."""
    root = static_dir.resolve()

    @api.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        if path and candidate.is_relative_to(root) and candidate.is_file():
            return FileResponse(candidate)
        index = root / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404)


def create_app(
    config: Config | None = None, timing: Timing = Timing(), static_dir: Path = STATIC_DIR
) -> socketio.ASGIApp:
    config = config or load_config()
    client = httpx.AsyncClient()
    youtube = YouTubeService(config.youtube_api_key, config.youtube_region, client)
    # AniList cho 30 lượt/phút; đặt 25 để chừa khoảng an toàn.
    lookup = AnimeLookup(client, TokenBucket(), titles=AniListTitles(client, TokenBucket(25, burst=5)))
    game = GameServer(RoomManager(load_popular_anime(), timing=timing))

    @asynccontextmanager
    async def lifespan(_api: FastAPI):
        if not config.youtube_api_key:
            raise RuntimeError("Thiếu biến môi trường YOUTUBE_API_KEY")
        cleanup = asyncio.create_task(game.cleanup_loop())
        try:
            yield
        finally:
            cleanup.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await cleanup
            await client.aclose()

    api = FastAPI(title="Anime Music Quiz", lifespan=lifespan)
    api.include_router(build_router(youtube, lookup))
    _mount_spa(api, static_dir)
    return socketio.ASGIApp(game.sio, other_asgi_app=api)


app = create_app()
