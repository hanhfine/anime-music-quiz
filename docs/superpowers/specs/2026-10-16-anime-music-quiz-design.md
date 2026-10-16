# Thiết kế: Tool đoán tên anime qua đoạn nhạc

- **Ngày:** 2026-10-16
- **Trạng thái:** Đã duyệt thiết kế, chờ review spec

## 1. Tổng quan

Web app cho phép **quản trò** tổ chức thử thách đoán tên anime qua một đoạn nhạc (OP/ED) trên YouTube.

Kịch bản chính: quản trò **stream màn hình qua Discord**, người chơi nghe và xem qua stream, rồi trả lời trắc nghiệm trên trình duyệt riêng của mình (điện thoại hoặc PC). Kịch bản này cũng dùng được khi chơi offline, chỉ cần chiếu màn hình quản trò lên TV hoặc máy chiếu.

Luồng chính:

```
Quản trò soạn bộ câu hỏi → tạo phòng → người chơi vào phòng bằng mã hoặc link, đặt tên
→ đo độ trễ stream → quản trò bấm Bắt đầu → N câu hỏi → bảng xếp hạng chung cuộc
```

### 1.1 Phạm vi phiên bản 1

**Có trong phiên bản 1:**
- Soạn bộ câu hỏi từ link video YouTube hoặc playlist. Lưu ở localStorage, có xuất và nhập file JSON.
- Gợi ý tên anime tự động bằng AnimeThemes API, quản trò xác nhận hoặc sửa.
- Chế độ chơi `stream`: chỉ tab quản trò phát nhạc, người chơi chỉ bấm đáp án.
- Đo độ trễ stream của từng người chơi và bù độ trễ đó khi tính điểm.
- Trắc nghiệm 4 đáp án, tính điểm theo tốc độ kiểu Kahoot.
- Công bố đáp án bằng video YouTube kèm tên anime và nhãn bài.
- Kết nối lại cho cả quản trò lẫn người chơi.

**Không có trong phiên bản 1** (thiết kế sẵn chỗ mở rộng, nhưng chưa làm):
- Chế độ `self`, trong đó mỗi người chơi tự phát nhạc trên máy mình.
- Tài khoản người dùng, lưu bộ câu hỏi trên server, chia sẻ bộ câu hỏi công khai.
- Cho người chơi vào giữa ván.
- Chạy nhiều instance server hoặc dùng Redis.

### 1.2 Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Nơi phát nhạc | Chỉ tab quản trò, được stream qua Discord. Kiến trúc chừa sẵn trường `mode` |
| Nguồn tên anime | AnimeThemes API gợi ý tối đa 3 ứng viên, quản trò xác nhận |
| Lưu bộ câu hỏi | localStorage, có xuất và nhập JSON. Không có tài khoản |
| Người chơi | Không cần tài khoản: vào bằng mã phòng hoặc link, nhập tên |
| Quy mô | Nhóm bạn bè, 2–30 người mỗi phòng, ít phòng chạy cùng lúc |
| Công nghệ | Frontend React + Vite + TypeScript. Backend FastAPI + python-socketio |
| Lưu trạng thái | Trong RAM, 1 process, deploy thành 1 service |
| Độ trễ stream | Đo ở sảnh chờ (3 lượt, lấy trung vị), trừ vào thời gian trả lời |
| Video lúc công bố đáp án | Chính video YouTube của câu hỏi: bỏ lớp che, phát tiếp liền mạch |

## 2. Kiến trúc

```
┌──────────────────────── Trình duyệt ────────────────────────┐
│  React (Vite, TS)                                           │
│   /                 Trang chủ: [Tạo phòng] [Vào phòng]       │
│   /sets             Danh sách bộ câu hỏi (localStorage)      │
│   /sets/:id         Soạn bộ câu hỏi                          │
│   /host/:code       Màn hình quản trò (để stream)           │
│   /play/:code       Màn hình người chơi                     │
└──────────┬──────────────────────────────┬───────────────────┘
           │ REST (soạn câu hỏi)          │ Socket.IO (chơi game)
┌──────────▼──────────────────────────────▼───────────────────┐
│  FastAPI + python-socketio (1 process uvicorn, 1 worker)    │
│   api/         REST endpoints                               │
│   services/    youtube, anime_lookup, title_cleaner,        │
│                rate_limiter                                 │
│   game/        logic thuần: room, scoring, calibration,     │
│                question_builder, room_manager, views        │
│   sockets.py   lớp vỏ: event → game/ → broadcast            │
│   static/      file build của React                         │
└──────────┬──────────────────────────────┬───────────────────┘
           ▼                              ▼
   YouTube Data API v3             AnimeThemes API
```

### 2.1 Nguyên tắc

