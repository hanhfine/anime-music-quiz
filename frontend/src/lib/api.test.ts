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
