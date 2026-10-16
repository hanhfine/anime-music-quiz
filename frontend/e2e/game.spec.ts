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