- **`game/` là logic thuần.** Module này không import Socket.IO, không gọi mạng và không tự đọc đồng hồ. Mọi hàm nhận `now` (epoch ms) và `rng` qua tham số, nhờ vậy test được một cách xác định.
- **Server là nguồn sự thật duy nhất.** Server giữ đáp án đúng, đo thời gian và tính điểm. Client của người chơi không bao giờ nhận đáp án đúng trước khi phòng chuyển sang REVEAL.
- **Gửi snapshot theo vai trò.** Mỗi khi phòng thay đổi, server gửi toàn bộ trạng thái phòng qua event `room:state`. Bản cho quản trò và bản cho người chơi được tạo riêng trong `game/views.py`. Client chỉ vẽ lại màn hình từ snapshot mới nhất, nên kết nối lại chỉ là nhận snapshot hiện tại.
- **Bắt buộc chạy 1 worker uvicorn**, vì trạng thái phòng nằm trong RAM của process.
- REST chỉ dùng khi soạn bộ câu hỏi. Lúc chơi game không gọi API ngoài nào.

### 2.2 Cấu trúc thư mục

```
backend/
  pyproject.toml                (uv; Python 3.12; fastapi, uvicorn, python-socketio, httpx, pydantic)
  app/
    main.py                     tạo FastAPI, bọc trong socketio.ASGIApp, mount static
    config.py                   YOUTUBE_API_KEY, YOUTUBE_REGION (mặc định "VN")
    api/routes.py
    services/youtube.py
    services/title_cleaner.py
    services/anime_lookup.py
    services/rate_limiter.py
    game/models.py              dataclass: Room, Player, Round, Settings, Song
    game/room.py                state machine
    game/scoring.py
    game/calibration.py
    game/question_builder.py
    game/room_manager.py        tạo mã phòng, tra phòng, dọn phòng
    game/views.py               host_view(room, now), player_view(room, player_id, now)
    sockets.py                  event handler và timer (asyncio task)
    data/popular_anime.json     ~500 tên anime phổ biến (dùng làm đáp án nhiễu dự phòng)
  tests/
frontend/
  src/
    App.tsx                     routes
    lib/socket.ts               kết nối, emit kèm ack
    lib/clock.ts                tính chênh lệch đồng hồ với server
    lib/sets/storage.ts         đọc, ghi localStorage; xuất, nhập JSON
    lib/sets/schema.ts          kiểm tra file bộ câu hỏi
    audio/AudioPlayer.ts        interface
    audio/YouTubePlayer.ts      cài đặt bằng YouTube IFrame API
    audio/FakePlayer.ts         dùng cho test, bật khi VITE_FAKE_PLAYER=1
    pages/Home.tsx, SetList.tsx, SetEditor.tsx, HostScreen.tsx, PlayScreen.tsx
    components/                 AnswerTile, Leaderboard, Podium, CountdownRing, …
Dockerfile                      build frontend → copy vào backend/app/static → chạy uvicorn
```

## 3. Bộ câu hỏi

### 3.1 Cấu trúc dữ liệu

Cấu trúc này dùng chung cho localStorage và file `.animequiz.json`:

```json
{
  "version": 1,
  "id": "uuid",
  "name": "Anime OP 2010s",
  "updatedAt": "2026-10-16T12:00:00Z",
  "songs": [{
    "videoId": "8OkpRK2_gVs",
    "videoTitle": "Shingeki no Kyojin OP1 Full - Guren no Yumiya",
    "durationSec": 312,
    "animeName": "Shingeki no Kyojin",
    "songLabel": "OP1 · Guren no Yumiya",
    "startSec": null,
    "needsReview": false
  }]
}
```

- `startSec: null` nghĩa là điểm bắt đầu được chọn ngẫu nhiên. Nếu là số thì dùng làm điểm bắt đầu cố định.
- `songLabel` có thể là `null`.
- `needsReview: true` nghĩa là tên anime do máy gợi ý và quản trò chưa xác nhận.
- Khi nhập file, tool từ chối file có `version` không được hỗ trợ hoặc thiếu trường bắt buộc. Thông báo lỗi chỉ rõ trường nào sai.

### 3.2 Luồng import

1. Quản trò dán link.
   - Link có tham số `list=` thì import cả playlist, tối đa 200 bài mỗi lần.
   - Các dạng `watch?v=`, `youtu.be/` và `shorts/` thì import 1 video.
2. Frontend gọi `POST /api/import`. Backend dùng YouTube Data API để lấy danh sách bài:
   - `playlistItems.list` (50 bài mỗi trang), sau đó `videos.list` với `part=snippet,contentDetails,status` (50 video mỗi lần gọi).
   - Bị loại kèm lý do: video đã xóa, video riêng tư, `status.embeddable=false`, hoặc `regionRestriction` chặn `YOUTUBE_REGION`.
   - Kết quả trả về ngay, chưa có tên anime.
