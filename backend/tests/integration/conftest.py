import asyncio
import socket
from collections.abc import Callable

import pytest
import socketio
import uvicorn

from app.config import Config
from app.game.models import Timing
from app.main import create_app


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Client:
    """Một tab trình duyệt giả: lưu mọi room:state / room:closed nhận được."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.sio = socketio.AsyncClient(reconnection=False)
        self.states: list[dict] = []
        self.closed: list[dict] = []
        self._changed = asyncio.Event()
        self.sio.on("room:state", self._on_state)
        self.sio.on("room:closed", self._on_closed)

    async def _on_state(self, data: dict) -> None:
        self.states.append(data)
        self._changed.set()

    async def _on_closed(self, data: dict) -> None:
        self.closed.append(data)
        self._changed.set()

    async def connect(self) -> "Client":
        await self.sio.connect(self.url, transports=["websocket"])
        return self

    async def emit(self, event: str, data: object = None) -> dict:
        return await self.sio.call(event, data, timeout=5)

    @property
    def state(self) -> dict | None:
        return self.states[-1] if self.states else None

    async def wait_until(self, condition: Callable[[], bool], timeout: float = 5.0) -> None:
        async with asyncio.timeout(timeout):
            while not condition():
                self._changed.clear()
                await self._changed.wait()

    async def wait_for(self, predicate: Callable[[dict], bool], timeout: float = 5.0) -> dict:
        await self.wait_until(lambda: self.state is not None and predicate(self.state), timeout)
        return self.state


@pytest.fixture
async def server_url():
    port = _free_port()
    app = create_app(Config("test-key"), timing=Timing(calib_tap_window_ms=300))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(server.serve())
    async with asyncio.timeout(5):
        while not server.started:
            await asyncio.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    await task


@pytest.fixture
async def connect(server_url):
    clients: list[Client] = []

    async def factory() -> Client:
        client = await Client(server_url).connect()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        if client.sio.connected:
            await client.sio.disconnect()
