import { expect, test, type Page } from '@playwright/test'
import { createRoom, currentAnime, join, newPage } from './helpers.ts'

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
  const code = await createRoom(host, 2)

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
