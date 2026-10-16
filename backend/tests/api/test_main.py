import httpx
import pytest
import socketio

from app.config import Config
from app.main import create_app


@pytest.fixture
def static_dir(tmp_path):
    root = tmp_path / "static"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<html>quiz</html>")
    (root / "assets" / "app.js").write_text("console.log('quiz')")
    (tmp_path / "secret.txt").write_text("secret")
    return root


async def get(app, path):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get(path)


def test_module_level_app_imports_without_api_key(monkeypatch):
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    from app.main import app

    assert isinstance(app, socketio.ASGIApp)


async def test_api_routes_are_mounted(static_dir):
    response = await get(create_app(Config("key"), static_dir=static_dir), "/api/health")
    assert (response.status_code, response.json()) == (200, {"ok": True})


@pytest.mark.parametrize("path", ["/", "/play/ABC234", "/host/ABC234", "/sets/new"])
async def test_spa_fallback_serves_index(static_dir, path):
    response = await get(create_app(Config("key"), static_dir=static_dir), path)
    assert (response.status_code, response.text) == (200, "<html>quiz</html>")


async def test_static_assets_are_served(static_dir):
    response = await get(create_app(Config("key"), static_dir=static_dir), "/assets/app.js")
    assert (response.status_code, response.text) == (200, "console.log('quiz')")


async def test_unknown_api_path_is_404_not_index(static_dir):
    response = await get(create_app(Config("key"), static_dir=static_dir), "/api/nope")
    assert response.status_code == 404


@pytest.mark.parametrize("path", ["/%2E%2E/secret.txt", "/assets/..%2F..%2Fsecret.txt"])
async def test_paths_outside_static_dir_are_not_served(static_dir, path):
    response = await get(create_app(Config("key"), static_dir=static_dir), path)
    assert (response.status_code, response.text) == (200, "<html>quiz</html>")


async def test_missing_build_is_404(tmp_path):
    response = await get(create_app(Config("key"), static_dir=tmp_path / "missing"), "/")
    assert response.status_code == 404


async def test_lifespan_requires_api_key(static_dir):
    api = create_app(Config(""), static_dir=static_dir).other_asgi_app
    with pytest.raises(RuntimeError, match="YOUTUBE_API_KEY"):
        async with api.router.lifespan_context(api):
            pass


async def test_lifespan_starts_and_stops_cleanly(static_dir):
    api = create_app(Config("key"), static_dir=static_dir).other_asgi_app
    async with api.router.lifespan_context(api):
        pass
