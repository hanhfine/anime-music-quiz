import { expect, test, type Page } from '@playwright/test'
import { createRoom, currentAnime, join, newPage } from './helpers.ts'

test('two teams vote and see the team results', async ({ browser }) => {
  const host = await newPage(browser)
  const code = await createRoom(host, 1)
  const mai = await newPage(browser)
  const long = await newPage(browser)
  await join(mai, code, 'Mai')
  await join(long, code, 'Long')
  await expect(host.getByText('Người chơi (2/30)')).toBeVisible()

  // Bật chế độ đội: người vào trước ở Đội Đỏ, người sau ở Đội Chanh.
  await host.getByRole('radio', { name: 'Theo đội' }).click()
  await expect(host.getByRole('region', { name: 'Đội Đỏ' }).getByText('Mai')).toBeVisible()
  await expect(host.getByRole('region', { name: 'Đội Chanh' }).getByText('Long')).toBeVisible()
  await expect(mai.getByRole('button', { name: 'Đội Đỏ' })).toHaveAttribute('aria-pressed', 'true')
  await expect(long.getByRole('button', { name: 'Đội Chanh' })).toHaveAttribute('aria-pressed', 'true')

  await host.getByRole('button', { name: 'Bắt đầu' }).click()
  await expect(host.getByRole('heading', { name: 'Câu 1/1', exact: true })).toBeVisible()
  const anime = await currentAnime(host)
  const right = mai.getByRole('button', { name: new RegExp(`^[A-D]: ${anime}$`) })
  const wrong = (page: Page) => page.getByRole('button', { name: /^[A-D]: / }).filter({ hasNotText: anime }).first()

  // Mai bầu sai rồi đổi sang đúng, Long bầu sai. Mọi người đã bầu, không đội nào hòa nên công bố ngay.
  await wrong(mai).click()
  await right.click()
  await expect(right).toHaveAttribute('data-state', 'chosen')
  await expect(right).toContainText('1 phiếu')
  await wrong(long).click()

  await expect(host.getByRole('heading', { name: anime, exact: true })).toBeVisible()
  await expect(host.locator('[data-state="correct"]')).toContainText('Đội Đỏ')
  await expect(mai.getByText(/^ĐỘI ĐÚNG! \+\d+$/)).toBeVisible()
  await expect(long.getByText('ĐỘI SAI', { exact: true })).toBeVisible()

  await host.getByRole('button', { name: 'Xem kết quả' }).click()
  await expect(host.getByRole('list', { name: 'Bảng xếp hạng đội' })).toBeVisible()
  await expect(mai.getByText('Đội Đỏ · Hạng 1/2')).toBeVisible()
  await expect(long.getByText('Đội Chanh · Hạng 2/2')).toBeVisible()
})
