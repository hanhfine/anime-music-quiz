// REST API dùng khi soạn bộ câu hỏi (spec mục 3.4).

export type SkipReason = 'DELETED' | 'PRIVATE' | 'NOT_EMBEDDABLE' | 'REGION_BLOCKED'

export interface ImportTrack {
  videoId: string
  videoTitle: string
  durationSec: number
}

export interface SkippedTrack {
  videoId: string
  title: string
  reason: SkipReason
}

export interface ImportResult {
  kind: 'video' | 'playlist'
  tracks: ImportTrack[]
  skipped: SkippedTrack[]
}

export interface Candidate {
  animeName: string
  songLabel: string | null
}

export type ImportErrorCode = 'INVALID_URL' | 'NOT_FOUND' | 'YOUTUBE_QUOTA' | 'UPSTREAM_ERROR' | 'NETWORK'

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, string> = {
  INVALID_URL: 'Link YouTube không hợp lệ. Hãy dán link video, shorts hoặc playlist',
  NOT_FOUND: 'Không tìm thấy video hoặc playlist (có thể đã bị xóa hoặc để riêng tư)',
  YOUTUBE_QUOTA: 'Đã hết hạn mức YouTube API hôm nay, hãy thử lại sau',
  UPSTREAM_ERROR: 'YouTube đang lỗi, hãy thử lại sau',
  NETWORK: 'Không kết nối được server',
}

export const SKIP_REASON_MESSAGES: Record<SkipReason, string> = {
  DELETED: 'đã bị xóa',
  PRIVATE: 'riêng tư',
  NOT_EMBEDDABLE: 'không cho nhúng',
  REGION_BLOCKED: 'bị chặn ở khu vực của bạn',
}

export class ApiError extends Error {
  code: ImportErrorCode

  constructor(code: ImportErrorCode) {
    super(IMPORT_ERROR_MESSAGES[code])
    this.name = 'ApiError'
    this.code = code
  }
}

const isImportError = (code: unknown): code is ImportErrorCode =>
  typeof code === 'string' && Object.hasOwn(IMPORT_ERROR_MESSAGES, code)

export async function importUrl(url: string): Promise<ImportResult> {
  let response: Response
  try {
    response = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
  } catch {
    throw new ApiError('NETWORK')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok && body !== null) return body as ImportResult
  const code = (body as { error?: unknown } | null)?.error
  throw new ApiError(isImportError(code) ? code : 'UPSTREAM_ERROR')
}

// Gợi ý tên chỉ là phụ: mọi lỗi đều trả về danh sách rỗng.
async function fetchCandidates(path: string): Promise<Candidate[]> {
  try {
    const response = await fetch(path)
    if (!response.ok) return []
    const body = (await response.json()) as { candidates?: unknown }
    return Array.isArray(body.candidates) ? (body.candidates as Candidate[]) : []
  } catch {
    return []
  }
}

export function suggestAnime(title: string): Promise<Candidate[]> {
  return fetchCandidates(`/api/anime/suggest?${new URLSearchParams({ title })}`)
}

export function searchAnime(q: string): Promise<Candidate[]> {
  return fetchCandidates(`/api/anime/search?${new URLSearchParams({ q })}`)
}

export function describeSkipped(skipped: SkippedTrack[]): string {
  if (skipped.length === 0) return ''
  const items = skipped.map((s) => `“${s.title || s.videoId}” (${SKIP_REASON_MESSAGES[s.reason]})`)
  return `Bỏ qua ${skipped.length} video: ${items.join(', ')}`
}
