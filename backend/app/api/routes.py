"""REST API dùng khi soạn bộ câu hỏi: import từ YouTube và gợi ý tên anime."""

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.services.youtube import YouTubeError


class ImportIn(BaseModel):
    url: str = ""


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
        return {"candidates": await lookup.suggest(title)}

    @router.get("/anime/search")
    async def search(q: str = ""):
        if not q.strip():
            return JSONResponse(status_code=400, content={"error": "EMPTY_QUERY"})
        return {"candidates": await lookup.search(q)}

    return router