3. Frontend bỏ qua các bài trùng `videoId` với bài đã có trong bộ, rồi thêm các bài mới vào bảng.
4. Frontend gọi `GET /api/anime/suggest?title=` cho từng bài mới, tối đa 3 lời gọi song song, để các dòng hiện dần lên. Ứng viên tốt nhất được điền sẵn kèm `needsReview: true`. Nếu không có ứng viên nào thì để trống tên anime.
5. Quản trò xử lý từng dòng: chọn ứng viên khác, tự tìm kiếm (`/api/anime/search`), hoặc gõ tên tự do. Thao tác nào cũng đặt `needsReview` về `false`. Ngoài ra có nút **"Chấp nhận tất cả gợi ý"** cho playlist dài.

### 3.3 Gợi ý tên anime (`title_cleaner` và `anime_lookup`)

- **Làm sạch tiêu đề:**
  - Bỏ nội dung trong các cặp ngoặc `【】`, `[]`, `()`.
  - Bỏ các từ khóa (không phân biệt hoa thường): `Full`, `HD`, `4K`, `1080p`, `Lyrics`, `MAD`, `AMV`, `NCOP`, `NCED`, `Creditless`, `Official`, `MV`, `TV Size`.
  - Bỏ các cụm `Opening N`, `OP N`, `Ending N`, `ED N`, nhưng giữ lại số thứ tự để gợi ý nhãn bài.
- **Tách tiêu đề** theo ` - `, `|`, `/`, `「」` thành nhiều phần. Tìm từng phần qua endpoint search của AnimeThemes, gộp kết quả, bỏ trùng, rồi lấy tối đa 3 ứng viên `{animeName, songLabel}`.
- **Cache** kết quả theo câu truy vấn đã làm sạch, giữ trong RAM suốt vòng đời process.
- **Giới hạn lượt gọi** bằng token bucket với 80 lời gọi mỗi phút cho toàn server (AnimeThemes cho phép 90). Khi hết lượt, request chờ tối đa 5 giây. Quá thời gian đó thì trả về danh sách ứng viên rỗng.
- Nếu AnimeThemes lỗi, hết thời gian chờ hoặc trả về 429, API vẫn trả `200` với `candidates: []`. Import không bao giờ thất bại chỉ vì không gợi ý được tên.

### 3.4 REST API

| Endpoint | Request | Response | Lỗi |
|---|---|---|---|
| `POST /api/import` | `{url}` | `{kind: "video"\|"playlist", tracks: [{videoId, videoTitle, durationSec}], skipped: [{videoId, title, reason}]}` | `400 INVALID_URL`, `404 NOT_FOUND`, `503 YOUTUBE_QUOTA`, `502 UPSTREAM_ERROR` |
| `GET /api/anime/suggest?title=` | | `{candidates: [{animeName, songLabel}]}` (≤3) | |
| `GET /api/anime/search?q=` | | `{candidates: [{animeName, songLabel}]}` (≤10) | `400` nếu `q` rỗng |
| `GET /api/health` | | `{ok: true}` | |

`reason` nhận một trong các giá trị `DELETED`, `PRIVATE`, `NOT_EMBEDDABLE`, `REGION_BLOCKED`.

## 4. Phòng chơi và vòng đời game

### 4.1 Thiết lập phòng

| Thiết lập | Mặc định | Giới hạn |
|---|---|---|
| `questionCount` | số nhỏ hơn giữa 10 và số bài trong bộ | 1 … số bài trong bộ |
| `clipSec` | 15 | 5–30 |
| `revealSec` | 15 | 0–30 (0 nghĩa là không phát thêm video lúc công bố đáp án) |
| `maxPlayers` | 30 | 2–50 |
| `mode` | `"stream"` | phiên bản 1 chỉ có giá trị này |

Các hằng số: `GRACE_SEC = 3` (thời gian bù), `MAX_DELAY_MS = 3000`, `CALIB_ROUNDS = 3`, `CALIB_TAP_WINDOW_MS = 5000`, `PREPARE_TIMEOUT_SEC = 10`.

**Điều kiện tạo phòng** (frontend kiểm tra trước, server kiểm tra lại):
- Bộ câu hỏi có ít nhất 1 bài.
- Bài nào cũng có `animeName` không rỗng và `needsReview = false`.
- Bộ câu hỏi có tối đa 500 bài.

### 4.2 Danh tính

