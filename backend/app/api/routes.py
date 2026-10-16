"""REST API dùng khi soạn bộ câu hỏi: import từ YouTube và gợi ý tên anime."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.anime_lookup import LookupUnavailable
from app.services.youtube import YouTubeError


class ImportIn(BaseModel):
    url: str = ""


def _lookup_unavailable() -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": "LOOKUP_UNAVAILABLE"})


def build_router(youtube, lookup) -> APIRouter:
    router = APIRouter(prefix="/api")

    @router.get("/health")
    async def health():
        return {"ok": True}

    @router.post("/import")
    async def import_url(body: ImportIn):
        try:
            return await youtube.import_url(body.url)
        except YouTubeError as exc:
            return JSONResponse(status_code=exc.status, content={"error": exc.code})

    @router.get("/anime/suggest")
    async def suggest(title: str = ""):
        if not title.strip():
            return {"candidates": []}
        try:
            return {"candidates": await lookup.suggest(title)}
        except LookupUnavailable:
            return _lookup_unavailable()

    @router.get("/anime/search")
    async def search(q: str = ""):
        if not q.strip():
            return JSONResponse(status_code=400, content={"error": "EMPTY_QUERY"})
        try:
            return {"candidates": await lookup.search(q)}
        except LookupUnavailable:
            return _lookup_unavailable()

    return router
