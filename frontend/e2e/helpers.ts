import { expect, type Browser, type Page } from '@playwright/test'

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

export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

// Quản trò nhập bộ câu hỏi từ file rồi tạo phòng; trả về mã phòng.
export async function createRoom(host: Page, questionCount: number): Promise<string> {
  await host.goto('/sets')
  await host.getByLabel('Nhập file JSON').setInputFiles({
    name: 'e2e.animequiz.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(SET)),
  })
  await host.getByRole('link', { name: 'E2E OP' }).click()
  await host.getByLabel('Số câu').fill(String(questionCount))
  await host.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(host).toHaveURL(/\/host\/[A-Z2-9]{6}$/)
  return ((await host.getByTestId('room-code').textContent()) ?? '').trim()
}

export async function join(page: Page, code: string, name: string) {
  await page.goto(`/play/${code}`)
  await page.getByLabel('Tên của bạn').fill(name)
  await page.getByRole('button', { name: 'Vào phòng' }).click()
  await expect(page.getByText('Chờ quản trò bắt đầu…')).toBeVisible()
}

// FakePlayer in videoId đang phát vào khung nhạc của quản trò; từ đó biết đáp án đúng.
export async function currentAnime(host: Page): Promise<string> {
  const text = (await host.getByTestId('fake-player').textContent()) ?? ''
  const song = SONGS.find((s) => text.includes(s.videoId))
  if (!song) throw new Error(`Không nhận ra bài đang phát: ${text}`)
  return song.animeName
}