- **Mã phòng:** 6 ký tự lấy từ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, không trùng với phòng đang tồn tại.
- `hostToken` và `playerToken` được tạo bằng `secrets.token_urlsafe(16)`. Client lưu token trong localStorage theo khóa `room:<code>`.
- **Tên người chơi:** được trim và dài 1–20 ký tự. Không được trùng trong phòng; khi so sánh thì không phân biệt hoa thường.
- Chỉ vào phòng mới được khi phòng ở trạng thái `LOBBY` hoặc `CALIBRATING`. Người chơi đã có token thì `rejoin` được ở mọi trạng thái.

### 4.3 Các trạng thái

```
LOBBY ──host:calibrate──► CALIBRATING ──đủ 3 lượt──► LOBBY
LOBBY ──host:start──► PREPARING(i) ──host:audio_started──► ANSWERING(i)
ANSWERING(i) ──hết hạn chót HOẶC mọi người online đã trả lời──► REVEAL(i)
REVEAL(i) ──host:next──► PREPARING(i+1)        (i là câu cuối ──host:next──► FINISHED)
PREPARING(i) | ANSWERING(i) | REVEAL(i) ──host:replay_round──► PREPARING(i)
PREPARING(i) ──host:audio_failed──► PREPARING(i) với bài thay thế (hoặc bỏ câu i)
FINISHED ──host:play_again──► LOBBY            (giữ người chơi và độ trễ, reset điểm)
mọi trạng thái ──host:close_room──► (phòng bị xóa, gửi room:closed)
```

- `host:start` yêu cầu phòng có ít nhất 1 người chơi. `host:calibrate` yêu cầu ít nhất 1 người chơi online.
- Mọi lệnh không hợp lệ với trạng thái hiện tại đều nhận ack `{ok:false, error:"INVALID_STATE"}` và không làm thay đổi phòng.

### 4.4 Đo độ trễ (`calibration.py`)

1. `host:calibrate`: phòng chuyển sang `CALIBRATING` với `calibRound = 1` và `waitMs` ngẫu nhiên trong khoảng 2000–4000.
2. Tab quản trò chờ `waitMs`, đếm ngược "3, 2, 1" (mỗi số 1 giây), rồi hiện **BẤM!** kèm tiếng bíp và gửi `host:calib_flash {round}`. Server ghi `T_flash` là giờ server lúc nhận event.
3. Người chơi bấm nút BẤM trên máy mình, gửi `player:calib_tap {round}`, server ghi `T_tap`. Mỗi người chỉ được tính 1 lần bấm mỗi lượt. Lần bấm đến trước `T_flash` hoặc sau `T_flash + CALIB_TAP_WINDOW_MS` bị loại.
4. Hết cửa sổ bấm thì sang lượt tiếp theo với `waitMs` ngẫu nhiên mới. Hết lượt 3 thì quay về `LOBBY`.
5. Độ trễ của người chơi bằng trung vị các mẫu `T_tap − T_flash` hợp lệ, giới hạn trong [0, `MAX_DELAY_MS`].
   - Người không có mẫu hợp lệ nào dùng trung vị độ trễ của những người đã đo trong phòng.
   - Nếu cả phòng chưa ai đo thì độ trễ bằng 0.
6. Có thể đo lại nhiều lần; kết quả lần đo mới ghi đè lần cũ. Độ trễ của từng người hiện công khai ở sảnh chờ trên màn hình stream.

### 4.5 Sinh câu hỏi (`question_builder.py`)

Câu hỏi được sinh mới mỗi lần `host:start`, kể cả lần bắt đầu sau `host:play_again`:

- **Chọn bài:** bốc ngẫu nhiên `questionCount` bài không lặp từ bộ câu hỏi, theo thứ tự ngẫu nhiên. Các bài còn lại là **dự phòng**, dùng để thay khi video lỗi.
- **Điểm bắt đầu** (gọi `D` là thời lượng bài):
  - Nếu `startSec` là số: dùng `clamp(startSec, 0, max(0, D − clipSec))`.
  - Nếu `startSec` là null: chọn ngẫu nhiên trong khoảng `[0.15·D, 0.85·D − clipSec]`. Khoảng này không hợp lệ khi bài quá ngắn; lúc đó dùng `max(0, (D − clipSec)/2)`.
  - Nếu `D ≤ clipSec` thì `start = 0` và clip của câu đó kéo dài `D` giây.
  - `endSec = min(D, start + clipSec + revealSec)`.
- **Đáp án:**
  - Đáp án đúng là `animeName` của bài.
  - Đáp án nhiễu là 3 tên lấy ngẫu nhiên từ các tên anime khác nhau trong bộ, trừ tên đúng. Tên được chuẩn hóa bằng `casefold()` sau khi `strip()`.
  - Nếu bộ không đủ 3 tên khác thì bổ sung từ `popular_anime.json`, bỏ qua các tên trùng với bất kỳ tên nào trong bộ sau khi chuẩn hóa.
  - Xáo trộn thứ tự 4 đáp án.

