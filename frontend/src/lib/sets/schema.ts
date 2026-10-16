// Bộ câu hỏi: dùng chung cho localStorage và file .animequiz.json (spec mục 3.1).

export const SET_VERSION = 1
export const MAX_SONGS = 500
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export interface Song {
  videoId: string
  videoTitle: string
  durationSec: number
  animeName: string
  songLabel: string | null
  startSec: number | null
  needsReview: boolean
}

export interface QuestionSet {
  version: 1
  id: string
  name: string
  updatedAt: string
  songs: Song[]
}

export type ParseResult = { ok: true; set: QuestionSet } | { ok: false; error: string }

type Data = Record<string, unknown>

const isRecord = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fieldError = (path: string): ParseResult => ({ ok: false, error: `Trường "${path}" bị thiếu hoặc sai kiểu` })

export function makeSetId(): string {
  // randomUUID chỉ có trong secure context (https hoặc localhost).
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function newSet(name = 'Bộ câu hỏi mới', now = new Date()): QuestionSet {
  return { version: SET_VERSION, id: makeSetId(), name, updatedAt: now.toISOString(), songs: [] }
}

// Trả về Song, hoặc tên trường sai ('' nếu cả phần tử không phải object).
function parseSong(raw: unknown): Song | string {
  if (!isRecord(raw)) return ''
  const { videoId, videoTitle, durationSec, animeName, needsReview } = raw
  const songLabel = raw.songLabel ?? null
  const startSec = raw.startSec ?? null
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return 'videoId'
  if (typeof videoTitle !== 'string') return 'videoTitle'
  if (typeof durationSec !== 'number' || !Number.isInteger(durationSec) || durationSec < 1) return 'durationSec'
  if (typeof animeName !== 'string') return 'animeName'
  if (songLabel !== null && typeof songLabel !== 'string') return 'songLabel'
  if (startSec !== null && (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0)) {
    return 'startSec'
  }
  if (typeof needsReview !== 'boolean') return 'needsReview'
  return { videoId, videoTitle, durationSec, animeName, songLabel, startSec, needsReview }
}

export function parseQuestionSet(data: unknown): ParseResult {
  if (!isRecord(data)) return { ok: false, error: 'File không chứa bộ câu hỏi' }
  if (data.version !== SET_VERSION) {
    return {
      ok: false,
      error: `Trường "version" không được hỗ trợ: ${JSON.stringify(data.version) ?? 'không có'} (chỉ hỗ trợ ${SET_VERSION})`,
    }
  }
  const { id, name, updatedAt, songs } = data
  if (typeof id !== 'string' || id === '') return fieldError('id')
  if (typeof name !== 'string') return fieldError('name')
  if (typeof updatedAt !== 'string') return fieldError('updatedAt')
  if (!Array.isArray(songs)) return fieldError('songs')
  if (songs.length > MAX_SONGS) return { ok: false, error: `Bộ câu hỏi có tối đa ${MAX_SONGS} bài` }
  const parsed: Song[] = []
  for (const [index, raw] of songs.entries()) {
    const song = parseSong(raw)
    if (typeof song === 'string') return fieldError(song ? `songs[${index}].${song}` : `songs[${index}]`)
    parsed.push(song)
  }
  return { ok: true, set: { version: SET_VERSION, id, name, updatedAt, songs: parsed } }
}

const isNamed = (song: Song) => song.animeName.trim() !== ''

// Bài dùng được khi tạo phòng: đã có tên anime và đã xác nhận (server kiểm tra lại đúng điều kiện này).
export const readySongs = (songs: Song[]): Song[] => songs.filter((song) => isNamed(song) && !song.needsReview)

// Lý do chưa tạo phòng được, hoặc null. Bài chưa sẵn sàng không chặn: phòng chỉ dùng các bài đã sẵn sàng.
export function roomBlocker(songs: Song[]): string | null {
  if (songs.length === 0) return 'Bộ câu hỏi chưa có bài nào'
  if (songs.length > MAX_SONGS) return `Bộ câu hỏi có tối đa ${MAX_SONGS} bài`
  if (readySongs(songs).length === 0) return 'Chưa có bài nào sẵn sàng: hãy đặt tên anime hoặc xác nhận gợi ý'
  return null
}

// Cho quản trò biết phòng sẽ bỏ qua bao nhiêu bài, hoặc null nếu dùng hết.
export function unreadyNote(songs: Song[]): string | null {
  const unnamed = songs.filter((song) => !isNamed(song)).length
  const unreviewed = songs.filter((song) => isNamed(song) && song.needsReview).length
  if (unnamed + unreviewed === 0) return null
  const reasons = [
    unnamed > 0 ? `${unnamed} bài chưa có tên` : '',
    unreviewed > 0 ? `${unreviewed} bài chưa xác nhận tên` : '',
  ].filter(Boolean)
  return `Phòng sẽ dùng ${songs.length - unnamed - unreviewed}/${songs.length} bài, bỏ qua ${reasons.join(' và ')}`
}
