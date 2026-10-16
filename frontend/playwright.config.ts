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