### 4.6 Trả lời và tính điểm (`scoring.py`)

- `clip` là độ dài clip thực tế của câu: bằng `clipSec`, hoặc bằng `D` nếu bài ngắn hơn `clipSec`.
- `T0` là giờ server lúc nhận `host:audio_started`. Hạn chót: `deadline = T0 + clip·1000 + GRACE_SEC·1000`.
- Server chỉ nhận `player:answer {roundIndex, optionIndex}` khi thỏa tất cả các điều kiện sau. Nếu không thì ack trả về lỗi tương ứng.
  - Phòng đang ở `ANSWERING`.
  - `roundIndex` khớp với câu hiện tại.
  - Người chơi chưa trả lời câu này.
  - `now ≤ deadline`.
- **Thời gian hiệu dụng:** `t = max(0, t_nhận − T0 − delayMs)` (ms).
- **Điểm:**
  - Đúng: `round(1000 − 500 · min(t, clip·1000) / (clip·1000))`, tức từ 1000 xuống 500.
  - Sai hoặc không trả lời: 0.
- Phòng chuyển sang `REVEAL` ngay khi tới `deadline`, hoặc sớm hơn khi mọi người chơi đang online đều đã trả lời. Điều kiện thứ hai chỉ áp dụng khi phòng có ít nhất 1 người online.
- **Xếp hạng:** sắp theo tổng điểm giảm dần. Người bằng điểm thì đồng hạng (kiểu 1, 2, 2, 4).

### 4.7 Socket.IO events

**Client gửi lên server** (mọi event đều có ack dạng `{ok: true, ...}` hoặc `{ok: false, error: CODE}`):

| Event | Payload | Ack khi thành công |
|---|---|---|
| `host:create_room` | `{set, settings}` | `{code, hostToken}` |
| `host:resume` | `{code, hostToken}` | `{}` |
| `host:kick` | `{playerId}` | `{}` |
| `host:calibrate` | `{}` | `{}` |
| `host:calib_flash` | `{round}` | `{}` |
| `host:start` | `{}` | `{}` |
| `host:audio_started` | `{roundIndex}` | `{}` |
| `host:audio_failed` | `{roundIndex, reason}` | `{}` |
| `host:replay_round` | `{}` | `{}` |
| `host:next` | `{}` | `{}` |
| `host:play_again` | `{}` | `{}` |
| `host:close_room` | `{}` | `{}` |
| `player:join` | `{code, name}` | `{playerId, playerToken}` |
| `player:rejoin` | `{code, playerToken}` | `{}` |
| `player:calib_tap` | `{round}` | `{}` |
| `player:answer` | `{roundIndex, optionIndex}` | `{}` |

Các mã lỗi: `ROOM_NOT_FOUND`, `ROOM_FULL`, `GAME_STARTED`, `NAME_TAKEN`, `INVALID_NAME`, `INVALID_TOKEN`, `INVALID_STATE`, `INVALID_SET`, `ALREADY_ANSWERED`, `TOO_LATE`, `KICKED`. Frontend dịch các mã này sang tiếng Việt.

**Server gửi xuống client:**
- `room:state`: snapshot theo vai trò.
- `room:closed {reason}`: gửi khi quản trò đóng phòng, khi phòng bị dọn, hoặc khi người chơi bị kick (`reason: "KICKED"`).

**Snapshot cho quản trò** (`host_view`):
```
{ code, phase, mode, settings, serverNow,
  players: [{id, name, online, delayMs, calibrated, score}],
  calib?: {round, waitMs, flashed},
  round?: { index, total, videoId, startSec, endSec, options[4], deadline,
            answeredCount, onlineCount,
            reveal?: {correctIndex, optionCounts[4], animeName, songLabel} },
  leaderboard: [{playerId, name, score, rank, gained?}],
  notice?: "AUDIO_REPLACED" | "ROUND_DROPPED" }
```

**Snapshot cho người chơi** (`player_view`): không bao giờ có `videoId`, `startSec`, hay `correctIndex` trước khi phòng sang REVEAL.
```
{ code, phase, serverNow, hostOnline, playerCount,
  me: {id, name, score, rank, delayMs, calibrated},
  calib?: {round, tapped},
  round?: { index, total, options[4] (chỉ có từ ANSWERING), deadline, myAnswer,
            result?: {correctIndex, correct, gained, animeName, songLabel} },
  leaderboardTop: [...top 10] (chỉ có ở REVEAL và FINISHED) }
```

