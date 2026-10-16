import { makeSetId, parseQuestionSet, type ParseResult, type QuestionSet } from './schema'

const PREFIX = 'animequiz:set:'

export function loadSet(id: string): QuestionSet | null {
  const raw = localStorage.getItem(PREFIX + id)
  if (raw === null) return null
  try {
    const result = parseQuestionSet(JSON.parse(raw))
    return result.ok ? result.set : null
  } catch {
    return null
  }
}

export function listSets(): QuestionSet[] {
  const sets: QuestionSet[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key?.startsWith(PREFIX)) continue
    const set = loadSet(key.slice(PREFIX.length))
    if (set) sets.push(set)
  }
  return sets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function saveSet(set: QuestionSet, now = new Date()): QuestionSet {
  const saved = { ...set, updatedAt: now.toISOString() }
  localStorage.setItem(PREFIX + set.id, JSON.stringify(saved))
  return saved
}

export function deleteSet(id: string): void {
  localStorage.removeItem(PREFIX + id)
}

export function exportSetJson(set: QuestionSet): string {
  return JSON.stringify(set, null, 2)
}

export function exportFileName(set: QuestionSet): string {
  const slug = set.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'bo-cau-hoi'}.animequiz.json`
}

export function importSetJson(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'File không phải JSON hợp lệ' }
  }
  const result = parseQuestionSet(data)
  if (!result.ok) return result
  const set = loadSet(result.set.id) ? { ...result.set, id: makeSetId() } : result.set
  return { ok: true, set: saveSet(set) }
}

export function downloadSet(set: QuestionSet): void {
  const url = URL.createObjectURL(new Blob([exportSetJson(set)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = exportFileName(set)
  link.click()
  URL.revokeObjectURL(url)
}
