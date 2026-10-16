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

  it('lets the host create a room as soon as some suggestions are accepted', async () => {
    mockApi({
      '/api/import': () => json({ kind: 'playlist', tracks: [TRACK_A, TRACK_B], skipped: [] }),
      '/api/anime/suggest': (url) =>
        json({ candidates: [{ animeName: `Gợi ý cho ${url.searchParams.get('title')}`, songLabel: null }] }),
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://www.youtube.com/playlist?list=PL123')

    expect(
      await screen.findByText('Chưa có bài nào sẵn sàng: hãy đặt tên anime hoặc xác nhận gợi ý'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Gợi ý, chưa xác nhận')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeDisabled()

    await user.click(within(row(1)).getByRole('button', { name: 'Xác nhận' }))
    expect(screen.getByRole('button', { name: 'Tạo phòng' })).toBeEnabled()
    expect(screen.getByText('Phòng sẽ dùng 1/2 bài, bỏ qua 1 bài chưa xác nhận tên')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chấp nhận tất cả gợi ý (1)' }))
    expect(screen.queryByText(/Phòng sẽ dùng/)).not.toBeInTheDocument()
    expect(screen.queryByText('Gợi ý, chưa xác nhận')).not.toBeInTheDocument()
    expect(loadSet(set.id)?.songs.every((song) => !song.needsReview)).toBe(true)
  })

  it('reports failed suggestions and retries the unnamed songs on request', async () => {
    let available = false
    mockApi({
      '/api/import': () => json({ kind: 'playlist', tracks: [TRACK_A, TRACK_B], skipped: [] }),
      '/api/anime/suggest': (url) =>
        available
          ? json({ candidates: [{ animeName: `Tên cho ${url.searchParams.get('title')}`, songLabel: null }] })
          : json({ error: 'LOOKUP_UNAVAILABLE' }, 503),
    })
    const set = saveSet(newSet('Thử'))
    const { user } = renderEditor(set.id)
    await importLink(user, 'https://www.youtube.com/playlist?list=PL123')

    expect(
      await screen.findByText('Không tra được tên cho 2 bài vì AnimeThemes đang bận. Đợi một lát rồi bấm Gợi ý lại.'),
    ).toBeInTheDocument()
    expect(within(row(1)).getByText('Không tra được tên')).toBeInTheDocument()

    available = true
    await user.click(screen.getByRole('button', { name: 'Gợi ý lại (2)' }))
    await waitFor(() => expect(within(row(2)).getByLabelText('Tên anime')).toHaveValue('Tên cho Bài không rõ'))
    expect(within(row(1)).getByLabelText('Tên anime')).toHaveValue(`Tên cho ${TRACK_A.videoTitle}`)
    expect(screen.queryByText(/Không tra được/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gợi ý lại/ })).not.toBeInTheDocument()
  })

  it('offers to re-suggest unnamed songs of a set opened later', async () => {
    mockApi({
      '/api/anime/suggest': () => json({ candidates: [{ animeName: 'Bleach', songLabel: 'OP1' }] }),
    })
    const set = saveSet({ ...newSet('Thử'), songs: [named(TRACK_A, 'Shingeki no Kyojin'), named(TRACK_B, '')] })
    const { user } = renderEditor(set.id)

    await user.click(screen.getByRole('button', { name: 'Gợi ý lại (1)' }))
    await waitFor(() => expect(within(row(2)).getByLabelText('Tên anime')).toHaveValue('Bleach'))
    expect(within(row(2)).getByText('Gợi ý, chưa xác nhận')).toBeInTheDocument()
    expect(within(row(1)).getByLabelText('Tên anime')).toHaveValue('Shingeki no Kyojin')
  })

  it('tells a failed name search apart from no results', async () => {
    mockApi({ '/api/anime/search': () => json({ error: 'LOOKUP_UNAVAILABLE' }, 503) })
    const set = saveSet({ ...newSet('Thử'), songs: [named(TRACK_A, 'Shingeki no Kyojin')] })
    const { user } = renderEditor(set.id)

    await user.type(within(row(1)).getByLabelText('Tìm tên anime'), 'kimetsu')
    await user.click(within(row(1)).getByRole('button', { name: 'Tìm' }))
    expect(await within(row(1)).findByText(/Không tra được tên anime/)).toBeInTheDocument()
    expect(within(row(1)).queryByText('Không tìm thấy')).not.toBeInTheDocument()
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
