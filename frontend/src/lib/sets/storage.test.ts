import { describe, expect, it } from 'vitest'
import { newSet, type QuestionSet } from './schema'
import {
  deleteSet,
  exportFileName,
  exportSetJson,
  importSetJson,
  listSets,
  loadSet,
  saveSet,
} from './storage'

const song = {
  videoId: '8OkpRK2_gVs',
  videoTitle: 'Guren no Yumiya',
  durationSec: 312,
  animeName: 'Shingeki no Kyojin',
  songLabel: null,
  startSec: null,
  needsReview: false,
}

const withSongs = (set: QuestionSet): QuestionSet => ({ ...set, songs: [song] })

describe('storage', () => {
  it('saves under animequiz:set:<id> and stamps updatedAt', () => {
    const set = withSongs(newSet('A'))
    const saved = saveSet(set, new Date('2026-10-16T13:00:00Z'))
    expect(saved.updatedAt).toBe('2026-10-16T13:00:00.000Z')
    expect(localStorage.getItem(`animequiz:set:${set.id}`)).not.toBeNull()
    expect(loadSet(set.id)).toEqual(saved)
  })

  it('returns null for missing or corrupted sets', () => {
    expect(loadSet('nope')).toBeNull()
    localStorage.setItem('animequiz:set:bad', '{oops')
    expect(loadSet('bad')).toBeNull()
  })

  it('lists valid sets newest first and ignores other keys', () => {
    const older = saveSet(newSet('Cũ'), new Date('2026-10-01T00:00:00Z'))
    const newer = saveSet(newSet('Mới'), new Date('2026-10-02T00:00:00Z'))
    localStorage.setItem('animequiz:set:bad', '{oops')
    localStorage.setItem('room:ABC234', '{}')
    expect(listSets().map((s) => s.id)).toEqual([newer.id, older.id])
  })

  it('deletes a set', () => {
    const set = saveSet(newSet())
    deleteSet(set.id)
    expect(loadSet(set.id)).toBeNull()
  })

  it('round-trips through export and import', () => {
    const set = withSongs(newSet('Anime OP'))
    const result = importSetJson(exportSetJson(set))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.set).toMatchObject({ id: set.id, name: 'Anime OP', songs: [song] })
    expect(loadSet(set.id)?.songs).toEqual([song])
  })

  it('gives an imported set a new id when the id already exists', () => {
    const set = saveSet(withSongs(newSet('Gốc')))
    const result = importSetJson(exportSetJson(set))
    expect(result.ok && result.set.id !== set.id).toBe(true)
    expect(listSets()).toHaveLength(2)
  })

  it('reports invalid JSON and invalid sets without saving', () => {
    expect(importSetJson('not json')).toEqual({ ok: false, error: 'File không phải JSON hợp lệ' })
    expect(importSetJson(JSON.stringify({ ...newSet(), version: 9 }))).toEqual({
      ok: false,
      error: 'Trường "version" không được hỗ trợ: 9 (chỉ hỗ trợ 1)',
    })
    expect(listSets()).toEqual([])
  })

  it('builds an ASCII file name from the set name', () => {
    expect(exportFileName({ ...newSet(), name: 'Anime OP 2010s — Đỉnh cao!' })).toBe(
      'anime-op-2010s-dinh-cao.animequiz.json',
    )
    expect(exportFileName({ ...newSet(), name: '★★★' })).toBe('bo-cau-hoi.animequiz.json')
  })
})