**Đồng hồ:** client tính `offset = serverNow − Date.now()` mỗi lần nhận snapshot, rồi hiển thị đếm ngược theo `deadline − (Date.now() + offset)`. Đồng hồ trên client chỉ dùng để hiển thị; server mới là bên quyết định thời gian.

## 5. Phát nhạc và giao diện

### 5.1 `YouTubePlayer` (chỉ chạy ở tab quản trò)

- Cài đặt interface `AudioPlayer`: `load({videoId, startSec, endSec})`, `onPlaying(cb)`, `onError(cb)`, `setVolume(v)`, `stop()`, `currentTime()`.
- Cả ván chỉ dùng **1 instance `YT.Player`**, tạo khi màn hình quản trò được mount. Lần phát đầu tiên diễn ra sau khi quản trò bấm "Bắt đầu", và thao tác bấm đó khiến trình duyệt cho phép phát âm thanh.
- `playerVars`: `controls:0, disablekb:1, rel:0, fs:0, iv_load_policy:3, playsinline:1`.
- **Iframe luôn nằm cố định một chỗ trong DOM** (được định vị tuyệt đối). Khi chuyển trạng thái, tool chỉ đổi kích thước và vị trí bằng CSS. Nếu di chuyển iframe trong cây DOM, trình duyệt sẽ tải lại video.
  - `PREPARING` và `ANSWERING`: iframe 320×180, bị một lớp phủ đục (đĩa nhạc quay hoặc thanh sóng âm) che kín. Lớp phủ chặn mọi click vào iframe.
  - `REVEAL`: lớp phủ mờ dần, iframe phóng to thành khung 16:9 lớn, nhạc phát tiếp liền mạch.
- **PREPARING:** gọi `loadVideoById({videoId, startSeconds: startSec, endSeconds: endSec})`. Khi trạng thái là `PLAYING` **và** `getCurrentTime() ≥ startSec − 1` thì gửi `host:audio_started`, mỗi câu chỉ gửi 1 lần. Điều kiện thứ hai để quảng cáo phát trước không bị tính nhầm là nhạc đã bắt đầu.
- **Gửi `host:audio_failed`** khi `onError` trả về mã 2, 5, 100, 101 hoặc 150, hoặc khi đã quá `PREPARE_TIMEOUT_SEC` mà vẫn chưa thỏa điều kiện ở trên. Event này chỉ hợp lệ ở PREPARING. Nếu video lỗi khi đang ở ANSWERING, quản trò dùng nút [Phát lại câu này].
- Có thanh chỉnh âm lượng trên màn hình quản trò; giá trị được lưu vào localStorage.
- Khi rời câu hiện tại (`host:next`, `host:replay_round`, `FINISHED`): gọi `stop()` hoặc `load` bài kế tiếp.

### 5.2 Màn hình quản trò (16:9, chữ to, dành để stream)

- **LOBBY:**
  - Mã phòng cỡ lớn, link `/play/<code>` và mã QR.
  - Danh sách người chơi, mỗi người có huy hiệu độ trễ (ví dụ `1.2s`), người offline hiện màu xám, có nút kick.
  - Tóm tắt thiết lập phòng; các nút **[Đo độ trễ]** và **[Bắt đầu]**.
- **CALIBRATING:** "Lượt k/3", đếm ngược "3, 2, 1", rồi hiện **BẤM!** cỡ lớn kèm tiếng bíp, và số người đã bấm.
- **PREPARING:** "Câu i/N: chuẩn bị…".
- **ANSWERING:** số câu, vòng đếm ngược, lớp phủ, 4 ô đáp án (A ▲, B ◆, C ●, D ■, mỗi ô một màu cố định), dòng "x/y đã trả lời", nút [Phát lại câu này].
- **REVEAL:** video lớn ở bên trái. Bên phải là ô đáp án đúng, tên anime, nhãn bài, số người chọn mỗi đáp án, top 10 kèm điểm vừa cộng. Có các nút [Câu tiếp →] và [Phát lại câu này].
- **FINISHED:** bục vinh quang cho top 3, bảng xếp hạng đầy đủ, các nút [Chơi lại] [Đóng phòng].
- Có lớp thông báo nhỏ cho `notice`, ví dụ "Video lỗi, đã đổi bài khác".

### 5.3 Màn hình người chơi (ưu tiên điện thoại)

