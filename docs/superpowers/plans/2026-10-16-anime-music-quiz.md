# Anime Music Quiz Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app where a host streams (via Discord) a "guess the anime from the song" quiz: the host's tab plays YouTube clips, players answer 4-option multiple choice on their own devices, and the server scores them, compensating for each player's measured stream delay.

**Architecture:** A single Python process: FastAPI serves REST (for building question sets) and the React build, and is wrapped in a python-socketio `ASGIApp` for realtime play. Room state lives in RAM. All game rules live in `backend/app/game/` as pure, deterministic code (`now` in epoch ms and `rng` are injected). `sockets.py` is a thin shell that maps events to `Room` methods and pushes role-specific snapshots (`room:state`). The React frontend only renders the latest snapshot. Only the host tab plays audio, through a single YouTube IFrame player that is resized with CSS and never moved in the DOM.

**Tech Stack:** Python 3.12, uv, FastAPI, python-socketio 5, httpx, pydantic 2, pytest + pytest-asyncio + respx. React + Vite + TypeScript, React Router, socket.io-client, Tailwind CSS v4, qrcode.react, Vitest + React Testing Library, Playwright. Docker for deploy.

**Spec:** `docs/superpowers/specs/2026-10-16-anime-music-quiz-design.md`

## Global Constraints

Every task implicitly includes these (values copied from the spec):

- Backend: Python 3.12 managed by uv; FastAPI + python-socketio wrapped in `socketio.ASGIApp`; httpx; pydantic. Run with exactly **1 uvicorn worker** (`uvicorn app.main:app --workers 1`).
- Frontend: React + Vite + TypeScript, React Router, socket.io-client, Tailwind.
- `backend/app/game/` never imports socketio, never touches the network, never reads the clock. Every time-dependent function takes `now` (epoch ms); randomness comes from an injected `random.Random`.
- The server is the single source of truth: it keeps the correct answer, measures time, and computes scores.
- Snapshots are per role. A **player snapshot never contains `videoId`, `startSec` or `correctIndex` before REVEAL**.
- Constants: `GRACE_SEC = 3`, `MAX_DELAY_MS = 3000`, `CALIB_ROUNDS = 3`, `CALIB_TAP_WINDOW_MS = 5000`, `PREPARE_TIMEOUT_SEC = 10`.
- Room settings: `questionCount` defaults to min(10, songs in set), range 1…songs; `clipSec` 15 (5–30); `revealSec` 15 (0–30, 0 = no extra video on reveal); `maxPlayers` 30 (2–50); `mode` `"stream"` (the only v1 value).
- Room creation requires at least 1 song and at most 500, and every song must have a non-empty `animeName` and `needsReview = false`. The frontend checks first and the server checks again.
- Room code: 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, unique among live rooms. `hostToken`/`playerToken` = `secrets.token_urlsafe(16)`. The client stores tokens in localStorage under key `room:<code>`.
- Player name: trimmed, 1–20 characters, unique within the room case-insensitively. New joins are only allowed in `LOBBY` or `CALIBRATING`; `rejoin` with a token works in any phase.
- Calibration: `waitMs` random in 2000–4000; the host shows "3, 2, 1" (1 s each) then **BẤM!** with a beep. Delay = median of valid `T_tap − T_flash`, clamped to [0, `MAX_DELAY_MS`]. Uncalibrated players use the room median of calibrated players, or 0 if nobody is calibrated. A new calibration overwrites the old one.
- Scoring: `deadline = T0 + clip·1000 + GRACE_SEC·1000`; `t = max(0, t_recv − T0 − delayMs)`; correct = `round(1000 − 500·min(t, clip·1000)/(clip·1000))`, wrong/no answer = 0. REVEAL happens at the deadline, or earlier once every online player has answered (only if at least 1 player is online). Competition ranking (1, 2, 2, 4).
- Error codes: `ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_STARTED`, `NAME_TAKEN`, `INVALID_NAME`, `INVALID_TOKEN`, `INVALID_STATE`, `INVALID_SET`, `ALREADY_ANSWERED`, `TOO_LATE`, `KICKED`. Every command that is invalid for the current phase acks `{ok:false, error:"INVALID_STATE"}` and does not change the room.
- Cleanup task every 5 minutes removes rooms that are `FINISHED` for more than 30 min, whose host has been offline for more than 15 min, or that are older than 4 h.
- Import: a URL with `list=` imports the playlist (max 200 items). `watch?v=`, `youtu.be/` and `shorts/` import 1 video. Skip reasons: `DELETED`, `PRIVATE`, `NOT_EMBEDDABLE`, `REGION_BLOCKED`. `YOUTUBE_REGION` defaults to `VN`. Errors: `400 INVALID_URL`, `404 NOT_FOUND`, `503 YOUTUBE_QUOTA`, `502 UPSTREAM_ERROR`.
- AnimeThemes: suggest ≤ 3 candidates, search ≤ 10. Token bucket of 80 calls/min for the whole server, waiting at most 5 s. Any AnimeThemes failure returns `200` with `candidates: []`. Results are cached in RAM by cleaned query.
- YouTube player (host tab only): exactly 1 `YT.Player`; playerVars `controls:0, disablekb:1, rel:0, fs:0, iv_load_policy:3, playsinline:1`. Report `host:audio_started` once per round when state is PLAYING **and** `getCurrentTime() ≥ startSec − 1`. Report `host:audio_failed` on error codes 2, 5, 100, 101, 150 or after `PREPARE_TIMEOUT_SEC` without starting.
- Answer tiles everywhere: A ▲, B ◆, C ●, D ■, each with a fixed colour.
- All user-facing copy is Vietnamese.
- Env vars: `YOUTUBE_API_KEY` (required), `YOUTUBE_REGION` (default `VN`), `PORT`.

## Plan-level decisions (fill gaps the spec leaves open)

- Optional snapshot fields (`calib`, `round`, `reveal`, `result`, `leaderboardTop`, `notice`, `gained`, `deadline`, `options`) are **always present** and `null` when they don't apply.
- The host snapshot adds `calib.tappedCount`, because the calibration screen shows how many players tapped. It also adds `round.prepareSeq`, a counter that increases every time the room enters PREPARING, so the host tab knows when to (re)load the video, including after [Phát lại câu này] during PREPARING.
- Calibration tap errors: tap before the flash → `INVALID_STATE`, second tap in the same round → `ALREADY_ANSWERED`, tap after the window → `TOO_LATE`.
- Malformed event payloads ack `INVALID_STATE`. A bad `host:create_room` payload (set or settings) acks `INVALID_SET`. Events sent without a host/player session ack `INVALID_TOKEN`.
- `room:closed.reason` is one of `"CLOSED"` (host closed the room), `"KICKED"`, `"EXPIRED"` (cleanup).
- `Timing` (grace period, calibration rounds, tap window) is injectable into the room manager so integration tests can use a 300 ms tap window. Production uses the spec constants.
- A YouTube video with duration 0 (live/upcoming) is skipped with reason `NOT_EMBEDDABLE`. A private playlist (`playlistItemsNotAccessible`) maps to `404 NOT_FOUND`.
- `backend/app/data/popular_anime.json` ships ~190 well-known titles (the spec says ~500). The fallback only needs 3 names that are not in the set, and the list can grow later without code changes.
- Random start times are whole seconds.

## File Structure

```
spike/youtube-iframe.html          Task 1: manual YouTube IFrame experiment page
spike/RESULTS.md                   Task 1: recorded spike findings
backend/
  pyproject.toml, .python-version, uv.lock
  app/__init__.py
  app/config.py                    Config + load_config() (env vars)
  app/main.py                      create_app(): FastAPI + routes + SPA fallback, wrapped in socketio.ASGIApp; module-level `app`
  app/api/__init__.py
  app/api/routes.py                build_router(youtube, lookup): /api/health, /api/import, /api/anime/suggest, /api/anime/search
  app/services/__init__.py
  app/services/title_cleaner.py    clean_title(title) -> CleanedTitle(parts, label_hint)
  app/services/rate_limiter.py     TokenBucket(rate, per_sec).acquire(timeout) -> bool
  app/services/anime_lookup.py     AnimeLookup(client, limiter).suggest(title) / .search(q)
  app/services/youtube.py          parse_url, parse_duration, YouTubeService(api_key, region, client).import_url(url)
  app/data/__init__.py
  app/data/popular.py              load_popular_anime() -> list[str]
  app/data/popular_anime.json      fallback distractor names
  app/game/__init__.py
  app/game/constants.py            all numeric constants
  app/game/scoring.py              answer_deadline, effective_time_ms, points, competition_ranks
  app/game/calibration.py          random_wait_ms, tap_sample, measured_delay, effective_delays
  app/game/models.py               Phase, GameError, Song, Settings, Timing, Question, Player, Answer, CalibState, RoundState
  app/game/question_builder.py     clip_window, build_options, build_question, build_game
  app/game/room.py                 Room state machine
  app/game/views.py                host_view(room, now), player_view(room, player_id, now)
  app/game/validation.py           parse_create_room(payload) -> (songs, settings)
  app/game/room_manager.py         RoomManager: codes, lookup, expiry
  app/sockets.py                   GameServer: Socket.IO handlers, timers, cleanup loop
  app/static/                      (build output, git-ignored)
  tests/__init__.py, tests/factories.py
  tests/game/…, tests/services/…, tests/api/…, tests/sockets/…, tests/integration/…, tests/test_config.py
frontend/
  package.json, vite.config.ts, tsconfig.node.json, index.html (from the Vite template)
  playwright.config.ts             E2E against the backend-served build (port 8765)
  src/main.tsx, src/App.tsx, src/index.css
  src/test/setup.ts                jsdom + jest-dom setup
  src/test/fakeSocket.ts           installFakeSocket(): scripted Socket.IO client
  src/test/renderRoute.tsx         renderRoute(element, {path, url, state}) inside a router
  src/test/LocationProbe.tsx       exposes the current location/state for asserts
  src/test/fakePlayer.ts           installFakePlayer(): records every FakePlayer a page creates
  src/test/snapshots.ts            hostSnapshot/hostRound/playerSnapshot/playerRound builders
  src/lib/protocol.ts              snapshot/ack types + Vietnamese error messages
  src/lib/socket.ts                getSocket(), emitAck(), setSocketForTests()
  src/lib/clock.ts                 clockOffset(), remainingMs()
  src/lib/roomAuth.ts              save/load/clear localStorage `room:<code>`
  src/lib/roomSettings.ts          SETTING_LIMITS, defaultRoomSettings(), clampRoomSettings()
  src/lib/useRoomSnapshot.ts       hook: latest room:state + clock offset + room:closed
  src/lib/useNow.ts                hook: re-render on an interval
  src/lib/beep.ts                  WebAudio beep for calibration
  src/lib/async.ts                 mapLimit()
  src/lib/api.ts                   REST client + Vietnamese import messages
  src/lib/sets/schema.ts           types, parseQuestionSet(), roomBlocker()
  src/lib/sets/storage.ts          localStorage CRUD + JSON export/import
  src/audio/AudioPlayer.ts         interface + helpers
  src/audio/FakePlayer.ts          test/E2E player
  src/audio/YouTubePlayer.ts       YouTube IFrame implementation
  src/audio/createPlayer.ts        picks Fake/YouTube via VITE_FAKE_PLAYER
  src/audio/useAudioPlayer.ts      hook: one player per container, destroyed on unmount
  src/audio/useHostPlayback.ts     hook: load / audio_started / audio_failed / stop
  src/audio/volume.ts              loadVolume(), saveVolume() (localStorage)
  src/components/tiles.ts          TILES (A ▲, B ◆, C ●, D ■ + colours), TileState
  src/components/AnswerTile.tsx, Leaderboard.tsx, Podium.tsx, CountdownRing.tsx, DelayBadge.tsx
  src/components/SongRow.tsx, CreateRoomPanel.tsx   editor row and room-creation form
  src/pages/Home.tsx, SetList.tsx, SetEditor.tsx, HostScreen.tsx, PlayScreen.tsx
  src/pages/host/useHostCommand.ts run(event, payload) with busy/error state
  src/pages/host/HostLobby.tsx, HostCalibration.tsx, HostQuestion.tsx, HostFinished.tsx
  src/pages/play/JoinForm.tsx, PlayerLobby.tsx, PlayerCalibration.tsx, PlayerRound.tsx, PlayerFinished.tsx
  src/**/*.test.ts(x)              Vitest + React Testing Library, next to the code they test
  e2e/game.spec.ts                 Playwright: one full game with a host and two players
Dockerfile, .dockerignore, .gitignore, README.md
```

---

### Task 1: YouTube IFrame spike (manual, do this first)

The rest of the plan assumes four things about the YouTube IFrame API. This task checks them by hand before any product code exists. **If any check fails, stop and report to your human partner before starting Task 2**: spec §5.1 and Tasks 21–23 depend on these results.

**Files:**
- Create: `spike/youtube-iframe.html`
- Create: `spike/RESULTS.md`

**Interfaces:**
- Consumes: nothing
- Produces: `spike/RESULTS.md`, which records the observed behaviour. Later tasks assume the 4 checks pass.

- [ ] **Step 1: Write the spike page**

```html
<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Spike: YouTube IFrame</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }
    #controls { padding: 12px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    #controls input { width: 110px; }
    #arena { position: relative; height: 560px; border-top: 1px solid #334155; }
    /* The wrapper stays at one place in the DOM; only these classes change. */
    #stage { position: absolute; transition: all .4s ease; }
    #stage.small { right: 24px; bottom: 24px; width: 320px; height: 180px; }
    #stage.large { left: 24px; top: 24px; width: 853px; height: 480px; }
    #cover { position: absolute; inset: 0; background: #1e293b; display: flex; align-items: center;
             justify-content: center; font-size: 48px; transition: opacity .4s; }
    #stage.large #cover { opacity: 0; pointer-events: none; }
    #log { font: 12px/1.4 ui-monospace, monospace; padding: 12px; height: 260px; overflow: auto;
           background: #020617; white-space: pre; }
  </style>
</head>
<body>
  <div id="controls">
    videoId <input id="vid" value="8OkpRK2_gVs" />
    start <input id="start" type="number" value="60" />
    end <input id="end" type="number" value="80" />
    <button id="load">Load (loadVideoById)</button>
    <button id="toggle">Toggle small/large (CSS only)</button>
    <button id="stop">stopVideo</button>
    <span id="status"></span>
  </div>
  <div id="arena">
    <div id="stage" class="small">
      <div id="player"></div>
      <div id="cover">🎵</div>
    </div>
  </div>
  <div id="log"></div>
  <script>
    const STATES = { "-1": "UNSTARTED", 0: "ENDED", 1: "PLAYING", 2: "PAUSED", 3: "BUFFERING", 5: "CUED" };
    const t0 = performance.now();
    let player = null;
    let loadedAt = null;
    let reported = false;
    const log = (msg) => {
      const line = `${((performance.now() - t0) / 1000).toFixed(2).padStart(7)}s  ${msg}\n`;
      const el = document.getElementById("log");
      el.textContent += line;
      el.scrollTop = el.scrollHeight;
    };
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player("player", {
        width: "100%",
        height: "100%",
        playerVars: { controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 },
        events: {
          onReady: () => log("onReady"),
          onError: (e) => log(`onError code=${e.data}`),
          onStateChange: (e) =>
            log(`state=${STATES[e.data] ?? e.data} currentTime=${player.getCurrentTime().toFixed(2)}`),
        },
      });
    };
    setInterval(() => {
      if (!player || !player.getPlayerState) return;
      const state = player.getPlayerState();
      const time = player.getCurrentTime();
      const start = Number(document.getElementById("start").value);
      document.getElementById("status").textContent =
        `state=${STATES[state] ?? state} t=${time.toFixed(2)}`;
      if (!reported && loadedAt !== null && state === YT.PlayerState.PLAYING && time >= start - 1) {
        reported = true;
        log(`>>> audio_started condition met after ${((performance.now() - loadedAt) / 1000).toFixed(2)}s (t=${time.toFixed(2)})`);
      }
    }, 250);
    document.getElementById("load").onclick = () => {
      reported = false;
      loadedAt = performance.now();
      const videoId = document.getElementById("vid").value.trim();
      const startSeconds = Number(document.getElementById("start").value);
      const endSeconds = Number(document.getElementById("end").value);
      log(`loadVideoById ${videoId} ${startSeconds}→${endSeconds}`);
      player.loadVideoById({ videoId, startSeconds, endSeconds });
    };
    document.getElementById("toggle").onclick = () => {
      const stage = document.getElementById("stage");
      stage.className = stage.className === "small" ? "large" : "small";
      log(`CSS → ${stage.className}`);
    };
    document.getElementById("stop").onclick = () => { player.stopVideo(); log("stopVideo"); };
  </script>
  <script src="https://www.youtube.com/iframe_api"></script>
</body>
</html>
```

- [ ] **Step 2: Serve the page over HTTP**

The IFrame API does not work from `file://`.

Run: `python3 -m http.server 5500 --directory spike`
Expected: `Serving HTTP on :: port 5500 …`. Open `http://localhost:5500/youtube-iframe.html`.

- [ ] **Step 3: Run the four checks and record them**

For each browser (Chrome, Edge, Safari), open the page in a **fresh tab**, without clicking anything else first:

1. **Ads + PLAYING + currentTime.** Without an ad blocker, load a popular music video likely to show ads. Click **Load** once. In the log, check whether `state=PLAYING` appears while an ad runs, what `currentTime` reads then, and that the `>>> audio_started condition met` line appears only once the real video plays from `start`.
2. **endSeconds.** Load with start=60, end=80. Check that the log shows `ENDED` (or `PAUSED`) with `currentTime` ≈ 80.
3. **CSS resize without reload.** While playing, click **Toggle** several times. Check that no `UNSTARTED`/`BUFFERING` line appears, that `currentTime` keeps increasing, and that audio never restarts.
4. **Autoplay after one click.** With the tab still fresh, check that the first **Load** click produces sound. Then click **Load** again with another videoId: the second video should play with sound with no extra click. The game only ever loads videos after the host's first click on "Bắt đầu".

Write the results:

```markdown
# Spike results: YouTube IFrame API

Date: YYYY-MM-DD · Tester: <name>

| Check | Chrome | Edge | Safari | Notes |
|---|---|---|---|---|
| 1. PLAYING during ads; `currentTime ≥ start−1` only fires on real content | | | | |
| 2. `endSeconds` stops at the mark | | | | |
| 3. CSS resize/reposition does not reload | | | | |
| 4. Sound after 1 click; later loads need no click | | | | |

Conclusion: <"assumptions hold" or which assumption breaks and what spec §5.1 must change>
```

Fill every cell with ✅ or ❌ plus a short note, and replace the date, tester and conclusion lines with real values.

- [ ] **Step 4: Commit**

```bash
git add spike/
git commit -m "spike: verify YouTube IFrame behaviour assumptions"
```

If the conclusion is not "assumptions hold", stop here and report to your human partner.

---

### Task 2: Backend scaffold, constants and scoring

**Files:**
- Create: `.gitignore`
- Create: `backend/pyproject.toml`, `backend/.python-version`
- Create: `backend/app/__init__.py`, `backend/app/game/__init__.py`, `backend/tests/__init__.py`, `backend/tests/game/__init__.py` (all empty)
- Create: `backend/app/game/constants.py`
- Create: `backend/app/game/scoring.py`
- Test: `backend/tests/game/test_scoring.py`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `app.game.constants`: every numeric constant used later (names below).
  - `answer_deadline(t0: int, clip_ms: int, grace_ms: int) -> int`
  - `effective_time_ms(received_at: int, t0: int, delay_ms: int) -> int`
  - `points(correct: bool, t_ms: int, clip_ms: int) -> int`
  - `competition_ranks(scores: dict[str, int]) -> dict[str, int]`

- [ ] **Step 1: Create the project files**

```gitignore
.venv/
__pycache__/
.pytest_cache/
.DS_Store
backend/app/static/
node_modules/
frontend/dist/
frontend/test-results/
frontend/playwright-report/
```

```toml
[project]
name = "anime-quiz-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "python-socketio>=5.11",
    "httpx>=0.27",
    "pydantic>=2.9",
]

[dependency-groups]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "respx>=0.21",
    "aiohttp>=3.10",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "function"
testpaths = ["tests"]
pythonpath = ["."]
```

```text
3.12
```

Run:
```bash
mkdir -p backend/app/game backend/tests/game
touch backend/app/__init__.py backend/app/game/__init__.py backend/tests/__init__.py backend/tests/game/__init__.py
cd backend && uv sync
```
Expected: uv downloads Python 3.12 if needed, creates `backend/.venv` and `backend/uv.lock`, and ends with `Installed N packages`.

- [ ] **Step 2: Write the constants module**

```python
"""Hằng số của game. Giá trị lấy từ spec, không đổi tùy tiện."""

GRACE_SEC = 3
MAX_DELAY_MS = 3000
CALIB_ROUNDS = 3
CALIB_TAP_WINDOW_MS = 5000
CALIB_WAIT_MIN_MS = 2000
CALIB_WAIT_MAX_MS = 4000

MAX_SONGS = 500
NAME_MAX_LEN = 20
LEADERBOARD_TOP = 10

DEFAULT_QUESTION_COUNT = 10
DEFAULT_CLIP_SEC = 15
DEFAULT_REVEAL_SEC = 15
DEFAULT_MAX_PLAYERS = 30
CLIP_SEC_MIN, CLIP_SEC_MAX = 5, 30
REVEAL_SEC_MIN, REVEAL_SEC_MAX = 0, 30
MAX_PLAYERS_MIN, MAX_PLAYERS_MAX = 2, 50

ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROOM_CODE_LENGTH = 6

CLEANUP_INTERVAL_SEC = 5 * 60
FINISHED_TTL_MS = 30 * 60_000
HOST_OFFLINE_TTL_MS = 15 * 60_000
ROOM_MAX_AGE_MS = 4 * 60 * 60_000
```

- [ ] **Step 3: Write the failing scoring tests**

```python
from app.game.scoring import answer_deadline, competition_ranks, effective_time_ms, points

CLIP_MS = 15_000


def test_instant_correct_answer_gets_1000():
    assert points(True, 0, CLIP_MS) == 1000


def test_correct_answer_at_clip_end_gets_500():
    assert points(True, CLIP_MS, CLIP_MS) == 500


def test_correct_answer_inside_grace_period_gets_500():
    assert points(True, CLIP_MS + 2_000, CLIP_MS) == 500


def test_correct_answer_halfway_gets_750():
    assert points(True, 7_500, CLIP_MS) == 750


def test_wrong_answer_gets_0():
    assert points(False, 0, CLIP_MS) == 0


def test_effective_time_subtracts_delay():
    assert effective_time_ms(received_at=10_500, t0=10_000, delay_ms=200) == 300


def test_effective_time_never_negative():
    assert effective_time_ms(received_at=10_500, t0=10_000, delay_ms=900) == 0


def test_deadline_adds_clip_and_grace():
    assert answer_deadline(t0=1_000, clip_ms=CLIP_MS, grace_ms=3_000) == 19_000


def test_competition_ranking_shares_ties():
    ranks = competition_ranks({"a": 900, "b": 700, "c": 700, "d": 100})
    assert ranks == {"a": 1, "b": 2, "c": 2, "d": 4}


def test_competition_ranking_all_zero():
    assert competition_ranks({"a": 0, "b": 0}) == {"a": 1, "b": 1}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_scoring.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.game.scoring'`.

- [ ] **Step 5: Implement scoring**

```python
"""Tính điểm và xếp hạng. Logic thuần: thời gian truyền vào bằng epoch ms."""


def answer_deadline(t0: int, clip_ms: int, grace_ms: int) -> int:
    return t0 + clip_ms + grace_ms


def effective_time_ms(received_at: int, t0: int, delay_ms: int) -> int:
    """Thời gian trả lời sau khi trừ độ trễ stream của người chơi."""
    return max(0, received_at - t0 - delay_ms)


def points(correct: bool, t_ms: int, clip_ms: int) -> int:
    """Đúng: 1000 giảm tuyến tính về 500 khi hết clip. Sai: 0."""
    if not correct:
        return 0
    return round(1000 - 500 * min(t_ms, clip_ms) / clip_ms)


def competition_ranks(scores: dict[str, int]) -> dict[str, int]:
    """Xếp hạng kiểu 1, 2, 2, 4: hạng = 1 + số người có điểm cao hơn hẳn."""
    values = list(scores.values())
    return {key: 1 + sum(1 for v in values if v > score) for key, score in scores.items()}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game/test_scoring.py -v`
Expected: `10 passed`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore backend/pyproject.toml backend/.python-version backend/uv.lock backend/app backend/tests
git commit -m "feat(backend): scaffold project, game constants and scoring"
```

---

### Task 3: Calibration math

**Files:**
- Create: `backend/app/game/calibration.py`
- Test: `backend/tests/game/test_calibration.py`

**Interfaces:**
- Consumes: `app.game.constants` (`MAX_DELAY_MS`, `CALIB_WAIT_MIN_MS`, `CALIB_WAIT_MAX_MS`)
- Produces:
  - `random_wait_ms(rng: random.Random) -> int`, in 2000–4000
  - `tap_sample(flash_at: int, tap_at: int, window_ms: int) -> int | None`: `tap_at − flash_at`, or `None` if the tap is before the flash or after `flash_at + window_ms`
  - `measured_delay(samples: list[int]) -> int | None`: median clamped to [0, 3000], or `None` without samples
  - `effective_delays(measured: dict[str, int | None]) -> dict[str, int]`: fills `None` with the median of known values, or 0

- [ ] **Step 1: Write the failing tests**

```python
from random import Random

from app.game.calibration import effective_delays, measured_delay, random_wait_ms, tap_sample


def test_tap_inside_window_gives_sample():
    assert tap_sample(flash_at=1_000, tap_at=1_800, window_ms=5_000) == 800


def test_tap_before_flash_is_rejected():
    assert tap_sample(flash_at=1_000, tap_at=999, window_ms=5_000) is None


def test_tap_window_edge_is_inclusive_then_rejected():
    assert tap_sample(flash_at=1_000, tap_at=6_000, window_ms=5_000) == 5_000
    assert tap_sample(flash_at=1_000, tap_at=6_001, window_ms=5_000) is None


def test_measured_delay_is_median():
    assert measured_delay([900, 1_200, 1_000]) == 1_000


def test_measured_delay_even_count_averages_middle():
    assert measured_delay([800, 1_000]) == 900


def test_measured_delay_is_capped_at_3_seconds():
    assert measured_delay([3_500, 4_000, 4_900]) == 3_000


def test_measured_delay_without_samples_is_none():
    assert measured_delay([]) is None


def test_uncalibrated_player_gets_room_median():
    assert effective_delays({"a": 1_000, "b": 2_000, "c": None}) == {"a": 1_000, "b": 2_000, "c": 1_500}


def test_nobody_calibrated_means_zero_delay():
    assert effective_delays({"a": None, "b": None}) == {"a": 0, "b": 0}


def test_random_wait_stays_in_range():
    rng = Random(1)
    waits = [random_wait_ms(rng) for _ in range(200)]
    assert min(waits) >= 2_000 and max(waits) <= 4_000
    assert len(set(waits)) > 10
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_calibration.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.game.calibration'`.

- [ ] **Step 3: Implement calibration**

```python
"""Đo độ trễ stream: lọc lần bấm, lấy trung vị, độ trễ dự phòng."""

from random import Random
from statistics import median

from app.game.constants import CALIB_WAIT_MAX_MS, CALIB_WAIT_MIN_MS, MAX_DELAY_MS


def random_wait_ms(rng: Random) -> int:
    return rng.randint(CALIB_WAIT_MIN_MS, CALIB_WAIT_MAX_MS)


def tap_sample(flash_at: int, tap_at: int, window_ms: int) -> int | None:
    """Trả về T_tap − T_flash nếu lần bấm nằm trong cửa sổ, ngược lại None."""
    if tap_at < flash_at or tap_at > flash_at + window_ms:
        return None
    return tap_at - flash_at


def measured_delay(samples: list[int]) -> int | None:
    if not samples:
        return None
    return min(MAX_DELAY_MS, max(0, round(median(samples))))


def effective_delays(measured: dict[str, int | None]) -> dict[str, int]:
    """Người chưa đo dùng trung vị của những người đã đo; cả phòng chưa đo thì 0."""
    known = [d for d in measured.values() if d is not None]
    fallback = round(median(known)) if known else 0
    return {key: fallback if delay is None else delay for key, delay in measured.items()}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game/test_calibration.py -v`
Expected: `10 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/game/calibration.py backend/tests/game/test_calibration.py
git commit -m "feat(game): calibration delay math"
```

---

### Task 4: Game models, fallback names and question builder

**Files:**
- Create: `backend/app/game/models.py`
- Create: `backend/app/data/__init__.py` (empty), `backend/app/data/popular.py`, `backend/app/data/popular_anime.json`
- Create: `backend/app/game/question_builder.py`
- Test: `backend/tests/game/test_question_builder.py`

**Interfaces:**
- Consumes: `app.game.constants`
- Produces:
  - `Phase` (StrEnum: `LOBBY, CALIBRATING, PREPARING, ANSWERING, REVEAL, FINISHED`)
  - `GameError(code: str)` with attribute `.code`
  - `Song(video_id, video_title, duration_sec, anime_name, song_label=None, start_sec=None)` (frozen)
  - `Settings(question_count, clip_sec=15, reveal_sec=15, max_players=30, mode="stream")` (frozen)
  - `Timing(grace_ms=3000, calib_rounds=3, calib_tap_window_ms=5000)` (frozen)
  - `Question(song, start_sec: float, end_sec: float, clip_ms: int, options: tuple[str, ...], correct_index: int)` (frozen)
  - `Player(id, token, name, online=True, delay_ms: int | None = None, score=0)`
  - `Answer(option_index, received_at, gained)`
  - `CalibState(round, wait_ms, flash_at=None, tapped: set[str], samples: dict[str, list[int]])`
  - `RoundState(index, question, t0=None, deadline=None, answers: dict[str, Answer])`
  - `load_popular_anime(path=POPULAR_PATH) -> list[str]`
  - `clip_window(song, clip_sec, reveal_sec, rng) -> tuple[float, float, int]` (start_sec, end_sec, clip_ms)
  - `build_options(correct, set_names, popular, rng) -> tuple[tuple[str, ...], int]`
  - `build_question(song, set_names, popular, settings, rng) -> Question`
  - `build_game(songs, settings, popular, rng) -> tuple[list[Question], list[Song]]` (questions, spares)

- [ ] **Step 1: Write the models**

```python
"""Kiểu dữ liệu của game. Không có logic, không có I/O."""

from dataclasses import dataclass, field
from enum import StrEnum

from app.game.constants import (
    CALIB_ROUNDS,
    CALIB_TAP_WINDOW_MS,
    DEFAULT_CLIP_SEC,
    DEFAULT_MAX_PLAYERS,
    DEFAULT_REVEAL_SEC,
    GRACE_SEC,
)


class Phase(StrEnum):
    LOBBY = "LOBBY"
    CALIBRATING = "CALIBRATING"
    PREPARING = "PREPARING"
    ANSWERING = "ANSWERING"
    REVEAL = "REVEAL"
    FINISHED = "FINISHED"


class GameError(Exception):
    """Lỗi nghiệp vụ; `code` được gửi nguyên văn cho client trong ack."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Song:
    video_id: str
    video_title: str
    duration_sec: int
    anime_name: str
    song_label: str | None = None
    start_sec: float | None = None


@dataclass(frozen=True)
class Settings:
    question_count: int
    clip_sec: int = DEFAULT_CLIP_SEC
    reveal_sec: int = DEFAULT_REVEAL_SEC
    max_players: int = DEFAULT_MAX_PLAYERS
    mode: str = "stream"


@dataclass(frozen=True)
class Timing:
    grace_ms: int = GRACE_SEC * 1000
    calib_rounds: int = CALIB_ROUNDS
    calib_tap_window_ms: int = CALIB_TAP_WINDOW_MS


@dataclass(frozen=True)
class Question:
    song: Song
    start_sec: float
    end_sec: float
    clip_ms: int
    options: tuple[str, ...]
    correct_index: int


@dataclass
class Player:
    id: str
    token: str
    name: str
    online: bool = True
    delay_ms: int | None = None
    score: int = 0


@dataclass
class Answer:
    option_index: int
    received_at: int
    gained: int


@dataclass
class CalibState:
    round: int
    wait_ms: int
    flash_at: int | None = None
    tapped: set[str] = field(default_factory=set)
    samples: dict[str, list[int]] = field(default_factory=dict)


@dataclass
class RoundState:
    index: int
    question: Question
    t0: int | None = None
    deadline: int | None = None
    answers: dict[str, Answer] = field(default_factory=dict)
```

- [ ] **Step 2: Add the fallback distractor names**

```json
[
  "Naruto", "Naruto: Shippuuden", "Boruto: Naruto Next Generations", "One Piece", "Bleach",
  "Bleach: Sennen Kessen-hen", "Dragon Ball", "Dragon Ball Z", "Dragon Ball Super",
  "Fullmetal Alchemist: Brotherhood", "Death Note", "Code Geass: Hangyaku no Lelouch", "Steins;Gate",
  "Shingeki no Kyojin", "Kimetsu no Yaiba", "Jujutsu Kaisen", "Chainsaw Man", "Spy x Family",
  "Boku no Hero Academia", "Haikyuu!!", "Kuroko no Basket", "Hunter x Hunter (2011)", "Tokyo Ghoul",
  "Sword Art Online", "Re:Zero kara Hajimeru Isekai Seikatsu", "Kono Subarashii Sekai ni Shukufuku wo!",
  "Mob Psycho 100", "One Punch Man", "Neon Genesis Evangelion", "Cowboy Bebop", "Gintama", "Fairy Tail",
  "Black Clover", "Tokyo Revengers", "Vinland Saga", "Made in Abyss", "Violet Evergarden",
  "Shigatsu wa Kimi no Uso", "Ano Hi Mita Hana no Namae wo Bokutachi wa Mada Shiranai.", "Clannad",
  "Toradora!", "K-On!", "Lucky☆Star", "Suzumiya Haruhi no Yuuutsu", "Bakemonogatari",
  "Mahou Shoujo Madoka★Magica", "Kill la Kill", "Tengen Toppa Gurren Lagann", "Noragami", "Dr. Stone",
  "Enen no Shouboutai", "Yakusoku no Neverland", "Kaguya-sama wa Kokurasetai", "Oshi no Ko",
  "Bocchi the Rock!", "Lycoris Recoil", "Sousou no Frieren", "Blue Lock",
  "Mushoku Tensei: Isekai Ittara Honki Dasu", "Tensei shitara Slime Datta Ken", "Overlord",
  "No Game No Life", "Log Horizon", "Dungeon ni Deai wo Motomeru no wa Machigatteiru Darou ka",
  "Sono Bisque Doll wa Koi wo Suru", "Horimiya", "Kimi ni Todoke", "Ouran Koukou Host Club",
  "Fruits Basket", "Nana", "Natsume Yuujinchou", "Mushishi", "Monster", "Psycho-Pass",
  "Ghost in the Shell: Stand Alone Complex", "Samurai Champloo", "Trigun", "Hellsing Ultimate",
  "Black Lagoon", "Darker than Black", "Durarara!!", "Baccano!", "Ao no Exorcist", "Soul Eater",
  "D.Gray-man", "Inuyasha", "Bishoujo Senshi Sailor Moon", "Cardcaptor Sakura", "Meitantei Conan",
  "Doraemon", "Pokémon", "Digimon Adventure", "Yu-Gi-Oh! Duel Monsters", "Slam Dunk",
  "Captain Tsubasa", "Hajime no Ippo", "Yuri!!! on Ice", "Free!", "Ansatsu Kyoushitsu",
  "Nanatsu no Taizai", "Magi: The Labyrinth of Magic", "Kekkai Sensen", "JoJo no Kimyou na Bouken",
  "Akame ga Kill!", "Kiseijuu: Sei no Kakuritsu", "Zankyou no Terror", "Boku dake ga Inai Machi",
  "Dororo", "Kakegurui", "Shokugeki no Souma", "Nichijou", "Hyouka", "Chuunibyou demo Koi ga Shitai!",
  "Kobayashi-san Chi no Maid Dragon", "Tonikaku Kawaii", "Komi-san wa, Comyushou desu.",
  "Karakai Jouzu no Takagi-san", "Seishun Buta Yarou wa Bunny Girl Senpai no Yume wo Minai",
  "Yahari Ore no Seishun Love Comedy wa Machigatteiru.", "Bungou Stray Dogs", "Dorohedoro", "Beastars",
  "Cyberpunk: Edgerunners", "Odd Taxi", "Ousama Ranking", "Kaijuu 8-gou", "Dandadan",
  "Kusuriya no Hitorigoto", "Mashle", "Jigokuraku", "Zom 100: Zombie ni Naru made ni Shitai 100 no Koto",
  "Ore dake Level Up na Ken", "Shangri-La Frontier", "Undead Unluck", "Ookami to Koushinryou",
  "Kanojo, Okarishimasu", "Gotoubun no Hanayome", "Charlotte", "Angel Beats!", "Plastic Memories",
  "Kimi no Na wa.", "Tenki no Ko", "Suzume no Tojimari", "Koe no Katachi", "Sen to Chihiro no Kamikakushi",
  "Tonari no Totoro", "Mononoke Hime", "Howl no Ugoku Shiro", "Akira", "Perfect Blue", "Initial D",
  "Great Teacher Onizuka", "Rurouni Kenshin", "Yuu☆Yuu☆Hakusho", "Saint Seiya", "Hokuto no Ken",
  "Berserk", "Claymore", "Mirai Nikki", "Higurashi no Naku Koro ni", "Another", "Elfen Lied", "Shiki",
  "Gakkougurashi!", "Kamisama Hajimemashita", "Kaichou wa Maid-sama!", "Toaru Majutsu no Index",
  "Toaru Kagaku no Railgun", "Date A Live", "Golden Kamuy", "Kingdom", "Megalo Box",
  "Ping Pong the Animation", "Kaze ga Tsuyoku Fuiteiru", "Chihayafuru", "Hibike! Euphonium",
  "Love Live! School Idol Project", "Zombieland Saga", "Darling in the FranXX", "Guilty Crown",
  "Aldnoah.Zero", "Koutetsujou no Kabaneri", "86", "Kidou Senshi Gundam: Tekketsu no Orphans",
  "Macross Frontier", "Koukyoushihen Eureka Seven", "Tsuki ga Kirei", "Given", "Banana Fish"
]
```

```python
"""Danh sách tên anime phổ biến, dùng làm đáp án nhiễu khi bộ câu hỏi có ít hơn 4 tên."""

import json
from pathlib import Path

POPULAR_PATH = Path(__file__).with_name("popular_anime.json")


def load_popular_anime(path: Path = POPULAR_PATH) -> list[str]:
    names = json.loads(path.read_text(encoding="utf-8"))
    return [name.strip() for name in names if isinstance(name, str) and name.strip()]
```

Run: `touch backend/app/data/__init__.py`

- [ ] **Step 3: Write the failing question-builder tests**

```python
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
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_question_builder.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.game.question_builder'`.

- [ ] **Step 5: Implement the question builder**

```python
"""Sinh câu hỏi: chọn bài, chọn đoạn clip, chọn đáp án nhiễu. Logic thuần, rng truyền vào."""

from math import ceil, floor
from random import Random

from app.game.models import Question, Settings, Song


def _norm(name: str) -> str:
    return name.strip().casefold()


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
    taken = {_norm(answer)}
    others: list[str] = []
    for name in set_names:
        if _norm(name) not in taken:
            taken.add(_norm(name))
            others.append(name.strip())
    distractors = rng.sample(others, min(3, len(others)))
    if len(distractors) < 3:
        extras: list[str] = []
        for name in popular:
            if _norm(name) not in taken:
                taken.add(_norm(name))
                extras.append(name.strip())
        distractors += rng.sample(extras, 3 - len(distractors))
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game -v`
Expected: all tests in `tests/game` pass (`30 passed`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/game/models.py backend/app/game/question_builder.py backend/app/data backend/tests/game/test_question_builder.py
git commit -m "feat(game): models, fallback anime names and question builder"
```

---

### Task 5: Room state machine, part 1 (players and calibration)

**Files:**
- Create: `backend/app/game/room.py`
- Create: `backend/tests/factories.py`
- Test: `backend/tests/game/test_room_lobby.py`

**Interfaces:**
- Consumes: `app.game.models` (all types), `app.game.calibration`, `app.game.constants.NAME_MAX_LEN`
- Produces (`Room`, used by Tasks 6–8 and 13–14):
  - `Room(*, code, host_token, songs, settings, popular, rng, now, timing=Timing())`
  - Attributes: `code, host_token, songs, settings, popular, rng, timing, phase, players: dict[str, Player], kicked_tokens: set[str], host_online, host_offline_since, created_at, finished_at, calib: CalibState | None, questions: list[Question], spares: list[Song], round: RoundState | None, notice: str | None, prepare_seq: int`
  - `add_player(name) -> Player`: errors checked in order `GAME_STARTED`, `INVALID_NAME`, `ROOM_FULL`, `NAME_TAKEN`
  - `player_by_token(token) -> Player`: `KICKED` or `INVALID_TOKEN`
  - `is_host_token(token) -> bool`
  - `set_player_online(player_id, online)`, `set_host_online(online, now)`
  - `kick(player_id) -> Player`: `INVALID_STATE` if unknown
  - `effective_delays() -> dict[str, int]`
  - `start_calibration()`, `calib_flash(round_no, now)`, `calib_tap(player_id, round_no, now)`
  - `next_wakeup() -> int | None` and `tick(now) -> bool` (True if the room changed)
  - Internal, used by Task 6: `_require(*phases)`, `_maybe_reveal_early()`, `_reveal()`
- Produces (`tests/factories.py`): `POPULAR`, `make_songs(count, duration=200)`, `make_room(*, songs=None, now=0, seed=1, timing=Timing(), **settings)`, `game_error(fn, *args) -> str`

- [ ] **Step 1: Write the shared test factories**

```python
"""Dữ liệu mẫu dùng chung cho test."""

from collections.abc import Callable
from random import Random

import pytest

from app.game.models import GameError, Settings, Song, Timing
from app.game.room import Room

POPULAR = ["Popular A", "Popular B", "Popular C", "Popular D"]


def make_songs(count: int, duration: int = 200) -> list[Song]:
    return [
        Song(
            video_id=f"vid{i:08d}",
            video_title=f"Title {i}",
            duration_sec=duration,
            anime_name=f"Anime {i}",
            song_label=f"OP{i}",
        )
        for i in range(count)
    ]


def make_room(
    *, songs: list[Song] | None = None, now: int = 0, seed: int = 1, timing: Timing = Timing(), **settings
) -> Room:
    songs = make_songs(5) if songs is None else songs
    settings.setdefault("question_count", min(3, len(songs)))
    return Room(
        code="ABC234",
        host_token="host-token",
        songs=songs,
        settings=Settings(**settings),
        popular=POPULAR,
        rng=Random(seed),
        now=now,
        timing=timing,
    )


def game_error(fn: Callable, *args) -> str:
    """Gọi fn và trả về mã GameError mà nó ném ra."""
    with pytest.raises(GameError) as info:
        fn(*args)
    return info.value.code
```

- [ ] **Step 2: Write the failing room tests**

```python
import pytest

from app.game.models import Phase
from tests.factories import game_error, make_room


def test_new_room_is_lobby_with_online_host():
    room = make_room(now=1_000)
    assert room.phase is Phase.LOBBY
    assert room.host_online and room.created_at == 1_000
    assert room.players == {}


def test_add_player_trims_name_and_issues_credentials():
    room = make_room()
    player = room.add_player("  Linh  ")
    assert player.name == "Linh"
    assert room.players[player.id] is player
    assert len(player.token) >= 20
    assert player.online and player.delay_ms is None and player.score == 0


@pytest.mark.parametrize("name", ["", "   ", "x" * 21])
def test_invalid_names_are_rejected(name):
    assert game_error(make_room().add_player, name) == "INVALID_NAME"


def test_twenty_character_name_is_allowed():
    assert make_room().add_player("x" * 20).name == "x" * 20


def test_names_are_unique_ignoring_case():
    room = make_room()
    room.add_player("Linh")
    assert game_error(room.add_player, " linh ") == "NAME_TAKEN"


def test_room_full():
    room = make_room(max_players=2)
    room.add_player("A")
    room.add_player("B")
    assert game_error(room.add_player, "C") == "ROOM_FULL"


def test_join_is_allowed_while_calibrating():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert room.add_player("B").name == "B"


def test_player_by_token():
    room = make_room()
    player = room.add_player("A")
    assert room.player_by_token(player.token) is player
    assert game_error(room.player_by_token, "nope") == "INVALID_TOKEN"


def test_kicked_player_token_is_refused():
    room = make_room()
    player = room.add_player("A")
    assert room.kick(player.id) is player
    assert player.id not in room.players
    assert game_error(room.player_by_token, player.token) == "KICKED"


def test_kick_unknown_player_is_invalid_state():
    assert game_error(make_room().kick, "missing") == "INVALID_STATE"


def test_host_token_check():
    room = make_room()
    assert room.is_host_token("host-token")
    assert not room.is_host_token("wrong")
    assert not room.is_host_token("hôst-token")  # non-ASCII must not crash


def test_host_offline_tracking():
    room = make_room()
    room.set_host_online(False, now=5_000)
    assert not room.host_online and room.host_offline_since == 5_000
    room.set_host_online(True, now=6_000)
    assert room.host_online and room.host_offline_since is None


def test_calibrate_needs_an_online_player():
    room = make_room()
    assert game_error(room.start_calibration) == "INVALID_STATE"
    player = room.add_player("A")
    room.set_player_online(player.id, False)
    assert game_error(room.start_calibration) == "INVALID_STATE"
    assert room.phase is Phase.LOBBY


def test_calibrate_starts_round_one_with_random_wait():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert room.phase is Phase.CALIBRATING
    assert room.calib.round == 1 and 2_000 <= room.calib.wait_ms <= 4_000
    assert room.calib.flash_at is None
    assert game_error(room.start_calibration) == "INVALID_STATE"


def test_flash_must_match_round_and_happen_once():
    room = make_room()
    room.add_player("A")
    room.start_calibration()
    assert game_error(room.calib_flash, 2, 1_000) == "INVALID_STATE"
    room.calib_flash(1, 1_000)
    assert game_error(room.calib_flash, 1, 1_100) == "INVALID_STATE"
    assert room.calib.flash_at == 1_000


def test_tap_rules():
    room = make_room()
    a, b = room.add_player("A"), room.add_player("B")
    room.start_calibration()
    assert game_error(room.calib_tap, a.id, 1, 500) == "INVALID_STATE"  # before the flash
    room.calib_flash(1, 1_000)
    assert game_error(room.calib_tap, a.id, 2, 1_500) == "INVALID_STATE"  # wrong round
    room.calib_tap(a.id, 1, 1_800)
    assert game_error(room.calib_tap, a.id, 1, 1_900) == "ALREADY_ANSWERED"
    assert game_error(room.calib_tap, b.id, 1, 6_001) == "TOO_LATE"
    assert room.calib.tapped == {a.id}
    assert room.calib.samples == {a.id: [800]}


def test_wakeup_is_end_of_tap_window():
    room = make_room()
    room.add_player("A")
    assert room.next_wakeup() is None
    room.start_calibration()
    assert room.next_wakeup() is None
    room.calib_flash(1, 1_000)
    assert room.next_wakeup() == 6_000
    assert room.tick(5_999) is False
    assert room.tick(6_000) is True
    assert room.calib.round == 2 and room.calib.flash_at is None and room.calib.tapped == set()


def calibrate(room, taps_per_round, start=0):
    """Chạy đủ các lượt đo. Mỗi phần tử của taps_per_round là {player_id: độ trễ ms}."""
    now = start
    room.start_calibration()
    for round_no, taps in enumerate(taps_per_round, start=1):
        now += 10_000
        room.calib_flash(round_no, now)
        for player_id, delay in taps.items():
            room.calib_tap(player_id, round_no, now + delay)
        assert room.tick(now + room.timing.calib_tap_window_ms)
    return now


def test_three_rounds_measure_median_delay_and_return_to_lobby():
    room = make_room()
    a, b, c = room.add_player("A"), room.add_player("B"), room.add_player("C")
    calibrate(room, [{a.id: 800, b.id: 3_500}, {a.id: 1_200, b.id: 3_600}, {a.id: 1_000, b.id: 3_700}])
    assert room.phase is Phase.LOBBY and room.calib is None
    assert (a.delay_ms, b.delay_ms, c.delay_ms) == (1_000, 3_000, None)
    assert room.effective_delays() == {a.id: 1_000, b.id: 3_000, c.id: 2_000}


def test_recalibration_overwrites_previous_result():
    room = make_room()
    a, b = room.add_player("A"), room.add_player("B")
    calibrate(room, [{a.id: 500}, {a.id: 500}, {a.id: 500}])
    calibrate(room, [{b.id: 900}, {}, {}], start=100_000)
    assert a.delay_ms is None and b.delay_ms == 900


def test_kick_during_calibration_drops_taps():
    room = make_room()
    a, _ = room.add_player("A"), room.add_player("B")
    room.start_calibration()
    room.calib_flash(1, 1_000)
    room.calib_tap(a.id, 1, 1_500)
    room.kick(a.id)
    assert room.calib.tapped == set() and room.calib.samples == {}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_room_lobby.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.game.room'`.

- [ ] **Step 4: Implement the first half of `Room`**

The import block already lists what Task 6 needs, so Task 6 only appends methods to the class.

```python
"""Máy trạng thái của một phòng. Logic thuần: `now` (epoch ms) và `rng` được truyền vào."""

import secrets
from random import Random

from app.game import calibration
from app.game.constants import NAME_MAX_LEN
from app.game.models import (
    Answer,
    CalibState,
    GameError,
    Phase,
    Player,
    Question,
    RoundState,
    Settings,
    Song,
    Timing,
)
from app.game.question_builder import build_game, build_question
from app.game.scoring import answer_deadline, competition_ranks, effective_time_ms, points


class Room:
    def __init__(
        self,
        *,
        code: str,
        host_token: str,
        songs: list[Song],
        settings: Settings,
        popular: list[str],
        rng: Random,
        now: int,
        timing: Timing = Timing(),
    ) -> None:
        self.code = code
        self.host_token = host_token
        self.songs = list(songs)
        self.settings = settings
        self.popular = popular
        self.rng = rng
        self.timing = timing
        self.phase = Phase.LOBBY
        self.players: dict[str, Player] = {}
        self.kicked_tokens: set[str] = set()
        self.host_online = True
        self.host_offline_since: int | None = None
        self.created_at = now
        self.finished_at: int | None = None
        self.calib: CalibState | None = None
        self.questions: list[Question] = []
        self.spares: list[Song] = []
        self.round: RoundState | None = None
        self.notice: str | None = None
        self.prepare_seq = 0

    # ---- người chơi và quản trò ----

    def add_player(self, name: str) -> Player:
        if self.phase not in (Phase.LOBBY, Phase.CALIBRATING):
            raise GameError("GAME_STARTED")
        clean = name.strip()
        if not 1 <= len(clean) <= NAME_MAX_LEN:
            raise GameError("INVALID_NAME")
        if len(self.players) >= self.settings.max_players:
            raise GameError("ROOM_FULL")
        if any(p.name.casefold() == clean.casefold() for p in self.players.values()):
            raise GameError("NAME_TAKEN")
        player_id = secrets.token_hex(4)
        while player_id in self.players:
            player_id = secrets.token_hex(4)
        player = Player(id=player_id, token=secrets.token_urlsafe(16), name=clean)
        self.players[player.id] = player
        return player

    def player_by_token(self, token: str) -> Player:
        if token in self.kicked_tokens:
            raise GameError("KICKED")
        for player in self.players.values():
            if secrets.compare_digest(player.token.encode(), token.encode()):
                return player
        raise GameError("INVALID_TOKEN")

    def is_host_token(self, token: str) -> bool:
        return secrets.compare_digest(self.host_token.encode(), token.encode())

    def set_player_online(self, player_id: str, online: bool) -> None:
        player = self.players.get(player_id)
        if player is not None:
            player.online = online
            self._maybe_reveal_early()

    def set_host_online(self, online: bool, now: int) -> None:
        self.host_online = online
        self.host_offline_since = None if online else now

    def kick(self, player_id: str) -> Player:
        player = self.players.pop(player_id, None)
        if player is None:
            raise GameError("INVALID_STATE")
        self.kicked_tokens.add(player.token)
        if self.round is not None:
            self.round.answers.pop(player_id, None)
        if self.calib is not None:
            self.calib.tapped.discard(player_id)
            self.calib.samples.pop(player_id, None)
        self._maybe_reveal_early()
        return player

    def effective_delays(self) -> dict[str, int]:
        return calibration.effective_delays({pid: p.delay_ms for pid, p in self.players.items()})

    # ---- đo độ trễ ----

    def start_calibration(self) -> None:
        self._require(Phase.LOBBY)
        if not any(p.online for p in self.players.values()):
            raise GameError("INVALID_STATE")
        self.phase = Phase.CALIBRATING
        self.calib = CalibState(round=1, wait_ms=calibration.random_wait_ms(self.rng))
        self.notice = None

    def calib_flash(self, round_no: int, now: int) -> None:
        self._require(Phase.CALIBRATING)
        if round_no != self.calib.round or self.calib.flash_at is not None:
            raise GameError("INVALID_STATE")
        self.calib.flash_at = now

    def calib_tap(self, player_id: str, round_no: int, now: int) -> None:
        self._require(Phase.CALIBRATING)
        calib = self.calib
        if round_no != calib.round or calib.flash_at is None:
            raise GameError("INVALID_STATE")
        if player_id in calib.tapped:
            raise GameError("ALREADY_ANSWERED")
        sample = calibration.tap_sample(calib.flash_at, now, self.timing.calib_tap_window_ms)
        if sample is None:
            raise GameError("TOO_LATE")
        calib.tapped.add(player_id)
        calib.samples.setdefault(player_id, []).append(sample)

    def _finish_calibration_round(self) -> None:
        calib = self.calib
        if calib.round < self.timing.calib_rounds:
            self.calib = CalibState(
                round=calib.round + 1,
                wait_ms=calibration.random_wait_ms(self.rng),
                samples=calib.samples,
            )
            return
        # Lần đo mới ghi đè lần cũ, kể cả với người không có mẫu nào.
        for player in self.players.values():
            player.delay_ms = calibration.measured_delay(calib.samples.get(player.id, []))
        self.calib = None
        self.phase = Phase.LOBBY

    # ---- mốc thời gian ----

    def next_wakeup(self) -> int | None:
        """Mốc epoch ms mà `tick` cần được gọi, hoặc None nếu không có gì phải chờ."""
        if self.phase is Phase.CALIBRATING and self.calib.flash_at is not None:
            return self.calib.flash_at + self.timing.calib_tap_window_ms
        if self.phase is Phase.ANSWERING:
            return self.round.deadline
        return None

    def tick(self, now: int) -> bool:
        """Xử lý mốc thời gian đã tới. Trả về True nếu phòng thay đổi."""
        wakeup = self.next_wakeup()
        if wakeup is None or now < wakeup:
            return False
        if self.phase is Phase.CALIBRATING:
            self._finish_calibration_round()
        else:
            self._reveal()
        return True

    # ---- nội bộ ----

    def _require(self, *phases: Phase) -> None:
        if self.phase not in phases:
            raise GameError("INVALID_STATE")

    def _maybe_reveal_early(self) -> None:
        """Sang REVEAL khi mọi người online đã trả lời (chỉ khi có ít nhất 1 người online)."""
        if self.phase is not Phase.ANSWERING:
            return
        online = [pid for pid, p in self.players.items() if p.online]
        if online and all(pid in self.round.answers for pid in online):
            self._reveal()

    def _reveal(self) -> None:
        for player_id, answer in self.round.answers.items():
            self.players[player_id].score += answer.gained
        self.phase = Phase.REVEAL
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game -v`
Expected: all pass (`52 passed`).

- [ ] **Step 6: Commit**

```bash
git add backend/app/game/room.py backend/tests/factories.py backend/tests/game/test_room_lobby.py
git commit -m "feat(game): room players, kick and calibration flow"
```

---

### Task 6: Room state machine, part 2 (game flow)

**Files:**
- Modify: `backend/app/game/room.py` (append methods to the end of `class Room`)
- Test: `backend/tests/game/test_room_game.py`

**Interfaces:**
- Consumes: `Room` from Task 5 (`_require`, `_maybe_reveal_early`, `_reveal`), `build_game`, `build_question`, `answer_deadline`, `effective_time_ms`, `points`, `competition_ranks`
- Produces (more `Room` methods):
  - `start_game()`: `LOBBY` and at least 1 player → `PREPARING(0)`
  - `audio_started(round_index, now)`: `PREPARING` → `ANSWERING`, sets `round.t0` and `round.deadline`
  - `answer(player_id, round_index, option_index, now)`: `INVALID_STATE` / `ALREADY_ANSWERED` / `TOO_LATE`
  - `replay_round()`: `PREPARING | ANSWERING | REVEAL` → `PREPARING(same i)`, refunds points if it was `REVEAL`
  - `audio_failed(round_index, now)`: `PREPARING` only; uses a spare (`notice="AUDIO_REPLACED"`) or drops the question (`notice="ROUND_DROPPED"`)
  - `next_round(now)`: `REVEAL` → `PREPARING(i+1)` or `FINISHED`
  - `play_again()`: `FINISHED` → `LOBBY`, scores reset to 0, players and delays kept
  - `leaderboard() -> list[tuple[Player, int]]`: (player, rank) sorted by rank then name (casefold)
  - Every `_enter_round` increments `prepare_seq`.

- [ ] **Step 1: Write the failing tests**

```python
from app.game.models import Phase
from tests.factories import game_error, make_room, make_songs


def started_room(names=("A", "B"), **settings):
    room = make_room(**settings)
    ids = [room.add_player(name).id for name in names]
    room.start_game()
    return room, ids


def correct_index(room):
    return room.round.question.correct_index


def wrong_index(room):
    return (room.round.question.correct_index + 1) % 4


def play_round(room, now, correct=()):
    """audio_started lúc `now`; người trong `correct` trả lời đúng ngay; rồi tới hạn chót."""
    index = room.round.index
    room.audio_started(index, now)
    for player_id in correct:
        room.answer(player_id, index, correct_index(room), now)
    room.tick(room.round.deadline)


def test_start_needs_a_player():
    assert game_error(make_room().start_game) == "INVALID_STATE"


def test_offline_players_still_count_for_start():
    room = make_room()
    player = room.add_player("A")
    room.set_player_online(player.id, False)
    room.start_game()
    assert room.phase is Phase.PREPARING


def test_start_builds_questions_and_enters_preparing():
    room, _ = started_room()
    assert room.phase is Phase.PREPARING
    assert len(room.questions) == 3 and len(room.spares) == 2
    assert room.round.index == 0 and room.round.question is room.questions[0]
    assert room.prepare_seq == 1


def test_commands_refused_once_the_game_runs():
    room, _ = started_room()
    assert game_error(room.start_game) == "INVALID_STATE"
    assert game_error(room.start_calibration) == "INVALID_STATE"
    assert game_error(room.add_player, "Late") == "GAME_STARTED"
    assert game_error(room.next_round, 0) == "INVALID_STATE"
    assert game_error(room.play_again) == "INVALID_STATE"


def test_audio_started_opens_answers_with_deadline():
    room, _ = started_room()
    assert game_error(room.audio_started, 1, 10_000) == "INVALID_STATE"
    room.audio_started(0, 10_000)
    assert room.phase is Phase.ANSWERING
    assert room.round.t0 == 10_000
    assert room.round.deadline == 10_000 + 15_000 + 3_000
    assert room.next_wakeup() == 28_000
    assert game_error(room.audio_started, 0, 10_100) == "INVALID_STATE"


def test_answer_scores_with_player_delay_and_adds_points_at_reveal():
    room, (a, b) = started_room()
    room.players[a].delay_ms = 1_000
    room.players[b].delay_ms = 0
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 11_000)
    assert room.round.answers[a].gained == 1_000
    assert room.players[a].score == 0  # chỉ cộng điểm lúc REVEAL
    room.answer(b, 0, wrong_index(room), 17_500)
    assert room.phase is Phase.REVEAL
    assert (room.players[a].score, room.players[b].score) == (1_000, 0)


def test_answer_errors():
    room, (a, b, _) = started_room(names=("A", "B", "C"))
    assert game_error(room.answer, a, 0, 0, 5_000) == "INVALID_STATE"  # still PREPARING
    room.audio_started(0, 10_000)
    assert game_error(room.answer, a, 1, 0, 10_500) == "INVALID_STATE"  # wrong round
    assert game_error(room.answer, a, 0, 4, 10_500) == "INVALID_STATE"  # no option 4
    room.answer(a, 0, 0, 10_500)
    assert game_error(room.answer, a, 0, 1, 10_600) == "ALREADY_ANSWERED"
    assert game_error(room.answer, b, 0, 0, 28_001) == "TOO_LATE"
    assert room.phase is Phase.ANSWERING


def test_answer_at_the_deadline_is_accepted_for_500():
    room, (a, _) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 28_000)
    assert room.round.answers[a].gained == 500


def test_deadline_tick_reveals_without_all_answers():
    room, (a, _) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 10_000)
    assert room.tick(27_999) is False
    assert room.tick(28_000) is True
    assert room.phase is Phase.REVEAL
    assert room.next_wakeup() is None


def test_early_reveal_only_waits_for_online_players():
    room, (a, b) = started_room()
    room.set_player_online(b, False)
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    assert room.phase is Phase.REVEAL


def test_last_unanswered_player_going_offline_triggers_reveal():
    room, (a, b) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    room.set_player_online(b, False)
    assert room.phase is Phase.REVEAL


def test_kicking_last_unanswered_player_triggers_reveal():
    room, (a, b) = started_room()
    room.audio_started(0, 10_000)
    room.answer(a, 0, 0, 10_500)
    room.kick(b)
    assert room.phase is Phase.REVEAL


def test_nobody_online_waits_for_the_deadline():
    room, (a, b) = started_room()
    room.set_player_online(a, False)
    room.set_player_online(b, False)
    room.audio_started(0, 10_000)
    assert room.phase is Phase.ANSWERING
    room.tick(28_000)
    assert room.phase is Phase.REVEAL


def test_next_round_then_finish():
    room, (a, _) = started_room()
    play_round(room, 10_000, correct=[a])
    room.next_round(40_000)
    assert room.phase is Phase.PREPARING and room.round.index == 1 and room.prepare_seq == 2
    play_round(room, 50_000)
    room.next_round(80_000)
    play_round(room, 90_000)
    room.next_round(120_000)
    assert room.phase is Phase.FINISHED
    assert room.finished_at == 120_000 and room.round is None
    assert room.players[a].score == 1_000


def test_replay_from_answering_discards_answers():
    room, (a, _) = started_room()
    question = room.round.question
    room.audio_started(0, 10_000)
    room.answer(a, 0, correct_index(room), 10_000)
    room.replay_round()
    assert room.phase is Phase.PREPARING
    assert room.round.index == 0 and room.round.question is question
    assert room.round.answers == {} and room.round.t0 is None
    assert room.prepare_seq == 2


def test_replay_from_reveal_refunds_points():
    room, (a, b) = started_room()
    play_round(room, 10_000, correct=[a, b])
    assert room.players[a].score == 1_000
    room.replay_round()
    assert (room.players[a].score, room.players[b].score) == (0, 0)
    assert room.phase is Phase.PREPARING


def test_replay_from_preparing_reloads():
    room, _ = started_room()
    room.replay_round()
    assert room.phase is Phase.PREPARING and room.prepare_seq == 2


def test_replay_outside_a_round_is_invalid():
    room = make_room()
    room.add_player("A")
    assert game_error(room.replay_round) == "INVALID_STATE"


def test_audio_failed_swaps_in_a_spare():
    room, _ = started_room()
    first_spare = room.spares[0]
    room.audio_failed(0, 5_000)
    assert room.phase is Phase.PREPARING and room.round.index == 0
    assert room.round.question.song == first_spare
    assert room.questions[0].song == first_spare
    assert len(room.questions) == 3 and len(room.spares) == 1
    assert room.notice == "AUDIO_REPLACED" and room.prepare_seq == 2
    assert len(set(room.round.question.options)) == 4


def test_audio_failed_without_spares_drops_the_round():
    room, _ = started_room(songs=make_songs(3), question_count=3)
    second = room.questions[1]
    room.audio_failed(0, 5_000)
    assert len(room.questions) == 2
    assert room.round.index == 0 and room.round.question is second
    assert room.notice == "ROUND_DROPPED"


def test_audio_failed_on_last_round_without_spares_finishes():
    room, _ = started_room(songs=make_songs(1), question_count=1)
    room.audio_failed(0, 5_000)
    assert room.phase is Phase.FINISHED and room.questions == []
    assert room.notice == "ROUND_DROPPED"


def test_audio_failed_only_while_preparing():
    room, _ = started_room()
    assert game_error(room.audio_failed, 1, 5_000) == "INVALID_STATE"
    room.audio_started(0, 10_000)
    assert game_error(room.audio_failed, 0, 11_000) == "INVALID_STATE"


def test_notice_clears_when_audio_starts():
    room, _ = started_room()
    room.audio_failed(0, 5_000)
    room.audio_started(0, 10_000)
    assert room.notice is None


def test_play_again_resets_scores_but_keeps_players_and_delays():
    room, (a, b) = started_room(songs=make_songs(2), question_count=1)
    room.players[a].delay_ms = 700
    play_round(room, 10_000, correct=[a])
    room.next_round(40_000)
    room.play_again()
    assert room.phase is Phase.LOBBY and room.round is None and room.finished_at is None
    assert set(room.players) == {a, b}
    assert room.players[a].score == 0 and room.players[a].delay_ms == 700
    room.start_game()
    assert room.phase is Phase.PREPARING and len(room.questions) == 1


def test_leaderboard_uses_competition_ranking_and_name_order():
    room, (bao, an, cuong) = started_room(names=("bao", "An", "Cuong"))
    play_round(room, 10_000, correct=[bao, an])
    board = [(player.name, rank) for player, rank in room.leaderboard()]
    assert board == [("An", 1), ("bao", 1), ("Cuong", 3)]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_room_game.py -v`
Expected: FAIL with `AttributeError: 'Room' object has no attribute 'start_game'`.

- [ ] **Step 3: Append the game-flow methods to `Room`**

Add these methods at the end of the class body (after `_reveal`), indented 4 spaces like the other methods:

```python

    # ---- ván chơi ----

    def start_game(self) -> None:
        self._require(Phase.LOBBY)
        if not self.players:
            raise GameError("INVALID_STATE")
        self.questions, self.spares = build_game(self.songs, self.settings, self.popular, self.rng)
        self._enter_round(0)

    def audio_started(self, round_index: int, now: int) -> None:
        self._require(Phase.PREPARING)
        self._check_round(round_index)
        rnd = self.round
        rnd.t0 = now
        rnd.deadline = answer_deadline(now, rnd.question.clip_ms, self.timing.grace_ms)
        self.phase = Phase.ANSWERING
        self.notice = None

    def answer(self, player_id: str, round_index: int, option_index: int, now: int) -> None:
        self._require(Phase.ANSWERING)
        self._check_round(round_index)
        rnd = self.round
        if not 0 <= option_index < len(rnd.question.options):
            raise GameError("INVALID_STATE")
        if player_id in rnd.answers:
            raise GameError("ALREADY_ANSWERED")
        if now > rnd.deadline:
            raise GameError("TOO_LATE")
        t_ms = effective_time_ms(now, rnd.t0, self.effective_delays().get(player_id, 0))
        correct = option_index == rnd.question.correct_index
        rnd.answers[player_id] = Answer(option_index, now, points(correct, t_ms, rnd.question.clip_ms))
        self._maybe_reveal_early()

    def replay_round(self) -> None:
        self._require(Phase.PREPARING, Phase.ANSWERING, Phase.REVEAL)
        if self.phase is Phase.REVEAL:
            for player_id, answer in self.round.answers.items():
                self.players[player_id].score -= answer.gained
        self._enter_round(self.round.index)

    def audio_failed(self, round_index: int, now: int) -> None:
        self._require(Phase.PREPARING)
        self._check_round(round_index)
        index = self.round.index
        if self.spares:
            song = self.spares.pop(0)
            names = [s.anime_name for s in self.songs]
            self.questions[index] = build_question(song, names, self.popular, self.settings, self.rng)
            self._enter_round(index)
            self.notice = "AUDIO_REPLACED"
            return
        del self.questions[index]
        if index < len(self.questions):
            self._enter_round(index)
        else:
            self._finish(now)
        self.notice = "ROUND_DROPPED"

    def next_round(self, now: int) -> None:
        self._require(Phase.REVEAL)
        if self.round.index + 1 < len(self.questions):
            self._enter_round(self.round.index + 1)
        else:
            self._finish(now)

    def play_again(self) -> None:
        self._require(Phase.FINISHED)
        for player in self.players.values():
            player.score = 0
        self.phase = Phase.LOBBY
        self.questions, self.spares = [], []
        self.round = None
        self.finished_at = None
        self.notice = None

    def leaderboard(self) -> list[tuple[Player, int]]:
        ranks = competition_ranks({pid: p.score for pid, p in self.players.items()})
        rows = [(player, ranks[pid]) for pid, player in self.players.items()]
        return sorted(rows, key=lambda row: (row[1], row[0].name.casefold()))

    def _enter_round(self, index: int) -> None:
        self.round = RoundState(index=index, question=self.questions[index])
        self.phase = Phase.PREPARING
        self.prepare_seq += 1
        self.notice = None

    def _check_round(self, round_index: int) -> None:
        if round_index != self.round.index:
            raise GameError("INVALID_STATE")

    def _finish(self, now: int) -> None:
        self.round = None
        self.phase = Phase.FINISHED
        self.finished_at = now
        self.notice = None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game -v`
Expected: all pass (`77 passed`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/game/room.py backend/tests/game/test_room_game.py
git commit -m "feat(game): rounds, answers, replay, audio failure and play again"
```

---

### Task 7: Role-specific snapshots

**Files:**
- Create: `backend/app/game/views.py`
- Test: `backend/tests/game/test_views.py`

**Interfaces:**
- Consumes: `Room` (Tasks 5–6), `Phase`, `Settings`, `LEADERBOARD_TOP`
- Produces (payloads of the `room:state` event; Task 16's `protocol.ts` mirrors them exactly):
  - `host_view(room, now) -> dict`:
    ```
    { code, phase, mode, settings: {questionCount, clipSec, revealSec, maxPlayers, mode}, serverNow,
      players: [{id, name, online, delayMs, calibrated, score}],
      calib: {round, waitMs, flashed, tappedCount} | null,
      round: { index, total, videoId, startSec, endSec, options[4], deadline | null,
               answeredCount, onlineCount, prepareSeq,
               reveal: {correctIndex, optionCounts[4], animeName, songLabel} | null } | null,
      leaderboard: [{playerId, name, score, rank, gained | null}],
      notice: "AUDIO_REPLACED" | "ROUND_DROPPED" | null }
    ```
  - `player_view(room, player_id, now) -> dict`:
    ```
    { code, phase, serverNow, hostOnline, playerCount,
      me: {id, name, score, rank, delayMs, calibrated},
      calib: {round, tapped} | null,
      round: { index, total, options[4] | null, deadline | null, myAnswer | null,
               result: {correctIndex, correct, gained, animeName, songLabel} | null } | null,
      leaderboardTop: [{playerId, name, score, rank, gained | null}] (≤ 10) | null }
    ```
  - `delayMs` is the effective delay (with the room-median fallback). `calibrated` is true when the player has a measured delay.
  - `gained` is a number only in `REVEAL` (0 for players who did not answer), otherwise `null`.
  - Player `options` are only sent in `ANSWERING` and `REVEAL`. `leaderboardTop` is only sent in `REVEAL` and `FINISHED`.

- [ ] **Step 1: Write the failing tests**

```python
import json

from app.game.views import host_view, player_view
from tests.factories import make_room

HOST_KEYS = {"code", "phase", "mode", "settings", "serverNow", "players", "calib", "round", "leaderboard", "notice"}
PLAYER_KEYS = {"code", "phase", "serverNow", "hostOnline", "playerCount", "me", "calib", "round", "leaderboardTop"}
SECRET_KEYS = {"videoId", "startSec", "endSec", "correctIndex", "animeName", "songLabel", "reveal", "result", "gained"}


def non_null_keys(value) -> set[str]:
    """Mọi khóa có giá trị khác None, tìm đệ quy."""
    if isinstance(value, dict):
        own = {key for key, item in value.items() if item is not None}
        return own.union(*(non_null_keys(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(non_null_keys(item) for item in value))
    return set()


def lobby_room(count=3):
    room = make_room(now=1_000)
    ids = [room.add_player(f"P{i}").id for i in range(count)]
    return room, ids


def test_player_view_never_leaks_the_answer_before_reveal():
    room, (a, b, _) = lobby_room()
    snapshots = [player_view(room, a, 1_000)]
    room.start_game()
    snapshots.append(player_view(room, a, 3_000))
    room.audio_started(0, 4_000)
    snapshots.append(player_view(room, a, 4_100))
    room.answer(a, 0, room.round.question.correct_index, 4_500)
    snapshots += [player_view(room, a, 4_600), player_view(room, b, 4_600)]
    video_id = room.round.question.song.video_id
    for view in snapshots:
        assert non_null_keys(view) & SECRET_KEYS == set()
        assert video_id not in json.dumps(view)


def test_player_options_appear_only_once_answering():
    room, (a, _, _) = lobby_room()
    room.start_game()
    view = player_view(room, a, 0)
    assert view["round"]["options"] is None
    assert (view["round"]["index"], view["round"]["total"]) == (0, 3)
    room.audio_started(0, 1_000)
    view = player_view(room, a, 1_000)
    assert view["round"]["options"] == list(room.round.question.options)
    assert view["round"]["deadline"] == 19_000


def test_player_results_at_reveal():
    room, (a, b, c) = lobby_room()
    room.start_game()
    room.audio_started(0, 1_000)
    q = room.round.question
    room.answer(a, 0, q.correct_index, 1_000)
    room.answer(b, 0, (q.correct_index + 1) % 4, 1_000)
    room.tick(19_000)
    ra, rb, rc = (player_view(room, pid, 19_000)["round"]["result"] for pid in (a, b, c))
    assert ra == {
        "correctIndex": q.correct_index,
        "correct": True,
        "gained": 1_000,
        "animeName": q.song.anime_name,
        "songLabel": q.song.song_label,
    }
    assert (rb["correct"], rb["gained"]) == (False, 0)
    assert (rc["correct"], rc["gained"]) == (False, 0)
    me = player_view(room, a, 19_000)["me"]
    assert (me["score"], me["rank"]) == (1_000, 1)


def test_leaderboard_top_is_limited_to_ten_and_only_after_reveal():
    room, ids = lobby_room(count=12)
    assert player_view(room, ids[0], 0)["leaderboardTop"] is None
    room.start_game()
    room.audio_started(0, 1_000)
    room.tick(19_000)
    top = player_view(room, ids[0], 19_000)["leaderboardTop"]
    assert len(top) == 10
    assert set(top[0]) == {"playerId", "name", "score", "rank", "gained"}


def test_player_calibration_view():
    room, (a, b, _) = lobby_room()
    room.start_calibration()
    room.calib_flash(1, 1_000)
    room.calib_tap(a, 1, 1_400)
    assert player_view(room, a, 1_500)["calib"] == {"round": 1, "tapped": True}
    assert player_view(room, b, 1_500)["calib"] == {"round": 1, "tapped": False}


def test_player_view_shape_in_lobby():
    room, (a, _, _) = lobby_room()
    room.set_host_online(False, 500)
    view = player_view(room, a, 1_234)
    assert set(view) == PLAYER_KEYS
    assert (view["serverNow"], view["hostOnline"], view["playerCount"]) == (1_234, False, 3)
    assert view["me"] == {"id": a, "name": "P0", "score": 0, "rank": 1, "delayMs": 0, "calibrated": False}
    assert view["calib"] is None and view["round"] is None


def test_host_view_in_lobby():
    room, (a, b, _) = lobby_room()
    room.players[a].delay_ms = 1_200
    room.set_player_online(b, False)
    view = host_view(room, 5_000)
    assert set(view) == HOST_KEYS
    assert (view["phase"], view["mode"], view["serverNow"]) == ("LOBBY", "stream", 5_000)
    assert view["settings"] == {"questionCount": 3, "clipSec": 15, "revealSec": 15, "maxPlayers": 30, "mode": "stream"}
    pa, pb, pc = view["players"]
    assert pa == {"id": a, "name": "P0", "online": True, "delayMs": 1_200, "calibrated": True, "score": 0}
    assert pb["online"] is False
    assert (pc["delayMs"], pc["calibrated"]) == (1_200, False)  # room-median fallback
    assert view["calib"] is None and view["round"] is None and view["notice"] is None
    assert [row["gained"] for row in view["leaderboard"]] == [None, None, None]


def test_host_view_calibration_counts_taps():
    room, (a, _, _) = lobby_room()
    room.start_calibration()
    wait = room.calib.wait_ms
    assert host_view(room, 0)["calib"] == {"round": 1, "waitMs": wait, "flashed": False, "tappedCount": 0}
    room.calib_flash(1, 1_000)
    room.calib_tap(a, 1, 1_300)
    assert host_view(room, 1_300)["calib"] == {"round": 1, "waitMs": wait, "flashed": True, "tappedCount": 1}


def test_host_view_round_while_answering():
    room, (a, _, _) = lobby_room()
    room.start_game()
    q = room.round.question
    preparing = host_view(room, 0)["round"]
    assert preparing["deadline"] is None and preparing["prepareSeq"] == 1
    room.audio_started(0, 1_000)
    room.answer(a, 0, 0, 1_500)
    assert host_view(room, 1_500)["round"] == {
        "index": 0,
        "total": 3,
        "videoId": q.song.video_id,
        "startSec": q.start_sec,
        "endSec": q.end_sec,
        "options": list(q.options),
        "deadline": 19_000,
        "answeredCount": 1,
        "onlineCount": 3,
        "prepareSeq": 1,
        "reveal": None,
    }


def test_host_view_reveal():
    room, (a, b, c) = lobby_room()
    room.start_game()
    room.audio_started(0, 1_000)
    q = room.round.question
    wrong = (q.correct_index + 1) % 4
    room.answer(a, 0, q.correct_index, 1_000)
    room.answer(b, 0, wrong, 1_000)
    room.answer(c, 0, wrong, 1_000)
    view = host_view(room, 2_000)
    counts = [0, 0, 0, 0]
    counts[q.correct_index], counts[wrong] = 1, 2
    assert view["round"]["reveal"] == {
        "correctIndex": q.correct_index,
        "optionCounts": counts,
        "animeName": q.song.anime_name,
        "songLabel": q.song.song_label,
    }
    rows = [(row["name"], row["rank"], row["gained"]) for row in view["leaderboard"]]
    assert rows == [("P0", 1, 1_000), ("P1", 2, 0), ("P2", 2, 0)]


def test_host_view_shows_notice_and_views_are_json():
    room, (a, _, _) = lobby_room()
    room.start_game()
    room.audio_failed(0, 500)
    view = host_view(room, 500)
    assert view["notice"] == "AUDIO_REPLACED"
    for snapshot in (view, player_view(room, a, 500)):
        assert json.loads(json.dumps(snapshot)) == snapshot
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_views.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.game.views'`.

- [ ] **Step 3: Implement the views**

```python
"""Snapshot gửi cho từng vai trò. Bản cho người chơi không bao giờ lộ đáp án trước REVEAL."""

from app.game.constants import LEADERBOARD_TOP
from app.game.models import Phase, Settings
from app.game.room import Room


def _settings(settings: Settings) -> dict:
    return {
        "questionCount": settings.question_count,
        "clipSec": settings.clip_sec,
        "revealSec": settings.reveal_sec,
        "maxPlayers": settings.max_players,
        "mode": settings.mode,
    }


def _gained(room: Room, player_id: str) -> int | None:
    if room.phase is not Phase.REVEAL:
        return None
    answer = room.round.answers.get(player_id)
    return answer.gained if answer else 0


def _leaderboard(room: Room) -> list[dict]:
    return [
        {
            "playerId": player.id,
            "name": player.name,
            "score": player.score,
            "rank": rank,
            "gained": _gained(room, player.id),
        }
        for player, rank in room.leaderboard()
    ]


def _host_calib(room: Room) -> dict | None:
    calib = room.calib
    if calib is None:
        return None
    return {
        "round": calib.round,
        "waitMs": calib.wait_ms,
        "flashed": calib.flash_at is not None,
        "tappedCount": len(calib.tapped),
    }


def _host_round(room: Room) -> dict | None:
    rnd = room.round
    if rnd is None:
        return None
    question = rnd.question
    reveal = None
    if room.phase is Phase.REVEAL:
        counts = [0] * len(question.options)
        for answer in rnd.answers.values():
            counts[answer.option_index] += 1
        reveal = {
            "correctIndex": question.correct_index,
            "optionCounts": counts,
            "animeName": question.song.anime_name,
            "songLabel": question.song.song_label,
        }
    return {
        "index": rnd.index,
        "total": len(room.questions),
        "videoId": question.song.video_id,
        "startSec": question.start_sec,
        "endSec": question.end_sec,
        "options": list(question.options),
        "deadline": rnd.deadline,
        "answeredCount": len(rnd.answers),
        "onlineCount": sum(1 for p in room.players.values() if p.online),
        "prepareSeq": room.prepare_seq,
        "reveal": reveal,
    }


def host_view(room: Room, now: int) -> dict:
    delays = room.effective_delays()
    return {
        "code": room.code,
        "phase": room.phase.value,
        "mode": room.settings.mode,
        "settings": _settings(room.settings),
        "serverNow": now,
        "players": [
            {
                "id": player.id,
                "name": player.name,
                "online": player.online,
                "delayMs": delays[player.id],
                "calibrated": player.delay_ms is not None,
                "score": player.score,
            }
            for player in room.players.values()
        ],
        "calib": _host_calib(room),
        "round": _host_round(room),
        "leaderboard": _leaderboard(room),
        "notice": room.notice,
    }


def _player_round(room: Room, player_id: str) -> dict | None:
    rnd = room.round
    if rnd is None:
        return None
    question = rnd.question
    mine = rnd.answers.get(player_id)
    result = None
    if room.phase is Phase.REVEAL:
        result = {
            "correctIndex": question.correct_index,
            "correct": mine is not None and mine.option_index == question.correct_index,
            "gained": mine.gained if mine else 0,
            "animeName": question.song.anime_name,
            "songLabel": question.song.song_label,
        }
    show_options = room.phase in (Phase.ANSWERING, Phase.REVEAL)
    return {
        "index": rnd.index,
        "total": len(room.questions),
        "options": list(question.options) if show_options else None,
        "deadline": rnd.deadline,
        "myAnswer": mine.option_index if mine else None,
        "result": result,
    }


def player_view(room: Room, player_id: str, now: int) -> dict:
    player = room.players[player_id]
    rank = next(r for p, r in room.leaderboard() if p.id == player_id)
    calib = room.calib
    show_board = room.phase in (Phase.REVEAL, Phase.FINISHED)
    return {
        "code": room.code,
        "phase": room.phase.value,
        "serverNow": now,
        "hostOnline": room.host_online,
        "playerCount": len(room.players),
        "me": {
            "id": player.id,
            "name": player.name,
            "score": player.score,
            "rank": rank,
            "delayMs": room.effective_delays()[player_id],
            "calibrated": player.delay_ms is not None,
        },
        "calib": None if calib is None else {"round": calib.round, "tapped": player_id in calib.tapped},
        "round": _player_round(room, player_id),
        "leaderboardTop": _leaderboard(room)[:LEADERBOARD_TOP] if show_board else None,
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game -v`
Expected: all pass (`88 passed`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/game/views.py backend/tests/game/test_views.py
git commit -m "feat(game): host and player snapshots"
```

---

### Task 8: Room manager and room-creation validation

**Files:**
- Create: `backend/app/game/room_manager.py`
- Create: `backend/app/game/validation.py`
- Test: `backend/tests/game/test_room_manager.py`, `backend/tests/game/test_validation.py`

**Interfaces:**
- Consumes: `Room`, `Song`, `Settings`, `Timing`, `GameError`, `Phase`, constants
- Produces:
  - `RoomManager(popular, rng=None, timing=Timing())` with `.rooms: dict[str, Room]`
    - `create_room(songs, settings, now) -> Room` (code unique among live rooms; `host_token = secrets.token_urlsafe(16)`)
    - `get(code) -> Room` (strips and upper-cases the code; `ROOM_NOT_FOUND`)
    - `remove(code) -> None`
    - `expired(now) -> list[str]`: codes of rooms FINISHED > 30 min, host offline > 15 min, or older than 4 h
  - `parse_create_room(payload) -> tuple[list[Song], Settings]`: raises `GameError("INVALID_SET")` for any invalid set or settings

- [ ] **Step 1: Write the failing room-manager tests**

```python
from random import Random

from app.game.constants import ROOM_CODE_ALPHABET
from app.game.models import Phase, Settings, Timing
from app.game.room_manager import RoomManager
from tests.factories import POPULAR, game_error, make_songs

MINUTE = 60_000
SETTINGS = Settings(question_count=2)


def new_manager(seed=1, timing=Timing()):
    return RoomManager(POPULAR, rng=Random(seed), timing=timing)


def test_create_room_registers_it_with_a_valid_code():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=1_000)
    assert len(room.code) == 6 and set(room.code) <= set(ROOM_CODE_ALPHABET)
    assert manager.rooms[room.code] is room
    assert len(room.host_token) >= 20
    assert room.created_at == 1_000 and room.phase is Phase.LOBBY


def test_rooms_get_the_manager_timing():
    timing = Timing(calib_tap_window_ms=300)
    room = new_manager(timing=timing).create_room(make_songs(3), SETTINGS, now=0)
    assert room.timing is timing


def test_get_normalises_the_code():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    assert manager.get(f"  {room.code.lower()} ") is room
    assert game_error(manager.get, "ZZZZZZ") == "ROOM_NOT_FOUND"


def test_codes_never_collide_with_live_rooms():
    manager = new_manager(seed=5)
    first = manager.create_room(make_songs(3), SETTINGS, now=0)
    manager.rng = Random(5)  # same seed: the first code drawn now equals `first.code`
    second = manager.create_room(make_songs(3), SETTINGS, now=0)
    assert second.code != first.code
    assert len(manager.rooms) == 2


def test_many_rooms_have_unique_codes():
    manager = new_manager()
    codes = {manager.create_room(make_songs(3), SETTINGS, now=0).code for _ in range(200)}
    assert len(codes) == 200


def test_remove():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    manager.remove(room.code)
    manager.remove(room.code)  # removing twice is harmless
    assert room.code not in manager.rooms


def test_expiry_rules():
    manager = new_manager()
    fresh = manager.create_room(make_songs(3), SETTINGS, now=0)
    finished = manager.create_room(make_songs(3), SETTINGS, now=0)
    finished.phase, finished.finished_at = Phase.FINISHED, 10 * MINUTE
    host_gone = manager.create_room(make_songs(3), SETTINGS, now=0)
    host_gone.set_host_online(False, now=20 * MINUTE)

    assert manager.expired(35 * MINUTE) == []  # 25 min finished, 15 min offline: not yet
    assert set(manager.expired(35 * MINUTE + 1)) == {host_gone.code}
    assert set(manager.expired(40 * MINUTE + 1)) == {host_gone.code, finished.code}
    assert fresh.code not in manager.expired(240 * MINUTE)
    assert fresh.code in manager.expired(240 * MINUTE + 1)


def test_host_coming_back_cancels_offline_expiry():
    manager = new_manager()
    room = manager.create_room(make_songs(3), SETTINGS, now=0)
    room.set_host_online(False, now=0)
    room.set_host_online(True, now=MINUTE)
    assert manager.expired(30 * MINUTE) == []
```

- [ ] **Step 2: Write the failing validation tests**

```python
import pytest

from app.game.models import Settings, Song
from app.game.validation import parse_create_room
from tests.factories import game_error


def song(i=0, **overrides):
    data = {
        "videoId": f"vid{i:08d}",
        "videoTitle": f"Title {i}",
        "durationSec": 200,
        "animeName": f"Anime {i}",
        "songLabel": "OP1",
        "startSec": None,
        "needsReview": False,
    }
    return data | overrides


def payload(songs=None, **settings):
    songs = [song(i) for i in range(3)] if songs is None else songs
    question_set = {"version": 1, "id": "x", "name": "Bộ", "updatedAt": "2026-10-16T12:00:00Z", "songs": songs}
    return {"set": question_set, "settings": settings}


def test_valid_payload_is_converted():
    songs, settings = parse_create_room(payload([song(0, animeName="  Naruto ", startSec=42)], clipSec=20))
    assert songs == [
        Song(
            video_id="vid00000000",
            video_title="Title 0",
            duration_sec=200,
            anime_name="Naruto",
            song_label="OP1",
            start_sec=42,
        )
    ]
    assert settings == Settings(question_count=1, clip_sec=20, reveal_sec=15, max_players=30, mode="stream")


def test_question_count_defaults_to_at_most_ten():
    _, few = parse_create_room(payload([song(i) for i in range(3)]))
    _, many = parse_create_room(payload([song(i) for i in range(12)]))
    assert (few.question_count, many.question_count) == (3, 10)


def test_missing_settings_use_defaults():
    _, settings = parse_create_room({"set": payload()["set"]})
    assert settings == Settings(question_count=3)


@pytest.mark.parametrize(
    "bad_song",
    [
        song(needsReview=True),
        song(animeName="   "),
        song(videoId="short"),
        song(durationSec=0),
    ],
)
def test_bad_songs_are_rejected(bad_song):
    assert game_error(parse_create_room, payload([bad_song])) == "INVALID_SET"


def test_song_count_limits():
    assert game_error(parse_create_room, payload([])) == "INVALID_SET"
    assert game_error(parse_create_room, payload([song(i) for i in range(501)])) == "INVALID_SET"
    songs, _ = parse_create_room(payload([song(i) for i in range(500)]))
    assert len(songs) == 500


@pytest.mark.parametrize(
    "settings",
    [
        {"questionCount": 0},
        {"questionCount": 4},
        {"clipSec": 4},
        {"clipSec": 31},
        {"revealSec": -1},
        {"revealSec": 31},
        {"maxPlayers": 1},
        {"maxPlayers": 51},
        {"mode": "self"},
    ],
)
def test_out_of_range_settings_are_rejected(settings):
    assert game_error(parse_create_room, payload(**settings)) == "INVALID_SET"


def test_setting_limits_are_inclusive():
    _, low = parse_create_room(payload(questionCount=1, clipSec=5, revealSec=0, maxPlayers=2))
    _, high = parse_create_room(payload(questionCount=3, clipSec=30, revealSec=30, maxPlayers=50))
    assert (low.clip_sec, low.reveal_sec, low.max_players) == (5, 0, 2)
    assert (high.question_count, high.clip_sec, high.reveal_sec, high.max_players) == (3, 30, 30, 50)


@pytest.mark.parametrize("bad", [None, "x", [], {}, {"set": {"songs": "nope"}}])
def test_malformed_payloads_are_rejected(bad):
    assert game_error(parse_create_room, bad) == "INVALID_SET"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/game/test_room_manager.py tests/game/test_validation.py -v`
Expected: collection errors `No module named 'app.game.room_manager'` and `No module named 'app.game.validation'`.

- [ ] **Step 4: Implement the room manager**

```python
"""Quản lý các phòng đang sống: cấp mã phòng, tra cứu, tìm phòng hết hạn."""

import secrets
from random import Random, SystemRandom

from app.game.constants import (
    FINISHED_TTL_MS,
    HOST_OFFLINE_TTL_MS,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
    ROOM_MAX_AGE_MS,
)
from app.game.models import GameError, Phase, Settings, Song, Timing
from app.game.room import Room


def _is_expired(room: Room, now: int) -> bool:
    if now - room.created_at > ROOM_MAX_AGE_MS:
        return True
    if room.phase is Phase.FINISHED and room.finished_at is not None and now - room.finished_at > FINISHED_TTL_MS:
        return True
    offline_since = room.host_offline_since
    return not room.host_online and offline_since is not None and now - offline_since > HOST_OFFLINE_TTL_MS


class RoomManager:
    def __init__(self, popular: list[str], rng: Random | None = None, timing: Timing = Timing()) -> None:
        self.popular = popular
        self.rng = rng if rng is not None else SystemRandom()
        self.timing = timing
        self.rooms: dict[str, Room] = {}

    def _new_code(self) -> str:
        while True:
            code = "".join(self.rng.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH))
            if code not in self.rooms:
                return code

    def create_room(self, songs: list[Song], settings: Settings, now: int) -> Room:
        code = self._new_code()
        room = Room(
            code=code,
            host_token=secrets.token_urlsafe(16),
            songs=songs,
            settings=settings,
            popular=self.popular,
            rng=Random(self.rng.getrandbits(64)),
            now=now,
            timing=self.timing,
        )
        self.rooms[code] = room
        return room

    def get(self, code: str) -> Room:
        room = self.rooms.get(code.strip().upper())
        if room is None:
            raise GameError("ROOM_NOT_FOUND")
        return room

    def remove(self, code: str) -> None:
        self.rooms.pop(code, None)

    def expired(self, now: int) -> list[str]:
        return [code for code, room in self.rooms.items() if _is_expired(room, now)]
```

- [ ] **Step 5: Implement the validation**

```python
"""Kiểm tra payload `host:create_room` (server kiểm tra lại những gì frontend đã kiểm tra)."""

from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.game.constants import (
    CLIP_SEC_MAX,
    CLIP_SEC_MIN,
    DEFAULT_CLIP_SEC,
    DEFAULT_MAX_PLAYERS,
    DEFAULT_QUESTION_COUNT,
    DEFAULT_REVEAL_SEC,
    MAX_PLAYERS_MAX,
    MAX_PLAYERS_MIN,
    MAX_SONGS,
    REVEAL_SEC_MAX,
    REVEAL_SEC_MIN,
)
from app.game.models import GameError, Settings, Song


class SongIn(BaseModel):
    videoId: str = Field(pattern=r"^[A-Za-z0-9_-]{11}$")
    videoTitle: str = ""
    durationSec: int = Field(ge=1)
    animeName: str
    songLabel: str | None = None
    startSec: float | None = None
    needsReview: bool = False


class SetIn(BaseModel):
    songs: list[SongIn] = Field(min_length=1, max_length=MAX_SONGS)


class SettingsIn(BaseModel):
    questionCount: int | None = None
    clipSec: int = Field(DEFAULT_CLIP_SEC, ge=CLIP_SEC_MIN, le=CLIP_SEC_MAX)
    revealSec: int = Field(DEFAULT_REVEAL_SEC, ge=REVEAL_SEC_MIN, le=REVEAL_SEC_MAX)
    maxPlayers: int = Field(DEFAULT_MAX_PLAYERS, ge=MAX_PLAYERS_MIN, le=MAX_PLAYERS_MAX)
    mode: Literal["stream"] = "stream"


class CreateRoomIn(BaseModel):
    question_set: SetIn = Field(alias="set")
    settings: SettingsIn = Field(default_factory=SettingsIn)


def parse_create_room(payload: object) -> tuple[list[Song], Settings]:
    try:
        data = CreateRoomIn.model_validate(payload)
    except ValidationError as exc:
        raise GameError("INVALID_SET") from exc
    songs_in = data.question_set.songs
    if any(s.needsReview or not s.animeName.strip() for s in songs_in):
        raise GameError("INVALID_SET")
    count = data.settings.questionCount
    if count is None:
        count = min(DEFAULT_QUESTION_COUNT, len(songs_in))
    if not 1 <= count <= len(songs_in):
        raise GameError("INVALID_SET")
    songs = [
        Song(
            video_id=s.videoId,
            video_title=s.videoTitle,
            duration_sec=s.durationSec,
            anime_name=s.animeName.strip(),
            song_label=s.songLabel,
            start_sec=s.startSec,
        )
        for s in songs_in
    ]
    settings = Settings(
        question_count=count,
        clip_sec=data.settings.clipSec,
        reveal_sec=data.settings.revealSec,
        max_players=data.settings.maxPlayers,
        mode=data.settings.mode,
    )
    return songs, settings
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/game -v`
Expected: all pass (`119 passed`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/game/room_manager.py backend/app/game/validation.py backend/tests/game/test_room_manager.py backend/tests/game/test_validation.py
git commit -m "feat(game): room manager with expiry and create-room validation"
```

---

### Task 9: YouTube title cleaner

**Files:**
- Create: `backend/app/services/__init__.py`, `backend/tests/services/__init__.py` (empty)
- Create: `backend/app/services/title_cleaner.py`
- Test: `backend/tests/services/test_title_cleaner.py`

**Interfaces:**
- Consumes: nothing
- Produces: `CleanedTitle(parts: list[str], label_hint: str | None)` (frozen dataclass) and `clean_title(title: str) -> CleanedTitle`. `parts` are the search queries in title order, de-duplicated case-insensitively. `label_hint` is `"OP<n>"` / `"ED<n>"` when the title names a numbered opening/ending.

- [ ] **Step 1: Write the failing tests**

Run: `mkdir -p backend/app/services backend/tests/services && touch backend/app/services/__init__.py backend/tests/services/__init__.py`

```python
import pytest

from app.services.title_cleaner import clean_title

# (tiêu đề YouTube, các phần dùng để tìm, nhãn gợi ý)
CASES = [
    ("Shingeki no Kyojin OP1 Full - Guren no Yumiya", ["Shingeki no Kyojin", "Guren no Yumiya"], "OP1"),
    ("【MAD】Naruto Shippuden Opening 16 - Silhouette", ["Naruto Shippuden", "Silhouette"], "OP16"),
    ("Demon Slayer: Kimetsu no Yaiba - Opening | Gurenge by LiSA", ["Demon Slayer: Kimetsu no Yaiba", "Gurenge by LiSA"], None),
    ("Jujutsu Kaisen - Opening 1 (HD)", ["Jujutsu Kaisen"], "OP1"),
    ("Tokyo Ghoul OP「unravel」TK from Ling tosite sigure", ["Tokyo Ghoul", "unravel", "TK from Ling tosite sigure"], None),
    ("Fullmetal Alchemist Brotherhood - Opening 1 | Again", ["Fullmetal Alchemist Brotherhood", "Again"], "OP1"),
    ("Made in Abyss OP - Deep in Abyss [Lyrics]", ["Made in Abyss", "Deep in Abyss"], None),
    ("NCOP - Chainsaw Man - KICK BACK", ["Chainsaw Man", "KICK BACK"], None),
    ("Spy x Family - Opening 2 - SOUVENIR by BUMP OF CHICKEN", ["Spy x Family", "SOUVENIR by BUMP OF CHICKEN"], "OP2"),
    ("Kaguya-sama: Love is War Opening Full - Love Dramatic", ["Kaguya-sama: Love is War", "Love Dramatic"], None),
    ("Steins;Gate OP - Hacking to the Gate (Full)", ["Steins;Gate", "Hacking to the Gate"], None),
    ("Code Geass Opening 1 - COLORS [1080p]", ["Code Geass", "COLORS"], "OP1"),
    ("Neon Genesis Evangelion - Opening (4K)", ["Neon Genesis Evangelion"], None),
    ("Your Lie in April ED 1 Full | Kirameki", ["Your Lie in April", "Kirameki"], "ED1"),
    ("Bocchi the Rock! ED 3 - Korogaru Iwa, Kimi ni Asa ga Furu", ["Bocchi the Rock!", "Korogaru Iwa, Kimi ni Asa ga Furu"], "ED3"),
    ("Re:Zero Season 2 Opening 1 | Realize - Konomi Suzuki", ["Re:Zero Season 2", "Realize", "Konomi Suzuki"], "OP1"),
    ("Mob Psycho 100 OP / 99 by MOB CHOIR", ["Mob Psycho 100", "99 by MOB CHOIR"], None),
    ("Cowboy Bebop - Opening - Tank! (HD)", ["Cowboy Bebop", "Tank!"], None),
    ("Haikyuu!! Season 4 OP 2 Full「Toppakou」SUPER BEAVER", ["Haikyuu!! Season 4", "Toppakou", "SUPER BEAVER"], "OP2"),
    ("Oshi no Ko - Opening | IDOL by YOASOBI (Creditless)", ["Oshi no Ko", "IDOL by YOASOBI"], None),
    ("Frieren ED 1 - Anytime Anywhere [NCED]", ["Frieren", "Anytime Anywhere"], "ED1"),
    ("Death Note - Opening 1 HD", ["Death Note"], "OP1"),
    ("Sword Art Online OP1 - crossing field (TV Size)", ["Sword Art Online", "crossing field"], "OP1"),
    ("Mushoku Tensei OP | Tabibito no Uta (Lyrics)", ["Mushoku Tensei", "Tabibito no Uta"], None),
    ("Hunter x Hunter 2011 Opening 1 Full / departure! by Masatoshi Ono", ["Hunter x Hunter 2011", "departure! by Masatoshi Ono"], "OP1"),
    ("Vinland Saga Season 2 ED 1 Official MV", ["Vinland Saga Season 2"], "ED1"),
    ("Toradora! OP 01 Pre-Parade", ["Toradora! Pre-Parade"], "OP1"),
    ("[AMV] Attack on Titan - Opening 7", ["Attack on Titan"], "OP7"),
    ("Kimi no Na wa / Your Name - Zenzenzense", ["Kimi no Na wa", "Your Name", "Zenzenzense"], None),
    ("Kono Subarashii Sekai ni Shukufuku wo! ED | Chiisana Boukensha", ["Kono Subarashii Sekai ni Shukufuku wo!", "Chiisana Boukensha"], None),
    ("Dragon Ball Z Opening (Cha-La Head-Cha-La) 1080p", ["Dragon Ball Z"], None),
    ("Blue Lock OP2 Full - Chaos ga Kiwamaru by UNISON SQUARE GARDEN", ["Blue Lock", "Chaos ga Kiwamaru by UNISON SQUARE GARDEN"], "OP2"),
    ("Lycoris Recoil", ["Lycoris Recoil"], None),
    ("Opening 1", [], "OP1"),
]


@pytest.mark.parametrize(("title", "parts", "label"), CASES)
def test_clean_title(title, parts, label):
    cleaned = clean_title(title)
    assert cleaned.parts == parts
    assert cleaned.label_hint == label


def test_duplicate_parts_are_dropped_ignoring_case():
    assert clean_title("Naruto - naruto | NARUTO").parts == ["Naruto"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/services/test_title_cleaner.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.services.title_cleaner'`.

- [ ] **Step 3: Implement the cleaner**

`!` is deliberately not in the trim set, so names like "Bocchi the Rock!" stay intact.

```python
"""Làm sạch tiêu đề video YouTube thành các câu truy vấn tìm tên anime."""

import re
from dataclasses import dataclass

_BRACKETS = re.compile(r"【[^】]*】|\[[^\]]*\]|\([^)]*\)")
_LABEL = re.compile(r"\b(opening|ending|ncop|nced|op|ed)\s*0*(\d+)\b", re.IGNORECASE)
_KEYWORDS = re.compile(
    r"\b(?:full|hd|4k|1080p|lyrics|mad|amv|ncop\d*|nced\d*|creditless|official|mv|tv[\s-]?size)\b",
    re.IGNORECASE,
)
_SEQUENCE = re.compile(r"\b(?:opening|ending|op|ed)\s*\d*\b", re.IGNORECASE)
_SPLIT = re.compile(r"\s+-\s+|\||/|「|」")
_TRIM = " -–—:·~|,"


@dataclass(frozen=True)
class CleanedTitle:
    parts: list[str]
    label_hint: str | None


def clean_title(title: str) -> CleanedTitle:
    label_hint = None
    match = _LABEL.search(title)
    if match:
        kind = "OP" if match.group(1).lower() in ("opening", "op", "ncop") else "ED"
        label_hint = f"{kind}{int(match.group(2))}"
    text = _BRACKETS.sub(" ", title)
    text = _KEYWORDS.sub(" ", text)
    text = _SEQUENCE.sub(" ", text)
    parts: list[str] = []
    for raw in _SPLIT.split(text):
        part = re.sub(r"\s+", " ", raw).strip(_TRIM)
        if part and part.casefold() not in {p.casefold() for p in parts}:
            parts.append(part)
    return CleanedTitle(parts=parts, label_hint=label_hint)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/services/test_title_cleaner.py -v`
Expected: `35 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services backend/tests/services
git commit -m "feat(services): YouTube title cleaner for anime lookup"
```

---

### Task 10: Rate limiter and AnimeThemes lookup

**Files:**
- Create: `backend/app/services/rate_limiter.py`
- Create: `backend/app/services/anime_lookup.py`
- Test: `backend/tests/services/test_rate_limiter.py`, `backend/tests/services/test_anime_lookup.py`

**Interfaces:**
- Consumes: `clean_title`, `CleanedTitle` (Task 9); `httpx.AsyncClient`
- Produces:
  - `TokenBucket(rate=80, per_sec=60.0, *, clock=time.monotonic, sleep=asyncio.sleep)` with `async acquire(timeout: float) -> bool`
  - `ANIMETHEMES_URL = "https://api.animethemes.moe/anime"`
  - `AnimeLookup(client, limiter)` with:
    - `async suggest(title) -> list[dict]`: ≤ 3 `{"animeName": str, "songLabel": str | None}`
    - `async search(query) -> list[dict]`: ≤ 10 `{"animeName": str, "songLabel": None}`
  - Both return `[]` when AnimeThemes fails, times out, answers 429, or the limiter waits more than 5 s. Results are cached in RAM per `(query.casefold(), page size)`. Failures are not cached.

AnimeThemes request used (checked against the live API): `GET /anime?q=<query>&include=animethemes.song&page[size]=<n>&fields[anime]=name&fields[animetheme]=slug&fields[song]=title`, response `{"anime": [{"name": "...", "animethemes": [{"slug": "OP1", "song": {"title": "..."}}]}]}`.

Suggestion ranking: every hit for every title part becomes a candidate. Candidates whose theme song title (≥ 3 characters) appears in one of the title parts come first; then by part order, then by the API's own order. Names are de-duplicated case-insensitively. The label is `"<slug> · <song>"` for a song-title match, otherwise the theme whose slug equals the title's label hint (`"OP1 · <song>"`), otherwise the bare hint (`"OP1"`), otherwise `null`.

- [ ] **Step 1: Write the failing rate-limiter tests**

```python
from app.services.rate_limiter import TokenBucket


class FakeTime:
    def __init__(self) -> None:
        self.now = 0.0

    def clock(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


def bucket(fake: FakeTime, rate: int = 80) -> TokenBucket:
    return TokenBucket(rate, 60.0, clock=fake.clock, sleep=fake.sleep)


async def test_full_bucket_allows_a_burst_then_refuses_without_waiting():
    fake = FakeTime()
    limiter = bucket(fake)
    assert all([await limiter.acquire(timeout=0) for _ in range(80)])
    assert await limiter.acquire(timeout=0) is False
    assert fake.now == 0.0


async def test_waits_for_the_next_token_when_allowed():
    fake = FakeTime()
    limiter = bucket(fake)
    for _ in range(80):
        await limiter.acquire(timeout=0)
    assert await limiter.acquire(timeout=5) is True
    assert abs(fake.now - 0.75) < 1e-9  # 60 s / 80 tokens


async def test_gives_up_when_the_wait_exceeds_the_timeout():
    fake = FakeTime()
    limiter = bucket(fake, rate=1)
    assert await limiter.acquire(timeout=5)
    assert await limiter.acquire(timeout=5) is False  # next token needs 60 s
    assert fake.now == 0.0


async def test_refill_is_capped_at_capacity():
    fake = FakeTime()
    limiter = bucket(fake, rate=2)
    await limiter.acquire(timeout=0)
    await limiter.acquire(timeout=0)
    fake.now = 600.0
    assert [await limiter.acquire(timeout=0) for _ in range(3)] == [True, True, False]
```

- [ ] **Step 2: Write the failing lookup tests**

```python
import httpx
import pytest
import respx

from app.services.anime_lookup import ANIMETHEMES_URL, AnimeLookup
from app.services.rate_limiter import TokenBucket


def anime(name, *themes):
    return {
        "name": name,
        "animethemes": [{"slug": slug, "song": {"title": title} if title else None} for slug, title in themes],
    }


SNK = anime("Shingeki no Kyojin", ("OP1", "Guren no Yumiya"), ("OP2", "Jiyuu no Tsubasa"))
SNK_FINAL = anime("Shingeki no Kyojin: The Final Season", ("OP1", "My War"))
SNK_MOVIE = anime("Shingeki no Kyojin Movie 1", ("ED1", "Ujigami no Aru Hito"))
JJK = anime("Jujutsu Kaisen", ("OP1", "Kaikai Kitan"), ("ED1", None))


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as router:
        yield router


@pytest.fixture
async def lookup():
    async with httpx.AsyncClient() as client:
        yield AnimeLookup(client, TokenBucket())


def route(api, query, *results, status=200):
    return api.get(ANIMETHEMES_URL, params={"q": query}).respond(status, json={"anime": list(results)})


async def test_suggest_merges_parts_ranks_song_matches_first_and_dedupes(api, lookup):
    route(api, "Shingeki no Kyojin", SNK_FINAL, SNK)
    route(api, "Guren no Yumiya", SNK_MOVIE, SNK)
    result = await lookup.suggest("Shingeki no Kyojin OP1 Full - Guren no Yumiya")
    assert result == [
        {"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"},
        {"animeName": "Shingeki no Kyojin: The Final Season", "songLabel": "OP1 · My War"},
        {"animeName": "Shingeki no Kyojin Movie 1", "songLabel": "OP1"},
    ]


async def test_suggest_falls_back_to_the_label_hint(api, lookup):
    route(api, "Jujutsu Kaisen", JJK)
    assert await lookup.suggest("Jujutsu Kaisen - Opening 1 (HD)") == [
        {"animeName": "Jujutsu Kaisen", "songLabel": "OP1 · Kaikai Kitan"}
    ]


async def test_suggest_without_any_label(api, lookup):
    route(api, "Neon Genesis Evangelion", anime("Neon Genesis Evangelion", ("OP1", "Zankoku na Tenshi no Thesis")))
    assert await lookup.suggest("Neon Genesis Evangelion - Opening (4K)") == [
        {"animeName": "Neon Genesis Evangelion", "songLabel": None}
    ]


async def test_suggest_returns_at_most_three(api, lookup):
    route(api, "Gundam", *[anime(f"Gundam {i}") for i in range(5)])
    assert len(await lookup.suggest("Gundam")) == 3


async def test_request_uses_sparse_fields(api, lookup):
    called = route(api, "Gundam", anime("Gundam"))
    await lookup.suggest("Gundam")
    params = called.calls.last.request.url.params
    assert params["include"] == "animethemes.song"
    assert params["fields[anime]"] == "name"
    assert params["fields[animetheme]"] == "slug"
    assert params["fields[song]"] == "title"


async def test_results_are_cached_per_cleaned_query(api, lookup):
    called = route(api, "Naruto", anime("Naruto"))
    await lookup.search("Naruto")
    await lookup.search("  NARUTO ")
    assert called.call_count == 1


@pytest.mark.parametrize("status", [429, 500])
async def test_http_errors_give_no_candidates(api, lookup, status):
    route(api, "Naruto", anime("Naruto"), status=status)
    assert await lookup.suggest("Naruto") == []
    assert await lookup.search("Naruto") == []


async def test_network_errors_and_bad_json_give_no_candidates(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(side_effect=httpx.ConnectError("down"))
    api.get(ANIMETHEMES_URL, params={"q": "Bleach"}).respond(200, json={"unexpected": True})
    assert await lookup.suggest("Naruto") == []
    assert await lookup.suggest("Bleach") == []


async def test_failures_are_not_cached(api, lookup):
    api.get(ANIMETHEMES_URL, params={"q": "Naruto"}).mock(
        side_effect=[httpx.Response(500), httpx.Response(200, json={"anime": [anime("Naruto")]})]
    )
    assert await lookup.suggest("Naruto") == []
    assert await lookup.suggest("Naruto") == [{"animeName": "Naruto", "songLabel": None}]


async def test_exhausted_rate_limit_gives_no_candidates_without_calling(api):
    called = route(api, "Naruto", anime("Naruto"))
    async with httpx.AsyncClient() as client:
        limiter = TokenBucket(1, 60.0)
        await limiter.acquire(timeout=0)
        lookup = AnimeLookup(client, limiter)
        assert await lookup.suggest("Naruto") == []
    assert called.call_count == 0


async def test_search_returns_up_to_ten_names_without_labels(api, lookup):
    route(api, "Gundam", *[anime(f"Gundam {i}", ("OP1", "x")) for i in range(10)], anime("gundam 0"))
    result = await lookup.search("Gundam")
    assert len(result) == 10
    assert result[0] == {"animeName": "Gundam 0", "songLabel": None}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/services -v`
Expected: collection errors `No module named 'app.services.rate_limiter'` and `No module named 'app.services.anime_lookup'`.

- [ ] **Step 4: Implement the token bucket**

```python
"""Token bucket dùng chung toàn server để giới hạn lượt gọi AnimeThemes."""

import asyncio
import time
from collections.abc import Awaitable, Callable


class TokenBucket:
    def __init__(
        self,
        rate: int = 80,
        per_sec: float = 60.0,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.capacity = float(rate)
        self.refill_per_sec = rate / per_sec
        self.tokens = float(rate)
        self.clock = clock
        self.sleep = sleep
        self.updated = clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.refill_per_sec)
        self.updated = now

    async def acquire(self, timeout: float) -> bool:
        """Lấy 1 lượt, chờ tối đa `timeout` giây. Trả về False nếu phải chờ lâu hơn."""
        deadline = self.clock() + timeout
        while True:
            self._refill()
            if self.tokens >= 1:
                self.tokens -= 1
                return True
            wait = (1 - self.tokens) / self.refill_per_sec
            if self.clock() + wait > deadline:
                return False
            await self.sleep(wait)
```

- [ ] **Step 5: Implement the lookup**

```python
"""Gợi ý tên anime từ tiêu đề YouTube bằng AnimeThemes API."""

import asyncio
from dataclasses import dataclass

import httpx

from app.services.rate_limiter import TokenBucket
from app.services.title_cleaner import CleanedTitle, clean_title

ANIMETHEMES_URL = "https://api.animethemes.moe/anime"
LIMIT_WAIT_SEC = 5.0
REQUEST_TIMEOUT_SEC = 8.0
SUGGEST_PAGE_SIZE = 5
SUGGEST_LIMIT = 3
SEARCH_LIMIT = 10


class LookupUnavailable(Exception):
    """AnimeThemes lỗi, hết thời gian chờ, hoặc hết lượt gọi."""


@dataclass(frozen=True)
class Theme:
    slug: str
    song_title: str | None


@dataclass(frozen=True)
class Hit:
    name: str
    themes: tuple[Theme, ...]


def _parse_hits(data: object) -> list[Hit]:
    hits = []
    for item in data["anime"]:
        themes = tuple(
            Theme(slug=theme["slug"], song_title=(theme.get("song") or {}).get("title"))
            for theme in item.get("animethemes") or []
        )
        hits.append(Hit(name=item["name"], themes=themes))
    return hits


def _pick_label(hit: Hit, cleaned: CleanedTitle) -> tuple[str | None, bool]:
    """Trả về (nhãn bài, tên bài có khớp tiêu đề không)."""
    parts = [part.casefold() for part in cleaned.parts]
    for theme in hit.themes:
        song = theme.song_title
        if song and len(song) >= 3 and any(song.casefold() in part for part in parts):
            return f"{theme.slug} · {song}", True
    if cleaned.label_hint is None:
        return None, False
    for theme in hit.themes:
        if theme.slug == cleaned.label_hint:
            return (f"{theme.slug} · {theme.song_title}" if theme.song_title else theme.slug), False
    return cleaned.label_hint, False


class AnimeLookup:
    def __init__(self, client: httpx.AsyncClient, limiter: TokenBucket) -> None:
        self.client = client
        self.limiter = limiter
        self._cache: dict[tuple[str, int], list[Hit]] = {}

    async def _search(self, query: str, size: int) -> list[Hit]:
        key = (query.casefold(), size)
        if key in self._cache:
            return self._cache[key]
        if not await self.limiter.acquire(LIMIT_WAIT_SEC):
            raise LookupUnavailable("rate limited")
        params = {
            "q": query,
            "include": "animethemes.song",
            "page[size]": size,
            "fields[anime]": "name",
            "fields[animetheme]": "slug",
            "fields[song]": "title",
        }
        try:
            response = await self.client.get(ANIMETHEMES_URL, params=params, timeout=REQUEST_TIMEOUT_SEC)
            response.raise_for_status()
            hits = _parse_hits(response.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError) as exc:
            raise LookupUnavailable(str(exc)) from exc
        self._cache[key] = hits
        return hits

    async def suggest(self, title: str) -> list[dict]:
        cleaned = clean_title(title)
        results = await asyncio.gather(
            *(self._search(part, SUGGEST_PAGE_SIZE) for part in cleaned.parts), return_exceptions=True
        )
        for result in results:
            if isinstance(result, LookupUnavailable):
                return []
            if isinstance(result, BaseException):
                raise result
        ranked = []
        for part_index, hits in enumerate(results):
            for hit_index, hit in enumerate(hits):
                label, song_match = _pick_label(hit, cleaned)
                ranked.append(((not song_match, part_index, hit_index), hit.name, label))
        ranked.sort(key=lambda row: row[0])
        candidates: list[dict] = []
        seen: set[str] = set()
        for _, name, label in ranked:
            if name.casefold() not in seen:
                seen.add(name.casefold())
                candidates.append({"animeName": name, "songLabel": label})
        return candidates[:SUGGEST_LIMIT]

    async def search(self, query: str) -> list[dict]:
        try:
            hits = await self._search(query.strip(), SEARCH_LIMIT)
        except LookupUnavailable:
            return []
        candidates: list[dict] = []
        seen: set[str] = set()
        for hit in hits:
            if hit.name.casefold() not in seen:
                seen.add(hit.name.casefold())
                candidates.append({"animeName": hit.name, "songLabel": None})
        return candidates[:SEARCH_LIMIT]
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/services -v`
Expected: all pass (`51 passed`).

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/rate_limiter.py backend/app/services/anime_lookup.py backend/tests/services/test_rate_limiter.py backend/tests/services/test_anime_lookup.py
git commit -m "feat(services): AnimeThemes lookup with shared rate limit and cache"
```

---

### Task 11: YouTube import service

**Files:**
- Create: `backend/app/services/youtube.py`
- Test: `backend/tests/services/test_youtube.py`

**Interfaces:**
- Consumes: `httpx.AsyncClient`
- Produces:
  - `YouTubeError(code: str, status: int)` with `.code` and `.status`: `INVALID_URL`/400, `NOT_FOUND`/404, `YOUTUBE_QUOTA`/503, `UPSTREAM_ERROR`/502
  - `ParsedUrl(kind: "video" | "playlist", id: str)` and `parse_url(url) -> ParsedUrl`
  - `parse_duration(iso: str) -> int` (seconds; 0 when unparsable)
  - `YouTubeService(api_key, region, client)` with `async import_url(url) -> dict`:
    `{"kind": "video" | "playlist", "tracks": [{"videoId", "videoTitle", "durationSec"}], "skipped": [{"videoId", "title", "reason"}]}`, where `reason` is `DELETED`, `PRIVATE`, `NOT_EMBEDDABLE` or `REGION_BLOCKED`.

YouTube Data API v3 calls (1 quota unit each): `GET /playlistItems?part=snippet,status&playlistId=…&maxResults=50[&pageToken=…]` until 200 items or no `nextPageToken`, then `GET /videos?part=snippet,contentDetails,status&id=<≤50 ids>&maxResults=50`. Videos missing from the `videos` response were deleted, or are private when the playlist item says `privacyStatus: "private"`.

- [ ] **Step 1: Write the failing tests**

```python
import httpx
import pytest
import respx

from app.services.youtube import API_BASE, ParsedUrl, YouTubeError, YouTubeService, parse_duration, parse_url

VIDEO = "8OkpRK2_gVs"
PLAYLIST = "PLabcdefghij1234"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (f"https://www.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"youtube.com/watch?v={VIDEO}&t=42", ParsedUrl("video", VIDEO)),
        (f"https://youtu.be/{VIDEO}?si=abc", ParsedUrl("video", VIDEO)),
        (f"https://m.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"https://music.youtube.com/watch?v={VIDEO}", ParsedUrl("video", VIDEO)),
        (f"https://www.youtube.com/shorts/{VIDEO}", ParsedUrl("video", VIDEO)),
        (f"  https://www.youtube.com/playlist?list={PLAYLIST}  ", ParsedUrl("playlist", PLAYLIST)),
        (f"https://www.youtube.com/watch?v={VIDEO}&list={PLAYLIST}", ParsedUrl("playlist", PLAYLIST)),
    ],
)
def test_parse_url_accepts_youtube_links(url, expected):
    assert parse_url(url) == expected


@pytest.mark.parametrize(
    "url",
    [
        "",
        "hello",
        "https://vimeo.com/123",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/channel/UC1234567890",
        f"https://notyoutube.com/watch?v={VIDEO}",
        "https://www.youtube.com/playlist?list=bad!",
    ],
)
def test_parse_url_rejects_other_links(url):
    with pytest.raises(YouTubeError) as info:
        parse_url(url)
    assert (info.value.code, info.value.status) == ("INVALID_URL", 400)


@pytest.mark.parametrize(
    ("iso", "seconds"),
    [("PT4M12S", 252), ("PT1H2M3S", 3723), ("PT45S", 45), ("P1DT1S", 86401), ("P0D", 0), ("garbage", 0)],
)
def test_parse_duration(iso, seconds):
    assert parse_duration(iso) == seconds


def vid(i: int) -> str:
    return f"vid{i:08d}"


def playlist_item(video_id, title="Song", privacy="public"):
    return {"snippet": {"title": title, "resourceId": {"videoId": video_id}}, "status": {"privacyStatus": privacy}}


def video(video_id, title="Song", duration="PT3M", embeddable=True, privacy="public", region=None):
    details = {"duration": duration}
    if region is not None:
        details["regionRestriction"] = region
    return {
        "id": video_id,
        "snippet": {"title": title},
        "contentDetails": details,
        "status": {"embeddable": embeddable, "privacyStatus": privacy},
    }


class FakeYouTube:
    """Giả lập 2 endpoint YouTube Data API bằng respx."""

    def __init__(self, router, pages, videos):
        self.pages = pages
        self.videos = {v["id"]: v for v in videos}
        self.playlist_route = router.get(f"{API_BASE}/playlistItems").mock(side_effect=self._playlist)
        self.videos_route = router.get(f"{API_BASE}/videos").mock(side_effect=self._videos)

    def _playlist(self, request):
        assert request.url.params["key"] == "test-key"
        index = int(request.url.params.get("pageToken", "0"))
        body = {"items": self.pages[index]}
        if index + 1 < len(self.pages):
            body["nextPageToken"] = str(index + 1)
        return httpx.Response(200, json=body)

    def _videos(self, request):
        ids = request.url.params["id"].split(",")
        assert len(ids) <= 50
        return httpx.Response(200, json={"items": [self.videos[i] for i in ids if i in self.videos]})


@pytest.fixture
def router():
    with respx.mock(assert_all_called=False) as mock:
        yield mock


@pytest.fixture
async def service():
    async with httpx.AsyncClient() as client:
        yield YouTubeService("test-key", "VN", client)


async def test_playlist_is_paginated_and_videos_are_batched(router, service):
    pages = [[playlist_item(vid(i)) for i in range(50)], [playlist_item(vid(i)) for i in range(50, 60)]]
    fake = FakeYouTube(router, pages, [video(vid(i), title=f"Song {i}", duration="PT4M12S") for i in range(60)])
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert result["kind"] == "playlist" and result["skipped"] == []
    assert len(result["tracks"]) == 60
    assert result["tracks"][0] == {"videoId": vid(0), "videoTitle": "Song 0", "durationSec": 252}
    assert fake.playlist_route.call_count == 2
    assert fake.videos_route.call_count == 2


async def test_playlist_stops_at_200_items_and_dedupes(router, service):
    pages = [[playlist_item(vid(p * 50 + i)) for i in range(50)] for p in range(5)]
    pages[0][1] = playlist_item(vid(0))  # trùng bài đầu tiên
    fake = FakeYouTube(router, pages, [video(vid(i)) for i in range(250)])
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    # 4 trang đầu chỉ có 199 bài khác nhau → lấy thêm trang 5 rồi dừng ở đúng 200
    assert fake.playlist_route.call_count == 5
    assert len(result["tracks"]) == 200
    assert len({t["videoId"] for t in result["tracks"]}) == 200
    assert result["tracks"][-1]["videoId"] == vid(200)


async def test_playlist_skip_reasons(router, service):
    items = [
        playlist_item(vid(0), "OK"),
        playlist_item(vid(1), "Deleted video", privacy="privacyStatusUnspecified"),
        playlist_item(vid(2), "Private video", privacy="private"),
        playlist_item(vid(3), "No embed"),
        playlist_item(vid(4), "Blocked in VN"),
        playlist_item(vid(5), "Only in JP"),
        playlist_item(vid(6), "Live"),
        playlist_item(vid(7), "Allowed in VN"),
    ]
    videos = [
        video(vid(0), "OK"),
        video(vid(3), "No embed", embeddable=False),
        video(vid(4), "Blocked in VN", region={"blocked": ["VN", "US"]}),
        video(vid(5), "Only in JP", region={"allowed": ["JP"]}),
        video(vid(6), "Live", duration="P0D"),
        video(vid(7), "Allowed in VN", region={"allowed": ["JP", "VN"]}),
    ]
    FakeYouTube(router, [items], videos)
    result = await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert [t["videoId"] for t in result["tracks"]] == [vid(0), vid(7)]
    assert result["skipped"] == [
        {"videoId": vid(1), "title": "Deleted video", "reason": "DELETED"},
        {"videoId": vid(2), "title": "Private video", "reason": "PRIVATE"},
        {"videoId": vid(3), "title": "No embed", "reason": "NOT_EMBEDDABLE"},
        {"videoId": vid(4), "title": "Blocked in VN", "reason": "REGION_BLOCKED"},
        {"videoId": vid(5), "title": "Only in JP", "reason": "REGION_BLOCKED"},
        {"videoId": vid(6), "title": "Live", "reason": "NOT_EMBEDDABLE"},
    ]


async def test_single_video(router, service):
    FakeYouTube(router, [], [video(VIDEO, "Guren no Yumiya", duration="PT5M12S")])
    result = await service.import_url(f"https://youtu.be/{VIDEO}")
    assert result == {
        "kind": "video",
        "tracks": [{"videoId": VIDEO, "videoTitle": "Guren no Yumiya", "durationSec": 312}],
        "skipped": [],
    }


async def test_single_video_that_cannot_be_embedded_is_skipped(router, service):
    FakeYouTube(router, [], [video(VIDEO, "No embed", embeddable=False)])
    result = await service.import_url(f"https://youtu.be/{VIDEO}")
    assert result["tracks"] == []
    assert result["skipped"] == [{"videoId": VIDEO, "title": "No embed", "reason": "NOT_EMBEDDABLE"}]


async def test_missing_single_video_is_not_found(router, service):
    FakeYouTube(router, [], [])
    with pytest.raises(YouTubeError) as info:
        await service.import_url(f"https://youtu.be/{VIDEO}")
    assert (info.value.code, info.value.status) == ("NOT_FOUND", 404)


def api_error(status, reason):
    return httpx.Response(status, json={"error": {"code": status, "errors": [{"reason": reason}]}})


@pytest.mark.parametrize(
    ("response", "code", "status"),
    [
        (api_error(403, "quotaExceeded"), "YOUTUBE_QUOTA", 503),
        (api_error(403, "dailyLimitExceeded"), "YOUTUBE_QUOTA", 503),
        (api_error(403, "playlistItemsNotAccessible"), "NOT_FOUND", 404),
        (api_error(404, "playlistNotFound"), "NOT_FOUND", 404),
        (api_error(400, "keyInvalid"), "UPSTREAM_ERROR", 502),
        (httpx.Response(500, text="oops"), "UPSTREAM_ERROR", 502),
        (httpx.ConnectError("down"), "UPSTREAM_ERROR", 502),
    ],
)
async def test_api_errors_are_mapped(router, service, response, code, status):
    router.get(f"{API_BASE}/playlistItems").mock(side_effect=[response])
    with pytest.raises(YouTubeError) as info:
        await service.import_url(f"https://www.youtube.com/playlist?list={PLAYLIST}")
    assert (info.value.code, info.value.status) == (code, status)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/services/test_youtube.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.services.youtube'`.

- [ ] **Step 3: Implement the service**

```python
"""Lấy danh sách bài từ link YouTube (1 video hoặc playlist) qua YouTube Data API v3."""

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

import httpx

API_BASE = "https://www.googleapis.com/youtube/v3"
MAX_PLAYLIST_ITEMS = 200
PAGE_SIZE = 50
REQUEST_TIMEOUT_SEC = 10.0
_VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_PLAYLIST_ID = re.compile(r"^[A-Za-z0-9_-]{10,64}$")
_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")
_QUOTA_REASONS = {"quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"}
_NOT_FOUND_REASONS = {"playlistNotFound", "playlistItemsNotAccessible", "videoNotFound"}


class YouTubeError(Exception):
    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ParsedUrl:
    kind: str  # "video" | "playlist"
    id: str


@dataclass(frozen=True)
class _Entry:
    video_id: str
    title: str
    privacy: str


def parse_url(url: str) -> ParsedUrl:
    text = url.strip()
    if "://" not in text:
        text = "https://" + text
    parsed = urlparse(text)
    host = (parsed.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        host = host.removeprefix(prefix)
    if host not in ("youtube.com", "youtu.be"):
        raise YouTubeError("INVALID_URL", 400)
    query = parse_qs(parsed.query)
    list_id = query.get("list", [""])[0]
    if list_id:
        if _PLAYLIST_ID.match(list_id):
            return ParsedUrl("playlist", list_id)
        raise YouTubeError("INVALID_URL", 400)
    video_id = ""
    segments = [s for s in parsed.path.split("/") if s]
    if host == "youtu.be" and segments:
        video_id = segments[0]
    elif parsed.path == "/watch":
        video_id = query.get("v", [""])[0]
    elif len(segments) >= 2 and segments[0] == "shorts":
        video_id = segments[1]
    if _VIDEO_ID.match(video_id):
        return ParsedUrl("video", video_id)
    raise YouTubeError("INVALID_URL", 400)


def parse_duration(iso: str) -> int:
    match = _DURATION.match(iso or "")
    if not match:
        return 0
    days, hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def _error_reasons(response: httpx.Response) -> set[str]:
    try:
        return {error.get("reason", "") for error in response.json()["error"]["errors"]}
    except (ValueError, KeyError, TypeError, AttributeError):
        return set()


class YouTubeService:
    def __init__(self, api_key: str, region: str, client: httpx.AsyncClient) -> None:
        self.api_key = api_key
        self.region = region
        self.client = client

    async def import_url(self, url: str) -> dict:
        target = parse_url(url)
        if target.kind == "video":
            videos = await self._videos([target.id])
            if target.id not in videos:
                raise YouTubeError("NOT_FOUND", 404)
            entries = [_Entry(target.id, videos[target.id]["snippet"]["title"], "public")]
        else:
            entries = await self._playlist_entries(target.id)
            videos = await self._videos([e.video_id for e in entries])
        tracks: list[dict] = []
        skipped: list[dict] = []
        for entry in entries:
            item = videos.get(entry.video_id)
            if item is None:
                reason = "PRIVATE" if entry.privacy == "private" else "DELETED"
                skipped.append({"videoId": entry.video_id, "title": entry.title, "reason": reason})
                continue
            title = item["snippet"]["title"]
            reason = self._skip_reason(item)
            if reason:
                skipped.append({"videoId": entry.video_id, "title": title, "reason": reason})
            else:
                duration = parse_duration(item["contentDetails"].get("duration", ""))
                tracks.append({"videoId": entry.video_id, "videoTitle": title, "durationSec": duration})
        return {"kind": target.kind, "tracks": tracks, "skipped": skipped}

    def _skip_reason(self, item: dict) -> str | None:
        status = item.get("status", {})
        details = item.get("contentDetails", {})
        if status.get("privacyStatus") == "private":
            return "PRIVATE"
        if not status.get("embeddable", False):
            return "NOT_EMBEDDABLE"
        restriction = details.get("regionRestriction", {})
        if self.region in restriction.get("blocked", []):
            return "REGION_BLOCKED"
        allowed = restriction.get("allowed")
        if allowed is not None and self.region not in allowed:
            return "REGION_BLOCKED"
        if parse_duration(details.get("duration", "")) == 0:
            return "NOT_EMBEDDABLE"  # live hoặc sắp phát
        return None

    async def _playlist_entries(self, playlist_id: str) -> list[_Entry]:
        entries: list[_Entry] = []
        seen: set[str] = set()
        page_token = None
        while len(entries) < MAX_PLAYLIST_ITEMS:
            params = {"part": "snippet,status", "playlistId": playlist_id, "maxResults": PAGE_SIZE}
            if page_token:
                params["pageToken"] = page_token
            data = await self._get("playlistItems", params)
            for item in data.get("items", []):
                video_id = item["snippet"]["resourceId"].get("videoId")
                if not video_id or video_id in seen or len(entries) >= MAX_PLAYLIST_ITEMS:
                    continue
                seen.add(video_id)
                privacy = item.get("status", {}).get("privacyStatus", "")
                entries.append(_Entry(video_id, item["snippet"].get("title", ""), privacy))
            page_token = data.get("nextPageToken")
            if not page_token:
                break
        return entries

    async def _videos(self, ids: list[str]) -> dict[str, dict]:
        found: dict[str, dict] = {}
        for start in range(0, len(ids), PAGE_SIZE):
            batch = ids[start : start + PAGE_SIZE]
            params = {"part": "snippet,contentDetails,status", "id": ",".join(batch), "maxResults": PAGE_SIZE}
            data = await self._get("videos", params)
            for item in data.get("items", []):
                found[item["id"]] = item
        return found

    async def _get(self, path: str, params: dict) -> dict:
        try:
            response = await self.client.get(
                f"{API_BASE}/{path}", params={**params, "key": self.api_key}, timeout=REQUEST_TIMEOUT_SEC
            )
        except httpx.HTTPError as exc:
            raise YouTubeError("UPSTREAM_ERROR", 502) from exc
        if response.status_code == 200:
            try:
                return response.json()
            except ValueError as exc:
                raise YouTubeError("UPSTREAM_ERROR", 502) from exc
        reasons = _error_reasons(response)
        if response.status_code == 403 and reasons & _QUOTA_REASONS:
            raise YouTubeError("YOUTUBE_QUOTA", 503)
        if response.status_code == 404 or reasons & _NOT_FOUND_REASONS:
            raise YouTubeError("NOT_FOUND", 404)
        raise YouTubeError("UPSTREAM_ERROR", 502)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/services -v`
Expected: all pass (`85 passed`).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/youtube.py backend/tests/services/test_youtube.py
git commit -m "feat(services): import YouTube videos and playlists with skip reasons"
```

---

### Task 12: Config and REST routes

**Files:**
- Create: `backend/app/config.py`
- Create: `backend/app/api/__init__.py`, `backend/app/api/routes.py`
- Test: `backend/tests/test_config.py`, `backend/tests/api/__init__.py`, `backend/tests/api/test_routes.py`

**Interfaces:**
- Consumes: `YouTubeService.import_url(url) -> dict` and `YouTubeError(code, status)` (Task 11); `AnimeLookup.suggest(title) -> list[dict]` and `AnimeLookup.search(q) -> list[dict]` (Task 10). Routes only depend on these method names, so tests pass stubs.
- Produces:
  - `Config(youtube_api_key: str, youtube_region: str = "VN")` (frozen dataclass)
  - `load_config(env: Mapping[str, str] | None = None) -> Config` (reads `os.environ` by default; it does **not** fail when the key is missing, because `create_app()` checks that in its lifespan in Task 13)
  - `build_router(youtube, lookup) -> APIRouter` with prefix `/api`:
    - `GET /api/health` → `{"ok": true}`
    - `POST /api/import` with body `{url}` → the `import_url` result; a `YouTubeError` → status `exc.status`, body `{"error": exc.code}`; a missing `url` is treated as `""` → `400 INVALID_URL`
    - `GET /api/anime/suggest?title=` → `{"candidates": [...]}` (an empty title → `[]` without calling the lookup)
    - `GET /api/anime/search?q=` → `{"candidates": [...]}`; an empty or blank `q` → `400 {"error": "EMPTY_QUERY"}`

- [ ] **Step 1: Write the failing tests**

Run: `mkdir -p backend/app/api backend/tests/api && touch backend/app/api/__init__.py backend/tests/api/__init__.py`

```python
from app.config import Config, load_config


def test_load_config_reads_env():
    assert load_config({"YOUTUBE_API_KEY": " key-1 ", "YOUTUBE_REGION": "jp"}) == Config("key-1", "JP")


def test_load_config_defaults():
    assert load_config({}) == Config(youtube_api_key="", youtube_region="VN")
```

```python
import httpx
import pytest
from fastapi import FastAPI

from app.api.routes import build_router
from app.services.youtube import YouTubeError, parse_url

IMPORT_RESULT = {
    "kind": "video",
    "tracks": [{"videoId": "8OkpRK2_gVs", "videoTitle": "Guren no Yumiya", "durationSec": 312}],
    "skipped": [],
}


class StubYouTube:
    def __init__(self):
        self.urls = []
        self.error = None

    async def import_url(self, url):
        self.urls.append(url)
        parse_url(url)  # giữ hành vi thật: link sai → YouTubeError("INVALID_URL", 400)
        if self.error:
            raise self.error
        return IMPORT_RESULT


class StubLookup:
    def __init__(self):
        self.calls = []

    async def suggest(self, title):
        self.calls.append(("suggest", title))
        return [{"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"}]

    async def search(self, q):
        self.calls.append(("search", q))
        return [{"animeName": "Naruto", "songLabel": None}]


@pytest.fixture
def youtube():
    return StubYouTube()


@pytest.fixture
def lookup():
    return StubLookup()


@pytest.fixture
async def client(youtube, lookup):
    app = FastAPI()
    app.include_router(build_router(youtube, lookup))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
        yield http


async def test_health(client):
    response = await client.get("/api/health")
    assert (response.status_code, response.json()) == (200, {"ok": True})


async def test_import_returns_service_result(client, youtube):
    response = await client.post("/api/import", json={"url": "https://youtu.be/8OkpRK2_gVs"})
    assert (response.status_code, response.json()) == (200, IMPORT_RESULT)
    assert youtube.urls == ["https://youtu.be/8OkpRK2_gVs"]


@pytest.mark.parametrize(
    ("code", "status"),
    [("NOT_FOUND", 404), ("YOUTUBE_QUOTA", 503), ("UPSTREAM_ERROR", 502), ("INVALID_URL", 400)],
)
async def test_import_maps_youtube_errors(client, youtube, code, status):
    youtube.error = YouTubeError(code, status)
    response = await client.post("/api/import", json={"url": "https://youtu.be/8OkpRK2_gVs"})
    assert (response.status_code, response.json()) == (status, {"error": code})


async def test_import_without_url_is_invalid_url(client):
    response = await client.post("/api/import", json={})
    assert (response.status_code, response.json()) == (400, {"error": "INVALID_URL"})


async def test_suggest(client, lookup):
    response = await client.get("/api/anime/suggest", params={"title": "Shingeki no Kyojin OP 1"})
    assert response.status_code == 200
    assert response.json() == {
        "candidates": [{"animeName": "Shingeki no Kyojin", "songLabel": "OP1 · Guren no Yumiya"}]
    }
    assert lookup.calls == [("suggest", "Shingeki no Kyojin OP 1")]


async def test_suggest_with_empty_title_skips_lookup(client, lookup):
    response = await client.get("/api/anime/suggest", params={"title": "  "})
    assert (response.status_code, response.json()) == (200, {"candidates": []})
    assert lookup.calls == []


async def test_search(client, lookup):
    response = await client.get("/api/anime/search", params={"q": "naruto"})
    assert (response.status_code, response.json()) == (200, {"candidates": [{"animeName": "Naruto", "songLabel": None}]})
    assert lookup.calls == [("search", "naruto")]


@pytest.mark.parametrize("params", [{}, {"q": ""}, {"q": "   "}])
async def test_search_requires_query(client, lookup, params):
    response = await client.get("/api/anime/search", params=params)
    assert (response.status_code, response.json()) == (400, {"error": "EMPTY_QUERY"})
    assert lookup.calls == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_config.py tests/api -v`
Expected: collection errors `ModuleNotFoundError: No module named 'app.config'` and `No module named 'app.api.routes'`.

- [ ] **Step 3: Implement config and routes**

```python
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
```

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_config.py tests/api -v`
Expected: `15 passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/config.py backend/app/api backend/tests/test_config.py backend/tests/api
git commit -m "feat(api): add config loader and REST routes for import and anime lookup"
```

---

### Task 13: Socket.IO server (rooms and sessions), app entry point, integration harness

**Files:**
- Create: `backend/app/sockets.py`
- Create: `backend/app/main.py`
- Modify: `backend/tests/factories.py` (append `set_payload`)
- Test: `backend/tests/sockets/__init__.py`, `backend/tests/sockets/helpers.py`, `backend/tests/sockets/conftest.py`, `backend/tests/sockets/test_server_lobby.py`
- Test: `backend/tests/api/test_main.py`
- Test: `backend/tests/integration/__init__.py`, `backend/tests/integration/conftest.py`, `backend/tests/integration/test_smoke.py`

**Interfaces:**
- Consumes:
  - `RoomManager(popular, rng=None, timing=Timing())` with `.create_room(songs, settings, now) -> Room`, `.get(code) -> Room` (raises `ROOM_NOT_FOUND`), `.remove(code)`, `.expired(now) -> list[str]` (Task 8)
  - `parse_create_room(payload) -> (songs, settings)` (raises `INVALID_SET`) (Task 8)
  - `host_view(room, now)` and `player_view(room, player_id, now)` (Task 7)
  - `Room.add_player`, `.player_by_token`, `.is_host_token`, `.set_player_online`, `.set_host_online`, `.kick`, `.next_wakeup`, `.tick` (Task 5)
  - `build_router`, `Config`, `load_config` (Task 12); `YouTubeService` (Task 11); `AnimeLookup`, `TokenBucket` (Task 10); `load_popular_anime` (Task 4)
- Produces:
  - `now_ms() -> int` (epoch ms)
  - `Session(code, role, player_id=None)` (frozen dataclass; `role` is `"host"` or `"player"`)
  - `GameServer(manager, clock=now_ms)` with:
    - `.sio`: the `socketio.AsyncServer`
    - every method named `host_<x>` / `player_<x>` is registered automatically as event `host:<x>` / `player:<x>`. A handler takes `(sid, data)` and returns a dict that is merged into the ack `{"ok": true, ...}`, or raises `GameError` → ack `{"ok": false, "error": code}`. **Task 14 appends more handlers to the end of the class.**
    - `await handle(event, sid, data=None) -> dict` (the ack; tests call it directly)
    - `_host(sid) -> Room` (raises `INVALID_TOKEN` without a host session)
    - `await _broadcast(room)` (sends each connected sid of the room its role view as `room:state`, then re-arms the room timer)
    - `await cleanup()` and `await cleanup_loop(interval_sec=CLEANUP_INTERVAL_SEC)`
  - Events in this task: `host:create_room`, `host:resume`, `host:kick`, `host:close_room`, `player:join`, `player:rejoin`, and `disconnect`. Server → client: `room:state` (snapshot) and `room:closed {reason: "CLOSED" | "KICKED" | "EXPIRED"}`.
  - `create_app(config=None, timing=Timing(), static_dir=STATIC_DIR) -> socketio.ASGIApp` and module-level `app = create_app()`. The lifespan raises `RuntimeError` when `YOUTUBE_API_KEY` is empty and runs the cleanup loop.
  - Test helpers: `set_payload(count=4, **settings) -> dict` in `tests/factories.py`; `FakeClock`, `Emits`, `create_room`, `join` in `tests/sockets/helpers.py`; fixtures `clock`, `emits`, `server` in `tests/sockets/conftest.py`; fixture `connect` and class `Client` in `tests/integration/conftest.py`.

Notes:
- A host or player can be connected from several tabs at once. They only go offline when their **last** sid disconnects.
- When a sid that already has a session creates or joins a room, its old session is detached first.
- One timer task per room. `_broadcast` re-arms it from `room.next_wakeup()`. When the timer fires it calls `room.tick(now)`, broadcasting if the room changed and re-arming if the timer woke up early.
- Socket.IO keeps its default same-origin check. The Vite dev proxy (Task 15) must therefore **not** set `changeOrigin` for `/socket.io`.

- [ ] **Step 1: Add the shared payload factory**

```python


def set_payload(count: int = 4, **settings) -> dict:
    """Payload `host:create_room` hợp lệ gồm `count` bài từ make_songs."""
    songs = [
        {
            "videoId": song.video_id,
            "videoTitle": song.video_title,
            "durationSec": song.duration_sec,
            "animeName": song.anime_name,
            "songLabel": song.song_label,
            "needsReview": False,
        }
        for song in make_songs(count)
    ]
    return {"set": {"songs": songs}, "settings": settings}
```

- [ ] **Step 2: Write the socket test helpers**

Run: `mkdir -p backend/tests/sockets backend/tests/integration && touch backend/tests/sockets/__init__.py backend/tests/integration/__init__.py`

```python
"""Đồng hồ giả, bộ ghi emit và vài thao tác hay dùng khi test GameServer không qua mạng."""

from app.sockets import GameServer
from tests.factories import set_payload


class FakeClock:
    def __init__(self, now: int = 1_000_000) -> None:
        self.now = now

    def __call__(self) -> int:
        return self.now


class Emits:
    """Thay cho `sio.emit`: ghi lại (event, data, to)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, object, str | None]] = []

    async def __call__(self, event, data=None, to=None, **_kwargs) -> None:
        self.events.append((event, data, to))

    def states(self, sid: str) -> list[dict]:
        return [data for event, data, to in self.events if event == "room:state" and to == sid]

    def last_state(self, sid: str) -> dict:
        states = self.states(sid)
        assert states, f"{sid} chưa nhận room:state nào"
        return states[-1]

    def closed(self, sid: str) -> list[dict]:
        return [data for event, data, to in self.events if event == "room:closed" and to == sid]


async def create_room(server: GameServer, sid: str = "host", count: int = 4, **settings) -> dict:
    ack = await server.handle("host:create_room", sid, set_payload(count, **settings))
    assert ack["ok"], ack
    return ack


async def join(server: GameServer, code: str, name: str, sid: str | None = None) -> dict:
    ack = await server.handle("player:join", sid or f"sid-{name}", {"code": code, "name": name})
    assert ack["ok"], ack
    return ack
```

```python
from random import Random

import pytest

from app.game.models import Timing
from app.game.room_manager import RoomManager
from app.sockets import GameServer
from tests.factories import POPULAR
from tests.sockets.helpers import Emits, FakeClock


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def emits():
    return Emits()


@pytest.fixture
def server(clock, emits):
    manager = RoomManager(POPULAR, rng=Random(7), timing=Timing(calib_tap_window_ms=50))
    game = GameServer(manager, clock=clock)
    game.sio.emit = emits
    return game
```

- [ ] **Step 3: Write the failing lobby tests**

```python
from tests.sockets.helpers import create_room, join

LOBBY_EVENTS = {"host:create_room", "host:resume", "host:kick", "host:close_room", "player:join", "player:rejoin"}


def test_handlers_are_registered_as_events(server):
    assert LOBBY_EVENTS <= set(server.handlers)
    assert LOBBY_EVENTS | {"disconnect"} <= set(server.sio.handlers["/"])


async def test_create_room_acks_code_and_sends_host_view(server, emits):
    ack = await create_room(server)
    assert len(ack["code"]) == 6 and ack["hostToken"]
    state = emits.last_state("host")
    assert (state["code"], state["phase"], state["players"]) == (ack["code"], "LOBBY", [])


async def test_create_room_rejects_bad_set(server):
    assert await server.handle("host:create_room", "host", {"set": {"songs": []}}) == {
        "ok": False,
        "error": "INVALID_SET",
    }
    assert (await server.handle("host:create_room", "host"))["error"] == "INVALID_SET"


async def test_events_without_session_are_invalid_token(server):
    assert await server.handle("host:close_room", "nobody") == {"ok": False, "error": "INVALID_TOKEN"}
    assert (await server.handle("host:kick", "nobody", {"playerId": "x"}))["error"] == "INVALID_TOKEN"


async def test_join_sends_role_specific_views(server, emits):
    code = (await create_room(server))["code"]
    ack = await join(server, code, "Alice")
    assert ack["playerId"] and ack["playerToken"]
    host_state = emits.last_state("host")
    assert [(p["name"], p["online"]) for p in host_state["players"]] == [("Alice", True)]
    alice_state = emits.last_state("sid-Alice")
    assert alice_state["me"]["name"] == "Alice"
    assert "players" not in alice_state


async def test_join_code_is_case_insensitive(server):
    code = (await create_room(server))["code"]
    await join(server, f"  {code.lower()} ", "Alice")


async def test_join_errors(server):
    code = (await create_room(server))["code"]
    await join(server, code, "Alice")
    assert (await server.handle("player:join", "s1", {"code": "ZZZZZZ", "name": "Bob"}))["error"] == "ROOM_NOT_FOUND"
    assert (await server.handle("player:join", "s2", {"code": code, "name": "alice"}))["error"] == "NAME_TAKEN"
    assert (await server.handle("player:join", "s3", {"code": code, "name": " "}))["error"] == "INVALID_NAME"
    assert (await server.handle("player:join", "s4", "hello"))["error"] == "INVALID_STATE"
    assert (await server.handle("player:join", "s5", {"code": code, "name": 7}))["error"] == "INVALID_STATE"


async def test_disconnect_marks_player_offline_and_rejoin_restores(server, emits):
    code = (await create_room(server))["code"]
    joined = await join(server, code, "Alice", sid="tab-1")
    await server._on_disconnect("tab-1")
    assert emits.last_state("host")["players"][0]["online"] is False
    ack = await server.handle("player:rejoin", "tab-2", {"code": code, "playerToken": joined["playerToken"]})
    assert ack == {"ok": True, "playerId": joined["playerId"]}
    assert emits.last_state("host")["players"][0]["online"] is True
    assert emits.last_state("tab-2")["me"]["id"] == joined["playerId"]


async def test_rejoin_with_unknown_token(server):
    code = (await create_room(server))["code"]
    ack = await server.handle("player:rejoin", "tab", {"code": code, "playerToken": "nope"})
    assert ack == {"ok": False, "error": "INVALID_TOKEN"}


async def test_player_stays_online_while_another_tab_is_connected(server, emits):
    code = (await create_room(server))["code"]
    joined = await join(server, code, "Alice", sid="tab-1")
    await server.handle("player:rejoin", "tab-2", {"code": code, "playerToken": joined["playerToken"]})
    await server._on_disconnect("tab-1")
    assert emits.last_state("host")["players"][0]["online"] is True


async def test_host_disconnect_and_resume(server, emits):
    created = await create_room(server)
    code = created["code"]
    await join(server, code, "Alice")
    await server._on_disconnect("host")
    assert emits.last_state("sid-Alice")["hostOnline"] is False
    bad = await server.handle("host:resume", "host-2", {"code": code, "hostToken": "wrong"})
    assert bad == {"ok": False, "error": "INVALID_TOKEN"}
    missing = await server.handle("host:resume", "host-2", {"code": "ZZZZZZ", "hostToken": created["hostToken"]})
    assert missing["error"] == "ROOM_NOT_FOUND"
    ok = await server.handle("host:resume", "host-2", {"code": code, "hostToken": created["hostToken"]})
    assert ok == {"ok": True}
    assert emits.last_state("sid-Alice")["hostOnline"] is True
    assert emits.last_state("host-2")["players"][0]["name"] == "Alice"


async def test_kick_closes_the_players_sessions(server, emits):
    code = (await create_room(server))["code"]
    alice = await join(server, code, "Alice")
    await join(server, code, "Bob")
    assert await server.handle("host:kick", "host", {"playerId": alice["playerId"]}) == {"ok": True}
    assert emits.closed("sid-Alice") == [{"reason": "KICKED"}]
    assert [p["name"] for p in emits.last_state("host")["players"]] == ["Bob"]
    again = await server.handle("player:rejoin", "sid-x", {"code": code, "playerToken": alice["playerToken"]})
    assert again["error"] == "KICKED"


async def test_players_cannot_send_host_events(server):
    code = (await create_room(server))["code"]
    alice = await join(server, code, "Alice")
    ack = await server.handle("host:kick", "sid-Alice", {"playerId": alice["playerId"]})
    assert ack == {"ok": False, "error": "INVALID_TOKEN"}


async def test_close_room_notifies_everyone_and_forgets_room(server, emits):
    code = (await create_room(server))["code"]
    await join(server, code, "Alice")
    assert await server.handle("host:close_room", "host") == {"ok": True}
    assert emits.closed("host") == [{"reason": "CLOSED"}]
    assert emits.closed("sid-Alice") == [{"reason": "CLOSED"}]
    assert server.manager.rooms == {} and server.sessions == {}
    assert (await server.handle("player:join", "late", {"code": code, "name": "Bob"}))["error"] == "ROOM_NOT_FOUND"


async def test_cleanup_closes_expired_rooms(server, emits, clock):
    code = (await create_room(server))["code"]
    await server.cleanup()
    assert code in server.manager.rooms
    clock.now += 4 * 60 * 60_000 + 1
    await server.cleanup()
    assert code not in server.manager.rooms
    assert emits.closed("host") == [{"reason": "EXPIRED"}]


async def test_creating_another_room_from_the_same_tab_detaches_the_old_one(server):
    first = (await create_room(server))["code"]
    second = (await create_room(server))["code"]
    assert first != second
    assert server.manager.get(first).host_online is False
    assert server.sessions["host"].code == second
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/sockets -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.sockets'`.

- [ ] **Step 5: Implement the server (part 1)**

`GameServer` must stay the **last** definition in the file, because Task 14 appends methods to it.

```python
"""Lớp mỏng nối Socket.IO với game: phiên kết nối, gọi `Room`, đẩy snapshot theo vai trò, hẹn giờ."""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import socketio

from app.game.constants import CLEANUP_INTERVAL_SEC
from app.game.models import GameError
from app.game.room import Room
from app.game.room_manager import RoomManager
from app.game.validation import parse_create_room
from app.game.views import host_view, player_view

logger = logging.getLogger(__name__)


def now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class Session:
    code: str
    role: str  # "host" | "player"
    player_id: str | None = None


def _field(data: object, key: str, kind: type) -> object:
    """Lấy data[key] đúng kiểu; payload hỏng → INVALID_STATE."""
    if not isinstance(data, dict):
        raise GameError("INVALID_STATE")
    value = data.get(key)
    if isinstance(value, bool) or not isinstance(value, kind):
        raise GameError("INVALID_STATE")
    return value


def _str(data: object, key: str) -> str:
    return _field(data, key, str)


def _int(data: object, key: str) -> int:
    return _field(data, key, int)


class GameServer:
    """Mỗi phương thức `host_<x>` / `player_<x>` là handler của sự kiện `host:<x>` / `player:<x>`.

    Handler trả về dict (gộp vào ack `{"ok": true, ...}`) hoặc ném GameError (ack `{"ok": false, "error"}`).
    """

    def __init__(self, manager: RoomManager, clock: Callable[[], int] = now_ms) -> None:
        self.manager = manager
        self.clock = clock
        self.sio = socketio.AsyncServer(async_mode="asgi")
        self.sessions: dict[str, Session] = {}
        self.members: dict[str, set[str]] = {}
        self.timers: dict[str, asyncio.Task] = {}
        self.handlers: dict[str, Callable[[str, object], Awaitable[dict | None]]] = {}
        for name in dir(type(self)):
            if name.startswith(("host_", "player_")):
                event = name.replace("_", ":", 1)
                self.handlers[event] = getattr(self, name)
                self.sio.on(event, self._bind(event))
        self.sio.on("disconnect", self._on_disconnect)

    def _bind(self, event: str):
        async def on_event(sid, *args):
            return await self.handle(event, sid, args[0] if args else None)

        return on_event

    async def handle(self, event: str, sid: str, data: object = None) -> dict:
        try:
            result = await self.handlers[event](sid, data)
        except GameError as exc:
            return {"ok": False, "error": exc.code}
        return {"ok": True, **(result or {})}

    # ---- phiên kết nối ----

    def _host(self, sid: str) -> Room:
        session = self.sessions.get(sid)
        if session is None or session.role != "host":
            raise GameError("INVALID_TOKEN")
        return self.manager.get(session.code)

    async def _attach(self, sid: str, session: Session) -> None:
        old_room = self._detach(sid)
        if old_room is not None and old_room.code != session.code:
            await self._broadcast(old_room)
        self.sessions[sid] = session
        self.members.setdefault(session.code, set()).add(sid)

    def _forget(self, sid: str) -> Session | None:
        session = self.sessions.pop(sid, None)
        if session is not None:
            members = self.members.get(session.code, set())
            members.discard(sid)
            if not members:
                self.members.pop(session.code, None)
        return session

    def _detach(self, sid: str) -> Room | None:
        """Gỡ phiên của sid. Nếu đó là kết nối cuối của host/người chơi thì đánh dấu offline và trả về phòng."""
        session = self._forget(sid)
        if session is None:
            return None
        try:
            room = self.manager.get(session.code)
        except GameError:
            return None
        if any(self.sessions.get(other) == session for other in self.members.get(session.code, ())):
            return None
        if session.role == "host":
            room.set_host_online(False, self.clock())
        else:
            room.set_player_online(session.player_id, False)
        return room

    async def _on_disconnect(self, sid: str, *_reason) -> None:
        room = self._detach(sid)
        if room is not None:
            await self._broadcast(room)

    # ---- đẩy snapshot và hẹn giờ ----

    async def _broadcast(self, room: Room) -> None:
        now = self.clock()
        for sid in list(self.members.get(room.code, ())):
            session = self.sessions.get(sid)
            if session is None:
                continue
            if session.role == "host":
                await self.sio.emit("room:state", host_view(room, now), to=sid)
            elif session.player_id in room.players:
                await self.sio.emit("room:state", player_view(room, session.player_id, now), to=sid)
        self._schedule(room)

    def _schedule(self, room: Room) -> None:
        timer = self.timers.pop(room.code, None)
        if timer is not None:
            timer.cancel()
        wakeup = room.next_wakeup()
        if wakeup is not None:
            delay = max(0, wakeup - self.clock()) / 1000
            self.timers[room.code] = asyncio.create_task(self._wake(room.code, delay))

    async def _wake(self, code: str, delay: float) -> None:
        await asyncio.sleep(delay)
        self.timers.pop(code, None)
        try:
            room = self.manager.get(code)
        except GameError:
            return
        if room.tick(self.clock()):
            await self._broadcast(room)
        else:
            self._schedule(room)

    # ---- dọn phòng ----

    async def cleanup_loop(self, interval_sec: float = CLEANUP_INTERVAL_SEC) -> None:
        while True:
            await asyncio.sleep(interval_sec)
            try:
                await self.cleanup()
            except Exception:
                logger.exception("cleanup failed")

    async def cleanup(self) -> None:
        for code in self.manager.expired(self.clock()):
            await self._close(code, "EXPIRED")

    async def _close(self, code: str, reason: str) -> None:
        timer = self.timers.pop(code, None)
        if timer is not None:
            timer.cancel()
        self.manager.remove(code)
        for sid in list(self.members.get(code, ())):
            self._forget(sid)
            await self.sio.emit("room:closed", {"reason": reason}, to=sid)

    # ---- quản trò: phòng ----

    async def host_create_room(self, sid: str, data: object) -> dict:
        songs, settings = parse_create_room(data)
        room = self.manager.create_room(songs, settings, self.clock())
        await self._attach(sid, Session(room.code, "host"))
        await self._broadcast(room)
        return {"code": room.code, "hostToken": room.host_token}

    async def host_resume(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        if not room.is_host_token(_str(data, "hostToken")):
            raise GameError("INVALID_TOKEN")
        await self._attach(sid, Session(room.code, "host"))
        room.set_host_online(True, self.clock())
        await self._broadcast(room)
        return {}

    async def host_kick(self, sid: str, data: object) -> dict:
        room = self._host(sid)
        player = room.kick(_str(data, "playerId"))
        for other in list(self.members.get(room.code, ())):
            session = self.sessions.get(other)
            if session is not None and session.player_id == player.id:
                self._forget(other)
                await self.sio.emit("room:closed", {"reason": "KICKED"}, to=other)
        await self._broadcast(room)
        return {}

    async def host_close_room(self, sid: str, data: object) -> dict:
        room = self._host(sid)
        await self._close(room.code, "CLOSED")
        return {}

    # ---- người chơi: vào phòng ----

    async def player_join(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        player = room.add_player(_str(data, "name"))
        await self._attach(sid, Session(room.code, "player", player.id))
        await self._broadcast(room)
        return {"playerId": player.id, "playerToken": player.token}

    async def player_rejoin(self, sid: str, data: object) -> dict:
        room = self.manager.get(_str(data, "code"))
        player = room.player_by_token(_str(data, "playerToken"))
        await self._attach(sid, Session(room.code, "player", player.id))
        room.set_player_online(player.id, True)
        await self._broadcast(room)
        return {"playerId": player.id}
```

- [ ] **Step 6: Run the socket tests to verify they pass**

Run: `cd backend && uv run pytest tests/sockets -v`
Expected: `16 passed`.

- [ ] **Step 7: Write the failing app tests**

```python
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
```

- [ ] **Step 8: Run the app tests to verify they fail**

Run: `cd backend && uv run pytest tests/api/test_main.py -v`
Expected: collection error `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 9: Implement the entry point**

```python
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
    lookup = AnimeLookup(client, TokenBucket())
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
```

- [ ] **Step 10: Run the app tests to verify they pass**

Run: `cd backend && uv run pytest tests/api/test_main.py -v`
Expected: `13 passed`.

- [ ] **Step 11: Write the integration harness and smoke test**

The harness runs the real app under uvicorn on a free port, with a 300 ms calibration tap window, and talks to it with `socketio.AsyncClient` over websocket.

```python
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
```

```python
import httpx

from tests.factories import set_payload


async def test_health_over_http(server_url):
    async with httpx.AsyncClient() as http:
        response = await http.get(f"{server_url}/api/health")
    assert response.json() == {"ok": True}


async def test_lobby_round_trip(connect):
    host = await connect()
    created = await host.emit("host:create_room", set_payload(4))
    assert created["ok"], created
    await host.wait_for(lambda s: s["phase"] == "LOBBY")

    player = await connect()
    joined = await player.emit("player:join", {"code": created["code"], "name": "Alice"})
    assert joined["ok"], joined
    await player.wait_for(lambda s: s["me"]["name"] == "Alice")
    await host.wait_for(lambda s: [p["name"] for p in s["players"]] == ["Alice"])

    await player.sio.disconnect()
    await host.wait_for(lambda s: s["players"][0]["online"] is False)

    assert await host.emit("host:close_room") == {"ok": True}
    await host.wait_until(lambda: host.closed == [{"reason": "CLOSED"}])


async def test_rejoin_kick_and_join_errors(connect):
    host = await connect()
    code = (await host.emit("host:create_room", set_payload(4)))["code"]
    first_tab = await connect()
    joined = await first_tab.emit("player:join", {"code": code, "name": "Alice"})
    await first_tab.sio.disconnect()
    await host.wait_for(lambda s: s["players"] and s["players"][0]["online"] is False)

    second_tab = await connect()
    rejoined = await second_tab.emit("player:rejoin", {"code": code, "playerToken": joined["playerToken"]})
    assert rejoined == {"ok": True, "playerId": joined["playerId"]}
    await second_tab.wait_for(lambda s: s["me"]["name"] == "Alice")
    await host.wait_for(lambda s: s["players"][0]["online"] is True)

    taken = await (await connect()).emit("player:join", {"code": code, "name": "ALICE"})
    assert taken == {"ok": False, "error": "NAME_TAKEN"}
    missing = await (await connect()).emit("player:join", {"code": "ZZZZZZ", "name": "Bob"})
    assert missing == {"ok": False, "error": "ROOM_NOT_FOUND"}

    assert await host.emit("host:kick", {"playerId": joined["playerId"]}) == {"ok": True}
    await second_tab.wait_until(lambda: second_tab.closed == [{"reason": "KICKED"}])
    await host.wait_for(lambda s: s["players"] == [])
```

- [ ] **Step 12: Run the whole backend suite**

Run: `cd backend && uv run pytest -q`
Expected: `251 passed`.

- [ ] **Step 13: Commit**

```bash
git add backend/app/sockets.py backend/app/main.py backend/tests
git commit -m "feat(server): socket.io sessions, lobby events, app entry point and integration harness"
```

---

### Task 14: Socket.IO game events (calibration, rounds, reveal, finish)

**Files:**
- Modify: `backend/app/sockets.py` (append methods to the end of `GameServer`)
- Test: `backend/tests/sockets/test_server_game.py`
- Test: `backend/tests/integration/test_game_flow.py`

**Interfaces:**
- Consumes:
  - `GameServer._host(sid)`, `._broadcast(room)`, `._schedule(room)`, `.timers`, `_int`, `_str`, `logger`, `GameError`, `Room` (Task 13)
  - `Room.start_calibration()`, `.calib_flash(round_no, now)`, `.calib_tap(player_id, round_no, now)` (Task 5)
  - `Room.start_game()`, `.audio_started(round_index, now)`, `.audio_failed(round_index, now)`, `.replay_round()`, `.next_round(now)`, `.play_again()`, `.answer(player_id, round_index, option_index, now)` (Task 6)
  - Test helpers `FakeClock`, `Emits`, `create_room`, `join`, fixtures `server`/`emits`/`clock` (Task 13); `connect`/`Client` (Task 13); `set_payload` (Task 13)
- Produces events (payload → ack on success):
  - `host:calibrate` → `{ok}`
  - `host:calib_flash {round}` → `{ok}`
  - `host:start` → `{ok}`
  - `host:audio_started {roundIndex}` → `{ok}`
  - `host:audio_failed {roundIndex, reason}` → `{ok}` (`reason` is only logged)
  - `host:replay_round` → `{ok}`
  - `host:next` → `{ok}`
  - `host:play_again` → `{ok}`
  - `player:calib_tap {round}` → `{ok}`
  - `player:answer {roundIndex, optionIndex}` → `{ok}`
  - Every successful command broadcasts `room:state` to the whole room. Errors follow Task 13: `INVALID_TOKEN` without the right session, `INVALID_STATE` for malformed payloads or the wrong phase, plus the `Room` error codes.
  - `GameServer._player(sid) -> (Room, player_id)` (raises `INVALID_TOKEN` without a player session)

- [ ] **Step 1: Write the failing unit tests**

In the test set, song `i` has `videoId` `vid{i:08d}` and anime name `Anime {i}`. The correct option can therefore be read from the host snapshot, which never contains `correctIndex` before REVEAL.

```python
from tests.sockets.helpers import create_room, join

GAME_EVENTS = {
    "host:calibrate",
    "host:calib_flash",
    "host:start",
    "host:audio_started",
    "host:audio_failed",
    "host:replay_round",
    "host:next",
    "host:play_again",
    "player:calib_tap",
    "player:answer",
}


def correct_option(host_state: dict) -> int:
    rnd = host_state["round"]
    return rnd["options"].index(f"Anime {int(rnd['videoId'][3:])}")


async def lobby(server, *names, **settings) -> str:
    code = (await create_room(server, **settings))["code"]
    for name in names:
        await join(server, code, name)
    return code


async def ok(server, event, sid="host", data=None) -> None:
    ack = await server.handle(event, sid, data)
    assert ack == {"ok": True}, (event, ack)


async def answering(server, emits, *names, **settings) -> str:
    """Tạo phòng, cho người chơi vào, bắt đầu và phát xong câu 1."""
    code = await lobby(server, *names, **settings)
    await ok(server, "host:start")
    await ok(server, "host:audio_started", data={"roundIndex": 0})
    assert emits.last_state("host")["phase"] == "ANSWERING"
    return code


def test_game_handlers_are_registered_as_events(server):
    assert GAME_EVENTS <= set(server.handlers)
    assert GAME_EVENTS <= set(server.sio.handlers["/"])


async def test_calibration_rounds_end_when_the_timer_fires(server, emits, clock):
    code = await lobby(server, "Alice", "Bob")
    await ok(server, "host:calibrate")
    assert emits.last_state("host")["calib"]["round"] == 1
    for round_no in (1, 2, 3):
        assert (await server.handle("player:calib_tap", "sid-Alice", {"round": round_no}))["error"] == "INVALID_STATE"
        await ok(server, "host:calib_flash", data={"round": round_no})
        clock.now += 20
        await ok(server, "player:calib_tap", "sid-Alice", {"round": round_no})
        assert emits.last_state("host")["calib"]["tappedCount"] == 1
        repeat = await server.handle("player:calib_tap", "sid-Alice", {"round": round_no})
        assert repeat == {"ok": False, "error": "ALREADY_ANSWERED"}
        timer = server.timers[code]
        clock.now += 100  # cửa sổ bấm 50 ms đã hết
        await timer
    host_state = emits.last_state("host")
    assert host_state["phase"] == "LOBBY" and host_state["calib"] is None
    delays = {p["name"]: (p["delayMs"], p["calibrated"]) for p in host_state["players"]}
    assert delays == {"Alice": (20, True), "Bob": (20, False)}


async def test_malformed_payloads_are_invalid_state(server):
    await lobby(server, "Alice")
    await ok(server, "host:calibrate")
    assert (await server.handle("host:calib_flash", "host", {"round": "1"}))["error"] == "INVALID_STATE"
    assert (await server.handle("host:calib_flash", "host", {"round": True}))["error"] == "INVALID_STATE"
    assert (await server.handle("host:calib_flash", "host"))["error"] == "INVALID_STATE"


async def test_roles_are_enforced(server):
    await lobby(server, "Alice")
    assert (await server.handle("host:start", "sid-Alice"))["error"] == "INVALID_TOKEN"
    assert (await server.handle("player:answer", "host", {"roundIndex": 0, "optionIndex": 0}))["error"] == (
        "INVALID_TOKEN"
    )


async def test_start_sends_video_to_host_only(server, emits):
    await lobby(server, "Alice", count=4, questionCount=2)
    await ok(server, "host:start")
    host_round = emits.last_state("host")["round"]
    assert (host_round["index"], host_round["total"], host_round["prepareSeq"]) == (0, 2, 1)
    assert host_round["videoId"].startswith("vid")
    alice_state = emits.last_state("sid-Alice")
    assert alice_state["phase"] == "PREPARING"
    assert alice_state["round"]["options"] is None
    assert "videoId" not in str(alice_state)


async def test_answers_are_scored_and_round_reveals_early(server, emits, clock):
    await answering(server, emits, "Alice", "Bob", count=4, questionCount=2, clipSec=5)
    host_state = emits.last_state("host")
    assert host_state["round"]["deadline"] == clock.now + 5000 + 3000
    alice_round = emits.last_state("sid-Alice")["round"]
    assert len(alice_round["options"]) == 4 and alice_round["result"] is None
    right = correct_option(host_state)
    clock.now += 1000
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert emits.last_state("host")["round"]["answeredCount"] == 1
    assert emits.last_state("sid-Alice")["round"]["myAnswer"] == right
    again = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert again == {"ok": False, "error": "ALREADY_ANSWERED"}
    await ok(server, "player:answer", "sid-Bob", {"roundIndex": 0, "optionIndex": (right + 1) % 4})
    host_state = emits.last_state("host")
    assert host_state["phase"] == "REVEAL"
    assert host_state["round"]["reveal"]["correctIndex"] == right
    assert [(r["name"], r["score"], r["rank"]) for r in host_state["leaderboard"]] == [
        ("Alice", 900, 1),
        ("Bob", 0, 2),
    ]
    alice_result = emits.last_state("sid-Alice")["round"]["result"]
    assert (alice_result["correct"], alice_result["gained"]) == (True, 900)
    await ok(server, "host:next")
    assert emits.last_state("host")["round"]["index"] == 1
    assert emits.last_state("sid-Bob")["phase"] == "PREPARING"


async def test_answer_errors(server, emits):
    await lobby(server, "Alice")
    await ok(server, "host:start")
    early = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": 0})
    assert early["error"] == "INVALID_STATE"
    await ok(server, "host:audio_started", data={"roundIndex": 0})
    wrong_round = await server.handle("player:answer", "sid-Alice", {"roundIndex": 1, "optionIndex": 0})
    assert wrong_round["error"] == "INVALID_STATE"
    malformed = await server.handle("player:answer", "sid-Alice", {"roundIndex": 0})
    assert malformed["error"] == "INVALID_STATE"


async def test_deadline_reveals_round_when_the_timer_fires(server, emits, clock):
    code = await answering(server, emits, "Alice", clipSec=5)
    clock.now += 8001
    server._schedule(server.manager.get(code))  # tái hẹn theo đồng hồ giả → chạy ngay
    await server.timers[code]
    state = emits.last_state("sid-Alice")
    assert state["phase"] == "REVEAL"
    assert state["round"]["result"]["gained"] == 0


async def test_last_unanswered_player_leaving_reveals_round(server, emits):
    await answering(server, emits, "Alice", "Bob")
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    await server._on_disconnect("sid-Bob")
    assert emits.last_state("host")["phase"] == "REVEAL"


async def test_audio_failed_replaces_song_and_sets_notice(server, emits):
    await lobby(server, "Alice", count=4, questionCount=2)
    await ok(server, "host:start")
    before = emits.last_state("host")["round"]
    await ok(server, "host:audio_failed", data={"roundIndex": 0, "reason": "150"})
    state = emits.last_state("host")
    assert (state["phase"], state["notice"]) == ("PREPARING", "AUDIO_REPLACED")
    assert state["round"]["prepareSeq"] == before["prepareSeq"] + 1
    assert state["round"]["videoId"] != before["videoId"]


async def test_replay_round_from_reveal_undoes_points(server, emits):
    await answering(server, emits, "Alice")
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    assert emits.last_state("sid-Alice")["me"]["score"] > 0
    await ok(server, "host:replay_round")
    state = emits.last_state("sid-Alice")
    assert (state["phase"], state["round"]["index"], state["me"]["score"]) == ("PREPARING", 0, 0)


async def test_finish_and_play_again(server, emits):
    await answering(server, emits, "Alice", questionCount=1)
    right = correct_option(emits.last_state("host"))
    await ok(server, "player:answer", "sid-Alice", {"roundIndex": 0, "optionIndex": right})
    await ok(server, "host:next")
    finished = emits.last_state("sid-Alice")
    assert finished["phase"] == "FINISHED"
    assert finished["leaderboardTop"][0]["name"] == "Alice"
    await ok(server, "host:play_again")
    again = emits.last_state("sid-Alice")
    assert (again["phase"], again["me"]["score"]) == ("LOBBY", 0)
```

Run: `cd backend && uv run pytest tests/sockets/test_server_game.py -v`
Expected: FAIL. `test_game_handlers_are_registered_as_events` fails its assertion, and the other tests fail with `KeyError: 'host:calibrate'` (or `'host:start'`) raised from `GameServer.handle`.

- [ ] **Step 2: Implement the game handlers**

Append to the end of `backend/app/sockets.py`. These are methods of `GameServer`, so keep the 4-space indent.

```python

    # ---- quản trò: đo độ trễ và điều khiển ván ----

    async def _host_command(self, sid: str, command: Callable[[Room], None]) -> dict:
        room = self._host(sid)
        command(room)
        await self._broadcast(room)
        return {}

    async def host_calibrate(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.start_calibration())

    async def host_calib_flash(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.calib_flash(_int(data, "round"), self.clock()))

    async def host_start(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.start_game())

    async def host_audio_started(self, sid: str, data: object) -> dict:
        return await self._host_command(
            sid, lambda room: room.audio_started(_int(data, "roundIndex"), self.clock())
        )

    async def host_audio_failed(self, sid: str, data: object) -> dict:
        def command(room: Room) -> None:
            round_index = _int(data, "roundIndex")
            reason = data.get("reason") if isinstance(data, dict) else None
            logger.info("room %s: audio failed in round %s (%s)", room.code, round_index, reason)
            room.audio_failed(round_index, self.clock())

        return await self._host_command(sid, command)

    async def host_replay_round(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.replay_round())

    async def host_next(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.next_round(self.clock()))

    async def host_play_again(self, sid: str, data: object) -> dict:
        return await self._host_command(sid, lambda room: room.play_again())

    # ---- người chơi: bấm đo độ trễ và trả lời ----

    def _player(self, sid: str) -> tuple[Room, str]:
        session = self.sessions.get(sid)
        if session is None or session.role != "player":
            raise GameError("INVALID_TOKEN")
        return self.manager.get(session.code), session.player_id

    async def player_calib_tap(self, sid: str, data: object) -> dict:
        room, player_id = self._player(sid)
        room.calib_tap(player_id, _int(data, "round"), self.clock())
        await self._broadcast(room)
        return {}

    async def player_answer(self, sid: str, data: object) -> dict:
        room, player_id = self._player(sid)
        room.answer(player_id, _int(data, "roundIndex"), _int(data, "optionIndex"), self.clock())
        await self._broadcast(room)
        return {}
```

- [ ] **Step 3: Run the unit tests to verify they pass**

Run: `cd backend && uv run pytest tests/sockets -v`
Expected: `28 passed`.

- [ ] **Step 4: Write the full-game integration test**

This test runs on the real clock with a 300 ms tap window. Points depend on timing, so it only checks who scored.

```python
from tests.factories import set_payload


def correct_option(host_state: dict) -> int:
    rnd = host_state["round"]
    return rnd["options"].index(f"Anime {int(rnd['videoId'][3:])}")


async def must(client, event, data=None) -> dict:
    ack = await client.emit(event, data)
    assert ack["ok"], (event, ack)
    return ack


async def setup_room(connect, names, **settings):
    host = await connect()
    created = await must(host, "host:create_room", set_payload(4, **settings))
    players = {}
    for name in names:
        player = await connect()
        await must(player, "player:join", {"code": created["code"], "name": name})
        players[name] = player
    await host.wait_for(lambda s: len(s["players"]) == len(names))
    return host, players


async def test_full_game(connect):
    host, players = await setup_room(connect, ["Alice", "Bob", "Chi"], questionCount=2, clipSec=5)

    # Đo độ trễ: Alice và Bob bấm, Chi không bấm.
    await must(host, "host:calibrate")
    for round_no in (1, 2, 3):
        await host.wait_for(lambda s: s["calib"] and s["calib"]["round"] == round_no and not s["calib"]["flashed"])
        await must(host, "host:calib_flash", {"round": round_no})
        for name in ("Alice", "Bob"):
            await must(players[name], "player:calib_tap", {"round": round_no})
    lobby = await host.wait_for(lambda s: s["phase"] == "LOBBY")
    calibrated = {p["name"]: p["calibrated"] for p in lobby["players"]}
    assert calibrated == {"Alice": True, "Bob": True, "Chi": False}

    # 2 câu: Alice và Chi đúng, Bob sai.
    await must(host, "host:start")
    for round_index in (0, 1):
        state = await host.wait_for(lambda s: s["phase"] == "PREPARING" and s["round"]["index"] == round_index)
        await must(host, "host:audio_started", {"roundIndex": round_index})
        right = correct_option(state)
        for name, player in players.items():
            await player.wait_for(lambda s: s["phase"] == "ANSWERING" and s["round"]["index"] == round_index)
            choice = (right + 1) % 4 if name == "Bob" else right
            await must(player, "player:answer", {"roundIndex": round_index, "optionIndex": choice})
        reveal = await host.wait_for(lambda s: s["phase"] == "REVEAL")
        assert reveal["round"]["reveal"]["correctIndex"] == right
        alice = await players["Alice"].wait_for(lambda s: s["phase"] == "REVEAL")
        assert alice["round"]["result"]["correct"] is True
        await must(host, "host:next")

    finished = await host.wait_for(lambda s: s["phase"] == "FINISHED")
    scores = {row["name"]: row["score"] for row in finished["leaderboard"]}
    assert scores["Alice"] > 0 and scores["Chi"] > 0 and scores["Bob"] == 0
    bob = await players["Bob"].wait_for(lambda s: s["phase"] == "FINISHED")
    assert [row["name"] for row in bob["leaderboardTop"]][-1] == "Bob"

    await must(host, "host:play_again")
    again = await host.wait_for(lambda s: s["phase"] == "LOBBY")
    assert all(p["score"] == 0 for p in again["players"])


async def test_audio_failure_shows_notice(connect):
    host, _players = await setup_room(connect, ["Alice"], questionCount=2)
    await must(host, "host:start")
    first = await host.wait_for(lambda s: s["phase"] == "PREPARING")
    await must(host, "host:audio_failed", {"roundIndex": 0, "reason": "150"})
    state = await host.wait_for(lambda s: s["notice"] == "AUDIO_REPLACED")
    assert state["round"]["prepareSeq"] == first["round"]["prepareSeq"] + 1
```

- [ ] **Step 5: Run the integration tests and the whole suite**

Run: `cd backend && uv run pytest tests/integration -v && uv run pytest -q`
Expected: `5 passed`, then `265 passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/sockets.py backend/tests/sockets/test_server_game.py backend/tests/integration/test_game_flow.py
git commit -m "feat(server): calibration, rounds, answers and finish over socket.io"
```

---

### Task 15: Frontend scaffold (Vite, Tailwind, Vitest, router shell)

**Files:**
- Create (scaffold): `frontend/` from the Vite `react-ts` template
- Modify: `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/index.css`, `frontend/package.json` (scripts)
- Delete: `frontend/src/App.css`, `frontend/src/assets/`, `frontend/public/icons.svg`
- Create: `frontend/src/test/setup.ts`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: the backend from Task 13 listens on `http://localhost:8000` in development (`cd backend && YOUTUBE_API_KEY=... uv run uvicorn app.main:app --reload`).
- Produces:
  - `npm test` runs Vitest once (jsdom, `src/**/*.test.{ts,tsx}`, setup file `src/test/setup.ts`, which loads jest-dom matchers, and calls `cleanup()` and `localStorage.clear()` after every test).
  - `npm run build` type-checks, then writes the bundle to `backend/app/static/`, which `create_app()` serves (Task 13).
  - The dev server proxies `/api` and `/socket.io` (WebSocket included) to port 8000.
  - `src/App.tsx` default export `App` holds the `<Routes>` table. Later tasks replace the whole file to add routes. Unknown paths render "Không tìm thấy trang".
  - `src/main.tsx` wraps `App` in `BrowserRouter`. Tests wrap pages in `MemoryRouter` instead.
- Code style: follow the template (single quotes, no semicolons, 2-space indent). Tests import `describe/it/expect/vi` from `'vitest'` explicitly (no globals). `tsconfig.app.json` enables `verbatimModuleSyntax` and `erasableSyntaxOnly`, so use `import type` for types and do not use `enum` or constructor parameter properties.

- [ ] **Step 1: Scaffold the app and install dependencies**

Run from the repo root:

```bash
npx -y create-vite@9.2.1 frontend --template react-ts --no-interactive --no-immediate
cd frontend
npm install
npm install react-router@^8.4.0 socket.io-client@^4.8.4 qrcode.react@^4.2.0
npm install -D tailwindcss@^4.3.3 @tailwindcss/vite@^4.3.3 vitest@^5.0.5 jsdom@^30.1.3 \
  @testing-library/react@^16.3.3 @testing-library/dom@^10.4.2 @testing-library/user-event@^14.6.8 \
  @testing-library/jest-dom@^7.0.1 @playwright/test@^1.64.1
rm -rf src/App.css src/assets public/icons.svg
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
```

Expected: `frontend/package.json` lists the packages above, and `scripts` contains `dev`, `build`, `lint`, `preview`, `test`, `test:watch`.

- [ ] **Step 2: Configure Vite, Tailwind and Vitest**

```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const backend = 'http://localhost:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': backend,
      // Không đặt changeOrigin: Socket.IO so Origin với Host, cả hai phải là địa chỉ của Vite.
      '/socket.io': { target: backend, ws: true },
    },
  },
  build: { outDir: '../backend/app/static', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

```html
<!doctype html>
<html lang="vi">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Đoán anime qua nhạc</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```css
@import 'tailwindcss';

:root {
  color-scheme: dark;
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif;
}

body {
  @apply min-h-screen bg-slate-950 text-slate-100;
}
```

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
```

- [ ] **Step 3: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    render(
      <MemoryRouter initialEntries={['/khong-co-trang-nay']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd frontend && npm test`
Expected: FAIL. The template `App.tsx` still imports the deleted `./assets/` files and `./App.css`, so Vite reports `Failed to resolve import "./assets/hero.png" from "src/App.tsx"`.

- [ ] **Step 5: Write the router shell**

```tsx
import { Link, Route, Routes } from 'react-router'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 6: Run the tests, the build and the linter**

Run: `cd frontend && npm test && npm run build && npm run lint`
Expected: `1 passed`; the build prints `../backend/app/static/index.html` plus an `assets/` folder; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "chore(frontend): scaffold Vite React app with Tailwind, Vitest and router shell"
```

---

### Task 16: Protocol types, socket client, clock and room snapshot hook

**Files:**
- Create: `frontend/src/lib/protocol.ts`, `frontend/src/lib/socket.ts`, `frontend/src/lib/clock.ts`, `frontend/src/lib/roomAuth.ts`, `frontend/src/lib/useRoomSnapshot.ts`, `frontend/src/lib/useNow.ts`
- Create: `frontend/src/test/fakeSocket.ts` (test helper used by every page test)
- Test: `frontend/src/lib/protocol.test.ts`, `frontend/src/lib/clock.test.ts`, `frontend/src/lib/roomAuth.test.ts`, `frontend/src/lib/socket.test.ts`, `frontend/src/lib/useRoomSnapshot.test.tsx`

**Interfaces:**
- Consumes: the snapshot shapes of `host_view` / `player_view` (Task 7), the ack shapes of `GameServer` (Tasks 13–14): every ack is `{ok: true, ...}` or `{ok: false, error}`; `host:create_room` → `{code, hostToken}`; `player:join` → `{playerId, playerToken}`; `player:rejoin` → `{playerId}`; `room:closed` → `{reason: "CLOSED" | "KICKED" | "EXPIRED"}`.
- Produces:
  - `protocol.ts`: types `Phase`, `Notice`, `ClosedReason`, `ErrorCode` (server codes plus the client-only `'NETWORK'`), `RoomSettings`, `LeaderboardRow`, `HostPlayer`, `HostCalib`, `HostReveal`, `HostRound`, `HostSnapshot`, `PlayerMe`, `PlayerCalib`, `PlayerResult`, `PlayerRound`, `PlayerSnapshot`, `Ack<T>`, `CreateRoomAck`, `JoinAck`, `RejoinAck`; constants `GRACE_MS = 3000`, `PREPARE_TIMEOUT_MS = 10_000`, `CALIB_ROUNDS = 3`, `ERROR_MESSAGES`, `CLOSED_MESSAGES`; `errorMessage(code: string): string`. Optional fields are always present and `null` when they don't apply (plan-level decision).
  - `socket.ts`: `type Listener = (...args: any[]) => void`, `interface GameSocket { connected; on(event, listener); off(event, listener); emit(event, payload, ack) }` (the real `io()` socket satisfies it), `getSocket(): GameSocket` (one shared `io()` connection, same origin), `setSocketForTests(socket: GameSocket | null)`, `ACK_TIMEOUT_MS = 8000`, `emitAck<T>(event, payload = {}, timeoutMs = ACK_TIMEOUT_MS): Promise<Ack<T>>` (resolves `{ok:false, error:'NETWORK'}` when no ack arrives in time).
  - `clock.ts`: `clockOffset(serverNow, localNow = Date.now())`, `remainingMs(deadline, offset, localNow = Date.now())` (never negative).
  - `roomAuth.ts`: `interface RoomAuth { hostToken?: string; playerToken?: string; playerId?: string }`, `loadRoomAuth(code): RoomAuth`, `saveRoomAuth(code, patch)` (merges), `clearRoomAuth(code, role: 'host' | 'player')`. Key: `room:<code>`.
  - `useRoomSnapshot<S>(code, authenticate): { snapshot: S | null; offset: number; closedReason: ClosedReason | null }`. It calls `authenticate()` immediately if the socket is connected and again on every `connect` (so reconnects re-send `host:resume` / `player:rejoin`). It ignores snapshots whose `code` differs.
  - `useNow(intervalMs = 200, enabled = true): number` re-renders with `Date.now()` on an interval.
  - `src/test/fakeSocket.ts`: `class FakeSocket implements GameSocket` with `sent: {event, payload}[]`, `reply(event, response | (payload) => response)` (default ack `{ok: true}`), `serverEmit(event, payload?)` (wrapped in `act`), `payloads(event)`; `installFakeSocket(): FakeSocket`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { errorMessage } from './protocol'

describe('errorMessage', () => {
  it('translates server error codes to Vietnamese', () => {
    expect(errorMessage('ROOM_NOT_FOUND')).toBe('Phòng không còn tồn tại')
    expect(errorMessage('NAME_TAKEN')).toBe('Tên này đã có người dùng trong phòng')
    expect(errorMessage('NETWORK')).toBe('Mất kết nối tới server, thử lại nhé')
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(errorMessage('WAT')).toBe('Lỗi không xác định (WAT)')
    expect(errorMessage('toString')).toBe('Lỗi không xác định (toString)')
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { clockOffset, remainingMs } from './clock'

describe('clock', () => {
  it('computes the server clock offset', () => {
    expect(clockOffset(10_500, 10_000)).toBe(500)
    expect(clockOffset(9_000, 10_000)).toBe(-1000)
  })

  it('computes the remaining time on the server clock', () => {
    // Đồng hồ server nhanh hơn 500 ms: lúc local = 10_000 thì server = 10_500.
    expect(remainingMs(12_000, 500, 10_000)).toBe(1500)
  })

  it('never returns a negative remaining time', () => {
    expect(remainingMs(10_000, 0, 11_000)).toBe(0)
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { clearRoomAuth, loadRoomAuth, saveRoomAuth } from './roomAuth'

describe('roomAuth', () => {
  it('returns an empty object when nothing is stored', () => {
    expect(loadRoomAuth('ABC234')).toEqual({})
  })

  it('stores tokens under room:<code> and merges patches', () => {
    saveRoomAuth('ABC234', { hostToken: 'h1' })
    saveRoomAuth('ABC234', { playerToken: 'p1', playerId: 'id1' })
    expect(loadRoomAuth('ABC234')).toEqual({ hostToken: 'h1', playerToken: 'p1', playerId: 'id1' })
    expect(JSON.parse(localStorage.getItem('room:ABC234')!)).toEqual({
      hostToken: 'h1',
      playerToken: 'p1',
      playerId: 'id1',
    })
  })

  it('clears only the given role', () => {
    saveRoomAuth('ABC234', { hostToken: 'h1', playerToken: 'p1', playerId: 'id1' })
    clearRoomAuth('ABC234', 'player')
    expect(loadRoomAuth('ABC234')).toEqual({ hostToken: 'h1' })
    clearRoomAuth('ABC234', 'host')
    expect(localStorage.getItem('room:ABC234')).toBeNull()
  })

  it('ignores corrupted storage', () => {
    localStorage.setItem('room:ABC234', '{oops')
    expect(loadRoomAuth('ABC234')).toEqual({})
    localStorage.setItem('room:ABC234', '"text"')
    expect(loadRoomAuth('ABC234')).toEqual({})
  })
})
```

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeSocket } from '../test/fakeSocket'
import { emitAck, setSocketForTests, type GameSocket } from './socket'

afterEach(() => {
  setSocketForTests(null)
  vi.useRealTimers()
})

describe('emitAck', () => {
  it('sends the payload and resolves with the ack', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 't1' })
    const ack = await emitAck('player:join', { code: 'ABC234', name: 'An' })
    expect(ack).toEqual({ ok: true, playerId: 'p1', playerToken: 't1' })
    expect(socket.sent).toEqual([{ event: 'player:join', payload: { code: 'ABC234', name: 'An' } }])
  })

  it('acks ok by default and supports computed replies', async () => {
    const socket = installFakeSocket()
    socket.reply('host:kick', (payload) => ({ ok: false, error: (payload as { playerId: string }).playerId }))
    expect(await emitAck('host:next')).toEqual({ ok: true })
    expect(await emitAck('host:kick', { playerId: 'INVALID_STATE' })).toEqual({ ok: false, error: 'INVALID_STATE' })
  })

  it('resolves NETWORK when the server never acks', async () => {
    vi.useFakeTimers()
    const silent: GameSocket = { connected: false, on: () => {}, off: () => {}, emit: () => {} }
    setSocketForTests(silent)
    const pending = emitAck('host:start', {}, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({ ok: false, error: 'NETWORK' })
  })
})
```

```tsx
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeSocket } from '../test/fakeSocket'
import { setSocketForTests } from './socket'
import { useRoomSnapshot } from './useRoomSnapshot'

interface Snap {
  code: string
  serverNow: number
  phase: string
}

afterEach(() => {
  setSocketForTests(null)
  vi.useRealTimers()
})

describe('useRoomSnapshot', () => {
  it('authenticates on mount when connected and again on every reconnect', () => {
    const socket = installFakeSocket()
    const authenticate = vi.fn()
    renderHook(() => useRoomSnapshot<Snap>('ABC234', authenticate))
    expect(authenticate).toHaveBeenCalledTimes(1)
    socket.serverEmit('connect')
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it('waits for the connect event when the socket is not connected yet', () => {
    const socket = installFakeSocket()
    socket.connected = false
    const authenticate = vi.fn()
    renderHook(() => useRoomSnapshot<Snap>('ABC234', authenticate))
    expect(authenticate).not.toHaveBeenCalled()
    socket.serverEmit('connect')
    expect(authenticate).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest snapshot of its own room and the clock offset', () => {
    vi.useFakeTimers({ now: 10_000 })
    const socket = installFakeSocket()
    const { result } = renderHook(() => useRoomSnapshot<Snap>('ABC234', () => {}))
    expect(result.current).toEqual({ snapshot: null, offset: 0, closedReason: null })

    socket.serverEmit('room:state', { code: 'ABC234', serverNow: 10_400, phase: 'LOBBY' })
    expect(result.current.snapshot?.phase).toBe('LOBBY')
    expect(result.current.offset).toBe(400)

    socket.serverEmit('room:state', { code: 'ZZZ999', serverNow: 99_999, phase: 'REVEAL' })
    expect(result.current.snapshot?.phase).toBe('LOBBY')
  })

  it('reports room:closed', () => {
    const socket = installFakeSocket()
    const { result } = renderHook(() => useRoomSnapshot<Snap>('ABC234', () => {}))
    socket.serverEmit('room:closed', { reason: 'KICKED' })
    expect(result.current.closedReason).toBe('KICKED')
  })

  it('uses the latest authenticate callback and unsubscribes on unmount', () => {
    const socket = installFakeSocket()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ auth }) => useRoomSnapshot<Snap>('ABC234', auth), {
      initialProps: { auth: first },
    })
    rerender({ auth: second })
    socket.serverEmit('connect')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    unmount()
    socket.serverEmit('connect')
    expect(second).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL, 5 test files cannot resolve `./protocol`, `./clock`, `./roomAuth`, `../test/fakeSocket` and `./useRoomSnapshot`.

- [ ] **Step 3: Write the protocol types and messages**

```ts
// Dữ liệu trao đổi với server qua Socket.IO, khớp với backend/app/game/views.py.
// Trường không áp dụng luôn có mặt với giá trị null.

export type Phase = 'LOBBY' | 'CALIBRATING' | 'PREPARING' | 'ANSWERING' | 'REVEAL' | 'FINISHED'
export type Notice = 'AUDIO_REPLACED' | 'ROUND_DROPPED'
export type ClosedReason = 'CLOSED' | 'KICKED' | 'EXPIRED'

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NAME_TAKEN'
  | 'INVALID_NAME'
  | 'INVALID_TOKEN'
  | 'INVALID_STATE'
  | 'INVALID_SET'
  | 'ALREADY_ANSWERED'
  | 'TOO_LATE'
  | 'KICKED'
  | 'NETWORK' // chỉ có ở client: không nhận được ack

export interface RoomSettings {
  questionCount: number
  clipSec: number
  revealSec: number
  maxPlayers: number
  mode: 'stream'
}

export interface LeaderboardRow {
  playerId: string
  name: string
  score: number
  rank: number
  gained: number | null
}

export interface HostPlayer {
  id: string
  name: string
  online: boolean
  delayMs: number
  calibrated: boolean
  score: number
}

export interface HostCalib {
  round: number
  waitMs: number
  flashed: boolean
  tappedCount: number
}

export interface HostReveal {
  correctIndex: number
  optionCounts: number[]
  animeName: string
  songLabel: string | null
}

export interface HostRound {
  index: number
  total: number
  videoId: string
  startSec: number
  endSec: number
  options: string[]
  deadline: number | null
  answeredCount: number
  onlineCount: number
  prepareSeq: number
  reveal: HostReveal | null
}

export interface HostSnapshot {
  code: string
  phase: Phase
  mode: 'stream'
  settings: RoomSettings
  serverNow: number
  players: HostPlayer[]
  calib: HostCalib | null
  round: HostRound | null
  leaderboard: LeaderboardRow[]
  notice: Notice | null
}

export interface PlayerMe {
  id: string
  name: string
  score: number
  rank: number
  delayMs: number
  calibrated: boolean
}

export interface PlayerCalib {
  round: number
  tapped: boolean
}

export interface PlayerResult {
  correctIndex: number
  correct: boolean
  gained: number
  animeName: string
  songLabel: string | null
}

export interface PlayerRound {
  index: number
  total: number
  options: string[] | null
  deadline: number | null
  myAnswer: number | null
  result: PlayerResult | null
}

export interface PlayerSnapshot {
  code: string
  phase: Phase
  serverNow: number
  hostOnline: boolean
  playerCount: number
  me: PlayerMe
  calib: PlayerCalib | null
  round: PlayerRound | null
  leaderboardTop: LeaderboardRow[] | null
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode }

export interface CreateRoomAck {
  code: string
  hostToken: string
}

export interface JoinAck {
  playerId: string
  playerToken: string
}

export interface RejoinAck {
  playerId: string
}

export const GRACE_MS = 3000
export const PREPARE_TIMEOUT_MS = 10_000
export const CALIB_ROUNDS = 3

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'Phòng không còn tồn tại',
  ROOM_FULL: 'Phòng đã đủ người',
  GAME_STARTED: 'Ván đã bắt đầu, không vào thêm được',
  NAME_TAKEN: 'Tên này đã có người dùng trong phòng',
  INVALID_NAME: 'Tên phải dài 1–20 ký tự',
  INVALID_TOKEN: 'Phiên đã hết hạn, hãy vào lại phòng',
  INVALID_STATE: 'Thao tác không hợp lệ lúc này',
  INVALID_SET: 'Bộ câu hỏi hoặc thiết lập phòng không hợp lệ',
  ALREADY_ANSWERED: 'Bạn đã trả lời rồi',
  TOO_LATE: 'Hết giờ rồi',
  KICKED: 'Bạn đã bị mời ra khỏi phòng',
  NETWORK: 'Mất kết nối tới server, thử lại nhé',
}

export const CLOSED_MESSAGES: Record<ClosedReason, string> = {
  CLOSED: 'Quản trò đã đóng phòng',
  KICKED: 'Bạn đã bị mời ra khỏi phòng',
  EXPIRED: 'Phòng đã hết hạn',
}

export function errorMessage(code: string): string {
  return Object.hasOwn(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code as ErrorCode]
    : `Lỗi không xác định (${code})`
}
```

- [ ] **Step 4: Write the socket client, clock and token storage**

```ts
import { io } from 'socket.io-client'
import type { Ack } from './protocol'

// Cùng kiểu listener với socket.io-client.
export type Listener = (...args: any[]) => void

// Phần nhỏ nhất của Socket.IO client mà app dùng; test thay bằng FakeSocket.
export interface GameSocket {
  readonly connected: boolean
  on(event: string, listener: Listener): unknown
  off(event: string, listener: Listener): unknown
  emit(event: string, payload: unknown, ack: Listener): unknown
}

let socket: GameSocket | null = null

export function getSocket(): GameSocket {
  // Cùng origin: lúc dev đi qua proxy của Vite, lúc chạy thật do FastAPI phục vụ.
  socket ??= io()
  return socket
}

export function setSocketForTests(fake: GameSocket | null): void {
  socket = fake
}

export const ACK_TIMEOUT_MS = 8000

export function emitAck<T extends object = object>(
  event: string,
  payload: unknown = {},
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'NETWORK' }), timeoutMs)
    getSocket().emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}
```

```ts
// Đồng hồ client chỉ dùng để hiển thị; server mới quyết định thời gian.

export function clockOffset(serverNow: number, localNow = Date.now()): number {
  return serverNow - localNow
}

export function remainingMs(deadline: number, offset: number, localNow = Date.now()): number {
  return Math.max(0, deadline - (localNow + offset))
}
```

```ts
// Token phòng lưu ở localStorage theo khóa `room:<code>` để kết nối lại sau khi tải lại trang.

export interface RoomAuth {
  hostToken?: string
  playerToken?: string
  playerId?: string
}

const key = (code: string) => `room:${code}`

export function loadRoomAuth(code: string): RoomAuth {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(code)) ?? '{}')
    return typeof data === 'object' && data !== null ? (data as RoomAuth) : {}
  } catch {
    return {}
  }
}

export function saveRoomAuth(code: string, patch: RoomAuth): void {
  localStorage.setItem(key(code), JSON.stringify({ ...loadRoomAuth(code), ...patch }))
}

export function clearRoomAuth(code: string, role: 'host' | 'player'): void {
  const { hostToken, playerToken, playerId } = loadRoomAuth(code)
  const rest: RoomAuth = role === 'host' ? { playerToken, playerId } : { hostToken }
  const kept = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined))
  if (Object.keys(kept).length === 0) {
    localStorage.removeItem(key(code))
  } else {
    localStorage.setItem(key(code), JSON.stringify(kept))
  }
}
```

- [ ] **Step 5: Write the hooks and the fake socket**

```ts
import { useEffect, useRef, useState } from 'react'
import { clockOffset } from './clock'
import type { ClosedReason } from './protocol'
import { getSocket } from './socket'

export interface RoomConnection<S> {
  snapshot: S | null
  offset: number
  closedReason: ClosedReason | null
}

// Nghe room:state và room:closed của một phòng. `authenticate` chạy mỗi lần socket kết nối
// (kể cả kết nối lại) để gửi host:resume hoặc player:rejoin; server trả snapshot hiện tại.
export function useRoomSnapshot<S extends { code: string; serverNow: number }>(
  code: string,
  authenticate: () => void,
): RoomConnection<S> {
  const [state, setState] = useState<RoomConnection<S>>({ snapshot: null, offset: 0, closedReason: null })
  const authRef = useRef(authenticate)

  useEffect(() => {
    authRef.current = authenticate
  })

  useEffect(() => {
    const socket = getSocket()
    const onState = (snapshot: S) => {
      if (snapshot.code !== code) return
      setState((prev) => ({ ...prev, snapshot, offset: clockOffset(snapshot.serverNow) }))
    }
    const onClosed = ({ reason }: { reason: ClosedReason }) => {
      setState((prev) => ({ ...prev, closedReason: reason }))
    }
    const onConnect = () => authRef.current()
    socket.on('room:state', onState)
    socket.on('room:closed', onClosed)
    socket.on('connect', onConnect)
    if (socket.connected) onConnect()
    return () => {
      socket.off('room:state', onState)
      socket.off('room:closed', onClosed)
      socket.off('connect', onConnect)
    }
  }, [code])

  return state
}
```

```ts
import { useEffect, useState } from 'react'

export function useNow(intervalMs = 200, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
  return now
}
```

```ts
import { act } from '@testing-library/react'
import { setSocketForTests, type GameSocket, type Listener } from '../lib/socket'

type Reply = object | ((payload: unknown) => object)

export interface SentEvent {
  event: string
  payload: unknown
}

// Socket giả: ghi lại event client gửi, trả ack theo cấu hình, và giả lập event từ server.
export class FakeSocket implements GameSocket {
  connected = true
  sent: SentEvent[] = []
  private listeners = new Map<string, Set<Listener>>()
  private replies = new Map<string, Reply>()

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
    return this
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, payload: unknown, ack: Listener) {
    this.sent.push({ event, payload })
    const reply = this.replies.get(event) ?? { ok: true }
    ack(typeof reply === 'function' ? reply(payload) : reply)
    return this
  }

  reply(event: string, response: Reply): void {
    this.replies.set(event, response)
  }

  serverEmit(event: string, payload?: unknown): void {
    act(() => {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
    })
  }

  payloads(event: string): unknown[] {
    return this.sent.filter((sent) => sent.event === event).map((sent) => sent.payload)
  }
}

export function installFakeSocket(): FakeSocket {
  const socket = new FakeSocket()
  setSocketForTests(socket)
  return socket
}
```

- [ ] **Step 6: Run the tests and the type check**

Run: `cd frontend && npm test && npx tsc -b`
Expected: `6 passed` test files (`App`, `protocol`, `clock`, `roomAuth`, `socket`, `useRoomSnapshot`) with `18 passed` tests; `tsc -b` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib frontend/src/test
git commit -m "feat(frontend): add protocol types, socket client, clock and room snapshot hook"
```

---

### Task 17: Question-set schema and storage, room settings, REST client

**Files:**
- Create: `frontend/src/lib/sets/schema.ts`, `frontend/src/lib/sets/storage.ts`, `frontend/src/lib/roomSettings.ts`, `frontend/src/lib/async.ts`, `frontend/src/lib/api.ts`
- Test: `frontend/src/lib/sets/schema.test.ts`, `frontend/src/lib/sets/storage.test.ts`, `frontend/src/lib/roomSettings.test.ts`, `frontend/src/lib/async.test.ts`, `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `RoomSettings` (Task 16); REST endpoints of Task 12: `POST /api/import {url}` → `{kind, tracks: [{videoId, videoTitle, durationSec}], skipped: [{videoId, title, reason}]}` or `{error}`; `GET /api/anime/suggest?title=` and `GET /api/anime/search?q=` → `{candidates: [{animeName, songLabel}]}`.
- Produces:
  - `sets/schema.ts`: `SET_VERSION = 1`, `MAX_SONGS = 500`, `interface Song {videoId, videoTitle, durationSec, animeName, songLabel: string | null, startSec: number | null, needsReview}`, `interface QuestionSet {version: 1, id, name, updatedAt, songs}`, `type ParseResult = {ok: true, set} | {ok: false, error}`, `makeSetId(): string`, `newSet(name = 'Bộ câu hỏi mới', now = new Date()): QuestionSet`, `parseQuestionSet(data: unknown): ParseResult` (error messages name the bad field, e.g. `Trường "songs[1].durationSec" bị thiếu hoặc sai kiểu`), `roomBlocker(songs): string | null` (Vietnamese reason why a room cannot be created yet).
  - `sets/storage.ts`: key prefix `animequiz:set:`; `listSets()` (newest first, skips corrupted entries), `loadSet(id)`, `saveSet(set, now = new Date())` (stamps `updatedAt`, returns the saved copy), `deleteSet(id)`, `exportSetJson(set)`, `exportFileName(set)` (`<slug>.animequiz.json`), `importSetJson(text): ParseResult` (validates, saves, gives a new id if the id already exists), `downloadSet(set)` (browser download).
  - `roomSettings.ts`: `SETTING_LIMITS`, `defaultRoomSettings(songCount)`, `clampRoomSettings(settings, songCount)`.
  - `async.ts`: `mapLimit(items, limit, fn)` (results in input order, at most `limit` calls in flight).
  - `api.ts`: types `SkipReason`, `ImportTrack`, `SkippedTrack`, `ImportResult`, `Candidate`, `ImportErrorCode`; `IMPORT_ERROR_MESSAGES`, `SKIP_REASON_MESSAGES`; `class ApiError extends Error { code }`; `importUrl(url): Promise<ImportResult>` (throws `ApiError`); `suggestAnime(title)` and `searchAnime(q)`: `Promise<Candidate[]>`, never reject (`[]` on any failure); `describeSkipped(skipped): string`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { newSet, parseQuestionSet, roomBlocker, type Song } from './schema'

const song = (overrides: Partial<Song> = {}): Song => ({
  videoId: '8OkpRK2_gVs',
  videoTitle: 'Shingeki no Kyojin OP1 Full - Guren no Yumiya',
  durationSec: 312,
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
  startSec: null,
  needsReview: false,
  ...overrides,
})

const validSet = () => ({
  version: 1,
  id: 'set-1',
  name: 'Anime OP 2010s',
  updatedAt: '2026-10-16T12:00:00Z',
  songs: [song()],
})

describe('parseQuestionSet', () => {
  it('accepts a valid set', () => {
    expect(parseQuestionSet(validSet())).toEqual({ ok: true, set: validSet() })
  })

  it('defaults missing songLabel and startSec to null and drops unknown fields', () => {
    const data = validSet()
    const raw = { ...song(), extra: 'x' } as Record<string, unknown>
    delete raw.songLabel
    delete raw.startSec
    const result = parseQuestionSet({ ...data, songs: [raw], extra: 1 })
    expect(result).toEqual({ ok: true, set: { ...data, songs: [song({ songLabel: null, startSec: null })] } })
  })

  it('rejects unsupported versions', () => {
    expect(parseQuestionSet({ ...validSet(), version: 2 })).toEqual({
      ok: false,
      error: 'Trường "version" không được hỗ trợ: 2 (chỉ hỗ trợ 1)',
    })
  })

  it('names the missing top-level field', () => {
    const { name: _name, ...noName } = validSet()
    expect(parseQuestionSet(noName)).toEqual({ ok: false, error: 'Trường "name" bị thiếu hoặc sai kiểu' })
    expect(parseQuestionSet({ ...validSet(), id: '' })).toEqual({
      ok: false,
      error: 'Trường "id" bị thiếu hoặc sai kiểu',
    })
    expect(parseQuestionSet({ ...validSet(), songs: 'x' })).toEqual({
      ok: false,
      error: 'Trường "songs" bị thiếu hoặc sai kiểu',
    })
  })

  it('names the bad song field with its index', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ durationSec: 0 }, 'songs[1].durationSec'],
      [{ durationSec: 12.5 }, 'songs[1].durationSec'],
      [{ videoId: 'short' }, 'songs[1].videoId'],
      [{ animeName: 3 }, 'songs[1].animeName'],
      [{ needsReview: 'no' }, 'songs[1].needsReview'],
      [{ startSec: -1 }, 'songs[1].startSec'],
      [{ songLabel: 5 }, 'songs[1].songLabel'],
    ]
    for (const [bad, path] of cases) {
      const result = parseQuestionSet({ ...validSet(), songs: [song(), { ...song(), ...bad }] })
      expect(result).toEqual({ ok: false, error: `Trường "${path}" bị thiếu hoặc sai kiểu` })
    }
    expect(parseQuestionSet({ ...validSet(), songs: [song(), 'oops'] })).toEqual({
      ok: false,
      error: 'Trường "songs[1]" bị thiếu hoặc sai kiểu',
    })
  })

  it('rejects data that is not a set at all', () => {
    expect(parseQuestionSet([1, 2])).toEqual({ ok: false, error: 'File không chứa bộ câu hỏi' })
    expect(parseQuestionSet(null)).toEqual({ ok: false, error: 'File không chứa bộ câu hỏi' })
  })
})

describe('roomBlocker', () => {
  it('blocks an empty set', () => {
    expect(roomBlocker([])).toBe('Bộ câu hỏi chưa có bài nào')
  })

  it('blocks more than 500 songs', () => {
    expect(roomBlocker(Array.from({ length: 501 }, () => song()))).toBe('Bộ câu hỏi có tối đa 500 bài')
  })

  it('blocks songs without an anime name, then songs that need review', () => {
    expect(roomBlocker([song({ animeName: '  ' }), song({ needsReview: true })])).toBe(
      'Còn 1 bài chưa có tên anime',
    )
    expect(roomBlocker([song({ needsReview: true }), song({ needsReview: true })])).toBe(
      'Còn 2 bài chưa xác nhận tên anime',
    )
  })

  it('allows a complete set', () => {
    expect(roomBlocker([song()])).toBeNull()
  })
})

describe('newSet', () => {
  it('creates an empty version-1 set with a fresh id', () => {
    const set = newSet('Thử', new Date('2026-10-16T12:00:00Z'))
    expect(set).toMatchObject({ version: 1, name: 'Thử', updatedAt: '2026-10-16T12:00:00.000Z', songs: [] })
    expect(set.id).not.toBe(newSet().id)
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { newSet, type QuestionSet } from './schema'
import {
  deleteSet,
  exportFileName,
  exportSetJson,
  importSetJson,
  listSets,
  loadSet,
  saveSet,
} from './storage'

const song = {
  videoId: '8OkpRK2_gVs',
  videoTitle: 'Guren no Yumiya',
  durationSec: 312,
  animeName: 'Shingeki no Kyojin',
  songLabel: null,
  startSec: null,
  needsReview: false,
}

const withSongs = (set: QuestionSet): QuestionSet => ({ ...set, songs: [song] })

describe('storage', () => {
  it('saves under animequiz:set:<id> and stamps updatedAt', () => {
    const set = withSongs(newSet('A'))
    const saved = saveSet(set, new Date('2026-10-16T13:00:00Z'))
    expect(saved.updatedAt).toBe('2026-10-16T13:00:00.000Z')
    expect(localStorage.getItem(`animequiz:set:${set.id}`)).not.toBeNull()
    expect(loadSet(set.id)).toEqual(saved)
  })

  it('returns null for missing or corrupted sets', () => {
    expect(loadSet('nope')).toBeNull()
    localStorage.setItem('animequiz:set:bad', '{oops')
    expect(loadSet('bad')).toBeNull()
  })

  it('lists valid sets newest first and ignores other keys', () => {
    const older = saveSet(newSet('Cũ'), new Date('2026-10-01T00:00:00Z'))
    const newer = saveSet(newSet('Mới'), new Date('2026-10-02T00:00:00Z'))
    localStorage.setItem('animequiz:set:bad', '{oops')
    localStorage.setItem('room:ABC234', '{}')
    expect(listSets().map((s) => s.id)).toEqual([newer.id, older.id])
  })

  it('deletes a set', () => {
    const set = saveSet(newSet())
    deleteSet(set.id)
    expect(loadSet(set.id)).toBeNull()
  })

  it('round-trips through export and import', () => {
    const set = withSongs(newSet('Anime OP'))
    const result = importSetJson(exportSetJson(set))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.set).toMatchObject({ id: set.id, name: 'Anime OP', songs: [song] })
    expect(loadSet(set.id)?.songs).toEqual([song])
  })

  it('gives an imported set a new id when the id already exists', () => {
    const set = saveSet(withSongs(newSet('Gốc')))
    const result = importSetJson(exportSetJson(set))
    expect(result.ok && result.set.id !== set.id).toBe(true)
    expect(listSets()).toHaveLength(2)
  })

  it('reports invalid JSON and invalid sets without saving', () => {
    expect(importSetJson('not json')).toEqual({ ok: false, error: 'File không phải JSON hợp lệ' })
    expect(importSetJson(JSON.stringify({ ...newSet(), version: 9 }))).toEqual({
      ok: false,
      error: 'Trường "version" không được hỗ trợ: 9 (chỉ hỗ trợ 1)',
    })
    expect(listSets()).toEqual([])
  })

  it('builds an ASCII file name from the set name', () => {
    expect(exportFileName({ ...newSet(), name: 'Anime OP 2010s — Đỉnh cao!' })).toBe(
      'anime-op-2010s-dinh-cao.animequiz.json',
    )
    expect(exportFileName({ ...newSet(), name: '★★★' })).toBe('bo-cau-hoi.animequiz.json')
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { clampRoomSettings, defaultRoomSettings } from './roomSettings'

describe('roomSettings', () => {
  it('defaults questionCount to min(10, songs)', () => {
    expect(defaultRoomSettings(25)).toEqual({
      questionCount: 10,
      clipSec: 15,
      revealSec: 15,
      maxPlayers: 30,
      mode: 'stream',
    })
    expect(defaultRoomSettings(4).questionCount).toBe(4)
    expect(defaultRoomSettings(0).questionCount).toBe(1)
  })

  it('clamps every field into its range and rounds to integers', () => {
    expect(
      clampRoomSettings({ questionCount: 99, clipSec: 2, revealSec: 31, maxPlayers: 1.6, mode: 'stream' }, 12),
    ).toEqual({ questionCount: 12, clipSec: 5, revealSec: 30, maxPlayers: 2, mode: 'stream' })
  })

  it('replaces non-numbers (empty inputs) with the minimum', () => {
    expect(
      clampRoomSettings({ questionCount: Number.NaN, clipSec: 15, revealSec: Number.NaN, maxPlayers: 30, mode: 'stream' }, 5),
    ).toMatchObject({ questionCount: 1, revealSec: 0 })
  })
})
```

```ts
import { describe, expect, it } from 'vitest'
import { mapLimit } from './async'

describe('mapLimit', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapLimit([30, 10, 20, 5, 15], 3, async (ms, index) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, ms))
      active -= 1
      return `${index}:${ms}`
    })
    expect(results).toEqual(['0:30', '1:10', '2:20', '3:5', '4:15'])
    expect(peak).toBe(3)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([])
  })
})
```

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, describeSkipped, importUrl, searchAnime, suggestAnime } from './api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('importUrl', () => {
  it('posts the url and returns the import result', async () => {
    const result = { kind: 'video', tracks: [{ videoId: '8OkpRK2_gVs', videoTitle: 'x', durationSec: 90 }], skipped: [] }
    const fetchMock = vi.fn().mockResolvedValue(json(200, result))
    vi.stubGlobal('fetch', fetchMock)
    expect(await importUrl('https://youtu.be/8OkpRK2_gVs')).toEqual(result)
    expect(fetchMock).toHaveBeenCalledWith('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/8OkpRK2_gVs' }),
    })
  })

  it.each([
    [400, 'INVALID_URL', 'Link YouTube không hợp lệ. Hãy dán link video, shorts hoặc playlist'],
    [404, 'NOT_FOUND', 'Không tìm thấy video hoặc playlist (có thể đã bị xóa hoặc để riêng tư)'],
    [503, 'YOUTUBE_QUOTA', 'Đã hết hạn mức YouTube API hôm nay, hãy thử lại sau'],
    [502, 'UPSTREAM_ERROR', 'YouTube đang lỗi, hãy thử lại sau'],
  ])('maps %i %s to an ApiError with a Vietnamese message', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, { error: code })))
    const error = await importUrl('x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code, message })
  })

  it('maps unknown errors to UPSTREAM_ERROR and network failures to NETWORK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })))
    await expect(importUrl('x')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(importUrl('x')).rejects.toMatchObject({ code: 'NETWORK', message: 'Không kết nối được server' })
  })
})

describe('suggestAnime / searchAnime', () => {
  it('returns candidates and encodes the query', async () => {
    const candidates = [{ animeName: 'Naruto', songLabel: null }]
    const fetchMock = vi.fn(async () => json(200, { candidates }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await suggestAnime('Naruto OP 1 & 2')).toEqual(candidates)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/anime/suggest?title=Naruto+OP+1+%26+2')
    expect(await searchAnime('naruto')).toEqual(candidates)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/anime/search?q=naruto')
  })

  it('returns [] on any failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'EMPTY_QUERY' })))
    expect(await searchAnime(' ')).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { nope: 1 })))
    expect(await suggestAnime('x')).toEqual([])
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await suggestAnime('x')).toEqual([])
  })
})

describe('describeSkipped', () => {
  it('lists skipped videos with Vietnamese reasons', () => {
    expect(describeSkipped([])).toBe('')
    expect(
      describeSkipped([
        { videoId: 'a', title: 'Bài A', reason: 'PRIVATE' },
        { videoId: 'b', title: '', reason: 'REGION_BLOCKED' },
      ]),
    ).toBe('Bỏ qua 2 video: “Bài A” (riêng tư), “b” (bị chặn ở khu vực của bạn)')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test`
Expected: FAIL, the 5 new test files cannot resolve `./schema`, `./storage`, `./roomSettings`, `./async` and `./api`.

- [ ] **Step 3: Write the schema and the storage**

```ts
// Bộ câu hỏi: dùng chung cho localStorage và file .animequiz.json (spec mục 3.1).

export const SET_VERSION = 1
export const MAX_SONGS = 500
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export interface Song {
  videoId: string
  videoTitle: string
  durationSec: number
  animeName: string
  songLabel: string | null
  startSec: number | null
  needsReview: boolean
}

export interface QuestionSet {
  version: 1
  id: string
  name: string
  updatedAt: string
  songs: Song[]
}

export type ParseResult = { ok: true; set: QuestionSet } | { ok: false; error: string }

type Data = Record<string, unknown>

const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fieldError = (path: string): ParseResult => ({ ok: false, error: `Trường "${path}" bị thiếu hoặc sai kiểu` })

export function makeSetId(): string {
  // randomUUID chỉ có trong secure context (https hoặc localhost).
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newSet(name = 'Bộ câu hỏi mới', now = new Date()): QuestionSet {
  return { version: SET_VERSION, id: makeSetId(), name, updatedAt: now.toISOString(), songs: [] }
}

// Trả về Song, hoặc tên trường sai ('' nếu cả phần tử không phải object).
function parseSong(raw: unknown): Song | string {
  if (!isRecord(raw)) return ''
  const { videoId, videoTitle, durationSec, animeName, needsReview } = raw
  const songLabel = raw.songLabel ?? null
  const startSec = raw.startSec ?? null
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return 'videoId'
  if (typeof videoTitle !== 'string') return 'videoTitle'
  if (typeof durationSec !== 'number' || !Number.isInteger(durationSec) || durationSec < 1) return 'durationSec'
  if (typeof animeName !== 'string') return 'animeName'
  if (songLabel !== null && typeof songLabel !== 'string') return 'songLabel'
  if (startSec !== null && (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0)) {
    return 'startSec'
  }
  if (typeof needsReview !== 'boolean') return 'needsReview'
  return { videoId, videoTitle, durationSec, animeName, songLabel, startSec, needsReview }
}

export function parseQuestionSet(data: unknown): ParseResult {
  if (!isRecord(data)) return { ok: false, error: 'File không chứa bộ câu hỏi' }
  if (data.version !== SET_VERSION) {
    return {
      ok: false,
      error: `Trường "version" không được hỗ trợ: ${JSON.stringify(data.version) ?? 'không có'} (chỉ hỗ trợ ${SET_VERSION})`,
    }
  }
  const { id, name, updatedAt, songs } = data
  if (typeof id !== 'string' || id === '') return fieldError('id')
  if (typeof name !== 'string') return fieldError('name')
  if (typeof updatedAt !== 'string') return fieldError('updatedAt')
  if (!Array.isArray(songs)) return fieldError('songs')
  if (songs.length > MAX_SONGS) return { ok: false, error: `Bộ câu hỏi có tối đa ${MAX_SONGS} bài` }
  const parsed: Song[] = []
  for (const [index, raw] of songs.entries()) {
    const song = parseSong(raw)
    if (typeof song === 'string') return fieldError(song ? `songs[${index}].${song}` : `songs[${index}]`)
    parsed.push(song)
  }
  return { ok: true, set: { version: SET_VERSION, id, name, updatedAt, songs: parsed } }
}

// Lý do chưa tạo phòng được (server kiểm tra lại đúng các điều kiện này), hoặc null.
export function roomBlocker(songs: Song[]): string | null {
  if (songs.length === 0) return 'Bộ câu hỏi chưa có bài nào'
  if (songs.length > MAX_SONGS) return `Bộ câu hỏi có tối đa ${MAX_SONGS} bài`
  const unnamed = songs.filter((song) => !song.animeName.trim()).length
  if (unnamed > 0) return `Còn ${unnamed} bài chưa có tên anime`
  const unreviewed = songs.filter((song) => song.needsReview).length
  if (unreviewed > 0) return `Còn ${unreviewed} bài chưa xác nhận tên anime`
  return null
}
```

```ts
import { makeSetId, parseQuestionSet, type ParseResult, type QuestionSet } from './schema'

const PREFIX = 'animequiz:set:'

export function loadSet(id: string): QuestionSet | null {
  const raw = localStorage.getItem(PREFIX + id)
  if (raw === null) return null
  try {
    const result = parseQuestionSet(JSON.parse(raw))
    return result.ok ? result.set : null
  } catch {
    return null
  }
}

export function listSets(): QuestionSet[] {
  const sets: QuestionSet[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const set = loadSet(key.slice(PREFIX.length))
    if (set) sets.push(set)
  }
  return sets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function saveSet(set: QuestionSet, now = new Date()): QuestionSet {
  const saved = { ...set, updatedAt: now.toISOString() }
  localStorage.setItem(PREFIX + set.id, JSON.stringify(saved))
  return saved
}

export function deleteSet(id: string): void {
  localStorage.removeItem(PREFIX + id)
}

export function exportSetJson(set: QuestionSet): string {
  return JSON.stringify(set, null, 2)
}

export function exportFileName(set: QuestionSet): string {
  const slug = set.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'bo-cau-hoi'}.animequiz.json`
}

export function importSetJson(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'File không phải JSON hợp lệ' }
  }
  const result = parseQuestionSet(data)
  if (!result.ok) return result
  const set = loadSet(result.set.id) ? { ...result.set, id: makeSetId() } : result.set
  return { ok: true, set: saveSet(set) }
}

export function downloadSet(set: QuestionSet): void {
  const url = URL.createObjectURL(new Blob([exportSetJson(set)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName(set)
  link.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Write room settings, mapLimit and the REST client**

```ts
import type { RoomSettings } from './protocol'

export const SETTING_LIMITS = {
  clipSec: [5, 30],
  revealSec: [0, 30],
  maxPlayers: [2, 50],
} as const

export function defaultRoomSettings(songCount: number): RoomSettings {
  return {
    questionCount: Math.max(1, Math.min(10, songCount)),
    clipSec: 15,
    revealSec: 15,
    maxPlayers: 30,
    mode: 'stream',
  }
}

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min

export function clampRoomSettings(settings: RoomSettings, songCount: number): RoomSettings {
  return {
    questionCount: clamp(settings.questionCount, [1, Math.max(1, songCount)]),
    clipSec: clamp(settings.clipSec, SETTING_LIMITS.clipSec),
    revealSec: clamp(settings.revealSec, SETTING_LIMITS.revealSec),
    maxPlayers: clamp(settings.maxPlayers, SETTING_LIMITS.maxPlayers),
    mode: 'stream',
  }
}
```

```ts
// Chạy `fn` cho từng phần tử, tối đa `limit` lời gọi cùng lúc; kết quả giữ đúng thứ tự đầu vào.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
```

```ts
// REST API dùng khi soạn bộ câu hỏi (spec mục 3.4).

export type SkipReason = 'DELETED' | 'PRIVATE' | 'NOT_EMBEDDABLE' | 'REGION_BLOCKED'

export interface ImportTrack {
  videoId: string
  videoTitle: string
  durationSec: number
}

export interface SkippedTrack {
  videoId: string
  title: string
  reason: SkipReason
}

export interface ImportResult {
  kind: 'video' | 'playlist'
  tracks: ImportTrack[]
  skipped: SkippedTrack[]
}

export interface Candidate {
  animeName: string
  songLabel: string | null
}

export type ImportErrorCode = 'INVALID_URL' | 'NOT_FOUND' | 'YOUTUBE_QUOTA' | 'UPSTREAM_ERROR' | 'NETWORK'

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  INVALID_URL: 'Link YouTube không hợp lệ. Hãy dán link video, shorts hoặc playlist',
  NOT_FOUND: 'Không tìm thấy video hoặc playlist (có thể đã bị xóa hoặc để riêng tư)',
  YOUTUBE_QUOTA: 'Đã hết hạn mức YouTube API hôm nay, hãy thử lại sau',
  UPSTREAM_ERROR: 'YouTube đang lỗi, hãy thử lại sau',
  NETWORK: 'Không kết nối được server',
}

export const SKIP_REASON_MESSAGES: Record<SkipReason, string> = {
  DELETED: 'đã bị xóa',
  PRIVATE: 'riêng tư',
  NOT_EMBEDDABLE: 'không cho nhúng',
  REGION_BLOCKED: 'bị chặn ở khu vực của bạn',
}

export class ApiError extends Error {
  code: ImportErrorCode

  constructor(code: ImportErrorCode) {
    super(IMPORT_ERROR_MESSAGES[code])
    this.name = 'ApiError'
    this.code = code
  }
}

const isImportError = (code: unknown): code is ImportErrorCode =>
  typeof code === 'string' && Object.hasOwn(IMPORT_ERROR_MESSAGES, code)

export async function importUrl(url: string): Promise<ImportResult> {
  let response: Response
  try {
    response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch {
    throw new ApiError('NETWORK')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok && body !== null) return body as ImportResult
  const code = (body as { error?: unknown } | null)?.error
  throw new ApiError(isImportError(code) ? code : 'UPSTREAM_ERROR')
}

// Gợi ý tên chỉ là phụ: mọi lỗi đều trả về danh sách rỗng.
async function fetchCandidates(path: string): Promise<Candidate[]> {
  try {
    const response = await fetch(path)
    if (!response.ok) return []
    const body = (await response.json()) as { candidates?: unknown }
    return Array.isArray(body.candidates) ? (body.candidates as Candidate[]) : []
  } catch {
    return []
  }
}

export function suggestAnime(title: string): Promise<Candidate[]> {
  return fetchCandidates(`/api/anime/suggest?${new URLSearchParams({ title })}`)
}

export function searchAnime(q: string): Promise<Candidate[]> {
  return fetchCandidates(`/api/anime/search?${new URLSearchParams({ q })}`)
}

export function describeSkipped(skipped: SkippedTrack[]): string {
  if (skipped.length === 0) return ''
  const items = skipped.map((s) => `“${s.title || s.videoId}” (${SKIP_REASON_MESSAGES[s.reason]})`)
  return `Bỏ qua ${skipped.length} video: ${items.join(', ')}`
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `cd frontend && npm test && npx tsc -b`
Expected: `11 passed` test files, `51 passed` tests; `tsc -b` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib
git commit -m "feat(frontend): add question-set schema/storage, room settings and REST client"
```

---

### Task 18: Shared components (answer tiles, leaderboard, podium, countdown, delay badge)

**Files:**
- Create: `frontend/src/components/tiles.ts`, `frontend/src/components/AnswerTile.tsx`, `frontend/src/components/Leaderboard.tsx`, `frontend/src/components/Podium.tsx`, `frontend/src/components/CountdownRing.tsx`, `frontend/src/components/DelayBadge.tsx`
- Test: `frontend/src/components/components.test.tsx`

**Interfaces:**
- Consumes: `LeaderboardRow` (Task 16).
- Produces:
  - `tiles.ts`: `TILES`: `[{letter: 'A', symbol: '▲', color}, {letter: 'B', symbol: '◆', color}, {letter: 'C', symbol: '●', color}, {letter: 'D', symbol: '■', color}]`. The colours are fixed: red, blue, amber, green.
  - `tiles.ts`: `type TileState = 'idle' | 'chosen' | 'correct' | 'wrong' | 'dimmed'`.
  - `AnswerTile({index, label, state = 'idle', count?, disabled?, onSelect?})`. With `onSelect` it renders a `<button aria-label="A: <label>">`; without it, a display-only `<div>`. `data-state` exposes the state, and `count` renders the number of players who picked it.
  - `Leaderboard({rows, highlightId?})` renders an ordered list with rank, name, `+gained` (when > 0) and the score formatted `vi-VN` (e.g. `2.430`).
  - `Podium({rows})` shows the first 3 rows (rows are already sorted by rank) with 🥇🥈🥉 by rank.
  - `CountdownRing({remainingMs, totalMs})` renders `role="timer"` labelled `Còn N giây`, with N = `ceil(remainingMs / 1000)`.
  - `DelayBadge({delayMs, calibrated})` shows `1.2s`, or `~1.2s` when the player is not calibrated (the room median is used).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { LeaderboardRow } from '../lib/protocol'
import { AnswerTile } from './AnswerTile'
import { CountdownRing } from './CountdownRing'
import { DelayBadge } from './DelayBadge'
import { Leaderboard } from './Leaderboard'
import { Podium } from './Podium'
import { TILES } from './tiles'

const row = (playerId: string, name: string, score: number, rank: number, gained: number | null = null): LeaderboardRow => ({
  playerId,
  name,
  score,
  rank,
  gained,
})

describe('AnswerTile', () => {
  it('uses fixed letters and symbols', () => {
    expect(TILES.map((t) => `${t.letter}${t.symbol}`)).toEqual(['A▲', 'B◆', 'C●', 'D■'])
  })

  it('calls onSelect with its index', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<AnswerTile index={1} label="Naruto" onSelect={onSelect} />)
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('does not fire when disabled and exposes its state', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<AnswerTile index={2} label="Bleach" state="chosen" disabled onSelect={onSelect} />)
    const tile = screen.getByRole('button', { name: 'C: Bleach' })
    await user.click(tile)
    expect(onSelect).not.toHaveBeenCalled()
    expect(tile).toBeDisabled()
    expect(tile).toHaveAttribute('data-state', 'chosen')
  })

  it('renders a display-only tile with a pick count', () => {
    render(<AnswerTile index={3} label="One Piece" state="correct" count={4} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('One Piece').closest('[data-state]')).toHaveAttribute('data-state', 'correct')
    expect(screen.getByText('4')).toBeInTheDocument()
  })
})

describe('Leaderboard', () => {
  it('renders ranks, names, gained points and formatted scores', () => {
    render(<Leaderboard rows={[row('a', 'An', 2430, 1, 870), row('b', 'Bình', 900, 2, 0)]} highlightId="b" />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('1An+8702.430')
    expect(items[1]).toHaveTextContent('2Bình900')
    expect(items[1]).toHaveAttribute('data-me', 'true')
  })

  it('shows an empty state', () => {
    render(<Leaderboard rows={[]} />)
    expect(screen.getByText('Chưa có người chơi')).toBeInTheDocument()
  })
})

describe('Podium', () => {
  it('shows the top 3 with medals by rank', () => {
    render(
      <Podium
        rows={[row('a', 'An', 3000, 1), row('b', 'Bình', 2000, 2), row('c', 'Chi', 2000, 2), row('d', 'Dũng', 10, 4)]}
      />,
    )
    expect(screen.getByText('An').closest('li')).toHaveTextContent('🥇')
    expect(screen.getByText('Chi').closest('li')).toHaveTextContent('🥈')
    expect(screen.queryByText('Dũng')).not.toBeInTheDocument()
  })
})

describe('CountdownRing', () => {
  it('rounds the remaining seconds up', () => {
    render(<CountdownRing remainingMs={4200} totalMs={18000} />)
    expect(screen.getByRole('timer', { name: 'Còn 5 giây' })).toHaveTextContent('5')
  })
})

describe('DelayBadge', () => {
  it('formats measured and estimated delays', () => {
    const { rerender } = render(<DelayBadge delayMs={1234} calibrated />)
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    rerender(<DelayBadge delayMs={800} calibrated={false} />)
    expect(screen.getByText('~0.8s')).toHaveAttribute('title', 'Chưa đo, dùng trung vị của phòng')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components`
Expected: FAIL with `Failed to resolve import "./AnswerTile"`.

- [ ] **Step 3: Write the components**

```ts
// Ký hiệu và màu cố định của 4 ô đáp án, giống nhau trên màn hình stream và điện thoại.
export const TILES = [
  { letter: 'A', symbol: '▲', color: 'bg-red-600' },
  { letter: 'B', symbol: '◆', color: 'bg-blue-600' },
  { letter: 'C', symbol: '●', color: 'bg-amber-500' },
  { letter: 'D', symbol: '■', color: 'bg-green-600' },
] as const

export type TileState = 'idle' | 'chosen' | 'correct' | 'wrong' | 'dimmed'
```

```tsx
import { TILES, type TileState } from './tiles'

const LOOK: Record<TileState, string> = {
  idle: '',
  chosen: 'ring-4 ring-white',
  correct: 'ring-4 ring-white scale-[1.03]',
  wrong: 'opacity-40',
  dimmed: 'opacity-40',
}

interface Props {
  index: number
  label: string
  state?: TileState
  count?: number
  disabled?: boolean
  onSelect?: (index: number) => void
}

export function AnswerTile({ index, label, state = 'idle', count, disabled, onSelect }: Props) {
  const tile = TILES[index]
  const className = `flex w-full items-center gap-3 rounded-2xl p-4 text-left text-white shadow transition ${tile.color} ${LOOK[state]}`
  const body = (
    <>
      <span aria-hidden="true" className="text-3xl">
        {tile.symbol}
      </span>
      <span className="flex-1 text-xl font-semibold break-words">{label}</span>
      {count !== undefined && <span className="rounded-lg bg-black/30 px-3 py-1 text-xl font-bold">{count}</span>}
    </>
  )
  if (!onSelect) {
    return (
      <div className={className} data-state={state}>
        {body}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`${className} disabled:cursor-not-allowed`}
      data-state={state}
      aria-label={`${tile.letter}: ${label}`}
      disabled={disabled}
      onClick={() => onSelect(index)}
    >
      {body}
    </button>
  )
}
```

```tsx
import type { LeaderboardRow } from '../lib/protocol'

interface Props {
  rows: LeaderboardRow[]
  highlightId?: string
}

export function Leaderboard({ rows, highlightId }: Props) {
  if (rows.length === 0) return <p className="text-slate-400">Chưa có người chơi</p>
  return (
    <ol className="space-y-1">
      {rows.map((row) => (
        <li
          key={row.playerId}
          data-me={row.playerId === highlightId}
          className="flex items-center gap-3 rounded-lg bg-slate-800 px-3 py-2 data-[me=true]:bg-sky-800"
        >
          <span className="w-8 text-right font-bold text-slate-300">{row.rank}</span>
          <span className="flex-1 truncate">{row.name}</span>
          {row.gained !== null && row.gained > 0 && <span className="text-emerald-400">+{row.gained}</span>}
          <span className="w-20 text-right font-mono">{row.score.toLocaleString('vi-VN')}</span>
        </li>
      ))}
    </ol>
  )
}
```

```tsx
import type { LeaderboardRow } from '../lib/protocol'

const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' }
const HEIGHTS = ['h-40', 'h-28', 'h-20']

export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.slice(0, 3)
  // Thứ tự hiển thị: hạng 2, hạng 1, hạng 3.
  const order = [1, 0, 2].filter((i) => i < top.length)
  return (
    <ol className="flex items-end justify-center gap-4">
      {order.map((i) => (
        <li key={top[i].playerId} className="flex w-36 flex-col items-center gap-2">
          <span className="text-4xl">{MEDALS[top[i].rank] ?? ''}</span>
          <span className="max-w-full truncate text-xl font-bold">{top[i].name}</span>
          <span className="font-mono text-slate-300">{top[i].score.toLocaleString('vi-VN')}</span>
          <div className={`w-full rounded-t-xl bg-sky-700 ${HEIGHTS[i]}`} />
        </li>
      ))}
    </ol>
  )
}
```

```tsx
interface Props {
  remainingMs: number
  totalMs: number
  size?: number
}

const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function CountdownRing({ remainingMs, totalMs, size = 112 }: Props) {
  const fraction = totalMs > 0 ? Math.min(1, Math.max(0, remainingMs / totalMs)) : 0
  const seconds = Math.ceil(remainingMs / 1000)
  return (
    <div role="timer" aria-label={`Còn ${seconds} giây`} className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={RADIUS} fill="none" strokeWidth="8" className="stroke-slate-700" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
          className="stroke-sky-400 transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-4xl font-black">{seconds}</span>
    </div>
  )
}
```

```tsx
export function DelayBadge({ delayMs, calibrated }: { delayMs: number; calibrated: boolean }) {
  const text = `${(delayMs / 1000).toFixed(1)}s`
  return (
    <span
      title={calibrated ? 'Độ trễ đã đo' : 'Chưa đo, dùng trung vị của phòng'}
      className={`rounded-full px-2 py-0.5 font-mono text-sm ${calibrated ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-700 text-slate-300'}`}
    >
      {calibrated ? text : `~${text}`}
    </span>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/components && npx tsc -b`
Expected: `9 passed`; `tsc -b` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components
git commit -m "feat(frontend): add answer tiles, leaderboard, podium, countdown ring and delay badge"
```

---

### Task 19: Home page and question-set list

**Files:**
- Create: `frontend/src/test/renderRoute.tsx`, `frontend/src/test/LocationProbe.tsx` (test helpers used by every page test)
- Create: `frontend/src/pages/Home.tsx`, `frontend/src/pages/SetList.tsx`
- Modify: `frontend/src/App.tsx` (add `/` and `/sets`), `frontend/src/App.test.tsx`
- Test: `frontend/src/pages/Home.test.tsx`, `frontend/src/pages/SetList.test.tsx`

**Interfaces:**
- Consumes: `listSets`, `saveSet`, `deleteSet`, `importSetJson`, `downloadSet` (Task 17); `newSet` (Task 17).
- Produces:
  - `renderRoute(element, {path = '/', url = path, state?})` renders `element` at route `path` inside a `MemoryRouter` that starts at `url` (with optional `location.state`). It returns `{user}` (a `userEvent` instance). Any other path renders a probe: `screen.getByTestId('location')` holds the pathname and `getByTestId('location-state')` holds `JSON.stringify(location.state)`.
  - `Home` (route `/`): a "Vào phòng" form that upper-cases the code, strips non-alphanumerics, needs 6 characters and navigates to `/play/<CODE>`; a "Tạo phòng" link to `/sets`; and it shows `location.state.message` (used by the host and player pages after `ROOM_NOT_FOUND`) in an alert.
  - `SetList` (route `/sets`): lists sets (name, song count), links to `/sets/<id>`; buttons "+ Bộ mới" (creates and opens a set), "Nhập file JSON" (file input, shows `Không nhập được file: <error>`), "Xuất JSON" and "Xóa" (with `window.confirm`).

- [ ] **Step 1: Write the test helper and the failing tests**

```tsx
import { useLocation } from 'react-router'

// Đứng ở mọi route "lạ" trong test để kiểm tra trang đã điều hướng đi đâu.
export default function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="location-state">{JSON.stringify(location.state)}</div>
    </>
  )
}
```

```tsx
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import LocationProbe from './LocationProbe'

interface Options {
  path?: string
  url?: string
  state?: unknown
}

// Vẽ một trang ở đúng route của nó; điều hướng sang route khác sẽ hiện LocationProbe.
export function renderRoute(element: ReactElement, { path = '/', url = path, state }: Options = {}) {
  const user = userEvent.setup()
  render(
    <MemoryRouter initialEntries={[{ pathname: url, state }]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
  return { user }
}
```

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderRoute } from '../test/renderRoute'
import Home from './Home'

describe('Home', () => {
  it('normalizes the room code and opens the player page', async () => {
    const { user } = renderRoute(<Home />)
    const join = screen.getByRole('button', { name: 'Vào phòng' })
    expect(join).toBeDisabled()
    await user.type(screen.getByLabelText('Mã phòng'), ' k7m-2qx ')
    expect(screen.getByLabelText('Mã phòng')).toHaveValue('K7M2QX')
    await user.click(join)
    expect(screen.getByTestId('location')).toHaveTextContent('/play/K7M2QX')
  })

  it('links hosts to the question sets', () => {
    renderRoute(<Home />)
    expect(screen.getByRole('link', { name: 'Tạo phòng' })).toHaveAttribute('href', '/sets')
  })

  it('shows a message passed through navigation state', () => {
    renderRoute(<Home />, { state: { message: 'Phòng không còn tồn tại' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Phòng không còn tồn tại')
  })
})
```

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { newSet } from '../lib/sets/schema'
import { exportSetJson, listSets, saveSet } from '../lib/sets/storage'
import { renderRoute } from '../test/renderRoute'
import SetList from './SetList'

const song = {
  videoId: '8OkpRK2_gVs',
  videoTitle: 'Guren no Yumiya',
  durationSec: 312,
  animeName: 'Shingeki no Kyojin',
  songLabel: null,
  startSec: null,
  needsReview: false,
}

describe('SetList', () => {
  it('shows an empty state', () => {
    renderRoute(<SetList />, { path: '/sets' })
    expect(screen.getByText(/Chưa có bộ câu hỏi nào/)).toBeInTheDocument()
  })

  it('lists saved sets with their song count', () => {
    const set = saveSet({ ...newSet('Anime OP 2010s'), songs: [song] })
    renderRoute(<SetList />, { path: '/sets' })
    expect(screen.getByRole('link', { name: 'Anime OP 2010s' })).toHaveAttribute('href', `/sets/${set.id}`)
    expect(screen.getByText(/1 bài/)).toBeInTheDocument()
  })

  it('creates a new set and opens the editor', async () => {
    const { user } = renderRoute(<SetList />, { path: '/sets' })
    await user.click(screen.getByRole('button', { name: '+ Bộ mới' }))
    const [created] = listSets()
    expect(created.name).toBe('Bộ câu hỏi mới')
    expect(screen.getByTestId('location')).toHaveTextContent(`/sets/${created.id}`)
  })

  it('imports a valid file and reports an invalid one', async () => {
    const { user } = renderRoute(<SetList />, { path: '/sets' })
    const input = screen.getByLabelText('Nhập file JSON')

    const bad = new File([JSON.stringify({ ...newSet(), version: 2 })], 'bad.animequiz.json', { type: 'application/json' })
    await user.upload(input, bad)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không nhập được file: Trường "version" không được hỗ trợ: 2 (chỉ hỗ trợ 1)',
    )

    const good = new File([exportSetJson({ ...newSet('Từ file'), songs: [song] })], 'good.animequiz.json')
    await user.upload(input, good)
    expect(await screen.findByRole('link', { name: 'Từ file' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deletes a set after confirmation', async () => {
    saveSet(newSet('Bỏ đi'))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { user } = renderRoute(<SetList />, { path: '/sets' })
    await user.click(screen.getByRole('button', { name: 'Xóa Bỏ đi' }))
    expect(screen.getByRole('link', { name: 'Bỏ đi' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Xóa Bỏ đi' }))
    expect(screen.queryByRole('link', { name: 'Bỏ đi' })).not.toBeInTheDocument()
    expect(listSets()).toEqual([])
    expect(confirm).toHaveBeenCalledWith('Xóa bộ câu hỏi “Bỏ đi”?')
    confirm.mockRestore()
  })
})
```

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    renderAt('/khong-co-trang-nay')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })

  it('routes / to the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Đoán anime qua nhạc/ })).toBeInTheDocument()
  })

  it('routes /sets to the set list', () => {
    renderAt('/sets')
    expect(screen.getByRole('heading', { name: 'Bộ câu hỏi' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/pages src/App.test.tsx`
Expected: FAIL, `Failed to resolve import "./Home"` and `"./SetList"`, and the two new App route tests fail.

- [ ] **Step 3: Write the pages**

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

const CODE_LENGTH = 6

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const message = (location.state as { message?: string } | null)?.message
  const [code, setCode] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code.length === CODE_LENGTH) navigate(`/play/${code}`)
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="pt-8 text-center text-4xl font-black">Đoán anime qua nhạc 🎵</h1>
      {message && (
        <p role="alert" className="rounded-xl bg-amber-500/15 p-3 text-amber-200">
          {message}
        </p>
      )}

      <section className="rounded-2xl bg-slate-900 p-5">
        <h2 className="mb-3 text-xl font-bold">Người chơi</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            Mã phòng
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
              placeholder="VD: K7M2QX"
              autoCapitalize="characters"
              autoComplete="off"
              className="rounded-lg bg-slate-800 px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] uppercase"
            />
          </label>
          <button
            type="submit"
            disabled={code.length !== CODE_LENGTH}
            className="rounded-lg bg-sky-600 px-4 py-3 text-lg font-bold disabled:opacity-40"
          >
            Vào phòng
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-slate-900 p-5">
        <h2 className="mb-1 text-xl font-bold">Quản trò</h2>
        <p className="mb-3 text-slate-400">Soạn bộ câu hỏi từ link YouTube rồi tạo phòng để stream.</p>
        <Link to="/sets" className="block rounded-lg bg-emerald-600 px-4 py-3 text-center text-lg font-bold">
          Tạo phòng
        </Link>
      </section>
    </main>
  )
}
```

```tsx
import { useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { newSet, type QuestionSet } from '../lib/sets/schema'
import { deleteSet, downloadSet, importSetJson, listSets, saveSet } from '../lib/sets/storage'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export default function SetList() {
  const navigate = useNavigate()
  const [sets, setSets] = useState(listSets)
  const [error, setError] = useState<string | null>(null)

  const create = () => {
    const set = saveSet(newSet())
    navigate(`/sets/${set.id}`)
  }

  const remove = (set: QuestionSet) => {
    if (!window.confirm(`Xóa bộ câu hỏi “${set.name}”?`)) return
    deleteSet(set.id)
    setSets(listSets())
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = importSetJson(await file.text())
    if (!result.ok) {
      setError(`Không nhập được file: ${result.error}`)
      return
    }
    setError(null)
    setSets(listSets())
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-black">Bộ câu hỏi</h1>
        <Link to="/" className="text-sky-400 underline">
          ← Trang chủ
        </Link>
      </header>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={create} className="rounded-lg bg-emerald-600 px-4 py-2 font-bold">
          + Bộ mới
        </button>
        <label className="cursor-pointer rounded-lg bg-slate-700 px-4 py-2 font-bold focus-within:ring-2">
          Nhập file JSON
          <input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}

      {sets.length === 0 ? (
        <p className="text-slate-400">Chưa có bộ câu hỏi nào. Tạo bộ mới hoặc nhập file .animequiz.json.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sets.map((set) => (
            <li key={set.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/sets/${set.id}`} className="block truncate text-lg font-bold hover:underline">
                  {set.name || 'Chưa đặt tên'}
                </Link>
                <span className="text-sm text-slate-400">
                  {set.songs.length} bài · sửa lúc {formatDate(set.updatedAt)}
                </span>
              </div>
              <button type="button" onClick={() => downloadSet(set)} className="rounded-lg bg-slate-700 px-3 py-1">
                Xuất JSON
              </button>
              <button
                type="button"
                onClick={() => remove(set)}
                aria-label={`Xóa ${set.name}`}
                className="rounded-lg bg-red-700 px-3 py-1"
              >
                Xóa
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
```

```tsx
import { Link, Route, Routes } from 'react-router'
import Home from './pages/Home'
import SetList from './pages/SetList'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sets" element={<SetList />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  14 passed (14)`, `Tests  70 passed (70)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add home page and question-set list with JSON import/export"
```

---

### Task 20: Question-set editor and room creation

**Files:**
- Create: `frontend/src/components/SongRow.tsx`, `frontend/src/components/CreateRoomPanel.tsx`, `frontend/src/pages/SetEditor.tsx`
- Modify: `frontend/src/App.tsx` (add `/sets/:id`), `frontend/src/App.test.tsx`
- Test: `frontend/src/components/CreateRoomPanel.test.tsx`, `frontend/src/pages/SetEditor.test.tsx`

**Interfaces:**
- Consumes:
  - Task 16: `emitAck`, `errorMessage`, `CreateRoomAck`, `RoomSettings`, `saveRoomAuth`, and `installFakeSocket` in tests.
  - Task 17: `Song`, `QuestionSet`, `MAX_SONGS`, `roomBlocker`, `loadSet`, `saveSet`, `importUrl`, `suggestAnime`, `searchAnime`, `describeSkipped`, `ApiError`, `IMPORT_ERROR_MESSAGES`, `Candidate`, `mapLimit`, `defaultRoomSettings`, `clampRoomSettings`, `SETTING_LIMITS`.
  - Task 19: `renderRoute`.
- Produces (named exports):
  - `SongRow({song, index, candidates, suggesting, onChange(patch: Partial<Song>), onRemove})`: an `<li aria-label="Bài N">` with inputs "Tên anime", "Nhãn bài" and "Bắt đầu (giây)" (empty means random), plus candidate buttons (`animeName · songLabel`), a search box ("Tìm tên anime" plus "Tìm"), the badge "Gợi ý, chưa xác nhận" with a "Xác nhận" button, and "Xóa bài N". Every name action sends `needsReview: false`.
  - `CreateRoomPanel({songs})`: setting inputs "Số câu", "Độ dài đoạn nhạc (giây)", "Phát thêm khi công bố (giây)", "Số người tối đa". "Số câu" follows `min(10, songs.length)` until the host edits it. The panel shows `roomBlocker(songs)` and disables "Tạo phòng" while it is not null. On click it sends `host:create_room {set: {songs}, settings: clampRoomSettings(...)}`. On success it calls `saveRoomAuth(code, {hostToken})` and navigates to `/host/<code>`; on failure it shows `errorMessage(error)` in an alert.
  - `SetEditor` (route `/sets/:id`):
    - Renames the set, imports links, and auto-saves every change with `saveSet`. Just opening the set does not change `updatedAt`.
    - Import skips videos already in the set and stops at `MAX_SONGS`. It then asks `suggestAnime` for each new song (at most 3 at a time).
    - The best candidate fills only rows the host has not touched, with `needsReview: true`.
    - "Chấp nhận tất cả gợi ý (N)" confirms every named row that still needs review.
    - An unknown id shows "Không tìm thấy bộ câu hỏi".

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { loadRoomAuth } from '../lib/roomAuth'
import type { Song } from '../lib/sets/schema'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { CreateRoomPanel } from './CreateRoomPanel'

const makeSong = (i: number, patch: Partial<Song> = {}): Song => ({
  videoId: `video${String(i).padStart(6, '0')}`,
  videoTitle: `Bài ${i}`,
  durationSec: 240,
  animeName: `Anime ${i}`,
  songLabel: null,
  startSec: null,
  needsReview: false,
  ...patch,
})

const songs = (n: number) => Array.from({ length: n }, (_, i) => makeSong(i))

describe('CreateRoomPanel', () => {
  it('explains why the room cannot be created yet', () => {
    renderRoute(<CreateRoomPanel songs={[makeSong(1), makeSong(2, { needsReview: true })]} />)
    expect(screen.getByText('Còn 1 bài chưa xác nhận tên anime')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeDisabled()
  })

  it('defaults the question count to the smaller of 10 and the song count', () => {
    renderRoute(<CreateRoomPanel songs={songs(3)} />)
    expect(screen.getByLabelText('Số câu')).toHaveValue(3)
  })

  it('creates the room with clamped settings and opens the host screen', async () => {
    const socket = installFakeSocket()
    socket.reply('host:create_room', { ok: true, code: 'K7M2QX', hostToken: 'tok-1' })
    const list = songs(12)
    const { user } = renderRoute(<CreateRoomPanel songs={list} />)
    expect(screen.getByLabelText('Số câu')).toHaveValue(10)

    await user.clear(screen.getByLabelText('Độ dài đoạn nhạc (giây)'))
    await user.type(screen.getByLabelText('Độ dài đoạn nhạc (giây)'), '99')
    await user.clear(screen.getByLabelText('Số người tối đa'))
    await user.click(screen.getByRole('button', { name: 'Tạo phòng' }))

    expect(await screen.findByTestId('location')).toHaveTextContent('/host/K7M2QX')
    expect(socket.payloads('host:create_room')).toEqual([
      {
        set: { songs: list },
        settings: { questionCount: 10, clipSec: 30, revealSec: 15, maxPlayers: 2, mode: 'stream' },
      },
    ])
    expect(loadRoomAuth('K7M2QX')).toEqual({ hostToken: 'tok-1' })
  })

  it('shows the server error and lets the host retry', async () => {
    const socket = installFakeSocket()
    socket.reply('host:create_room', { ok: false, error: 'INVALID_SET' })
    const { user } = renderRoute(<CreateRoomPanel songs={songs(2)} />)
    await user.click(screen.getByRole('button', { name: 'Tạo phòng' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bộ câu hỏi hoặc thiết lập phòng không hợp lệ')
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeEnabled()
  })
})
```

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newSet, type Song } from '../lib/sets/schema'
import { loadSet, saveSet } from '../lib/sets/storage'
import { renderRoute } from '../test/renderRoute'
import SetEditor from './SetEditor'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Handler = (url: URL) => Response | Promise<Response>

// fetch giả theo đường dẫn; đường dẫn lạ ném lỗi (gợi ý tên sẽ coi như không có ứng viên).
function mockApi(handlers: Record<string, Handler>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost')
      const handler = handlers[url.pathname]
      if (!handler) throw new Error(`Unexpected fetch ${input}`)
      return handler(url)
    }),
  )
}

const TRACK_A = { videoId: 'AAAAAAAAAAA', videoTitle: 'Shingeki no Kyojin OP1 Full', durationSec: 240 }
const TRACK_B = { videoId: 'BBBBBBBBBBB', videoTitle: 'Bài không rõ', durationSec: 200 }

const named = (track: typeof TRACK_A, animeName: string): Song => ({
  ...track,
  animeName,
  songLabel: null,
  startSec: null,
  needsReview: false,
})

function renderEditor(id: string) {
  return renderRoute(<SetEditor />, { path: '/sets/:id', url: `/sets/${id}` })
}

async function importLink(user: ReturnType<typeof renderEditor>['user'], url: string) {
  await user.type(screen.getByLabelText('Link YouTube'), url)
  await user.click(screen.getByRole('button', { name: 'Thêm' }))
}

const row = (n: number) => screen.getByRole('listitem', { name: `Bài ${n}` })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SetEditor', () => {
  it('shows a not-found message for an unknown set', () => {
    renderEditor('khong-co')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy bộ câu hỏi' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về danh sách bộ câu hỏi' })).toHaveAttribute('href', '/sets')
  })

  it('does not touch updatedAt when the set is only opened', () => {
    const set = saveSet(newSet('Chỉ xem'), new Date('2026-01-01T00:00:00Z'))
    renderEditor(set.id)
    expect(screen.getByLabelText('Tên bộ câu hỏi')).toHaveValue('Chỉ xem')
    expect(loadSet(set.id)?.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('imports a playlist, fills suggestions and saves the set', async () => {
    mockApi({
      '/api/import': () =>
        json({
          kind: 'playlist',
          tracks: [TRACK_A, TRACK_B],
          skipped: [{ videoId: 'CCCCCCCCCCC', title: 'Bài riêng tư', reason: 'PRIVATE' }],
        }),
      '/api/anime/suggest': (url) =>
        json({
          candidates:
            url.searchParams.get('title') === TRACK_A.videoTitle
              ? [
                  { animeName: 'Shingeki no Kyojin', songLabel: 'OP1' },
                  { animeName: 'Attack on Titan', songLabel: null },
                ]
              : [],
        }),
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://www.youtube.com/playlist?list=PL123')

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Đã thêm 2 bài')
    expect(status).toHaveTextContent('Bỏ qua 1 video: “Bài riêng tư” (riêng tư)')
    await waitFor(() => expect(within(row(1)).getByLabelText('Tên anime')).toHaveValue('Shingeki no Kyojin'))
    expect(within(row(1)).getByText('Gợi ý, chưa xác nhận')).toBeInTheDocument()
    await waitFor(() => expect(within(row(2)).queryByText('Đang gợi ý…')).not.toBeInTheDocument())
    expect(within(row(2)).getByLabelText('Tên anime')).toHaveValue('')

    expect(loadSet(set.id)?.songs).toEqual([
      { ...TRACK_A, animeName: 'Shingeki no Kyojin', songLabel: 'OP1', startSec: null, needsReview: true },
      { ...TRACK_B, animeName: '', songLabel: null, startSec: null, needsReview: false },
    ])
  })

  it('blocks room creation until every suggestion is confirmed', async () => {
    mockApi({
      '/api/import': () => json({ kind: 'playlist', tracks: [TRACK_A, TRACK_B], skipped: [] }),
      '/api/anime/suggest': (url) =>
        json({ candidates: [{ animeName: `Gợi ý cho ${url.searchParams.get('title')}`, songLabel: null }] }),
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://www.youtube.com/playlist?list=PL123')

    expect(await screen.findByText('Còn 2 bài chưa xác nhận tên anime')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeDisabled()

    await user.click(within(row(1)).getByRole('button', { name: 'Xác nhận' }))
    expect(screen.getByText('Còn 1 bài chưa xác nhận tên anime')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chấp nhận tất cả gợi ý (1)' }))
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeEnabled()
    expect(screen.queryByText('Gợi ý, chưa xác nhận')).not.toBeInTheDocument()
    expect(loadSet(set.id)?.songs.every((song) => !song.needsReview)).toBe(true)
  })

  it('lets the host pick another candidate or search for a name', async () => {
    mockApi({
      '/api/import': () => json({ kind: 'playlist', tracks: [TRACK_A, TRACK_B], skipped: [] }),
      '/api/anime/suggest': () =>
        json({
          candidates: [
            { animeName: 'Shingeki no Kyojin', songLabel: 'OP1' },
            { animeName: 'Attack on Titan', songLabel: null },
          ],
        }),
      '/api/anime/search': (url) =>
        json({
          candidates:
            url.searchParams.get('q') === 'kimetsu' ? [{ animeName: 'Kimetsu no Yaiba', songLabel: 'OP1' }] : [],
        }),
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://www.youtube.com/playlist?list=PL123')

    await user.click(await within(row(1)).findByRole('button', { name: 'Attack on Titan' }))
    expect(within(row(1)).getByLabelText('Tên anime')).toHaveValue('Attack on Titan')
    expect(within(row(1)).getByLabelText('Nhãn bài')).toHaveValue('')
    expect(within(row(1)).queryByText('Gợi ý, chưa xác nhận')).not.toBeInTheDocument()

    await user.type(within(row(2)).getByLabelText('Tìm tên anime'), 'kimetsu')
    await user.click(within(row(2)).getByRole('button', { name: 'Tìm' }))
    await user.click(await within(row(2)).findByRole('button', { name: 'Kimetsu no Yaiba · OP1' }))
    expect(within(row(2)).getByLabelText('Tên anime')).toHaveValue('Kimetsu no Yaiba')
    expect(within(row(2)).getByLabelText('Nhãn bài')).toHaveValue('OP1')
    expect(loadSet(set.id)?.songs[1]).toMatchObject({ animeName: 'Kimetsu no Yaiba', needsReview: false })
  })

  it('keeps a typed name when a suggestion arrives later', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mockApi({
      '/api/import': () => json({ kind: 'video', tracks: [TRACK_A], skipped: [] }),
      '/api/anime/suggest': async () => {
        await gate
        return json({ candidates: [{ animeName: 'Gợi ý muộn', songLabel: null }] })
      },
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://youtu.be/AAAAAAAAAAA')

    expect(await within(row(1)).findByText('Đang gợi ý…')).toBeInTheDocument()
    await user.type(within(row(1)).getByLabelText('Tên anime'), 'Tên tự gõ')
    release()
    expect(await within(row(1)).findByRole('button', { name: 'Gợi ý muộn' })).toBeInTheDocument()
    expect(within(row(1)).getByLabelText('Tên anime')).toHaveValue('Tên tự gõ')
    expect(within(row(1)).queryByText('Gợi ý, chưa xác nhận')).not.toBeInTheDocument()
  })

  it('skips videos already in the set and reports import errors', async () => {
    let calls = 0
    mockApi({
      '/api/import': () => {
        calls += 1
        return calls === 1
          ? json({ kind: 'video', tracks: [TRACK_A], skipped: [] })
          : json({ error: 'INVALID_URL' }, 400)
      },
    })
    const set = saveSet({ ...newSet('Thử'), songs: [named(TRACK_A, 'Shingeki no Kyojin')] })
    const { user } = renderEditor(set.id)

    await importLink(user, 'https://youtu.be/AAAAAAAAAAA')
    expect(await screen.findByRole('status')).toHaveTextContent('Đã thêm 0 bài, bỏ qua 1 bài đã có trong bộ')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    await importLink(user, 'https://example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Link YouTube không hợp lệ. Hãy dán link video, shorts hoặc playlist',
    )
  })

  it('saves renames, fixed start times and deletions', async () => {
    const set = saveSet({
      ...newSet('Tên cũ'),
      songs: [named(TRACK_A, 'Shingeki no Kyojin'), named(TRACK_B, 'Bài B')],
    })
    const { user } = renderEditor(set.id)

    await user.clear(screen.getByLabelText('Tên bộ câu hỏi'))
    await user.type(screen.getByLabelText('Tên bộ câu hỏi'), 'Tên mới')
    await user.type(within(row(1)).getByLabelText('Bắt đầu (giây)'), '42')
    expect(loadSet(set.id)).toMatchObject({ name: 'Tên mới' })
    expect(loadSet(set.id)?.songs[0].startSec).toBe(42)

    await user.clear(within(row(1)).getByLabelText('Bắt đầu (giây)'))
    expect(loadSet(set.id)?.songs[0].startSec).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Xóa bài 2' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(loadSet(set.id)?.songs.map((song) => song.videoId)).toEqual([TRACK_A.videoId])
  })
})
```

Replace `frontend/src/App.test.tsx` (adds the `/sets/:id` test and two imports):

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'
import { newSet } from './lib/sets/schema'
import { saveSet } from './lib/sets/storage'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    renderAt('/khong-co-trang-nay')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })

  it('routes / to the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Đoán anime qua nhạc/ })).toBeInTheDocument()
  })

  it('routes /sets to the set list', () => {
    renderAt('/sets')
    expect(screen.getByRole('heading', { name: 'Bộ câu hỏi' })).toBeInTheDocument()
  })

  it('routes /sets/:id to the editor', () => {
    const set = saveSet(newSet('Anime OP'))
    renderAt(`/sets/${set.id}`)
    expect(screen.getByRole('heading', { name: 'Soạn bộ câu hỏi' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên bộ câu hỏi')).toHaveValue('Anime OP')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components/CreateRoomPanel.test.tsx src/pages/SetEditor.test.tsx src/App.test.tsx`
Expected: FAIL, `Failed to resolve import "./CreateRoomPanel"` and `"./SetEditor"`, and `routes /sets/:id to the editor` fails.

- [ ] **Step 3: Write `SongRow`**

```tsx
import { useState, type FormEvent } from 'react'
import { searchAnime, type Candidate } from '../lib/api'
import type { Song } from '../lib/sets/schema'

interface Props {
  song: Song
  index: number
  candidates: Candidate[]
  suggesting: boolean
  onChange: (patch: Partial<Song>) => void
  onRemove: () => void
}

const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

const candidateText = (c: Candidate) => (c.songLabel ? `${c.animeName} · ${c.songLabel}` : c.animeName)

export function SongRow({ song, index, candidates, suggesting, onChange, onRemove }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const options = results ?? candidates

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setResults(await searchAnime(query.trim()))
    setSearching(false)
  }

  return (
    <li aria-label={`Bài ${index + 1}`} className="flex flex-col gap-3 rounded-xl bg-slate-900 p-4">
      <div className="flex items-start gap-3">
        <span className="font-mono text-slate-500">#{index + 1}</span>
        <a
          href={`https://www.youtube.com/watch?v=${song.videoId}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-slate-300 hover:underline"
        >
          {song.videoTitle || song.videoId}
        </a>
        <span className="text-sm text-slate-500">{formatDuration(song.durationSec)}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Xóa bài ${index + 1}`}
          className="rounded bg-red-800 px-2 text-sm"
        >
          Xóa
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_8rem]">
        <label className="flex flex-col gap-1 text-sm">
          Tên anime
          <input
            value={song.animeName}
            onChange={(e) => onChange({ animeName: e.target.value, needsReview: false })}
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nhãn bài
          <input
            value={song.songLabel ?? ''}
            onChange={(e) => onChange({ songLabel: e.target.value || null })}
            placeholder="VD: OP1"
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bắt đầu (giây)
          <input
            type="number"
            min={0}
            max={Math.max(0, song.durationSec - 1)}
            value={song.startSec ?? ''}
            onChange={(e) => {
              const value = e.target.valueAsNumber
              onChange({ startSec: Number.isNaN(value) ? null : Math.max(0, value) })
            }}
            placeholder="Ngẫu nhiên"
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {song.needsReview && (
          <>
            <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-200">Gợi ý, chưa xác nhận</span>
            <button
              type="button"
              onClick={() => onChange({ needsReview: false })}
              className="rounded bg-emerald-700 px-2 py-1"
            >
              Xác nhận
            </button>
          </>
        )}
        {suggesting && <span className="text-slate-400">Đang gợi ý…</span>}
        {options.map((candidate) => (
          <button
            key={candidateText(candidate)}
            type="button"
            onClick={() => onChange({ animeName: candidate.animeName, songLabel: candidate.songLabel, needsReview: false })}
            className="rounded-full bg-slate-700 px-3 py-1 hover:bg-slate-600"
          >
            {candidateText(candidate)}
          </button>
        ))}
        {results?.length === 0 && <span className="text-slate-400">Không tìm thấy</span>}
      </div>

      <form onSubmit={search} className="flex gap-2 text-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm tên anime"
          placeholder="Tìm tên anime khác…"
          className="flex-1 rounded bg-slate-800 px-2 py-1"
        />
        <button type="submit" disabled={searching} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50">
          Tìm
        </button>
      </form>
    </li>
  )
}
```

- [ ] **Step 4: Write `CreateRoomPanel`**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage, type CreateRoomAck, type RoomSettings } from '../lib/protocol'
import { saveRoomAuth } from '../lib/roomAuth'
import { clampRoomSettings, defaultRoomSettings, SETTING_LIMITS } from '../lib/roomSettings'
import { roomBlocker, type Song } from '../lib/sets/schema'
import { emitAck } from '../lib/socket'

type NumericSetting = Exclude<keyof RoomSettings, 'mode'>

export function CreateRoomPanel({ songs }: { songs: Song[] }) {
  const navigate = useNavigate()
  // Chỉ giữ giá trị quản trò đã sửa; còn lại theo mặc định (số câu đổi theo số bài trong bộ).
  const [custom, setCustom] = useState<Partial<Record<NumericSetting, number>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settings: RoomSettings = { ...defaultRoomSettings(songs.length), ...custom }
  const blocker = roomBlocker(songs)

  const fields: { key: NumericSetting; label: string; min: number; max: number }[] = [
    { key: 'questionCount', label: 'Số câu', min: 1, max: Math.max(1, songs.length) },
    { key: 'clipSec', label: 'Độ dài đoạn nhạc (giây)', min: SETTING_LIMITS.clipSec[0], max: SETTING_LIMITS.clipSec[1] },
    {
      key: 'revealSec',
      label: 'Phát thêm khi công bố (giây)',
      min: SETTING_LIMITS.revealSec[0],
      max: SETTING_LIMITS.revealSec[1],
    },
    {
      key: 'maxPlayers',
      label: 'Số người tối đa',
      min: SETTING_LIMITS.maxPlayers[0],
      max: SETTING_LIMITS.maxPlayers[1],
    },
  ]

  const create = async () => {
    setBusy(true)
    setError(null)
    const response = await emitAck<CreateRoomAck>('host:create_room', {
      set: { songs },
      settings: clampRoomSettings(settings, songs.length),
    })
    if (!response.ok) {
      setError(errorMessage(response.error))
      setBusy(false)
      return
    }
    saveRoomAuth(response.code, { hostToken: response.hostToken })
    navigate(`/host/${response.code}`)
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-slate-900 p-4">
      <h2 className="text-xl font-bold">Tạo phòng</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fields.map(({ key, label, min, max }) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={Number.isNaN(settings[key]) ? '' : settings[key]}
              onChange={(e) => setCustom((prev) => ({ ...prev, [key]: e.target.valueAsNumber }))}
              className="rounded bg-slate-800 px-2 py-1 text-base"
            />
          </label>
        ))}
      </div>
      <p className="text-sm text-slate-400">
        Mở màn hình quản trò rồi chia sẻ tab đó kèm âm thanh trên Discord. Phát thêm 0 giây nghĩa là không phát video khi
        công bố đáp án.
      </p>
      {blocker && <p className="text-amber-300">{blocker}</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={create}
        disabled={blocker !== null || busy}
        className="self-start rounded-lg bg-emerald-600 px-6 py-2 text-lg font-bold disabled:opacity-40"
      >
        {busy ? 'Đang tạo…' : 'Tạo phòng'}
      </button>
    </section>
  )
}
```

The button label changes to "Đang tạo…" while the request is in flight. The tests look for "Tạo phòng" only before the click, or after the request has finished.

- [ ] **Step 5: Write `SetEditor` and register the route**

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { CreateRoomPanel } from '../components/CreateRoomPanel'
import { SongRow } from '../components/SongRow'
import { ApiError, describeSkipped, IMPORT_ERROR_MESSAGES, importUrl, suggestAnime, type Candidate } from '../lib/api'
import { mapLimit } from '../lib/async'
import { MAX_SONGS, type QuestionSet, type Song } from '../lib/sets/schema'
import { loadSet, saveSet } from '../lib/sets/storage'

const SUGGEST_CONCURRENCY = 3

export default function SetEditor() {
  const { id = '' } = useParams()
  // key: đổi sang bộ khác thì dựng lại toàn bộ state.
  return <Editor key={id} id={id} />
}

function Editor({ id }: { id: string }) {
  const [initial] = useState(() => loadSet(id))
  const [set, setSet] = useState<QuestionSet | null>(initial)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<string[]>([])
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [suggesting, setSuggesting] = useState<ReadonlySet<string>>(new Set())
  // Dòng quản trò đã sửa tay: gợi ý đến muộn không ghi đè lên nữa.
  const touched = useRef(new Set<string>())

  useEffect(() => {
    // So sánh với object lúc mở để chỉ lưu khi có thay đổi thật (StrictMode chạy effect 2 lần).
    if (set && set !== initial) saveSet(set)
  }, [set, initial])

  if (!set) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl font-bold">Không tìm thấy bộ câu hỏi</h1>
        <Link className="mt-4 inline-block text-sky-400 underline" to="/sets">
          Về danh sách bộ câu hỏi
        </Link>
      </main>
    )
  }

  const patchSong = (videoId: string, patch: Partial<Song>) =>
    setSet((prev) =>
      prev && { ...prev, songs: prev.songs.map((song) => (song.videoId === videoId ? { ...song, ...patch } : song)) },
    )

  const editSong = (videoId: string, patch: Partial<Song>) => {
    touched.current.add(videoId)
    patchSong(videoId, patch)
  }

  const removeSong = (videoId: string) =>
    setSet((prev) => prev && { ...prev, songs: prev.songs.filter((song) => song.videoId !== videoId) })

  const suggest = async (songs: Song[]) => {
    setSuggesting((prev) => new Set([...prev, ...songs.map((song) => song.videoId)]))
    await mapLimit(songs, SUGGEST_CONCURRENCY, async (song) => {
      const found = await suggestAnime(song.videoTitle)
      setCandidates((prev) => ({ ...prev, [song.videoId]: found }))
      setSuggesting((prev) => new Set([...prev].filter((videoId) => videoId !== song.videoId)))
      const best = found[0]
      if (best && !touched.current.has(song.videoId)) {
        patchSong(song.videoId, { animeName: best.animeName, songLabel: best.songLabel, needsReview: true })
      }
    })
  }

  const runImport = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    setImporting(true)
    setImportError(null)
    setImportInfo([])
    try {
      const result = await importUrl(url.trim())
      const known = new Set(set.songs.map((song) => song.videoId))
      const added: Song[] = []
      let duplicates = 0
      let overflow = 0
      for (const track of result.tracks) {
        if (known.has(track.videoId)) {
          duplicates += 1
        } else if (set.songs.length + added.length >= MAX_SONGS) {
          overflow += 1
        } else {
          known.add(track.videoId)
          added.push({ ...track, animeName: '', songLabel: null, startSec: null, needsReview: false })
        }
      }
      // Chỉ phần import thêm bài, và nút Thêm bị khóa khi đang import, nên không thể thêm trùng ở đây.
      setSet((prev) => prev && { ...prev, songs: [...prev.songs, ...added] })
      const summary = [`Đã thêm ${added.length} bài`]
      if (duplicates > 0) summary.push(`bỏ qua ${duplicates} bài đã có trong bộ`)
      if (overflow > 0) summary.push(`bỏ ${overflow} bài vì bộ câu hỏi có tối đa ${MAX_SONGS} bài`)
      setImportInfo([summary.join(', '), describeSkipped(result.skipped)].filter(Boolean))
      setUrl('')
      void suggest(added)
    } catch (error) {
      setImportError(error instanceof ApiError ? error.message : IMPORT_ERROR_MESSAGES.UPSTREAM_ERROR)
    } finally {
      setImporting(false)
    }
  }

  const reviewable = set.songs.filter((song) => song.needsReview && song.animeName.trim()).length
  const acceptAll = () =>
    setSet(
      (prev) =>
        prev && {
          ...prev,
          songs: prev.songs.map((song) =>
            song.needsReview && song.animeName.trim() ? { ...song, needsReview: false } : song,
          ),
        },
    )

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-sm tracking-widest text-slate-400 uppercase">Soạn bộ câu hỏi</h1>
        <Link to="/sets" className="text-sky-400 underline">
          ← Danh sách bộ
        </Link>
      </header>
      <input
        aria-label="Tên bộ câu hỏi"
        value={set.name}
        onChange={(e) => setSet((prev) => prev && { ...prev, name: e.target.value })}
        className="rounded-lg bg-slate-900 px-3 py-2 text-3xl font-black"
      />

      <CreateRoomPanel songs={set.songs} />

      <form onSubmit={runImport} className="flex flex-col gap-2 rounded-2xl bg-slate-900 p-4">
        <label className="flex flex-col gap-1">
          Link YouTube
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link video, shorts hoặc playlist (playlist tối đa 200 bài)"
            className="rounded bg-slate-800 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={importing || !url.trim()}
          className="self-start rounded-lg bg-sky-600 px-4 py-2 font-bold disabled:opacity-40"
        >
          {importing ? 'Đang lấy danh sách…' : 'Thêm'}
        </button>
        {importError && (
          <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
            {importError}
          </p>
        )}
        {importInfo.length > 0 && (
          <div role="status" className="text-sm text-slate-300">
            {importInfo.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </form>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{set.songs.length} bài</h2>
        <button
          type="button"
          onClick={acceptAll}
          disabled={reviewable === 0}
          className="rounded-lg bg-emerald-700 px-3 py-1 disabled:opacity-40"
        >
          Chấp nhận tất cả gợi ý ({reviewable})
        </button>
      </div>

      <ol className="flex flex-col gap-3">
        {set.songs.map((song, index) => (
          <SongRow
            key={song.videoId}
            song={song}
            index={index}
            candidates={candidates[song.videoId] ?? []}
            suggesting={suggesting.has(song.videoId)}
            onChange={(patch) => editSong(song.videoId, patch)}
            onRemove={() => removeSong(song.videoId)}
          />
        ))}
      </ol>
    </main>
  )
}
```

```tsx
import { Link, Route, Routes } from 'react-router'
import Home from './pages/Home'
import SetEditor from './pages/SetEditor'
import SetList from './pages/SetList'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sets" element={<SetList />} />
      <Route path="/sets/:id" element={<SetEditor />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  16 passed (16)`, `Tests  83 passed (83)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add question-set editor with YouTube import, name suggestions and room creation"
```

---

### Task 21: Audio players and host playback hook

**Files:**
- Create: `frontend/src/audio/AudioPlayer.ts`, `frontend/src/audio/YouTubePlayer.ts`, `frontend/src/audio/FakePlayer.ts`, `frontend/src/audio/createPlayer.ts`, `frontend/src/audio/useAudioPlayer.ts`, `frontend/src/audio/useHostPlayback.ts`, `frontend/src/audio/volume.ts`
- Create: `frontend/src/test/fakePlayer.ts`, `frontend/src/test/snapshots.ts`
- Test: `frontend/src/audio/players.test.ts`, `frontend/src/audio/hooks.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1: the spike results. This task assumes PLAYING plus `currentTime ≥ startSec − 1` is reported only for real content, and that resizing with CSS does not reload the iframe.
  - Task 16: `emitAck`, `HostSnapshot`, `HostRound`, `PREPARE_TIMEOUT_MS`, `installFakeSocket`.
- Produces:
  - `Clip {videoId, startSec, endSec}` and the `AudioPlayer` interface: `load(clip)`, `onPlaying(cb)` (fires once per `load`, when the clip itself is playing), `onError(cb(code))`, `setVolume(0..100)`, `stop()`, `currentTime()`, `destroy()`. `onPlaying` and `onError` replace the previous callback.
  - `isFatalError(code)` (YouTube codes 2, 5, 100, 101, 150).
  - `YouTubePlayer(container)`: appends its own `<div>` to `container`, so React never owns the iframe, and creates exactly one `YT.Player`. `loadYouTubeApi()` injects the IFrame API script once.
  - `FakePlayer(container, {autoPlayMs?})`: records `loads`, `stopCount`, `volume` and `destroyed`, and offers `emitPlaying()` / `emitError(code)`. It renders `data-testid="fake-player"` showing the loaded `videoId`. With `autoPlayMs` set, it calls `onPlaying` that many ms after each load (used by E2E).
  - `createPlayer(container)` returns a `FakePlayer` with `autoPlayMs: 300` when `VITE_FAKE_PLAYER=1`, and a `YouTubePlayer` otherwise. `setPlayerFactoryForTests(factory | null)` overrides it.
  - `useAudioPlayer(containerRef)` creates the player once the container is mounted and destroys it on unmount. It returns `AudioPlayer | null`.
  - `useHostPlayback(player, snapshot)`:
    - In PREPARING it loads `round`'s clip once per `prepareSeq`. On the first `onPlaying` it sends `host:audio_started {roundIndex}`.
    - On a fatal error it sends `host:audio_failed {roundIndex, reason: 'ERROR_<code>'}`. With no playback after `PREPARE_TIMEOUT_MS` it sends `host:audio_failed {roundIndex, reason: 'TIMEOUT'}`. Only one report is sent per load.
    - In LOBBY, CALIBRATING and FINISHED it calls `stop()`. ANSWERING and REVEAL keep the clip playing.
  - `loadVolume()` (default 80, clamped to 0–100) and `saveVolume(v)` use the localStorage key `animequiz:volume`.
  - Test helpers: `installFakePlayer()` returns the array of `FakePlayer`s created after it is called. `hostRound(patch?)` and `hostSnapshot(patch?)` build complete host snapshots: code `K7M2QX`, LOBBY, 2 questions, round 0 with options `['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']`, `startSec` 30, `endSec` 60, `prepareSeq` 1.

- [ ] **Step 1: Write the test helpers and the failing tests**

```ts
import type { HostRound, HostSnapshot } from '../lib/protocol'

// Snapshot đầy đủ trường (trường không áp dụng là null), sửa bằng patch cho từng test.
export function hostRound(patch: Partial<HostRound> = {}): HostRound {
  return {
    index: 0,
    total: 2,
    videoId: 'AAAAAAAAAAA',
    startSec: 30,
    endSec: 60,
    options: ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach'],
    deadline: null,
    answeredCount: 0,
    onlineCount: 2,
    prepareSeq: 1,
    reveal: null,
    ...patch,
  }
}

export function hostSnapshot(patch: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    code: 'K7M2QX',
    phase: 'LOBBY',
    mode: 'stream',
    settings: { questionCount: 2, clipSec: 15, revealSec: 15, maxPlayers: 30, mode: 'stream' },
    serverNow: Date.now(),
    players: [],
    calib: null,
    round: null,
    leaderboard: [],
    notice: null,
    ...patch,
  }
}
```

```ts
import { setPlayerFactoryForTests } from '../audio/createPlayer'
import { FakePlayer } from '../audio/FakePlayer'

// Mọi player tạo ra sau lời gọi này là FakePlayer (không tự phát); mảng trả về chứa chúng theo thứ tự tạo.
export function installFakePlayer(): FakePlayer[] {
  const created: FakePlayer[] = []
  setPlayerFactoryForTests((container) => {
    const player = new FakePlayer(container)
    created.push(player)
    return player
  })
  return created
}
```

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isFatalError } from './AudioPlayer'
import { FakePlayer } from './FakePlayer'
import { DEFAULT_VOLUME, loadVolume, saveVolume } from './volume'
import { loadYouTubeApi, YouTubePlayer, type YTNamespace } from './YouTubePlayer'

interface FakeOptions {
  width: string
  height: string
  playerVars: Record<string, number>
  events: { onReady: () => void; onError: (event: { data: number }) => void }
}

// Thay cho YT.Player thật: test điều khiển state/currentTime và gọi các event.
class FakeYT {
  static instances: FakeYT[] = []
  element: HTMLElement
  options: FakeOptions
  state = -1
  time = 0
  volume = 100
  loads: unknown[] = []
  stops = 0
  destroyed = false

  constructor(element: HTMLElement, options: FakeOptions) {
    this.element = element
    this.options = options
    FakeYT.instances.push(this)
  }

  loadVideoById(args: unknown) {
    this.loads.push(args)
  }

  stopVideo() {
    this.stops += 1
  }

  getPlayerState() {
    return this.state
  }

  getCurrentTime() {
    return this.time
  }

  setVolume(volume: number) {
    this.volume = volume
  }

  destroy() {
    this.destroyed = true
  }
}

const installYT = () => {
  window.YT = { Player: FakeYT, PlayerState: { PLAYING: 1 } } as unknown as YTNamespace
}

const clip = { videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }

async function readyPlayer() {
  const container = document.createElement('div')
  const player = new YouTubePlayer(container)
  await vi.waitFor(() => expect(FakeYT.instances).toHaveLength(1))
  const yt = FakeYT.instances[0]
  return { container, player, yt }
}

beforeEach(() => {
  FakeYT.instances = []
})

afterEach(() => {
  delete window.YT
  vi.useRealTimers()
})

describe('loadYouTubeApi', () => {
  // Chạy trước các test khác trong file: các test sau gán sẵn window.YT nên không chèn script nữa.
  it('injects the IFrame API script once and resolves when it is ready', async () => {
    const first = loadYouTubeApi()
    expect(loadYouTubeApi()).toBe(first)
    expect(document.querySelectorAll('script[src="https://www.youtube.com/iframe_api"]')).toHaveLength(1)
    installYT()
    window.onYouTubeIframeAPIReady?.()
    await expect(first).resolves.toBe(window.YT)
  })
})

describe('YouTubePlayer', () => {
  beforeEach(installYT)

  it('creates one player with the spec player vars inside its own element', async () => {
    const { container, player, yt } = await readyPlayer()
    expect(yt.options.playerVars).toEqual({ controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 })
    expect(yt.element.parentElement).toBe(container)
    player.destroy()
    expect(yt.destroyed).toBe(true)
    expect(container.childElementCount).toBe(0)
  })

  it('queues a load until the player is ready and applies the volume', async () => {
    const { player, yt } = await readyPlayer()
    player.setVolume(35)
    player.load(clip)
    expect(yt.loads).toEqual([])
    yt.options.events.onReady()
    expect(yt.loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSeconds: 30, endSeconds: 60 }])
    expect(yt.volume).toBe(35)
  })

  it('reports playing once, and only when the clip itself (not an ad) is playing', async () => {
    vi.useFakeTimers()
    const { player, yt } = await readyPlayer()
    yt.options.events.onReady()
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)

    yt.state = 1
    yt.time = 3 // quảng cáo: PLAYING nhưng chưa tới đoạn nhạc
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).not.toHaveBeenCalled()

    yt.time = 29.2
    await vi.advanceTimersByTimeAsync(250)
    expect(playing).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).toHaveBeenCalledTimes(1)
  })

  it('forwards errors, and stop() cancels the pending report', async () => {
    vi.useFakeTimers()
    const { player, yt } = await readyPlayer()
    yt.options.events.onReady()
    const playing = vi.fn()
    const error = vi.fn()
    player.onPlaying(playing)
    player.onError(error)
    player.load(clip)

    yt.options.events.onError({ data: 150 })
    expect(error).toHaveBeenCalledWith(150)

    player.stop()
    expect(yt.stops).toBe(1)
    yt.state = 1
    yt.time = 31
    await vi.advanceTimersByTimeAsync(1000)
    expect(playing).not.toHaveBeenCalled()
  })
})

describe('isFatalError', () => {
  it('treats the YouTube codes from the spec as fatal', () => {
    expect([2, 5, 100, 101, 150].every(isFatalError)).toBe(true)
    expect(isFatalError(3)).toBe(false)
  })
})

describe('FakePlayer', () => {
  it('shows the loaded clip and auto-plays after the configured delay', async () => {
    vi.useFakeTimers()
    const container = document.createElement('div')
    const player = new FakePlayer(container, { autoPlayMs: 300 })
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)
    expect(container.querySelector('[data-testid="fake-player"]')).toHaveTextContent('AAAAAAAAAAA')
    await vi.advanceTimersByTimeAsync(299)
    expect(playing).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(playing).toHaveBeenCalledTimes(1)
    expect(player.currentTime()).toBe(30)
  })

  it('waits for emitPlaying() when auto-play is off and cancels on stop', async () => {
    vi.useFakeTimers()
    const player = new FakePlayer(document.createElement('div'))
    const playing = vi.fn()
    player.onPlaying(playing)
    player.load(clip)
    await vi.advanceTimersByTimeAsync(5000)
    expect(playing).not.toHaveBeenCalled()
    player.emitPlaying()
    expect(playing).toHaveBeenCalledTimes(1)
    player.stop()
    expect(player.stopCount).toBe(1)
    expect(player.currentTime()).toBe(0)
  })
})

describe('volume', () => {
  it('defaults to 80, persists and clamps', () => {
    expect(loadVolume()).toBe(DEFAULT_VOLUME)
    saveVolume(35)
    expect(loadVolume()).toBe(35)
    localStorage.setItem('animequiz:volume', '250')
    expect(loadVolume()).toBe(100)
    localStorage.setItem('animequiz:volume', 'abc')
    expect(loadVolume()).toBe(DEFAULT_VOLUME)
  })
})
```

```tsx
import { render, renderHook, screen, within } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostRound, HostSnapshot } from '../lib/protocol'
import { installFakePlayer } from '../test/fakePlayer'
import { installFakeSocket, type FakeSocket } from '../test/fakeSocket'
import { hostRound, hostSnapshot } from '../test/snapshots'
import { FakePlayer } from './FakePlayer'
import { useAudioPlayer } from './useAudioPlayer'
import { useHostPlayback } from './useHostPlayback'

const preparing = (patch: Partial<HostRound> = {}) => hostSnapshot({ phase: 'PREPARING', round: hostRound(patch) })

let socket: FakeSocket
let player: FakePlayer

function renderPlayback(snapshot: HostSnapshot | null) {
  return renderHook((props: { snapshot: HostSnapshot | null }) => useHostPlayback(player, props.snapshot), {
    initialProps: { snapshot },
  })
}

beforeEach(() => {
  socket = installFakeSocket()
  player = new FakePlayer(document.createElement('div'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useHostPlayback', () => {
  it('loads the clip once per prepareSeq and reports audio_started once', () => {
    const { rerender } = renderPlayback(preparing())
    expect(player.loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }])

    rerender({ snapshot: preparing({ answeredCount: 0 }) }) // snapshot mới, cùng prepareSeq
    expect(player.loads).toHaveLength(1)

    player.emitPlaying()
    player.emitPlaying()
    expect(socket.payloads('host:audio_started')).toEqual([{ roundIndex: 0 }])
  })

  it('reloads when prepareSeq changes (replay or replacement)', () => {
    const { rerender } = renderPlayback(preparing())
    rerender({ snapshot: preparing({ prepareSeq: 2, videoId: 'BBBBBBBBBBB', startSec: 10, endSec: 40 }) })
    expect(player.loads.map((clip) => clip.videoId)).toEqual(['AAAAAAAAAAA', 'BBBBBBBBBBB'])
  })

  it('reports fatal player errors as audio_failed and ignores the rest', () => {
    renderPlayback(preparing({ index: 1 }))
    player.emitError(3)
    expect(socket.payloads('host:audio_failed')).toEqual([])
    player.emitError(150)
    player.emitError(100)
    expect(socket.payloads('host:audio_failed')).toEqual([{ roundIndex: 1, reason: 'ERROR_150' }])
  })

  it('reports TIMEOUT when the clip has not started after 10 seconds', async () => {
    vi.useFakeTimers()
    renderPlayback(preparing())
    await vi.advanceTimersByTimeAsync(9_999)
    expect(socket.payloads('host:audio_failed')).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(socket.payloads('host:audio_failed')).toEqual([{ roundIndex: 0, reason: 'TIMEOUT' }])
  })

  it('keeps playing through ANSWERING and REVEAL without reporting again', async () => {
    vi.useFakeTimers()
    const { rerender } = renderPlayback(preparing())
    player.emitPlaying()
    rerender({ snapshot: hostSnapshot({ phase: 'ANSWERING', round: hostRound({ deadline: Date.now() + 18_000 }) }) })
    rerender({ snapshot: hostSnapshot({ phase: 'REVEAL', round: hostRound() }) })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(player.loads).toHaveLength(1)
    expect(player.stopCount).toBe(0)
    expect(socket.payloads('host:audio_started')).toHaveLength(1)
    expect(socket.payloads('host:audio_failed')).toEqual([])
  })

  it('stops the player in the lobby and when the game is finished', () => {
    const { rerender } = renderPlayback(hostSnapshot())
    expect(player.stopCount).toBe(1)
    rerender({ snapshot: preparing() })
    rerender({ snapshot: hostSnapshot({ phase: 'FINISHED' }) })
    expect(player.stopCount).toBe(2)
  })
})

function Stage() {
  const ref = useRef<HTMLDivElement>(null)
  const player = useAudioPlayer(ref)
  return <div ref={ref} data-testid="stage" data-ready={player ? 'yes' : 'no'} />
}

describe('useAudioPlayer', () => {
  it('creates the player inside the container and destroys it on unmount', () => {
    const players = installFakePlayer()
    const { unmount } = render(<Stage />)
    const stage = screen.getByTestId('stage')
    expect(stage).toHaveAttribute('data-ready', 'yes')
    expect(within(stage).getByTestId('fake-player')).toBeInTheDocument()
    expect(players).toHaveLength(1)
    unmount()
    expect(players[0].destroyed).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/audio`
Expected: FAIL, `Failed to resolve import "./AudioPlayer"` (players.test.ts) and `"./FakePlayer"` (hooks.test.tsx).

- [ ] **Step 3: Write the player interface and the two players**

```ts
// Interface phát nhạc ở tab quản trò (spec mục 5.1). Chỉ có 1 player cho cả ván.

export interface Clip {
  videoId: string
  startSec: number
  endSec: number
}

export interface AudioPlayer {
  load(clip: Clip): void
  // Gọi 1 lần cho mỗi load, khi chính đoạn nhạc (không phải quảng cáo) đang phát.
  onPlaying(callback: () => void): void
  onError(callback: (code: number) => void): void
  setVolume(volume: number): void
  stop(): void
  currentTime(): number
  destroy(): void
}

// Mã lỗi YouTube: 2 tham số sai, 5 lỗi HTML5, 100 không tìm thấy, 101/150 chủ video chặn nhúng.
export const FATAL_ERROR_CODES: readonly number[] = [2, 5, 100, 101, 150]

export const isFatalError = (code: number) => FATAL_ERROR_CODES.includes(code)

// Quảng cáo cũng ở trạng thái PLAYING nhưng currentTime gần 0, nên chờ tới gần startSec.
export const START_TOLERANCE_SEC = 1
```

```ts
import { START_TOLERANCE_SEC, type AudioPlayer, type Clip } from './AudioPlayer'

// Phần nhỏ của YouTube IFrame API mà app dùng.
interface YTPlayer {
  loadVideoById(args: { videoId: string; startSeconds: number; endSeconds: number }): void
  stopVideo(): void
  getPlayerState(): number
  getCurrentTime(): number
  setVolume(volume: number): void
  destroy(): void
}

interface YTPlayerOptions {
  width: string
  height: string
  playerVars: Record<string, number>
  events: { onReady: () => void; onError: (event: { data: number }) => void }
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer
  PlayerState: { PLAYING: number }
}

declare global {
  interface Window {
    YT?: YTNamespace
    onYouTubeIframeAPIReady?: () => void
  }
}

const API_SRC = 'https://www.youtube.com/iframe_api'
const PLAYER_VARS = { controls: 0, disablekb: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1 }
const POLL_MS = 250

let apiPromise: Promise<YTNamespace> | null = null

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      resolve(window.YT!)
    }
    const script = document.createElement('script')
    script.src = API_SRC
    script.onerror = () => console.error('Không tải được YouTube IFrame API')
    document.head.append(script)
  })
  return apiPromise
}

export class YouTubePlayer implements AudioPlayer {
  private readonly element: HTMLDivElement
  private player: YTPlayer | null = null
  private playingState = 1
  private ready = false
  private destroyed = false
  private pending: Clip | null = null
  private clip: Clip | null = null
  private poll: ReturnType<typeof setInterval> | null = null
  private volume = 100
  private playingCallback = () => {}
  private errorCallback: (code: number) => void = () => {}

  constructor(container: HTMLElement) {
    // Div này do player tự tạo, React không quản lý, nên iframe không bao giờ bị gỡ hay di chuyển.
    this.element = document.createElement('div')
    container.append(this.element)
    void loadYouTubeApi().then((YT) => {
      if (this.destroyed) return
      this.playingState = YT.PlayerState.PLAYING
      this.player = new YT.Player(this.element, {
        width: '100%',
        height: '100%',
        playerVars: PLAYER_VARS,
        events: {
          onReady: () => {
            this.ready = true
            this.player?.setVolume(this.volume)
            if (this.pending) this.load(this.pending)
          },
          onError: (event) => this.errorCallback(event.data),
        },
      })
    })
  }

  load(clip: Clip): void {
    this.stopPolling()
    if (!this.player || !this.ready) {
      this.pending = clip
      return
    }
    this.pending = null
    this.clip = clip
    this.player.loadVideoById({ videoId: clip.videoId, startSeconds: clip.startSec, endSeconds: clip.endSec })
    this.poll = setInterval(() => this.check(), POLL_MS)
  }

  onPlaying(callback: () => void): void {
    this.playingCallback = callback
  }

  onError(callback: (code: number) => void): void {
    this.errorCallback = callback
  }

  setVolume(volume: number): void {
    this.volume = volume
    if (this.ready) this.player?.setVolume(volume)
  }

  stop(): void {
    this.pending = null
    this.clip = null
    this.stopPolling()
    if (this.ready) this.player?.stopVideo()
  }

  currentTime(): number {
    return this.ready && this.player ? this.player.getCurrentTime() : 0
  }

  destroy(): void {
    this.destroyed = true
    this.stopPolling()
    this.player?.destroy()
    this.element.remove()
  }

  private check(): void {
    if (!this.player || !this.clip) return
    const playing = this.player.getPlayerState() === this.playingState
    if (playing && this.player.getCurrentTime() >= this.clip.startSec - START_TOLERANCE_SEC) {
      this.clip = null
      this.stopPolling()
      this.playingCallback()
    }
  }

  private stopPolling(): void {
    if (this.poll !== null) clearInterval(this.poll)
    this.poll = null
  }
}
```

`YT.Player` replaces `this.element` with its iframe, so `element.remove()` in `destroy()` is only a fallback for a player that was never created.

```ts
import type { AudioPlayer, Clip } from './AudioPlayer'

interface Options {
  // Số ms sau mỗi load thì tự gọi onPlaying; null = chờ test gọi emitPlaying().
  autoPlayMs?: number | null
}

// Player giả cho unit test và E2E (VITE_FAKE_PLAYER=1): không tải YouTube, không phát tiếng.
export class FakePlayer implements AudioPlayer {
  loads: Clip[] = []
  stopCount = 0
  volume = 100
  destroyed = false
  private readonly screen: HTMLDivElement
  private readonly autoPlayMs: number | null
  private clip: Clip | null = null
  private startedAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private playingCallback = () => {}
  private errorCallback: (code: number) => void = () => {}

  constructor(container: HTMLElement, { autoPlayMs = null }: Options = {}) {
    this.autoPlayMs = autoPlayMs
    this.screen = document.createElement('div')
    this.screen.dataset.testid = 'fake-player'
    this.screen.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#000'
    container.append(this.screen)
  }

  load(clip: Clip): void {
    this.clearTimer()
    this.clip = clip
    this.startedAt = null
    this.loads.push(clip)
    this.screen.textContent = `▶ ${clip.videoId} (${clip.startSec}s → ${clip.endSec}s)`
    if (this.autoPlayMs !== null) this.timer = setTimeout(() => this.emitPlaying(), this.autoPlayMs)
  }

  emitPlaying(): void {
    this.startedAt = Date.now()
    this.playingCallback()
  }

  emitError(code: number): void {
    this.errorCallback(code)
  }

  onPlaying(callback: () => void): void {
    this.playingCallback = callback
  }

  onError(callback: (code: number) => void): void {
    this.errorCallback = callback
  }

  setVolume(volume: number): void {
    this.volume = volume
  }

  stop(): void {
    this.clearTimer()
    this.clip = null
    this.stopCount += 1
    this.screen.textContent = ''
  }

  currentTime(): number {
    if (!this.clip) return 0
    return this.clip.startSec + (this.startedAt === null ? 0 : (Date.now() - this.startedAt) / 1000)
  }

  destroy(): void {
    this.clearTimer()
    this.destroyed = true
    this.screen.remove()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
```

```ts
const KEY = 'animequiz:volume'
export const DEFAULT_VOLUME = 80

export function loadVolume(): number {
  const raw = localStorage.getItem(KEY)
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_VOLUME
}

export function saveVolume(volume: number): void {
  localStorage.setItem(KEY, String(volume))
}
```

- [ ] **Step 4: Write the factory and the hooks**

```ts
import type { AudioPlayer } from './AudioPlayer'
import { FakePlayer } from './FakePlayer'
import { YouTubePlayer } from './YouTubePlayer'

type Factory = (container: HTMLElement) => AudioPlayer

// E2E chạy với VITE_FAKE_PLAYER=1: player giả tự "phát" sau 300 ms.
const FAKE_AUTOPLAY_MS = 300

let factoryOverride: Factory | null = null

export function setPlayerFactoryForTests(factory: Factory | null): void {
  factoryOverride = factory
}

export function createPlayer(container: HTMLElement): AudioPlayer {
  if (factoryOverride) return factoryOverride(container)
  if (import.meta.env.VITE_FAKE_PLAYER === '1') return new FakePlayer(container, { autoPlayMs: FAKE_AUTOPLAY_MS })
  return new YouTubePlayer(container)
}
```

```ts
import { useEffect, useState, type RefObject } from 'react'
import type { AudioPlayer } from './AudioPlayer'
import { createPlayer } from './createPlayer'

// Tạo đúng 1 player khi container đã mount; container phải luôn được render và không có con do React quản lý.
export function useAudioPlayer(containerRef: RefObject<HTMLElement | null>): AudioPlayer | null {
  const [player, setPlayer] = useState<AudioPlayer | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const created = createPlayer(container)
    setPlayer(created)
    return () => {
      created.destroy()
      setPlayer(null)
    }
  }, [containerRef])

  return player
}
```

```ts
import { useEffect } from 'react'
import { PREPARE_TIMEOUT_MS, type HostSnapshot } from '../lib/protocol'
import { emitAck } from '../lib/socket'
import { isFatalError, type AudioPlayer } from './AudioPlayer'

// Nối snapshot của quản trò với player: nạp bài ở PREPARING, báo audio_started / audio_failed, dừng khi rời câu.
export function useHostPlayback(player: AudioPlayer | null, snapshot: HostSnapshot | null): void {
  const phase = snapshot?.phase ?? null
  const round = snapshot?.round ?? null
  const preparing = phase === 'PREPARING' && round !== null
  const idle = phase === 'LOBBY' || phase === 'CALIBRATING' || phase === 'FINISHED'

  // Snapshot đến liên tục; chỉ nạp lại khi prepareSeq đổi (câu mới, phát lại, hoặc bài thay thế).
  const prepareSeq = preparing ? round.prepareSeq : null
  const roundIndex = round?.index ?? -1
  const videoId = round?.videoId ?? ''
  const startSec = round?.startSec ?? 0
  const endSec = round?.endSec ?? 0

  useEffect(() => {
    if (!player || prepareSeq === null) return
    let reported = false
    const report = (event: string, payload: object) => {
      if (reported) return
      reported = true
      clearTimeout(timer)
      void emitAck(event, payload)
    }
    player.onPlaying(() => report('host:audio_started', { roundIndex }))
    player.onError((code) => {
      if (isFatalError(code)) report('host:audio_failed', { roundIndex, reason: `ERROR_${code}` })
    })
    const timer = setTimeout(
      () => report('host:audio_failed', { roundIndex, reason: 'TIMEOUT' }),
      PREPARE_TIMEOUT_MS,
    )
    player.load({ videoId, startSec, endSec })
    return () => {
      // Rời PREPARING: nhạc vẫn phát tiếp (ANSWERING/REVEAL) nhưng không báo gì nữa.
      reported = true
      clearTimeout(timer)
    }
  }, [player, prepareSeq, roundIndex, videoId, startSec, endSec])

  useEffect(() => {
    if (player && idle) player.stop()
  }, [player, idle])
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  18 passed (18)`, `Tests  99 passed (99)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add YouTube/fake audio players and host playback hook"
```

---

### Task 22: Host phase screens (lobby, calibration, question, results)

**Files:**
- Create: `frontend/src/lib/beep.ts`
- Create: `frontend/src/pages/host/useHostCommand.ts`, `frontend/src/pages/host/HostLobby.tsx`, `frontend/src/pages/host/HostCalibration.tsx`, `frontend/src/pages/host/HostQuestion.tsx`, `frontend/src/pages/host/HostFinished.tsx`
- Test: `frontend/src/pages/host/hostPhases.test.tsx`

**Interfaces:**
- Consumes:
  - Task 16: `emitAck`, `errorMessage`, `remainingMs`, `useNow`, `GRACE_MS`, `CALIB_ROUNDS`, the `HostSnapshot` / `HostRound` / `HostCalib` / `HostPlayer` types, and `installFakeSocket`.
  - Task 18: `AnswerTile`, `Leaderboard`, `Podium`, `CountdownRing`, `DelayBadge`.
  - Task 21: `hostSnapshot`, `hostRound` (test helpers).
- Produces (all named exports; Task 23 wires them into `HostScreen`):
  - `beep()`: an 880 Hz, 200 ms WebAudio tone. It does nothing where `AudioContext` is missing (jsdom).
  - `useHostCommand()` returns `{run(event, payload = {}): Promise<boolean>, error, busy}`. It shows `errorMessage(code)` when the ack fails.
  - `HostLobby({snapshot})`:
    - Shows the code (`data-testid="room-code"`), the join link `<origin>/play/<code>`, a QR code titled "Mã QR vào phòng", and the players with `DelayBadge`. Offline players have `data-online="false"`.
    - Kick asks `window.confirm('Mời <name> ra khỏi phòng?')` and then sends `host:kick {playerId}`.
    - Shows a settings summary.
    - "Đo độ trễ" sends `host:calibrate` and needs ≥ 1 online player. "Bắt đầu" sends `host:start` and needs ≥ 1 player.
  - `HostCalibration({calib, players})`:
    - Shows "Đo độ trễ · Lượt k/3". After `waitMs` it counts "3", "2", "1" (1 s each), then shows **BẤM!**, calls `beep()` and sends `host:calib_flash {round}` once.
    - After the flash it shows "x/y người đã bấm" (y = online players).
    - Mount it with `key={calib.round}` so each round starts fresh.
  - `HostQuestion({snapshot, round, offset})`:
    - PREPARING: "Câu i/N: chuẩn bị…".
    - ANSWERING: heading "Câu i/N", `CountdownRing` (total `clipSec·1000 + GRACE_MS`), 4 display-only tiles, and "x/y đã trả lời".
    - REVEAL: the anime name as a heading, the song label, tiles with `correct`/`dimmed` state and counts, the top 10 `Leaderboard`, and "Câu tiếp →" (or "Xem kết quả" on the last question), which sends `host:next`.
    - Every phase has "Phát lại câu này", which asks `window.confirm` and then sends `host:replay_round`.
    - In REVEAL the left 58vw stay empty for the video stage that `HostScreen` positions there.
  - `HostFinished({snapshot, onClose})`: heading "Kết quả chung cuộc", `Podium`, full `Leaderboard`, "Chơi lại" (sends `host:play_again`) and "Đóng phòng" (calls `onClose`).

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beep } from '../../lib/beep'
import type { HostPlayer, LeaderboardRow } from '../../lib/protocol'
import { installFakeSocket } from '../../test/fakeSocket'
import { hostRound, hostSnapshot } from '../../test/snapshots'
import { HostCalibration } from './HostCalibration'
import { HostFinished } from './HostFinished'
import { HostLobby } from './HostLobby'
import { HostQuestion } from './HostQuestion'

vi.mock('../../lib/beep', () => ({ beep: vi.fn() }))

const players: HostPlayer[] = [
  { id: 'p1', name: 'Mai', online: true, delayMs: 1200, calibrated: true, score: 870 },
  { id: 'p2', name: 'Long', online: false, delayMs: 800, calibrated: false, score: 0 },
]

const leaderboard: LeaderboardRow[] = [
  { playerId: 'p1', name: 'Mai', score: 870, rank: 1, gained: 870 },
  { playerId: 'p2', name: 'Long', score: 0, rank: 2, gained: 0 },
]

const reveal = {
  correctIndex: 0,
  optionCounts: [1, 1, 0, 0],
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.mocked(beep).mockClear()
})

describe('HostLobby', () => {
  it('shows the room code, join link, QR code and players with their delay', () => {
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    expect(screen.getByTestId('room-code')).toHaveTextContent('K7M2QX')
    expect(screen.getByText(`${window.location.origin}/play/K7M2QX`)).toBeInTheDocument()
    expect(screen.getByTitle('Mã QR vào phòng')).toBeInTheDocument()
    expect(screen.getByText('Người chơi (2/30)')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
    expect(screen.getByText('~0.8s')).toBeInTheDocument()
    expect(screen.getByText('Long').closest('li')).toHaveAttribute('data-online', 'false')
    expect(screen.getByText('2 câu · nhạc 15 giây · công bố 15 giây')).toBeInTheDocument()
  })

  it('kicks a player after confirmation', async () => {
    const socket = installFakeSocket()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    const kick = screen.getByRole('button', { name: 'Mời Mai ra khỏi phòng' })
    await userEvent.click(kick)
    expect(socket.payloads('host:kick')).toEqual([])
    await userEvent.click(kick)
    expect(socket.payloads('host:kick')).toEqual([{ playerId: 'p1' }])
    expect(window.confirm).toHaveBeenCalledWith('Mời Mai ra khỏi phòng?')
  })

  it('needs players to start and online players to calibrate', () => {
    const { rerender } = render(<HostLobby snapshot={hostSnapshot()} />)
    expect(screen.getByText(/Chưa có ai vào phòng/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Đo độ trễ' })).toBeDisabled()

    rerender(<HostLobby snapshot={hostSnapshot({ players: [players[1]] })} />)
    expect(screen.getByRole('button', { name: 'Bắt đầu' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Đo độ trễ' })).toBeDisabled()
  })

  it('sends calibrate and start, and shows a failed ack', async () => {
    const socket = installFakeSocket()
    socket.reply('host:start', { ok: false, error: 'INVALID_STATE' })
    render(<HostLobby snapshot={hostSnapshot({ players })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Đo độ trễ' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bắt đầu' }))
    expect(socket.payloads('host:calibrate')).toEqual([{}])
    expect(socket.payloads('host:start')).toEqual([{}])
    expect(await screen.findByRole('alert')).toHaveTextContent('Thao tác không hợp lệ lúc này')
  })
})

describe('HostCalibration', () => {
  it('counts down 3, 2, 1 after waitMs, then flashes BẤM! with a beep', async () => {
    vi.useFakeTimers()
    const socket = installFakeSocket()
    render(<HostCalibration calib={{ round: 2, waitMs: 2500, flashed: false, tappedCount: 0 }} players={players} />)
    expect(screen.getByText('Đo độ trễ · Lượt 2/3')).toBeInTheDocument()
    expect(screen.getByText('Chuẩn bị…')).toBeInTheDocument()

    for (const [ms, text] of [
      [2500, '3'],
      [1000, '2'],
      [1000, '1'],
    ] as const) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
      })
      expect(screen.getByText(text)).toBeInTheDocument()
    }
    expect(socket.payloads('host:calib_flash')).toEqual([])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('BẤM!')).toBeInTheDocument()
    expect(beep).toHaveBeenCalledTimes(1)
    expect(socket.payloads('host:calib_flash')).toEqual([{ round: 2 }])
  })

  it('shows how many online players have tapped after the flash', () => {
    render(<HostCalibration calib={{ round: 1, waitMs: 3000, flashed: true, tappedCount: 1 }} players={players} />)
    expect(screen.getByText('BẤM!')).toBeInTheDocument()
    expect(screen.getByText('1/1 người đã bấm')).toBeInTheDocument()
    expect(beep).not.toHaveBeenCalled()
  })
})

describe('HostQuestion', () => {
  it('shows the preparing message and lets the host replay after confirming', async () => {
    const socket = installFakeSocket()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const round = hostRound()
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'PREPARING', round })} round={round} offset={0} />)
    expect(screen.getByText('Câu 1/2: chuẩn bị…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Phát lại câu này' }))
    expect(window.confirm).toHaveBeenCalledWith('Phát lại câu này? Câu trả lời của câu này sẽ bị hủy.')
    expect(socket.payloads('host:replay_round')).toEqual([{}])
  })

  it('shows the options, the countdown and the answer count while answering', () => {
    const round = hostRound({ deadline: Date.now() + 18_000, answeredCount: 1, onlineCount: 2 })
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'ANSWERING', round })} round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 1/2' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName('Còn 18 giây')
    for (const option of ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']) {
      expect(screen.getByText(option)).toBeInTheDocument()
    }
    expect(screen.getByText('1/2 đã trả lời')).toBeInTheDocument()
  })

  it('reveals the answer, the counts and the top 10, then moves on', async () => {
    const socket = installFakeSocket()
    const round = hostRound({ reveal })
    const { container } = render(
      <HostQuestion snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard })} round={round} offset={0} />,
    )
    expect(screen.getByRole('heading', { name: 'Shingeki no Kyojin' })).toBeInTheDocument()
    expect(screen.getByText('OP1 · Guren no Yumiya')).toBeInTheDocument()
    const tiles = [...container.querySelectorAll('[data-state]')]
    expect(tiles.map((tile) => tile.getAttribute('data-state'))).toEqual(['correct', 'dimmed', 'dimmed', 'dimmed'])
    expect(tiles[1]).toHaveTextContent('Naruto1')
    expect(screen.getByText('+870')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Câu tiếp →' }))
    expect(socket.payloads('host:next')).toEqual([{}])
  })

  it('labels the last next button "Xem kết quả"', () => {
    const round = hostRound({ index: 1, total: 2, reveal })
    render(<HostQuestion snapshot={hostSnapshot({ phase: 'REVEAL', round, leaderboard })} round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 2/2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Xem kết quả' })).toBeInTheDocument()
  })
})

describe('HostFinished', () => {
  it('shows the podium and the full leaderboard, and offers replay or close', async () => {
    const socket = installFakeSocket()
    const onClose = vi.fn()
    render(<HostFinished snapshot={hostSnapshot({ phase: 'FINISHED', leaderboard })} onClose={onClose} />)
    expect(screen.getByRole('heading', { name: /Kết quả chung cuộc/ })).toBeInTheDocument()
    expect(screen.getByText('🥇')).toBeInTheDocument()
    expect(screen.getAllByText('Mai')).toHaveLength(2) // bục vinh quang + bảng xếp hạng
    await userEvent.click(screen.getByRole('button', { name: 'Chơi lại' }))
    expect(socket.payloads('host:play_again')).toEqual([{}])
    await userEvent.click(screen.getByRole('button', { name: 'Đóng phòng' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/pages/host`
Expected: FAIL, `Failed to resolve import "../../lib/beep"`.

- [ ] **Step 3: Write `beep` and `useHostCommand`**

```ts
let context: AudioContext | null = null

// Tiếng bíp lúc hiện BẤM! khi đo độ trễ. Trình duyệt không có WebAudio thì bỏ qua.
export function beep(frequency = 880, durationMs = 200): void {
  if (typeof AudioContext === 'undefined') return
  context ??= new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = frequency
  gain.gain.value = 0.3
  oscillator.connect(gain).connect(context.destination)
  oscillator.start()
  oscillator.stop(context.currentTime + durationMs / 1000)
}
```

```ts
import { useState } from 'react'
import { errorMessage } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

// Gửi lệnh của quản trò; snapshot mới đến qua room:state, ở đây chỉ giữ lỗi để hiện.
export function useHostCommand() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (event: string, payload: object = {}): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const response = await emitAck(event, payload)
    setBusy(false)
    if (!response.ok) setError(errorMessage(response.error))
    return response.ok
  }

  return { run, error, busy }
}
```

- [ ] **Step 4: Write the phase screens**

```tsx
import { QRCodeSVG } from 'qrcode.react'
import { DelayBadge } from '../../components/DelayBadge'
import type { HostPlayer, HostSnapshot } from '../../lib/protocol'
import { useHostCommand } from './useHostCommand'

export function HostLobby({ snapshot }: { snapshot: HostSnapshot }) {
  const { code, players, settings } = snapshot
  const { run, error, busy } = useHostCommand()
  const link = `${window.location.origin}/play/${code}`
  const onlineCount = players.filter((player) => player.online).length

  const kick = (player: HostPlayer) => {
    if (window.confirm(`Mời ${player.name} ra khỏi phòng?`)) void run('host:kick', { playerId: player.id })
  }

  return (
    <div className="grid gap-8 p-8 lg:grid-cols-[auto_1fr]">
      <section className="flex flex-col items-center gap-4 rounded-3xl bg-slate-900 p-8">
        <p className="text-xl text-slate-400">Mã phòng</p>
        <p data-testid="room-code" className="font-mono text-7xl font-black tracking-[0.2em]">
          {code}
        </p>
        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG value={link} size={200} title="Mã QR vào phòng" />
        </div>
        <p className="text-lg text-sky-300">{link}</p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-3xl font-bold">
          Người chơi ({players.length}/{settings.maxPlayers})
        </h2>
        {players.length === 0 ? (
          <p className="text-xl text-slate-400">Chưa có ai vào phòng. Gửi mã hoặc link cho người chơi nhé!</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {players.map((player) => (
              <li
                key={player.id}
                data-online={player.online}
                className="flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-3 text-xl data-[online=false]:opacity-40"
              >
                <span className="flex-1 truncate">{player.name}</span>
                <DelayBadge delayMs={player.delayMs} calibrated={player.calibrated} />
                <button
                  type="button"
                  onClick={() => kick(player)}
                  aria-label={`Mời ${player.name} ra khỏi phòng`}
                  className="px-1 text-slate-400 hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="text-lg text-slate-400">
          {settings.questionCount} câu · nhạc {settings.clipSec} giây · công bố {settings.revealSec} giây
        </p>
        {error && (
          <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => void run('host:calibrate')}
            disabled={busy || onlineCount === 0}
            className="rounded-xl bg-amber-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
          >
            Đo độ trễ
          </button>
          <button
            type="button"
            onClick={() => void run('host:start')}
            disabled={busy || players.length === 0}
            className="rounded-xl bg-emerald-600 px-8 py-3 text-2xl font-bold disabled:opacity-40"
          >
            Bắt đầu
          </button>
        </div>
        <p className="text-slate-400">
          Đo độ trễ: người chơi bấm nút trên máy khi thấy BẤM! trên stream, để điểm tốc độ công bằng với mọi người.
        </p>
      </section>
    </div>
  )
}
```

```tsx
import { useEffect, useState } from 'react'
import { beep } from '../../lib/beep'
import { CALIB_ROUNDS, type HostCalib, type HostPlayer } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

type Step = 3 | 2 | 1 | 'flash' | null

// Mount với key={calib.round}: mỗi lượt là một bộ đếm mới.
export function HostCalibration({ calib, players }: { calib: HostCalib; players: HostPlayer[] }) {
  const { round, waitMs, flashed } = calib
  const [step, setStep] = useState<Step>(null)

  useEffect(() => {
    if (flashed) return
    const timers = ([3, 2, 1] as const).map((n, i) => setTimeout(() => setStep(n), waitMs + i * 1000))
    timers.push(
      setTimeout(() => {
        setStep('flash')
        beep()
        void emitAck('host:calib_flash', { round })
      }, waitMs + 3000),
    )
    return () => timers.forEach(clearTimeout)
  }, [round, waitMs, flashed])

  const showFlash = flashed || step === 'flash'
  const onlineCount = players.filter((player) => player.online).length

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-8 text-center">
      <p className="text-3xl text-slate-400">
        Đo độ trễ · Lượt {round}/{CALIB_ROUNDS}
      </p>
      {showFlash ? (
        <p className="text-[12rem] leading-none font-black text-amber-400">BẤM!</p>
      ) : step === null ? (
        <p className="text-6xl font-bold text-slate-300">Chuẩn bị…</p>
      ) : (
        <p className="text-[12rem] leading-none font-black">{step}</p>
      )}
      {showFlash && (
        <p className="text-3xl">
          {calib.tappedCount}/{onlineCount} người đã bấm
        </p>
      )}
      <p className="max-w-2xl text-xl text-slate-400">
        Người chơi bấm nút trên điện thoại ngay khi thấy hoặc nghe BẤM! trên stream.
      </p>
    </div>
  )
}
```

```tsx
import { AnswerTile } from '../../components/AnswerTile'
import { CountdownRing } from '../../components/CountdownRing'
import { Leaderboard } from '../../components/Leaderboard'
import { remainingMs } from '../../lib/clock'
import { GRACE_MS, type HostRound, type HostSnapshot } from '../../lib/protocol'
import { useNow } from '../../lib/useNow'
import { useHostCommand } from './useHostCommand'

interface Props {
  snapshot: HostSnapshot
  round: HostRound
  offset: number
}

export function HostQuestion({ snapshot, round, offset }: Props) {
  const { phase, settings } = snapshot
  const now = useNow(200, phase === 'ANSWERING')
  const { run, error, busy } = useHostCommand()
  const number = `${round.index + 1}/${round.total}`
  const reveal = phase === 'REVEAL' ? round.reveal : null

  const replay = () => {
    if (window.confirm('Phát lại câu này? Câu trả lời của câu này sẽ bị hủy.')) void run('host:replay_round')
  }

  const actions = (
    <>
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {reveal && (
          <button
            type="button"
            onClick={() => void run('host:next')}
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
          >
            {round.index + 1 >= round.total ? 'Xem kết quả' : 'Câu tiếp →'}
          </button>
        )}
        <button
          type="button"
          onClick={replay}
          disabled={busy}
          className="rounded-xl bg-slate-700 px-4 py-3 text-lg disabled:opacity-40"
        >
          Phát lại câu này
        </button>
      </div>
    </>
  )

  if (phase === 'PREPARING') {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-6 text-center">
        <p className="text-5xl font-bold">Câu {number}: chuẩn bị…</p>
        <p className="text-xl text-slate-400">Đang tải nhạc. Nếu chờ quá lâu, hãy bấm Phát lại câu này.</p>
        {actions}
      </div>
    )
  }

  if (reveal) {
    return (
      // 58vw bên trái để trống cho khung video (HostScreen đặt khung video cố định ở đó).
      <div className="grid grid-cols-[58vw_1fr] gap-6 p-6">
        <div aria-hidden="true" />
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl text-slate-400">Câu {number}</h1>
          <h2 className="text-4xl font-black text-emerald-300">{reveal.animeName}</h2>
          {reveal.songLabel && <p className="text-xl text-slate-300">{reveal.songLabel}</p>}
          <div className="grid gap-2">
            {round.options.map((label, i) => (
              <AnswerTile
                key={i}
                index={i}
                label={label}
                state={i === reveal.correctIndex ? 'correct' : 'dimmed'}
                count={reveal.optionCounts[i]}
              />
            ))}
          </div>
          <Leaderboard rows={snapshot.leaderboard.slice(0, 10)} />
          {actions}
        </div>
      </div>
    )
  }

  return (
    // pb-56: chừa chỗ cho khung nhạc nhỏ (đã bị che) ở góc phải dưới.
    <div className="flex flex-col gap-6 p-8 pb-56">
      <div className="flex items-center justify-between gap-6">
        <h1 className="text-4xl font-black">Câu {number}</h1>
        {round.deadline !== null && (
          <CountdownRing
            remainingMs={remainingMs(round.deadline, offset, now)}
            totalMs={settings.clipSec * 1000 + GRACE_MS}
          />
        )}
        <p className="text-3xl">
          {round.answeredCount}/{round.onlineCount} đã trả lời
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {round.options.map((label, i) => (
          <AnswerTile key={i} index={i} label={label} />
        ))}
      </div>
      {actions}
    </div>
  )
}
```

```tsx
import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import type { HostSnapshot } from '../../lib/protocol'
import { useHostCommand } from './useHostCommand'

export function HostFinished({ snapshot, onClose }: { snapshot: HostSnapshot; onClose: () => void }) {
  const { run, error, busy } = useHostCommand()
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <h1 className="text-center text-5xl font-black">Kết quả chung cuộc 🏆</h1>
      <Podium rows={snapshot.leaderboard} />
      <Leaderboard rows={snapshot.leaderboard} />
      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      <div className="flex justify-center gap-4">
        <button
          type="button"
          onClick={() => void run('host:play_again')}
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-6 py-3 text-2xl font-bold disabled:opacity-40"
        >
          Chơi lại
        </button>
        <button type="button" onClick={onClose} className="rounded-xl bg-red-700 px-6 py-3 text-2xl font-bold">
          Đóng phòng
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  19 passed (19)`, `Tests  110 passed (110)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add host lobby, calibration, question and results screens"
```

---

### Task 23: Host screen (`/host/:code`)

**Files:**
- Create: `frontend/src/pages/HostScreen.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`
- Test: `frontend/src/pages/HostScreen.test.tsx`

**Interfaces:**
- Consumes:
  - Task 16: `useRoomSnapshot`, `emitAck`, `setSocketForTests`, `loadRoomAuth`, `saveRoomAuth`, `clearRoomAuth`, `errorMessage`, `CLOSED_MESSAGES`, the `HostSnapshot` / `Notice` types, `installFakeSocket`.
  - Task 19: `renderRoute` (the `location` / `location-state` probes).
  - Task 21: `useAudioPlayer`, `useHostPlayback`, `loadVolume`, `saveVolume`, `setPlayerFactoryForTests`, `installFakePlayer`, `hostSnapshot`, `hostRound`.
  - Task 22: `HostLobby`, `HostCalibration`, `HostQuestion`, `HostFinished`, `useHostCommand`.
- Produces: the default export `HostScreen`, routed at `/host/:code`. Its behaviour:
  - **Resume:** on every socket connect it sends `host:resume {code, hostToken}`.
    - No saved `hostToken`: clear nothing, go to `/` with the message "Trình duyệt này không giữ quyền quản trò phòng <code>".
    - Any failed ack except `NETWORK`: clear the host token and go to `/` with `errorMessage(error)`.
  - **room:closed:** clear the host token and go to `/`. The message is "Đã đóng phòng" for `CLOSED`, otherwise `CLOSED_MESSAGES[reason]`.
  - **Header:** "Phòng <code>", a volume slider labelled "Âm lượng" (starts at `loadVolume()`, saved on change, applied with `player.setVolume`), and "Đóng phòng" (hidden in FINISHED, where `HostFinished` has its own).
    - Closing asks `window.confirm('Đóng phòng? Mọi người chơi sẽ bị đưa ra ngoài.')`, sends `host:close_room`, then goes to `/` with "Đã đóng phòng".
  - **Notice:** a `role="status"` toast with "Video lỗi, đã đổi bài khác" (AUDIO_REPLACED) or "Video lỗi và hết bài dự phòng, đã bỏ câu này" (ROUND_DROPPED).
  - **Stage:** `data-testid="stage"` is rendered from the first render and never moves in the DOM. It holds the player container and an opaque cover (`data-testid="stage-cover"`). `data-layout` is:
    - `hidden` in LOBBY, CALIBRATING, FINISHED and while connecting;
    - `small` (320×180, bottom right, covered) in PREPARING and ANSWERING;
    - `large` (56vw 16:9, top left, cover faded out) in REVEAL.

- [ ] **Step 1: Write the failing tests**

```tsx
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setPlayerFactoryForTests } from '../audio/createPlayer'
import type { HostSnapshot } from '../lib/protocol'
import { loadRoomAuth, saveRoomAuth } from '../lib/roomAuth'
import { setSocketForTests } from '../lib/socket'
import { installFakePlayer } from '../test/fakePlayer'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { hostRound, hostSnapshot } from '../test/snapshots'
import HostScreen from './HostScreen'

const CODE = 'K7M2QX'

const reveal = {
  correctIndex: 0,
  optionCounts: [1, 0, 0, 0],
  animeName: 'Shingeki no Kyojin',
  songLabel: null,
}

interface SetupOptions {
  token?: string | null
  resume?: object
}

function setup({ token = 'host-token', resume }: SetupOptions = {}) {
  if (token) saveRoomAuth(CODE, { hostToken: token })
  const socket = installFakeSocket()
  if (resume) socket.reply('host:resume', resume)
  const players = installFakePlayer()
  const { user } = renderRoute(<HostScreen />, { path: '/host/:code', url: `/host/${CODE}` })
  const push = (patch: Partial<HostSnapshot> = {}) => socket.serverEmit('room:state', hostSnapshot(patch))
  return { socket, players, user, push }
}

afterEach(() => {
  setSocketForTests(null)
  setPlayerFactoryForTests(null)
  vi.restoreAllMocks()
})

describe('HostScreen', () => {
  it('resumes the room with the saved host token and shows the lobby', () => {
    const { socket, push } = setup()
    expect(socket.payloads('host:resume')).toEqual([{ code: CODE, hostToken: 'host-token' }])
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
    push()
    expect(screen.getByTestId('room-code')).toHaveTextContent(CODE)
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'hidden')
  })

  it('sends the host home when this browser has no host token', () => {
    const { socket } = setup({ token: null })
    expect(socket.payloads('host:resume')).toEqual([])
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    expect(screen.getByTestId('location-state')).toHaveTextContent(
      'Trình duyệt này không giữ quyền quản trò phòng K7M2QX',
    )
  })

  it('forgets the token and goes home when the room no longer exists', async () => {
    setup({ resume: { ok: false, error: 'ROOM_NOT_FOUND' } })
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Phòng không còn tồn tại')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('stays on the page when the resume ack is lost', async () => {
    setup({ resume: { ok: false, error: 'NETWORK' } })
    await act(async () => {})
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
    expect(loadRoomAuth(CODE)).toEqual({ hostToken: 'host-token' })
  })

  it('plays the clip under a cover, then enlarges the same player on reveal', () => {
    const { socket, players, push } = setup()
    const round = hostRound()
    push({ phase: 'PREPARING', round })
    expect(players).toHaveLength(1)
    expect(players[0].loads).toEqual([{ videoId: 'AAAAAAAAAAA', startSec: 30, endSec: 60 }])
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'small')
    expect(screen.getByTestId('stage-cover')).not.toHaveClass('opacity-0')
    const video = screen.getByTestId('fake-player')

    act(() => players[0].emitPlaying())
    expect(socket.payloads('host:audio_started')).toEqual([{ roundIndex: 0 }])

    push({ phase: 'ANSWERING', round: { ...round, deadline: Date.now() + 18_000 } })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'small')

    push({ phase: 'REVEAL', round: { ...round, reveal } })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'large')
    expect(screen.getByTestId('stage-cover')).toHaveClass('opacity-0')
    expect(screen.getByTestId('fake-player')).toBe(video)
    expect(players[0].loads).toHaveLength(1)
    expect(players[0].stopCount).toBe(0)

    push({ phase: 'FINISHED' })
    expect(screen.getByTestId('stage')).toHaveAttribute('data-layout', 'hidden')
    expect(players[0].stopCount).toBe(1)
  })

  it('applies the saved volume and remembers changes', () => {
    localStorage.setItem('animequiz:volume', '35')
    const { players } = setup()
    const slider = screen.getByRole('slider', { name: /Âm lượng/ })
    expect(slider).toHaveValue('35')
    expect(players[0].volume).toBe(35)
    fireEvent.change(slider, { target: { value: '60' } })
    expect(players[0].volume).toBe(60)
    expect(localStorage.getItem('animequiz:volume')).toBe('60')
  })

  it('shows a notice when the server swapped a broken video', () => {
    const { push } = setup()
    push({ phase: 'PREPARING', round: hostRound({ prepareSeq: 2 }), notice: 'AUDIO_REPLACED' })
    expect(screen.getByRole('status')).toHaveTextContent('Video lỗi, đã đổi bài khác')
  })

  it('shows the calibration screen', () => {
    const { push } = setup()
    push({ phase: 'CALIBRATING', calib: { round: 1, waitMs: 3000, flashed: false, tappedCount: 0 } })
    expect(screen.getByText('Đo độ trễ · Lượt 1/3')).toBeInTheDocument()
  })

  it('goes home when the room expires', () => {
    const { socket, push } = setup()
    push()
    socket.serverEmit('room:closed', { reason: 'EXPIRED' })
    expect(screen.getByTestId('location-state')).toHaveTextContent('Phòng đã hết hạn')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('closes the room from the results screen after confirmation', async () => {
    const { socket, user, push } = setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    push({ phase: 'FINISHED' })
    // Ở FINISHED chỉ còn nút của HostFinished, nút trên thanh đầu trang bị ẩn.
    await user.click(screen.getByRole('button', { name: 'Đóng phòng' }))
    expect(window.confirm).toHaveBeenCalledWith('Đóng phòng? Mọi người chơi sẽ bị đưa ra ngoài.')
    expect(socket.payloads('host:close_room')).toEqual([{}])
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Đã đóng phòng')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/pages/HostScreen.test.tsx`
Expected: FAIL, `Failed to resolve import "./HostScreen"`.

- [ ] **Step 3: Write `HostScreen`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAudioPlayer } from '../audio/useAudioPlayer'
import { useHostPlayback } from '../audio/useHostPlayback'
import { loadVolume, saveVolume } from '../audio/volume'
import { CLOSED_MESSAGES, errorMessage, type HostSnapshot, type Notice } from '../lib/protocol'
import { clearRoomAuth, loadRoomAuth } from '../lib/roomAuth'
import { emitAck } from '../lib/socket'
import { useRoomSnapshot } from '../lib/useRoomSnapshot'
import { HostCalibration } from './host/HostCalibration'
import { HostFinished } from './host/HostFinished'
import { HostLobby } from './host/HostLobby'
import { HostQuestion } from './host/HostQuestion'
import { useHostCommand } from './host/useHostCommand'

const NOTICE_MESSAGES: Record<Notice, string> = {
  AUDIO_REPLACED: 'Video lỗi, đã đổi bài khác',
  ROUND_DROPPED: 'Video lỗi và hết bài dự phòng, đã bỏ câu này',
}

type StageLayout = 'hidden' | 'small' | 'large'

// Khung nhạc luôn nằm một chỗ trong DOM; chỉ đổi CSS để iframe YouTube không bị tải lại.
const STAGE_CLASSES: Record<StageLayout, string> = {
  hidden: 'invisible right-6 bottom-6 h-[180px] w-[320px]',
  small: 'right-6 bottom-6 h-[180px] w-[320px]',
  large: 'top-20 left-6 aspect-video w-[56vw]',
}

function stageLayout(snapshot: HostSnapshot | null): StageLayout {
  switch (snapshot?.phase) {
    case 'PREPARING':
    case 'ANSWERING':
      return 'small'
    case 'REVEAL':
      return 'large'
    default:
      return 'hidden'
  }
}

export default function HostScreen() {
  const { code = '' } = useParams()
  return <Host key={code} code={code} />
}

function Host({ code }: { code: string }) {
  const navigate = useNavigate()
  const leave = useCallback(
    (message: string) => {
      clearRoomAuth(code, 'host')
      navigate('/', { replace: true, state: { message } })
    },
    [code, navigate],
  )

  // Chạy mỗi lần socket kết nối (kể cả kết nối lại) để gắn lại quyền quản trò.
  const authenticate = () => {
    const { hostToken } = loadRoomAuth(code)
    if (!hostToken) {
      navigate('/', { replace: true, state: { message: `Trình duyệt này không giữ quyền quản trò phòng ${code}` } })
      return
    }
    void emitAck('host:resume', { code, hostToken }).then((response) => {
      // NETWORK: socket sẽ tự kết nối lại và gọi authenticate lần nữa.
      if (!response.ok && response.error !== 'NETWORK') leave(errorMessage(response.error))
    })
  }
  const { snapshot, offset, closedReason } = useRoomSnapshot<HostSnapshot>(code, authenticate)

  useEffect(() => {
    if (closedReason) leave(closedReason === 'CLOSED' ? 'Đã đóng phòng' : CLOSED_MESSAGES[closedReason])
  }, [closedReason, leave])

  const stageRef = useRef<HTMLDivElement>(null)
  const player = useAudioPlayer(stageRef)
  useHostPlayback(player, snapshot)

  const [volume, setVolume] = useState(loadVolume)
  useEffect(() => {
    player?.setVolume(volume)
  }, [player, volume])
  const changeVolume = (value: number) => {
    setVolume(value)
    saveVolume(value)
  }

  const { run, error } = useHostCommand()
  const closeRoom = async () => {
    if (!window.confirm('Đóng phòng? Mọi người chơi sẽ bị đưa ra ngoài.')) return
    if (await run('host:close_room')) leave('Đã đóng phòng')
  }

  const layout = stageLayout(snapshot)

  return (
    <main className="min-h-screen">
      <header className="flex items-center gap-6 border-b border-slate-800 px-6 py-3">
        <span className="font-mono text-xl font-bold">Phòng {code}</span>
        <label className="ml-auto flex items-center gap-2 text-slate-300">
          <span aria-hidden="true">🔊</span> Âm lượng
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
          />
        </label>
        {snapshot?.phase !== 'FINISHED' && (
          <button
            type="button"
            onClick={() => void closeRoom()}
            className="rounded-lg bg-slate-800 px-3 py-1 text-slate-300 hover:bg-red-800"
          >
            Đóng phòng
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="m-4 rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      {snapshot?.notice && (
        <p
          role="status"
          className="fixed top-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-400 px-6 py-2 text-lg font-bold text-slate-950"
        >
          {NOTICE_MESSAGES[snapshot.notice]}
        </p>
      )}

      {snapshot ? (
        <PhaseView snapshot={snapshot} offset={offset} onClose={() => void closeRoom()} />
      ) : (
        <p className="p-8 text-2xl text-slate-400">Đang kết nối tới phòng…</p>
      )}

      <div
        data-testid="stage"
        data-layout={layout}
        className={`fixed z-10 overflow-hidden rounded-2xl bg-black shadow-2xl transition-all duration-700 ${STAGE_CLASSES[layout]}`}
      >
        {/* Player tự gắn phần tử của nó vào đây; React không render con nào bên trong. */}
        <div ref={stageRef} className="h-full w-full" />
        <div
          data-testid="stage-cover"
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center bg-slate-900 transition-opacity duration-700 ${
            layout === 'large' ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <span className="animate-spin text-7xl">💿</span>
        </div>
      </div>
    </main>
  )
}

interface PhaseViewProps {
  snapshot: HostSnapshot
  offset: number
  onClose: () => void
}

function PhaseView({ snapshot, offset, onClose }: PhaseViewProps) {
  switch (snapshot.phase) {
    case 'LOBBY':
      return <HostLobby snapshot={snapshot} />
    case 'CALIBRATING':
      return (
        snapshot.calib && (
          <HostCalibration key={snapshot.calib.round} calib={snapshot.calib} players={snapshot.players} />
        )
      )
    case 'FINISHED':
      return <HostFinished snapshot={snapshot} onClose={onClose} />
    default:
      return (
        snapshot.round && (
          <HostQuestion key={snapshot.round.index} snapshot={snapshot} round={snapshot.round} offset={offset} />
        )
      )
  }
}
```

- [ ] **Step 4: Route `/host/:code`**

Replace `frontend/src/App.tsx` with:

```tsx
import { Link, Route, Routes } from 'react-router'
import HostScreen from './pages/HostScreen'
import Home from './pages/Home'
import SetEditor from './pages/SetEditor'
import SetList from './pages/SetList'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sets" element={<SetList />} />
      <Route path="/sets/:id" element={<SetEditor />} />
      <Route path="/host/:code" element={<HostScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

Replace `frontend/src/App.test.tsx` with:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { setPlayerFactoryForTests } from './audio/createPlayer'
import { saveRoomAuth } from './lib/roomAuth'
import { newSet } from './lib/sets/schema'
import { saveSet } from './lib/sets/storage'
import { setSocketForTests } from './lib/socket'
import { installFakePlayer } from './test/fakePlayer'
import { installFakeSocket } from './test/fakeSocket'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

afterEach(() => {
  setSocketForTests(null)
  setPlayerFactoryForTests(null)
})

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    renderAt('/khong-co-trang-nay')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })

  it('routes / to the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Đoán anime qua nhạc/ })).toBeInTheDocument()
  })

  it('routes /sets to the set list', () => {
    renderAt('/sets')
    expect(screen.getByRole('heading', { name: 'Bộ câu hỏi' })).toBeInTheDocument()
  })

  it('routes /sets/:id to the editor', () => {
    const set = saveSet(newSet('Anime OP'))
    renderAt(`/sets/${set.id}`)
    expect(screen.getByRole('heading', { name: 'Soạn bộ câu hỏi' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên bộ câu hỏi')).toHaveValue('Anime OP')
  })

  it('routes /host/:code to the host screen', () => {
    saveRoomAuth('K7M2QX', { hostToken: 'host-token' })
    installFakeSocket()
    installFakePlayer()
    renderAt('/host/K7M2QX')
    expect(screen.getByText('Phòng K7M2QX')).toBeInTheDocument()
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  20 passed (20)`, `Tests  121 passed (121)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 6: Try it by hand**

Run the backend (`cd backend && YOUTUBE_API_KEY=<your key> uv run uvicorn app.main:app --reload`) and the frontend (`cd frontend && npm run dev`), then create a room from a set. The player page arrives in Task 25, so only check the host side. Expected:
- the lobby shows the code, link and QR code;
- reloading the host tab keeps you in the room;
- "Đóng phòng" returns you to `/` with "Đã đóng phòng".

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add host screen with stage, volume and room controls"
```

---

### Task 24: Player phase screens (join, lobby, calibration, question, results)

**Files:**
- Create: `frontend/src/pages/play/JoinForm.tsx`, `frontend/src/pages/play/PlayerLobby.tsx`, `frontend/src/pages/play/PlayerCalibration.tsx`, `frontend/src/pages/play/PlayerRound.tsx`, `frontend/src/pages/play/PlayerFinished.tsx`
- Modify: `frontend/src/test/snapshots.ts` (add player factories)
- Test: `frontend/src/pages/play/playPhases.test.tsx`

**Interfaces:**
- Consumes:
  - Task 16: `emitAck`, `errorMessage`, `remainingMs`, `useNow`, `saveRoomAuth`, `loadRoomAuth`, `CALIB_ROUNDS`, the `PlayerSnapshot` / `PlayerRound` / `PlayerCalib` / `JoinAck` / `ErrorCode` types, and `installFakeSocket`.
  - Task 18: `AnswerTile`, `TILES`, `CountdownRing`, `DelayBadge`, `Podium`, `Leaderboard`.
  - Task 21: `hostSnapshot` and `hostRound`, kept unchanged in `snapshots.ts`.
- Produces (all named exports; Task 25 wires them into `PlayScreen`):
  - `playerSnapshot(patch)` and `playerRound(patch)` in `src/test/snapshots.ts`. Defaults:
    - snapshot: code `K7M2QX`, LOBBY, `hostOnline: true`, `playerCount: 2`, me `{id:'p1', name:'Mai', score:0, rank:1, delayMs:0, calibrated:false}`, everything else null;
    - round: index 0 of 2, every other field null.
  - `JoinForm({code, message, onJoined})`:
    - heading "Vào phòng <code>", a "Tên của bạn" input (max 20) and a "Vào phòng" button, disabled while the trimmed name is empty;
    - sends `player:join {code, name}` with the name trimmed;
    - on success: `saveRoomAuth(code, {playerId, playerToken})`, then `onJoined()`;
    - shows the failed ack's `errorMessage`, or else `message`, in an alert.
  - `PlayerLobby({snapshot})`: "Chờ quản trò bắt đầu…", my name, "N người trong phòng", and my delay (`DelayBadge`) once calibrated.
  - `PlayerCalibration({calib})` (mount with `key={calib.round}`):
    - shows "Đo độ trễ · Lượt k/3", the hint "Bấm đúng lúc thấy hoặc nghe BẤM! trên stream" and a large "BẤM" button that sends `player:calib_tap {round}`;
    - once `calib.tapped` is set it shows "Đã bấm lượt k";
    - error text: INVALID_STATE → "Chưa tới lúc, chờ thấy BẤM! trên stream rồi bấm"; TOO_LATE → "Bấm trễ quá, lượt này không tính"; ALREADY_ANSWERED shows nothing.
  - `PlayerPreparing({round})`: "Câu i/N: chuẩn bị nghe…".
  - `PlayerAnswering({round, offset})` (mount with `key={`${round.index}:${round.deadline}`}`, so a replayed question starts unlocked):
    - shows "Câu i/N", a `CountdownRing` whose total is the time left at mount, and 4 tiles with accessible names `"<letter>: <option>"`;
    - choosing sends `player:answer {roundIndex, optionIndex}` and locks the tiles with "Đã chọn B, chờ kết quả";
    - `round.myAnswer` from the server also locks them;
    - a failed ack (except ALREADY_ANSWERED) unlocks the tiles and shows `errorMessage`.
  - `PlayerReveal({snapshot, round})`: one of:
    - "✅ Đúng! +870 · Hạng 4";
    - "❌ Sai, đáp án là A · <anime>";
    - "⌛ Hết giờ, đáp án là A · <anime>" when there was no answer.
    
    It also shows the song label and display-only tiles: correct, my wrong pick, the rest dimmed.
  - `PlayerFinished({snapshot})`: "Hạng N/M", "X điểm", the `Podium` (top 3), the top-10 `Leaderboard` with me highlighted, and "Chờ quản trò chơi lại hoặc đóng phòng…".

- [ ] **Step 1: Add the player snapshot factories**

Replace `frontend/src/test/snapshots.ts` with:

```ts
import type { HostRound, HostSnapshot, PlayerRound, PlayerSnapshot } from '../lib/protocol'

// Snapshot đầy đủ trường (trường không áp dụng là null), sửa bằng patch cho từng test.
export function hostRound(patch: Partial<HostRound> = {}): HostRound {
  return {
    index: 0,
    total: 2,
    videoId: 'AAAAAAAAAAA',
    startSec: 30,
    endSec: 60,
    options: ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach'],
    deadline: null,
    answeredCount: 0,
    onlineCount: 2,
    prepareSeq: 1,
    reveal: null,
    ...patch,
  }
}

export function hostSnapshot(patch: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    code: 'K7M2QX',
    phase: 'LOBBY',
    mode: 'stream',
    settings: { questionCount: 2, clipSec: 15, revealSec: 15, maxPlayers: 30, mode: 'stream' },
    serverNow: Date.now(),
    players: [],
    calib: null,
    round: null,
    leaderboard: [],
    notice: null,
    ...patch,
  }
}

export function playerRound(patch: Partial<PlayerRound> = {}): PlayerRound {
  return {
    index: 0,
    total: 2,
    options: null,
    deadline: null,
    myAnswer: null,
    result: null,
    ...patch,
  }
}

export function playerSnapshot(patch: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    code: 'K7M2QX',
    phase: 'LOBBY',
    serverNow: Date.now(),
    hostOnline: true,
    playerCount: 2,
    me: { id: 'p1', name: 'Mai', score: 0, rank: 1, delayMs: 0, calibrated: false },
    calib: null,
    round: null,
    leaderboardTop: null,
    ...patch,
  }
}
```

- [ ] **Step 2: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LeaderboardRow } from '../../lib/protocol'
import { loadRoomAuth } from '../../lib/roomAuth'
import { setSocketForTests } from '../../lib/socket'
import { installFakeSocket } from '../../test/fakeSocket'
import { playerRound, playerSnapshot } from '../../test/snapshots'
import { JoinForm } from './JoinForm'
import { PlayerCalibration } from './PlayerCalibration'
import { PlayerFinished } from './PlayerFinished'
import { PlayerLobby } from './PlayerLobby'
import { PlayerAnswering, PlayerPreparing, PlayerReveal } from './PlayerRound'

const options = ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']

const result = {
  correctIndex: 0,
  correct: false,
  gained: 0,
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
}

afterEach(() => {
  setSocketForTests(null)
})

describe('JoinForm', () => {
  it('joins with the trimmed name and remembers the player token', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 'player-token' })
    const onJoined = vi.fn()
    render(<JoinForm code="K7M2QX" message={null} onJoined={onJoined} />)
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Vào phòng' })
    expect(button).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Tên của bạn'), '  Mai  ')
    await userEvent.click(button)
    expect(socket.payloads('player:join')).toEqual([{ code: 'K7M2QX', name: 'Mai' }])
    expect(loadRoomAuth('K7M2QX')).toEqual({ playerId: 'p1', playerToken: 'player-token' })
    expect(onJoined).toHaveBeenCalledTimes(1)
  })

  it('shows why joining failed', async () => {
    const socket = installFakeSocket()
    socket.reply('player:join', { ok: false, error: 'NAME_TAKEN' })
    const onJoined = vi.fn()
    render(<JoinForm code="K7M2QX" message={null} onJoined={onJoined} />)
    await userEvent.type(screen.getByLabelText('Tên của bạn'), 'Mai{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Tên này đã có người dùng trong phòng')
    expect(onJoined).not.toHaveBeenCalled()
    expect(loadRoomAuth('K7M2QX')).toEqual({})
  })

  it('shows a message handed over by the play screen', () => {
    render(<JoinForm code="K7M2QX" message="Phiên đã hết hạn, hãy vào lại phòng" onJoined={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Phiên đã hết hạn, hãy vào lại phòng')
  })
})

describe('PlayerLobby', () => {
  it('shows my name, the player count and my measured delay', () => {
    const me = { id: 'p1', name: 'Mai', score: 0, rank: 1, delayMs: 1200, calibrated: true }
    render(<PlayerLobby snapshot={playerSnapshot({ playerCount: 5, me })} />)
    expect(screen.getByText('Mai')).toBeInTheDocument()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
    expect(screen.getByText('5 người trong phòng')).toBeInTheDocument()
    expect(screen.getByText('1.2s')).toBeInTheDocument()
  })
})

describe('PlayerCalibration', () => {
  it('sends a tap for the current round', async () => {
    const socket = installFakeSocket()
    render(<PlayerCalibration calib={{ round: 2, tapped: false }} />)
    expect(screen.getByText('Đo độ trễ · Lượt 2/3')).toBeInTheDocument()
    expect(screen.getByText('Bấm đúng lúc thấy hoặc nghe BẤM! trên stream')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'BẤM' }))
    expect(socket.payloads('player:calib_tap')).toEqual([{ round: 2 }])
  })

  it('explains an early tap', async () => {
    const socket = installFakeSocket()
    socket.reply('player:calib_tap', { ok: false, error: 'INVALID_STATE' })
    render(<PlayerCalibration calib={{ round: 1, tapped: false }} />)
    await userEvent.click(screen.getByRole('button', { name: 'BẤM' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tới lúc, chờ thấy BẤM! trên stream rồi bấm')
  })

  it('confirms the tap once the server has it', () => {
    render(<PlayerCalibration calib={{ round: 3, tapped: true }} />)
    expect(screen.getByText('Đã bấm lượt 3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'BẤM' })).not.toBeInTheDocument()
  })
})

describe('PlayerRound', () => {
  it('asks players to get ready while the host loads the clip', () => {
    render(<PlayerPreparing round={playerRound({ index: 1 })} />)
    expect(screen.getByText('Câu 2/2: chuẩn bị nghe…')).toBeInTheDocument()
  })

  it('locks the tiles after an answer', async () => {
    const socket = installFakeSocket()
    const round = playerRound({ options, deadline: Date.now() + 15_000 })
    render(<PlayerAnswering round={round} offset={0} />)
    expect(screen.getByRole('heading', { name: 'Câu 1/2' })).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveAccessibleName('Còn 15 giây')

    await userEvent.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(socket.payloads('player:answer')).toEqual([{ roundIndex: 0, optionIndex: 1 }])
    expect(screen.getByText('Đã chọn B, chờ kết quả')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'B: Naruto' })).toHaveAttribute('data-state', 'chosen')
  })

  it('unlocks the tiles when the answer is rejected', async () => {
    const socket = installFakeSocket()
    socket.reply('player:answer', { ok: false, error: 'TOO_LATE' })
    render(<PlayerAnswering round={playerRound({ options, deadline: Date.now() + 1000 })} offset={0} />)
    await userEvent.click(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Hết giờ rồi')
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeEnabled()
  })

  it('stays locked when the server already has my answer', () => {
    render(<PlayerAnswering round={playerRound({ options, deadline: Date.now() + 9000, myAnswer: 2 })} offset={0} />)
    expect(screen.getByText('Đã chọn C, chờ kết quả')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'C: One Piece' })).toBeDisabled()
  })

  it('celebrates a correct answer with the points and rank', () => {
    const round = playerRound({ options, myAnswer: 0, result: { ...result, correct: true, gained: 870 } })
    const me = { id: 'p1', name: 'Mai', score: 870, rank: 4, delayMs: 0, calibrated: false }
    render(<PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL', me })} round={round} />)
    expect(screen.getByText('✅ Đúng! +870 · Hạng 4')).toBeInTheDocument()
    expect(screen.getByText('OP1 · Guren no Yumiya')).toBeInTheDocument()
  })

  it('shows the right answer after a wrong pick', () => {
    const { container } = render(
      <PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL' })} round={playerRound({ options, myAnswer: 1, result })} />,
    )
    expect(screen.getByText('❌ Sai, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
    const states = [...container.querySelectorAll('[data-state]')].map((tile) => tile.getAttribute('data-state'))
    expect(states).toEqual(['correct', 'wrong', 'dimmed', 'dimmed'])
  })

  it('tells a player who did not answer that time ran out', () => {
    render(<PlayerReveal snapshot={playerSnapshot({ phase: 'REVEAL' })} round={playerRound({ options, result })} />)
    expect(screen.getByText('⌛ Hết giờ, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
  })
})

describe('PlayerFinished', () => {
  it('shows my final rank and score with the top 3', () => {
    const leaderboardTop: LeaderboardRow[] = [
      { playerId: 'p2', name: 'Long', score: 1500, rank: 1, gained: null },
      { playerId: 'p1', name: 'Mai', score: 870, rank: 2, gained: null },
    ]
    const me = { id: 'p1', name: 'Mai', score: 870, rank: 2, delayMs: 0, calibrated: false }
    const { container } = render(<PlayerFinished snapshot={playerSnapshot({ phase: 'FINISHED', me, leaderboardTop })} />)
    expect(screen.getByText('Hạng 2/2')).toBeInTheDocument()
    expect(screen.getByText('870 điểm')).toBeInTheDocument()
    expect(screen.getByText('🥇')).toBeInTheDocument()
    expect(container.querySelector('[data-me="true"]')).toHaveTextContent('Mai')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/pages/play`
Expected: FAIL, `Failed to resolve import "./PlayerRound"` (Vite reports the first missing phase module it reaches).

- [ ] **Step 4: Write the join form and the lobby**

```tsx
import { useState, type FormEvent } from 'react'
import { errorMessage, type JoinAck } from '../../lib/protocol'
import { saveRoomAuth } from '../../lib/roomAuth'
import { emitAck } from '../../lib/socket'

const NAME_MAX_LENGTH = 20

interface Props {
  code: string
  message: string | null
  onJoined: () => void
}

export function JoinForm({ code, message, onJoined }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  const join = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await emitAck<JoinAck>('player:join', { code, name: trimmed })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    saveRoomAuth(code, { playerId: response.playerId, playerToken: response.playerToken })
    onJoined()
  }

  const alert = error ?? message
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-6">
      <h1 className="pt-8 text-center text-3xl font-black">
        Vào phòng <span className="font-mono">{code}</span>
      </h1>
      <form onSubmit={join} className="flex flex-col gap-3 rounded-2xl bg-slate-900 p-5">
        <label className="flex flex-col gap-1">
          Tên của bạn
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            className="rounded-lg bg-slate-800 px-3 py-3 text-xl"
          />
        </label>
        <button
          type="submit"
          disabled={busy || trimmed === ''}
          className="rounded-lg bg-sky-600 px-4 py-3 text-lg font-bold disabled:opacity-40"
        >
          Vào phòng
        </button>
      </form>
      {alert && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {alert}
        </p>
      )}
    </main>
  )
}
```

```tsx
import { DelayBadge } from '../../components/DelayBadge'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerLobby({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  return (
    <section className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="text-lg text-slate-400">Bạn là</p>
      <p className="text-4xl font-black">{me.name}</p>
      <p className="text-2xl">Chờ quản trò bắt đầu…</p>
      <p className="text-slate-300">{playerCount} người trong phòng</p>
      {me.calibrated && (
        <p className="flex items-center gap-2 text-slate-300">
          Độ trễ stream của bạn <DelayBadge delayMs={me.delayMs} calibrated />
        </p>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Write the calibration, question and results screens**

```tsx
import { useState } from 'react'
import { CALIB_ROUNDS, errorMessage, type ErrorCode, type PlayerCalib } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

const TAP_ERRORS: Partial<Record<ErrorCode, string>> = {
  INVALID_STATE: 'Chưa tới lúc, chờ thấy BẤM! trên stream rồi bấm',
  TOO_LATE: 'Bấm trễ quá, lượt này không tính',
}

// Mount với key={calib.round}: mỗi lượt bắt đầu không có lỗi cũ.
export function PlayerCalibration({ calib }: { calib: PlayerCalib }) {
  const [error, setError] = useState<string | null>(null)

  const tap = async () => {
    setError(null)
    const response = await emitAck('player:calib_tap', { round: calib.round })
    if (!response.ok && response.error !== 'ALREADY_ANSWERED') {
      setError(TAP_ERRORS[response.error] ?? errorMessage(response.error))
    }
  }

  return (
    <section className="flex flex-col gap-4 text-center">
      <h1 className="text-2xl font-bold">
        Đo độ trễ · Lượt {calib.round}/{CALIB_ROUNDS}
      </h1>
      {calib.tapped ? (
        <p className="py-16 text-3xl font-bold text-emerald-300">Đã bấm lượt {calib.round}</p>
      ) : (
        <>
          <p className="text-lg text-slate-300">Bấm đúng lúc thấy hoặc nghe BẤM! trên stream</p>
          <button
            type="button"
            onClick={() => void tap()}
            className="min-h-[50vh] rounded-3xl bg-amber-500 text-7xl font-black text-slate-950 active:scale-95"
          >
            BẤM
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}
```

```tsx
import { useState } from 'react'
import { AnswerTile } from '../../components/AnswerTile'
import { CountdownRing } from '../../components/CountdownRing'
import { TILES, type TileState } from '../../components/tiles'
import { remainingMs } from '../../lib/clock'
import { errorMessage, type PlayerRound, type PlayerSnapshot } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'
import { useNow } from '../../lib/useNow'

function Title({ round }: { round: PlayerRound }) {
  return (
    <h1 className="text-2xl font-bold">
      Câu {round.index + 1}/{round.total}
    </h1>
  )
}

export function PlayerPreparing({ round }: { round: PlayerRound }) {
  return (
    <p className="py-16 text-center text-3xl font-bold">
      Câu {round.index + 1}/{round.total}: chuẩn bị nghe…
    </p>
  )
}

// Mount với key={`${round.index}:${round.deadline}`}: phát lại câu tạo deadline mới nên lựa chọn cũ bị xóa.
export function PlayerAnswering({ round, offset }: { round: PlayerRound; offset: number }) {
  const now = useNow()
  const deadline = round.deadline ?? 0
  const [totalMs] = useState(() => remainingMs(deadline, offset))
  const [chosen, setChosen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const picked = round.myAnswer ?? chosen

  const choose = async (optionIndex: number) => {
    setChosen(optionIndex)
    setError(null)
    const response = await emitAck('player:answer', { roundIndex: round.index, optionIndex })
    if (response.ok || response.error === 'ALREADY_ANSWERED') return
    setChosen(null)
    setError(errorMessage(response.error))
  }

  const tileState = (i: number): TileState => (picked === null ? 'idle' : i === picked ? 'chosen' : 'dimmed')

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Title round={round} />
        <CountdownRing remainingMs={remainingMs(deadline, offset, now)} totalMs={totalMs} size={80} />
      </div>
      <div className="grid gap-3">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile
            key={i}
            index={i}
            label={label}
            state={tileState(i)}
            disabled={picked !== null}
            onSelect={(index) => void choose(index)}
          />
        ))}
      </div>
      {picked !== null && <p className="text-center text-xl">Đã chọn {TILES[picked].letter}, chờ kết quả</p>}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}

export function PlayerReveal({ snapshot, round }: { snapshot: PlayerSnapshot; round: PlayerRound }) {
  const { result, myAnswer } = round
  if (!result) return null
  const answer = `${TILES[result.correctIndex].letter} · ${result.animeName}`
  const line = result.correct
    ? `✅ Đúng! +${result.gained} · Hạng ${snapshot.me.rank}`
    : myAnswer === null
      ? `⌛ Hết giờ, đáp án là ${answer}`
      : `❌ Sai, đáp án là ${answer}`

  const tileState = (i: number): TileState =>
    i === result.correctIndex ? 'correct' : i === myAnswer ? 'wrong' : 'dimmed'

  return (
    <section className="flex flex-col gap-4">
      <Title round={round} />
      <p className={`text-3xl font-black ${result.correct ? 'text-emerald-300' : 'text-red-300'}`}>{line}</p>
      {result.songLabel && <p className="text-lg text-slate-300">{result.songLabel}</p>}
      <div className="grid gap-3">
        {(round.options ?? []).map((label, i) => (
          <AnswerTile key={i} index={i} label={label} state={tileState(i)} />
        ))}
      </div>
    </section>
  )
}
```

```tsx
import { Leaderboard } from '../../components/Leaderboard'
import { Podium } from '../../components/Podium'
import type { PlayerSnapshot } from '../../lib/protocol'

export function PlayerFinished({ snapshot }: { snapshot: PlayerSnapshot }) {
  const { me, playerCount } = snapshot
  const rows = snapshot.leaderboardTop ?? []
  return (
    <section className="flex flex-col gap-6 text-center">
      <h1 className="text-3xl font-black">Kết thúc! 🏁</h1>
      <div>
        <p className="text-5xl font-black">
          Hạng {me.rank}/{playerCount}
        </p>
        <p className="text-xl text-slate-300">{me.score.toLocaleString('vi-VN')} điểm</p>
      </div>
      <Podium rows={rows} />
      <Leaderboard rows={rows} highlightId={me.id} />
      <p className="text-slate-400">Chờ quản trò chơi lại hoặc đóng phòng…</p>
    </section>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  21 passed (21)`, `Tests  136 passed (136)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add player join, lobby, calibration, question and results screens"
```

---

### Task 25: Player screen (`/play/:code`)

**Files:**
- Create: `frontend/src/pages/PlayScreen.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/App.test.tsx`
- Test: `frontend/src/pages/PlayScreen.test.tsx`

**Interfaces:**
- Consumes:
  - Task 16: `useRoomSnapshot`, `emitAck`, `setSocketForTests`, `loadRoomAuth`, `saveRoomAuth`, `clearRoomAuth`, `errorMessage`, `CLOSED_MESSAGES`, the `PlayerSnapshot` / `RejoinAck` types, `installFakeSocket`.
  - Task 19: `renderRoute`.
  - Task 24: `JoinForm`, `PlayerLobby`, `PlayerCalibration`, `PlayerPreparing`, `PlayerAnswering`, `PlayerReveal`, `PlayerFinished`, `playerSnapshot`, `playerRound`.
- Produces: the default export `PlayScreen`, routed at `/play/:code`. The code from the URL is upper-cased. Its behaviour:
  - **No saved `playerToken`:** shows `JoinForm`. After joining it shows "Đang vào phòng…" until the first snapshot arrives.
  - **Saved token:** on every socket connect it sends `player:rejoin {code, playerToken}`.
    - `INVALID_TOKEN`: clear the player token and show `JoinForm` with "Phiên đã hết hạn, hãy vào lại phòng".
    - Any other failure except `NETWORK` (e.g. ROOM_NOT_FOUND, KICKED): clear the token and go to `/` with `errorMessage(error)`.
  - **room:closed:** clear the token and go to `/` with `CLOSED_MESSAGES[reason]`.
  - **Header:** my name and score.
  - **Host offline:** when `hostOnline` is false, a `role="status"` banner shows "Quản trò mất kết nối, đang chờ…".
  - **Phases:** each phase renders its Task 24 screen. `PlayerCalibration` is keyed by `calib.round`; `PlayerAnswering` is keyed by `${round.index}:${round.deadline}`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerSnapshot } from '../lib/protocol'
import { loadRoomAuth, saveRoomAuth } from '../lib/roomAuth'
import { setSocketForTests } from '../lib/socket'
import { installFakeSocket } from '../test/fakeSocket'
import { renderRoute } from '../test/renderRoute'
import { playerRound, playerSnapshot } from '../test/snapshots'
import PlayScreen from './PlayScreen'

const CODE = 'K7M2QX'
const options = ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach']

interface SetupOptions {
  token?: string | null
  rejoin?: object
  url?: string
}

function setup({ token = null, rejoin, url = `/play/${CODE}` }: SetupOptions = {}) {
  if (token) saveRoomAuth(CODE, { playerId: 'p1', playerToken: token })
  const socket = installFakeSocket()
  if (rejoin) socket.reply('player:rejoin', rejoin)
  const { user } = renderRoute(<PlayScreen />, { path: '/play/:code', url })
  const push = (patch: Partial<PlayerSnapshot> = {}) => socket.serverEmit('room:state', playerSnapshot(patch))
  return { socket, user, push }
}

afterEach(() => {
  setSocketForTests(null)
})

describe('PlayScreen', () => {
  it('asks for a name, joins, then shows the lobby', async () => {
    const { socket, user, push } = setup()
    socket.reply('player:join', { ok: true, playerId: 'p1', playerToken: 'player-token' })
    expect(socket.payloads('player:rejoin')).toEqual([])
    await user.type(screen.getByLabelText('Tên của bạn'), 'Mai')
    await user.click(screen.getByRole('button', { name: 'Vào phòng' }))
    expect(await screen.findByText('Đang vào phòng…')).toBeInTheDocument()
    push()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
  })

  it('accepts a lower-case code in the link', () => {
    setup({ url: '/play/k7m2qx' })
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
  })

  it('rejoins with the saved token', () => {
    const { socket, push } = setup({ token: 'player-token' })
    expect(socket.payloads('player:rejoin')).toEqual([{ code: CODE, playerToken: 'player-token' }])
    push()
    expect(screen.getByText('Chờ quản trò bắt đầu…')).toBeInTheDocument()
  })

  it('asks for a name again when the saved token is no longer valid', async () => {
    setup({ token: 'old-token', rejoin: { ok: false, error: 'INVALID_TOKEN' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Phiên đã hết hạn, hãy vào lại phòng')
    expect(screen.getByLabelText('Tên của bạn')).toBeInTheDocument()
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('goes home when the room no longer exists', async () => {
    setup({ token: 'player-token', rejoin: { ok: false, error: 'ROOM_NOT_FOUND' } })
    expect(await screen.findByTestId('location-state')).toHaveTextContent('Phòng không còn tồn tại')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('goes home when the host kicks the player', () => {
    const { socket, push } = setup({ token: 'player-token' })
    push()
    socket.serverEmit('room:closed', { reason: 'KICKED' })
    expect(screen.getByTestId('location-state')).toHaveTextContent('Bạn đã bị mời ra khỏi phòng')
    expect(loadRoomAuth(CODE)).toEqual({})
  })

  it('warns when the host is offline', () => {
    const { push } = setup({ token: 'player-token' })
    push({ hostOnline: false })
    expect(screen.getByRole('status')).toHaveTextContent('Quản trò mất kết nối, đang chờ…')
  })

  it('shows the calibration button and the final results', () => {
    const { push } = setup({ token: 'player-token' })
    push({ phase: 'CALIBRATING', calib: { round: 1, tapped: false } })
    expect(screen.getByRole('button', { name: 'BẤM' })).toBeInTheDocument()
    push({ phase: 'FINISHED', leaderboardTop: [] })
    expect(screen.getByText('Hạng 1/2')).toBeInTheDocument()
  })

  it('plays a question from answer to result', async () => {
    const { socket, user, push } = setup({ token: 'player-token' })
    push({ phase: 'PREPARING', round: playerRound() })
    expect(screen.getByText('Câu 1/2: chuẩn bị nghe…')).toBeInTheDocument()

    push({ phase: 'ANSWERING', round: playerRound({ options, deadline: Date.now() + 15_000 }) })
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(socket.payloads('player:answer')).toEqual([{ roundIndex: 0, optionIndex: 1 }])

    const result = { correctIndex: 0, correct: false, gained: 0, animeName: 'Shingeki no Kyojin', songLabel: null }
    push({ phase: 'REVEAL', round: playerRound({ options, myAnswer: 1, result }) })
    expect(screen.getByText('❌ Sai, đáp án là A · Shingeki no Kyojin')).toBeInTheDocument()
  })

  it('unlocks the tiles when the question is replayed', async () => {
    const { user, push } = setup({ token: 'player-token' })
    const deadline = Date.now() + 15_000
    push({ phase: 'ANSWERING', round: playerRound({ options, deadline }) })
    await user.click(screen.getByRole('button', { name: 'B: Naruto' }))
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeDisabled()
    // Phát lại câu: server xóa câu trả lời và đặt deadline mới.
    push({ phase: 'ANSWERING', round: playerRound({ options, deadline: deadline + 5000 }) })
    expect(screen.getByRole('button', { name: 'A: Shingeki no Kyojin' })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/pages/PlayScreen.test.tsx`
Expected: FAIL, `Failed to resolve import "./PlayScreen"`.

- [ ] **Step 3: Write `PlayScreen`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { CLOSED_MESSAGES, errorMessage, type PlayerSnapshot, type RejoinAck } from '../lib/protocol'
import { clearRoomAuth, loadRoomAuth } from '../lib/roomAuth'
import { emitAck } from '../lib/socket'
import { useRoomSnapshot } from '../lib/useRoomSnapshot'
import { JoinForm } from './play/JoinForm'
import { PlayerCalibration } from './play/PlayerCalibration'
import { PlayerFinished } from './play/PlayerFinished'
import { PlayerLobby } from './play/PlayerLobby'
import { PlayerAnswering, PlayerPreparing, PlayerReveal } from './play/PlayerRound'

export default function PlayScreen() {
  // Link gõ tay có thể viết thường; mã phòng luôn là chữ hoa.
  const code = (useParams().code ?? '').toUpperCase()
  return <Play key={code} code={code} />
}

function Play({ code }: { code: string }) {
  const navigate = useNavigate()
  const [joined, setJoined] = useState(() => Boolean(loadRoomAuth(code).playerToken))
  const [message, setMessage] = useState<string | null>(null)

  const leave = useCallback(
    (text: string) => {
      clearRoomAuth(code, 'player')
      navigate('/', { replace: true, state: { message: text } })
    },
    [code, navigate],
  )

  // Mỗi lần socket kết nối: đã có token thì vào lại phòng, chưa có thì chờ người chơi nhập tên.
  const authenticate = () => {
    const { playerToken } = loadRoomAuth(code)
    if (!playerToken) return
    void emitAck<RejoinAck>('player:rejoin', { code, playerToken }).then((response) => {
      // NETWORK: socket sẽ tự kết nối lại và gọi authenticate lần nữa.
      if (response.ok || response.error === 'NETWORK') return
      if (response.error === 'INVALID_TOKEN') {
        clearRoomAuth(code, 'player')
        setJoined(false)
        setMessage(errorMessage(response.error))
        return
      }
      leave(errorMessage(response.error))
    })
  }
  const { snapshot, offset, closedReason } = useRoomSnapshot<PlayerSnapshot>(code, authenticate)

  useEffect(() => {
    if (closedReason) leave(CLOSED_MESSAGES[closedReason])
  }, [closedReason, leave])

  if (!joined) {
    return <JoinForm code={code} message={message} onJoined={() => setJoined(true)} />
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-4 p-4">
      {snapshot ? (
        <>
          <header className="flex items-center justify-between text-slate-300">
            <span className="font-bold text-white">{snapshot.me.name}</span>
            <span className="font-mono">{snapshot.me.score.toLocaleString('vi-VN')} điểm</span>
          </header>
          {!snapshot.hostOnline && (
            <p role="status" className="rounded-xl bg-amber-500/15 p-3 text-amber-200">
              Quản trò mất kết nối, đang chờ…
            </p>
          )}
          <PhaseView snapshot={snapshot} offset={offset} />
        </>
      ) : (
        <p className="py-16 text-center text-xl text-slate-400">Đang vào phòng…</p>
      )}
    </main>
  )
}

function PhaseView({ snapshot, offset }: { snapshot: PlayerSnapshot; offset: number }) {
  const { phase, calib, round } = snapshot
  switch (phase) {
    case 'LOBBY':
      return <PlayerLobby snapshot={snapshot} />
    case 'CALIBRATING':
      return calib && <PlayerCalibration key={calib.round} calib={calib} />
    case 'PREPARING':
      return round && <PlayerPreparing round={round} />
    case 'ANSWERING':
      return round && <PlayerAnswering key={`${round.index}:${round.deadline}`} round={round} offset={offset} />
    case 'REVEAL':
      return round && <PlayerReveal snapshot={snapshot} round={round} />
    case 'FINISHED':
      return <PlayerFinished snapshot={snapshot} />
  }
}
```

- [ ] **Step 4: Route `/play/:code`**

Replace `frontend/src/App.tsx` with:

```tsx
import { Link, Route, Routes } from 'react-router'
import HostScreen from './pages/HostScreen'
import Home from './pages/Home'
import PlayScreen from './pages/PlayScreen'
import SetEditor from './pages/SetEditor'
import SetList from './pages/SetList'

function NotFound() {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-2xl font-bold">Không tìm thấy trang</h1>
      <Link className="mt-4 inline-block text-sky-400 underline" to="/">
        Về trang chủ
      </Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sets" element={<SetList />} />
      <Route path="/sets/:id" element={<SetEditor />} />
      <Route path="/host/:code" element={<HostScreen />} />
      <Route path="/play/:code" element={<PlayScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
```

Replace `frontend/src/App.test.tsx` with (the new last test covers `/play/:code`):

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { setPlayerFactoryForTests } from './audio/createPlayer'
import { saveRoomAuth } from './lib/roomAuth'
import { newSet } from './lib/sets/schema'
import { saveSet } from './lib/sets/storage'
import { setSocketForTests } from './lib/socket'
import { installFakePlayer } from './test/fakePlayer'
import { installFakeSocket } from './test/fakeSocket'

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <App />
    </MemoryRouter>,
  )

afterEach(() => {
  setSocketForTests(null)
  setPlayerFactoryForTests(null)
})

describe('App', () => {
  it('shows a not-found page with a link home for unknown paths', () => {
    renderAt('/khong-co-trang-nay')
    expect(screen.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/')
  })

  it('routes / to the home page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /Đoán anime qua nhạc/ })).toBeInTheDocument()
  })

  it('routes /sets to the set list', () => {
    renderAt('/sets')
    expect(screen.getByRole('heading', { name: 'Bộ câu hỏi' })).toBeInTheDocument()
  })

  it('routes /sets/:id to the editor', () => {
    const set = saveSet(newSet('Anime OP'))
    renderAt(`/sets/${set.id}`)
    expect(screen.getByRole('heading', { name: 'Soạn bộ câu hỏi' })).toBeInTheDocument()
    expect(screen.getByLabelText('Tên bộ câu hỏi')).toHaveValue('Anime OP')
  })

  it('routes /host/:code to the host screen', () => {
    saveRoomAuth('K7M2QX', { hostToken: 'host-token' })
    installFakeSocket()
    installFakePlayer()
    renderAt('/host/K7M2QX')
    expect(screen.getByText('Phòng K7M2QX')).toBeInTheDocument()
    expect(screen.getByText('Đang kết nối tới phòng…')).toBeInTheDocument()
  })

  it('routes /play/:code to the player screen', () => {
    installFakeSocket()
    renderAt('/play/K7M2QX')
    expect(screen.getByRole('heading', { name: 'Vào phòng K7M2QX' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Test Files  22 passed (22)`, `Tests  147 passed (147)`; `tsc -b` prints nothing; `npm run lint` exits 0 without printing any warning.

- [ ] **Step 6: Play a real game by hand**

1. Run the backend (`cd backend && YOUTUBE_API_KEY=<your key> uv run uvicorn app.main:app --reload`) and the frontend (`cd frontend && npm run dev`).
2. Build a set of 4+ songs and create a room.
3. Open the join link on a phone (same Wi‑Fi, use the machine's LAN IP with `npm run dev -- --host`) and in a private window.
4. Run "Đo độ trễ", then play the whole game.

Expected:
- the host hears each clip while the video stays covered;
- the tiles on both players match the stream;
- on reveal the same video grows on the left without restarting;
- reloading a player tab mid-question returns to the same question;
- "Chơi lại" goes back to the lobby with scores reset.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): add player screen and /play route"
```

---

### Task 26: End-to-end game test (Playwright)

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/game.spec.ts`
- Modify: `frontend/package.json` (script `e2e`), `frontend/tsconfig.node.json` (type-check the E2E files)

**Interfaces:**
- Consumes:
  - The whole app. The backend from Task 13 serves the frontend build from `backend/app/static` (Task 15 points `vite build` there).
  - `VITE_FAKE_PLAYER=1` (Task 21) swaps YouTube for `FakePlayer({autoPlayMs: 300})`. That player prints `▶ <videoId> (<start>s → <end>s)` inside the stage, which is how the test learns the correct answer.
  - The UI copy and test ids from Tasks 19–25.
- Produces: `npm run e2e`, which builds with the fake player and plays a 2-question game in three browser contexts: host, Mai and Long.
  - The game covers import, room creation, join, reload, calibration, two questions, results and closing the room.
  - Mai always answers right and Long always answers wrong.

> Note: `npm run e2e` writes a fake-player build into `backend/app/static`. Run `npm run build` before serving the app for real (the Docker build in Task 27 always builds its own copy).

- [ ] **Step 1: Configure Playwright**

Run:

```bash
cd frontend
npm pkg set scripts.e2e="VITE_FAKE_PLAYER=1 vite build && playwright test"
npx playwright install chromium
```

(The root `.gitignore` from Task 2 already ignores `frontend/test-results/` and `frontend/playwright-report/`.)

In `frontend/tsconfig.node.json`, change `"include": ["vite.config.ts"]` to:

```json
  "include": ["vite.config.ts", "playwright.config.ts", "e2e"]
```

```ts
import { defineConfig, devices } from '@playwright/test'

const PORT = 8765
const ORIGIN = `http://127.0.0.1:${PORT}`

// Chạy trên bản build thật do backend phục vụ (script "e2e" build với VITE_FAKE_PLAYER=1).
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `uv run uvicorn app.main:app --host 127.0.0.1 --port ${PORT}`,
    cwd: '../backend',
    // Không gọi YouTube trong E2E: bộ câu hỏi được nhập từ file JSON.
    env: { YOUTUBE_API_KEY: 'e2e-dummy-key' },
    url: `${ORIGIN}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
```

- [ ] **Step 2: Write the game test**

```ts
import { expect, test, type Browser, type Page } from '@playwright/test'

// 4 bài của 4 anime khác nhau: 3 đáp án nhiễu của mỗi câu lấy từ chính bộ này.
const SONGS = [
  { videoId: 'e2eVideo001', animeName: 'Shingeki no Kyojin' },
  { videoId: 'e2eVideo002', animeName: 'Naruto' },
  { videoId: 'e2eVideo003', animeName: 'One Piece' },
  { videoId: 'e2eVideo004', animeName: 'Bleach' },
]

const SET = {
  version: 1,
  id: 'e2e-set',
  name: 'E2E OP',
  updatedAt: '2026-10-16T00:00:00.000Z',
  songs: SONGS.map((song) => ({
    ...song,
    videoTitle: `${song.animeName} Opening`,
    durationSec: 90,
    songLabel: 'OP1',
    startSec: null,
    needsReview: false,
  })),
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

async function join(page: Page, code: string, name: string) {
  await page.goto(`/play/${code}`)
  await page.getByLabel('Tên của bạn').fill(name)
  await page.getByRole('button', { name: 'Vào phòng' }).click()
  await expect(page.getByText('Chờ quản trò bắt đầu…')).toBeVisible()
}

// FakePlayer in videoId đang phát vào khung nhạc của quản trò; từ đó biết đáp án đúng.
async function currentAnime(host: Page): Promise<string> {
  const text = (await host.getByTestId('fake-player').textContent()) ?? ''
  const song = SONGS.find((s) => text.includes(s.videoId))
  if (!song) throw new Error(`Không nhận ra bài đang phát: ${text}`)
  return song.animeName
}

async function playQuestion(host: Page, right: Page, wrong: Page, number: number) {
  await expect(host.getByRole('heading', { name: `Câu ${number}/2`, exact: true })).toBeVisible()
  const anime = await currentAnime(host)
  await right.getByRole('button', { name: new RegExp(`^[A-D]: ${anime}$`) }).click()
  await wrong.getByRole('button', { name: /^[A-D]: / }).filter({ hasNotText: anime }).first().click()

  // Cả hai đã trả lời nên server công bố ngay, không chờ hết giờ.
  await expect(host.getByRole('heading', { name: anime, exact: true })).toBeVisible()
  await expect(host.getByTestId('stage')).toHaveAttribute('data-layout', 'large')
  await expect(right.getByText(/^✅ Đúng! \+\d+ · Hạng 1$/)).toBeVisible()
  await expect(wrong.getByText(new RegExp(`^❌ Sai, đáp án là [A-D] · ${anime}$`))).toBeVisible()
}

test('a host and two players play a full game', async ({ browser }) => {
  const host = await newPage(browser)
  host.on('dialog', (dialog) => void dialog.accept())

  // Quản trò nhập bộ câu hỏi từ file rồi tạo phòng 2 câu.
  await host.goto('/sets')
  await host.getByLabel('Nhập file JSON').setInputFiles({
    name: 'e2e.animequiz.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SET)),
  })
  await host.getByRole('link', { name: 'E2E OP' }).click()
  await host.getByLabel('Số câu').fill('2')
  await host.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(host).toHaveURL(/\/host\/[A-Z2-9]{6}$/)
  const code = ((await host.getByTestId('room-code').textContent()) ?? '').trim()

  const mai = await newPage(browser)
  const long = await newPage(browser)
  await join(mai, code, 'Mai')
  await join(long, code, 'Long')
  await expect(host.getByText('Người chơi (2/30)')).toBeVisible()

  // Tải lại trang thì người chơi vẫn ở trong phòng.
  await long.reload()
  await expect(long.getByText('Chờ quản trò bắt đầu…')).toBeVisible()

  // Đo độ trễ: 3 lượt, cả hai bấm ngay khi quản trò hiện BẤM!.
  await host.getByRole('button', { name: 'Đo độ trễ' }).click()
  for (const round of [1, 2, 3]) {
    await expect(host.getByText(`Đo độ trễ · Lượt ${round}/3`)).toBeVisible({ timeout: 15_000 })
    await expect(host.getByText('BẤM!', { exact: true })).toBeVisible({ timeout: 10_000 })
    for (const player of [mai, long]) {
      await player.getByRole('button', { name: 'BẤM', exact: true }).click()
      await expect(player.getByText(`Đã bấm lượt ${round}`)).toBeVisible()
    }
  }
  await expect(mai.getByText('Độ trễ stream của bạn')).toBeVisible({ timeout: 10_000 })

  // Hai câu: Mai luôn chọn đúng, Long luôn chọn sai.
  await host.getByRole('button', { name: 'Bắt đầu' }).click()
  await playQuestion(host, mai, long, 1)

  // Tải lại trang lúc công bố vẫn thấy kết quả câu đó.
  await mai.reload()
  await expect(mai.getByText(/^✅ Đúng!/)).toBeVisible()

  await host.getByRole('button', { name: 'Câu tiếp →' }).click()
  await playQuestion(host, mai, long, 2)

  await host.getByRole('button', { name: 'Xem kết quả' }).click()
  await expect(host.getByRole('heading', { name: /Kết quả chung cuộc/ })).toBeVisible()
  await expect(mai.getByText('Hạng 1/2')).toBeVisible()
  await expect(long.getByText('Hạng 2/2')).toBeVisible()

  // Đóng phòng: cả ba về trang chủ kèm thông báo.
  await host.getByRole('button', { name: 'Đóng phòng' }).click()
  await expect(host.getByText('Đã đóng phòng')).toBeVisible()
  await expect(mai.getByText('Quản trò đã đóng phòng')).toBeVisible()
  await expect(long.getByText('Quản trò đã đóng phòng')).toBeVisible()
})
```

- [ ] **Step 3: Run the E2E test**

Run: `cd frontend && npm run e2e`
Expected: `1 passed` in about 45 s; the three calibration rounds take most of that. If it fails, open the trace with `npx playwright show-trace test-results/*/trace.zip`.

- [ ] **Step 4: Make sure the unit checks still pass**

Run: `cd frontend && npm test && npx tsc -b && npm run lint`
Expected: `Tests  147 passed (147)`; `tsc -b` prints nothing (it now also checks `playwright.config.ts` and `e2e/`); `npm run lint` exits 0 without printing any warning.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/tsconfig.node.json frontend/playwright.config.ts frontend/e2e
git commit -m "test(e2e): play a full game with a host and two players"
```

---

### Task 27: Docker image and README

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `README.md` (all at the repo root)

**Interfaces:**
- Consumes:
  - `frontend/`: `npm ci` and `npm run build`. The build writes to `../backend/app/static` (Task 15).
  - `backend/`: `pyproject.toml` and `uv.lock` (Task 2), and the module-level `app` in `app/main.py`. If `YOUTUBE_API_KEY` is missing, `app` fails at startup (Task 13).
- Produces:
  - A self-contained image that serves the whole app on `$PORT` (default 8000) with exactly 1 uvicorn worker.
  - A Vietnamese README for whoever runs the tool, covering setup, env vars, dev, tests and deploy.

There is no unit test in this task. Instead, Step 3 builds the image and checks it end to end.

- [ ] **Step 1: Write `.dockerignore`**

Keep the build context small. Never send a local build of `backend/app/static`: after `npm run e2e` it holds the fake-player build, and the image always builds its own copy.

```
.git
**/node_modules
**/.venv
**/__pycache__
**/.pytest_cache
**/.DS_Store
backend/app/static
backend/tests
frontend/dist
frontend/test-results
frontend/playwright-report
docs
spike
```

- [ ] **Step 2: Write the Dockerfile**

Spec §9 requires a 2-stage build: `node` builds `frontend/`, then `python:3.12-slim` serves it. `npm run build` also runs `tsc -b`, which type-checks `playwright.config.ts` and `e2e/`. So those files stay in the context, and `npm ci` installs the dev dependencies.

```dockerfile
# Giai đoạn 1: build React; vite.config.ts ghi kết quả ra ../backend/app/static.
FROM node:24-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Giai đoạn 2: Python 3.12 + uv. Chạy đúng 1 worker vì phòng nằm trong RAM.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/app ./app
COPY --from=frontend /src/backend/app/static ./app/static
RUN useradd --system --no-create-home quiz
USER quiz
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --workers 1"]
```

- [ ] **Step 3: Build the image and check it**

Run from the repo root:

```bash
docker build -t anime-quiz .
docker run --rm -d --name anime-quiz -e YOUTUBE_API_KEY=dummy -e PORT=9000 -p 8080:9000 anime-quiz
sleep 3
curl -s http://localhost:8080/api/health
curl -s http://localhost:8080/play/K7M2QX | grep -o '<title>.*</title>'
docker stop anime-quiz
docker run --rm anime-quiz 2>&1 | grep -o 'Thiếu biến môi trường YOUTUBE_API_KEY'
```

Expected:
- The build succeeds. Its log shows `vite build` writing `../backend/app/static/index.html`.
- `/api/health` returns `{"ok":true}`. This also proves the server honours `PORT=9000`.
- `/play/K7M2QX` returns `<title>Đoán anime qua nhạc</title>` (the SPA fallback works).
- The last command prints `Thiếu biến môi trường YOUTUBE_API_KEY`: without the key the container exits instead of serving a broken app.

If port 8080 is busy, use another host port in `-p` and in the two `curl` URLs.

- [ ] **Step 4: Write the README**

````markdown
# Đoán anime qua nhạc

Web app tổ chức thử thách "nghe nhạc đoán anime". Quản trò mở phòng và chia sẻ màn hình (ví dụ qua Discord). Tab của quản trò phát đoạn nhạc từ YouTube; người chơi vào phòng bằng mã hoặc mã QR và chọn 1 trong 4 đáp án trên điện thoại của mình. Server tính điểm và bù độ trễ stream của từng người.

## Cách chơi

1. Mở **Bộ câu hỏi** (`/sets`), tạo bộ mới rồi dán link YouTube: một video, hoặc một playlist (tối đa 200 bài mỗi lần). Kiểm tra tên anime app gợi ý cho từng bài. Bộ câu hỏi chỉ lưu trong trình duyệt này, nên hãy xuất ra file JSON để sao lưu hoặc mang sang máy khác.
2. Chọn số câu, độ dài đoạn nhạc và thời gian công bố, rồi bấm **Tạo phòng**.
3. Chia sẻ cửa sổ trình duyệt của tab quản trò qua Discord, **nhớ bật chia sẻ âm thanh**.
4. Người chơi mở link `/play/<mã phòng>` hoặc quét mã QR trên màn hình, rồi nhập tên.
5. Bấm **Đo độ trễ** (nên làm, mất khoảng 30 giây) rồi **Bắt đầu**.

Mẹo:
- Dùng YouTube Premium hoặc trình chặn quảng cáo trên máy quản trò, để quảng cáo không chen vào đoạn nhạc.
- Video lỗi sẽ tự được đổi sang bài khác trong bộ. Nếu nhạc không phát, bấm **Phát lại câu này**.

## Yêu cầu

- Python 3.12 và [uv](https://docs.astral.sh/uv/)
- Node.js 22.12 trở lên
- Một API key của YouTube Data API v3. Vào Google Cloud Console, bật "YouTube Data API v3", rồi tạo API key. Hạn mức miễn phí là 10.000 đơn vị mỗi ngày; import một playlist 200 bài tốn khoảng 8 đơn vị.

## Biến môi trường

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---|---|---|
| `YOUTUBE_API_KEY` | có | | Key YouTube Data API v3. Thiếu key thì server không khởi động. |
| `YOUTUBE_REGION` | không | `VN` | Quốc gia dùng để kiểm tra video có bị chặn theo vùng hay không. |
| `PORT` | không | `8000` | Cổng server lắng nghe. Chỉ image Docker đọc biến này. |

## Chạy khi phát triển

```bash
# Terminal 1: backend ở http://localhost:8000
cd backend
uv sync
YOUTUBE_API_KEY=<key> uv run uvicorn app.main:app --reload

# Terminal 2: frontend ở http://localhost:5173 (chuyển /api và /socket.io sang cổng 8000)
cd frontend
npm install
npm run dev
```

Muốn thử bằng điện thoại trong cùng mạng Wi-Fi: chạy `npm run dev -- --host`, rồi mở địa chỉ "Network" mà Vite in ra **cả trên máy quản trò**, để link và mã QR của phòng dùng đúng địa chỉ đó.

## Kiểm thử

```bash
cd backend && uv run pytest                              # logic game, API, Socket.IO
cd frontend && npm test && npx tsc -b && npm run lint    # unit test, kiểu, lint
cd frontend && npx playwright install chromium && npm run e2e   # 1 ván hoàn chỉnh trên trình duyệt thật
```

`npm run e2e` build bản dùng player giả (không cần YouTube) vào `backend/app/static`. Sau khi chạy e2e, hãy chạy lại `npm run build` trước khi dùng thật.

## Chạy bản build (không dùng Docker)

```bash
cd frontend && npm run build
cd ../backend && YOUTUBE_API_KEY=<key> uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

## Docker

```bash
docker build -t anime-quiz .
docker run --rm -p 8000:8000 -e YOUTUBE_API_KEY=<key> anime-quiz
```

## Deploy

- Có thể deploy bằng `Dockerfile` lên Render, Railway hoặc Fly.io; chỉ cần đặt biến `YOUTUBE_API_KEY`. Render và Railway tự đặt `PORT`; với Fly.io, để `internal_port = 8000`.
- **Chỉ chạy 1 instance, 1 worker.** Phòng chơi nằm trong RAM: khởi động lại server là mất các phòng đang chơi. Bộ câu hỏi vẫn còn, vì nó nằm trong trình duyệt của quản trò.
- Cần HTTPS và WebSocket; các nền tảng trên đều có sẵn.
- Gói miễn phí thường cho server "ngủ" khi không có ai dùng, nên lần mở đầu chậm 30–60 giây. Khi chơi thật, nên dùng gói không ngủ hoặc mở trang trước vài phút.
````

- [ ] **Step 5: Run every check one last time**

```bash
cd backend && uv run pytest -q
cd ../frontend && npm test && npx tsc -b && npm run lint && npm run e2e && npm run build
```

Expected:
- `265 passed` (backend), `Tests  147 passed (147)` (frontend unit), `1 passed` (E2E).
- `tsc -b` and lint print no error or warning.
- The final `npm run build` puts the real YouTube build back into `backend/app/static`.

- [ ] **Step 6: Check by hand with real Discord (spec §7.4)**

Setup:
1. Run the image with a real key: `docker run --rm -p 8000:8000 -e YOUTUBE_API_KEY=<key> anime-quiz`.
2. On the host machine, open `http://<LAN IP>:8000` (not `localhost`), so the room link and QR code work for phones.
3. Create a room from a real set of at least 5 songs.
4. In Discord, share the host browser window with audio, and watch the stream from a second account on another device.
5. Join as players from phones on the same Wi‑Fi.

Check each item:
- The stream viewer hears the clip.
- Measured delays look sane (usually 0.5–3 s) and stay close across two calibrations.
- With ads (no ad blocker), PREPARING lasts longer, but the countdown starts only when the song itself plays.
- Locking a phone mid-question and unlocking it brings the player back by itself, on the right phase.
- While a question is open, the stream never shows the video's title or picture.
- At REVEAL the stage grows and the music keeps playing, with no gap and no restart (spike check 3).

If an item fails, write down what you saw and report it to your human partner. Do not patch around it inside this task.

- [ ] **Step 7: Commit**

```bash
git add Dockerfile .dockerignore README.md
git commit -m "build: Docker image and README"
```
