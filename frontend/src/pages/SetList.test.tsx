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