- **Nhập tên**, rồi vào **sảnh chờ** ("Chờ quản trò bắt đầu…", hiện tên mình và số người trong phòng).
- **CALIBRATING:** một nút **BẤM** chiếm cả màn hình, kèm hướng dẫn "Bấm đúng lúc thấy hoặc nghe BẤM! trên stream". Sau khi bấm thì hiện "Đã bấm lượt k".
- **PREPARING:** "Câu i: chuẩn bị nghe…".
- **ANSWERING:** 4 ô lớn, cùng màu và cùng ký hiệu với các ô trên stream, kèm đồng hồ đếm ngược. Sau khi chọn, các ô bị khóa và hiện "Đã chọn B, chờ kết quả".
- **REVEAL:** "✅ Đúng! +870 · Hạng 4" hoặc "❌ Sai, đáp án là A · Shingeki no Kyojin".
- **FINISHED:** thứ hạng và điểm chung cuộc, top 3.
- Khi `hostOnline = false` thì hiện banner "Quản trò mất kết nối, đang chờ…".

## 6. Xử lý lỗi

| Tình huống | Cách xử lý |
|---|---|
| Người chơi rớt mạng | Socket.IO tự kết nối lại, client gửi `player:rejoin`, server gửi snapshot. Trong lúc mất kết nối, `online=false`. Điều kiện "mọi người đã trả lời" chỉ tính người online. Câu bị lỡ được 0 điểm |
| Quản trò reload hoặc rớt mạng | Timer trên server vẫn chạy: phòng đang ở ANSWERING sẽ tự sang REVEAL. Phòng đang ở PREPARING thì giữ nguyên chờ quản trò quay lại. Quản trò gửi `host:resume` để lấy snapshot; nếu phòng đang PREPARING thì tab quản trò tải lại video. Nếu quản trò offline quá 15 phút thì phòng bị xóa |
| Video lỗi giữa ván | Gửi `host:audio_failed`. Server thay bằng bài dự phòng (đáp án và điểm bắt đầu được sinh lại) và đặt `notice=AUDIO_REPLACED`. Nếu hết bài dự phòng thì bỏ câu đó (tổng số câu giảm 1) và đặt `notice=ROUND_DROPPED` |
| Sự cố khi đang phát (khựng, quảng cáo dài, lỡ tay) | Quản trò bấm [Phát lại câu này]: hủy câu trả lời của câu hiện tại và trừ lại điểm nếu câu đó đã công bố đáp án, rồi quay về PREPARING(i) |
| Server restart | Phòng mất. Client nhận `ROOM_NOT_FOUND` khi resume hoặc rejoin, hiện "Phòng không còn tồn tại" rồi quay về trang chủ. Bộ câu hỏi vẫn còn trong localStorage |
| Lỗi khi vào phòng | Ack trả về mã lỗi (mục 4.7), frontend hiện thông báo tiếng Việt |
| Lỗi khi import | Link sai, playlist riêng tư hoặc hết hạn mức YouTube API (`403 quotaExceeded`, trả về `503 YOUTUBE_QUOTA`) đều có thông báo rõ ràng. AnimeThemes lỗi thì chỉ mất phần gợi ý tên |
| Gian lận | Chỉ socket đã xác thực bằng token mới gửi được đáp án. Mỗi câu trả lời 1 lần. Thời gian do server đo. Snapshot người chơi không chứa đáp án đúng. Độ trễ đo được bị giới hạn 3 giây và hiện công khai |
| Dọn phòng | Tác vụ chạy mỗi 5 phút xóa phòng `FINISHED` quá 30 phút, phòng có quản trò offline quá 15 phút, và phòng tồn tại quá 4 giờ |

## 7. Kiểm thử

### 7.1 Backend (pytest; giả lập HTTP bằng `respx`)

- `scoring`: t=0 được 1000 điểm; t=clip được 500; t nằm trong thời gian bù được 500; sai được 0; `t_nhận − T0 − delay < 0` thì t tính là 0.
- `calibration`: lấy trung vị; loại lần bấm sớm hoặc trễ; giới hạn 3 giây; người chưa đo dùng trung vị của phòng; cả phòng chưa đo thì bằng 0; mỗi lượt chỉ tính 1 lần bấm.
- `question_builder` (dùng rng có seed): bốc đủ N bài không lặp; 4 đáp án khác nhau và có đáp án đúng; bổ sung từ file anime phổ biến; điểm bắt đầu nằm đúng khoảng; bài ngắn hơn clip; `startSec` cố định bị clamp; `endSec` không vượt quá `D`.
- `room`: mọi chuyển trạng thái hợp lệ; lệnh sai trạng thái trả `INVALID_STATE`; trả lời 2 lần; trả lời quá hạn; sang REVEAL sớm khi mọi người online đã trả lời; phát lại câu (kể cả hoàn điểm); thay bài khi video lỗi và khi hết bài dự phòng; chơi lại.
- `room_manager`: mã phòng không trùng; dọn phòng đúng 3 điều kiện.
- `views`: snapshot người chơi không chứa `videoId` hay `correctIndex` trước REVEAL.
- `title_cleaner`: bảng khoảng 30 tiêu đề YouTube thật kèm kết quả mong đợi.
- `youtube`: tách các dạng link; phân trang playlist; loại video theo đủ 4 lý do; hết hạn mức thì trả `YOUTUBE_QUOTA`.
- `anime_lookup`: gộp kết quả và bỏ trùng; cache; hết lượt hoặc lỗi thì trả danh sách rỗng.
- **Tích hợp:** dùng `socketio.AsyncClient` với server test, chạy 1 quản trò và 3 người chơi qua đủ các bước: tạo phòng, vào phòng, đo độ trễ, bắt đầu, `audio_started`, trả lời, REVEAL, câu tiếp, FINISHED. Thêm test rejoin, kick và các mã lỗi.

