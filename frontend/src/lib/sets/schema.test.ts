import { describe, expect, it } from 'vitest'
import { newSet, parseQuestionSet, readySongs, roomBlocker, unreadyNote, type Song } from './schema'

const song = (overrides: Partial<Song> = {}): Song => ({
  videoId: '8OkpRK2_gVs',
  videoTitle: 'Shingeki no Kyojin OP1 Full - Guren no Yumiya',
  durationSec: 312,
  animeName: 'Shingeki no Kyojin',
  songLabel: 'OP1 · Guren no Yumiya',
  startSec: null,
  needsReview: false,
  ...overrides,
})

const validSet = () => ({
  version: 1,
  id: 'set-1',
  name: 'Anime OP 2010s',
  updatedAt: '2026-10-16T12:00:00Z',
  songs: [song()],
})

describe('parseQuestionSet', () => {
  it('accepts a valid set', () => {
    expect(parseQuestionSet(validSet())).toEqual({ ok: true, set: validSet() })
  })

  it('defaults missing songLabel and startSec to null and drops unknown fields', () => {
    const data = validSet()
    const raw = { ...song(), extra: 'x' } as Record<string, unknown>
    delete raw.songLabel
    delete raw.startSec
    const result = parseQuestionSet({ ...data, songs: [raw], extra: 1 })
    expect(result).toEqual({ ok: true, set: { ...data, songs: [song({ songLabel: null, startSec: null })] } })
  })

  it('rejects unsupported versions', () => {
    expect(parseQuestionSet({ ...validSet(), version: 2 })).toEqual({
      ok: false,
      error: 'Trường "version" không được hỗ trợ: 2 (chỉ hỗ trợ 1)',
    })
  })

  it('names the missing top-level field', () => {
    const { name: _name, ...noName } = validSet()
    expect(parseQuestionSet(noName)).toEqual({ ok: false, error: 'Trường "name" bị thiếu hoặc sai kiểu' })
    expect(parseQuestionSet({ ...validSet(), id: '' })).toEqual({
      ok: false,
      error: 'Trường "id" bị thiếu hoặc sai kiểu',
    })
    expect(parseQuestionSet({ ...validSet(), songs: 'x' })).toEqual({
      ok: false,
      error: 'Trường "songs" bị thiếu hoặc sai kiểu',
    })
  })

  it('names the bad song field with its index', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ durationSec: 0 }, 'songs[1].durationSec'],
      [{ durationSec: 12.5 }, 'songs[1].durationSec'],
      [{ videoId: 'short' }, 'songs[1].videoId'],
      [{ animeName: 3 }, 'songs[1].animeName'],
      [{ needsReview: 'no' }, 'songs[1].needsReview'],
      [{ startSec: -1 }, 'songs[1].startSec'],
      [{ songLabel: 5 }, 'songs[1].songLabel'],
    ]
    for (const [bad, path] of cases) {
      const result = parseQuestionSet({ ...validSet(), songs: [song(), { ...song(), ...bad }] })
      expect(result).toEqual({ ok: false, error: `Trường "${path}" bị thiếu hoặc sai kiểu` })
    }
    expect(parseQuestionSet({ ...validSet(), songs: [song(), 'oops'] })).toEqual({
      ok: false,
      error: 'Trường "songs[1]" bị thiếu hoặc sai kiểu',
    })
  })

  it('rejects data that is not a set at all', () => {
    expect(parseQuestionSet([1, 2])).toEqual({ ok: false, error: 'File không chứa bộ câu hỏi' })
    expect(parseQuestionSet(null)).toEqual({ ok: false, error: 'File không chứa bộ câu hỏi' })
  })
})

describe('roomBlocker', () => {
  it('blocks an empty set', () => {
    expect(roomBlocker([])).toBe('Bộ câu hỏi chưa có bài nào')
  })

  it('blocks more than 500 songs', () => {
    expect(roomBlocker(Array.from({ length: 501 }, () => song()))).toBe('Bộ câu hỏi có tối đa 500 bài')
  })

  it('blocks only when no song is ready yet', () => {
    expect(roomBlocker([song({ animeName: '  ' }), song({ needsReview: true })])).toBe(
      'Chưa có bài nào sẵn sàng: hãy đặt tên anime hoặc xác nhận gợi ý',
    )
    expect(roomBlocker([song({ animeName: '  ' }), song({ needsReview: true }), song()])).toBeNull()
  })
})

describe('readySongs', () => {
  it('keeps only songs that have a confirmed anime name', () => {
    const ready = song({ videoId: 'readyready1' })
    expect(readySongs([song({ animeName: ' ' }), ready, song({ needsReview: true })])).toEqual([ready])
  })
})

describe('unreadyNote', () => {
  it('is null when every song is ready', () => {
    expect(unreadyNote([song(), song()])).toBeNull()
  })

  it('says how many songs the room will leave out and why', () => {
    expect(
      unreadyNote([song(), song({ animeName: '' }), song({ needsReview: true }), song({ needsReview: true })]),
    ).toBe('Phòng sẽ dùng 1/4 bài, bỏ qua 1 bài chưa có tên và 2 bài chưa xác nhận tên')
    expect(unreadyNote([song(), song({ needsReview: true })])).toBe(
      'Phòng sẽ dùng 1/2 bài, bỏ qua 1 bài chưa xác nhận tên',
    )
  })

  it('allows a complete set', () => {
    expect(roomBlocker([song()])).toBeNull()
  })
})

describe('newSet', () => {
  it('creates an empty version-1 set with a fresh id', () => {
    const set = newSet('Thử', new Date('2026-10-16T12:00:00Z'))
    expect(set).toMatchObject({ version: 1, name: 'Thử', updatedAt: '2026-10-16T12:00:00.000Z', songs: [] })
    expect(set.id).not.toBe(newSet().id)
  })
})
