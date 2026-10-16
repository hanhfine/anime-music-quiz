# Đoán anime qua nhạc

Web app tổ chức thử thách "nghe nhạc đoán anime". Quản trò mở phòng và chia sẻ màn hình (ví dụ qua Discord). Tab của quản trò phát đoạn nhạc từ YouTube; người chơi vào phòng bằng mã hoặc mã QR và chọn 1 trong 4 đáp án trên điện thoại của mình. Server tính điểm và bù độ trễ stream của từng người.

## Cách chơi

1. Mở **Bộ câu hỏi** (`/sets`), tạo bộ mới rồi dán link YouTube: một video, hoặc một playlist (tối đa 200 bài mỗi lần). Kiểm tra tên anime app gợi ý cho từng bài. Nếu AnimeThemes đang bận và một số bài chưa có tên, đợi một lát rồi bấm **Gợi ý lại**. Bộ câu hỏi chỉ lưu trong trình duyệt này, nên hãy xuất ra file JSON để sao lưu hoặc mang sang máy khác.
2. Chọn số câu, độ dài đoạn nhạc và thời gian công bố, rồi bấm **Tạo phòng**. Phòng chỉ dùng các bài đã có tên và đã xác nhận; bài chưa xong được bỏ qua, không cần chờ.
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
- Render: repo có sẵn `render.yaml`. Vào Dashboard → **New → Blueprint**, chọn repo, nhập `YOUTUBE_API_KEY` rồi bấm **Deploy**. Mỗi lần push lên nhánh đã chọn, Render tự build lại.
- **Chỉ chạy 1 instance, 1 worker.** Phòng chơi nằm trong RAM: khởi động lại server là mất các phòng đang chơi. Bộ câu hỏi vẫn còn, vì nó nằm trong trình duyệt của quản trò.
- Cần HTTPS và WebSocket; các nền tảng trên đều có sẵn.
- Gói miễn phí thường cho server "ngủ" khi không có ai dùng, nên lần mở đầu chậm 30–60 giây. Khi chơi thật, nên dùng gói không ngủ hoặc mở trang trước vài phút.