### 7.2 Frontend (Vitest và React Testing Library)

- `sets/storage` và `sets/schema`: lưu, đọc, xuất, nhập; từ chối file sai phiên bản hoặc thiếu trường.
- Mỗi trang vẽ đúng giao diện theo snapshot mẫu. Các ô đáp án bị khóa sau khi chọn.
- `SetEditor`: chặn tạo phòng khi còn bài `needsReview`; nút "Chấp nhận tất cả gợi ý" hoạt động đúng.

### 7.3 E2E

Playwright chạy 3 trình duyệt riêng (1 quản trò, 2 người chơi) với `VITE_FAKE_PLAYER=1`, đi hết một ván 2 câu.

### 7.4 Kiểm tra thủ công với Discord thật

- [ ] Chia sẻ màn hình kèm âm thanh từ tab trình duyệt trên máy quản trò.
- [ ] Độ trễ đo được hợp lý (thường 0.5–3 giây) và ổn định giữa các lần đo.
- [ ] Video có quảng cáo: phải chờ lâu hơn nhưng đồng hồ vẫn tính đúng.
- [ ] Điện thoại tắt màn hình rồi mở lại: người chơi tự vào lại và màn hình đúng trạng thái.
- [ ] Màn hình stream không làm lộ tiêu đề hay hình ảnh video khi đang đố.

## 8. Rủi ro và thử nghiệm kỹ thuật đầu tiên (spike)

**Làm trước tiên trong kế hoạch:** viết một trang HTML thử YouTube IFrame API để kiểm tra:
1. Thời điểm chuyển sang `PLAYING` và giá trị `getCurrentTime()` khi có quảng cáo.
2. `endSeconds` có dừng đúng mốc không.
3. Đổi kích thước hoặc vị trí iframe bằng CSS (`position: absolute`) có làm video tải lại không.
4. Trình duyệt có cho tự phát âm thanh sau 1 lần click trên trang không (Chrome, Edge, Safari).

Nếu kết quả khác giả định thì cập nhật mục 5.1 trước khi làm tiếp.

**Các rủi ro khác:**
- **Điều khoản YouTube:** việc che player YouTube có thể không phù hợp điều khoản của YouTube API. Tool này dùng trong nhóm bạn bè, nên chấp nhận rủi ro.
- **Quảng cáo trong video nhúng:** khuyên quản trò dùng YouTube Premium hoặc trình chặn quảng cáo.
- **Hạn mức YouTube Data API** (10.000 đơn vị mỗi ngày): một playlist 200 bài tốn khoảng 8 đơn vị, nên dư thừa.
- **Độ chính xác của gợi ý tên anime:** quản trò luôn xác nhận lại. Bộ test `title_cleaner` dùng để cải thiện dần.
- **Host miễn phí cho server ngủ:** lần mở đầu chậm 30–60 giây. Khi chơi thật nên dùng gói không ngủ.

## 9. Deploy

- `Dockerfile` build theo 2 giai đoạn: (1) `node` build `frontend/`; (2) `python:3.12-slim` copy kết quả build vào `backend/app/static`, rồi chạy `uvicorn app.main:app --workers 1`.
- Biến môi trường: `YOUTUBE_API_KEY` (bắt buộc), `YOUTUBE_REGION` (mặc định `VN`), `PORT`.
- FastAPI trả `index.html` cho mọi đường dẫn không bắt đầu bằng `/api` hoặc `/socket.io`, để React Router xử lý.
- Nơi deploy: Render, Railway hoặc Fly.io, chạy 1 instance.

## 10. Mở rộng sau này (không làm ở phiên bản 1)

- **Chế độ `self`:** server gửi `playAt` theo giờ server, client chờ buffer xong rồi báo `ready`, và có màn "chạm để bật âm thanh" trên điện thoại. Phần đã chừa sẵn: trường `mode` trên phòng, và interface `AudioPlayer` tách khỏi màn hình.
- Lưu bộ câu hỏi trên server, chia sẻ bộ câu hỏi bằng mã.
