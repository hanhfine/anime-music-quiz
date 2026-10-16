import { useState, type FormEvent } from 'react'
import { LOOKUP_ERROR_MESSAGE, searchAnime, type Candidate } from '../lib/api'
import type { Song } from '../lib/sets/schema'

interface Props {
  song: Song
  index: number
  candidates: Candidate[]
  suggesting: boolean
  suggestFailed: boolean
  onChange: (patch: Partial<Song>) => void
  onRemove: () => void
}

const formatDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`

const candidateText = (c: Candidate) => (c.songLabel ? `${c.animeName} · ${c.songLabel}` : c.animeName)

export function SongRow({ song, index, candidates, suggesting, suggestFailed, onChange, onRemove }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)
  const options = results ?? candidates

  const search = async (event: FormEvent) => {
    event.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchFailed(false)
    try {
      setResults(await searchAnime(query.trim()))
    } catch {
      setSearchFailed(true)
    } finally {
      setSearching(false)
    }
  }

  return (
    <li aria-label={`Bài ${index + 1}`} className="flex flex-col gap-3 rounded-xl bg-slate-900 p-4">
      <div className="flex items-start gap-3">
        <span className="font-mono text-slate-500">#{index + 1}</span>
        <a
          href={`https://www.youtube.com/watch?v=${song.videoId}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate text-slate-300 hover:underline"
        >
          {song.videoTitle || song.videoId}
        </a>
        <span className="text-sm text-slate-500">{formatDuration(song.durationSec)}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Xóa bài ${index + 1}`}
          className="rounded bg-red-800 px-2 text-sm"
        >
          Xóa
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_8rem]">
        <label className="flex flex-col gap-1 text-sm">
          Tên anime
          <input
            value={song.animeName}
            onChange={(e) => onChange({ animeName: e.target.value, needsReview: false })}
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nhãn bài
          <input
            value={song.songLabel ?? ''}
            onChange={(e) => onChange({ songLabel: e.target.value || null })}
            placeholder="VD: OP1"
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Bắt đầu (giây)
          <input
            type="number"
            min={0}
            max={Math.max(0, song.durationSec - 1)}
            value={song.startSec ?? ''}
            onChange={(e) => {
              const value = e.target.valueAsNumber
              onChange({ startSec: Number.isNaN(value) ? null : Math.max(0, value) })
            }}
            placeholder="Ngẫu nhiên"
            className="rounded bg-slate-800 px-2 py-1 text-base"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {song.needsReview && (
          <>
            <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-200">Gợi ý, chưa xác nhận</span>
            <button
              type="button"
              onClick={() => onChange({ needsReview: false })}
              className="rounded bg-emerald-700 px-2 py-1"
            >
              Xác nhận
            </button>
          </>
        )}
        {suggesting && <span className="text-slate-400">Đang gợi ý…</span>}
        {suggestFailed && <span className="text-amber-300">Không tra được tên</span>}
        {options.map((candidate) => (
          <button
            key={candidateText(candidate)}
            type="button"
            onClick={() => onChange({ animeName: candidate.animeName, songLabel: candidate.songLabel, needsReview: false })}
            className="rounded-full bg-slate-700 px-3 py-1 hover:bg-slate-600"
          >
            {candidateText(candidate)}
          </button>
        ))}
        {results?.length === 0 && !searchFailed && <span className="text-slate-400">Không tìm thấy</span>}
        {searchFailed && <span className="text-amber-300">{LOOKUP_ERROR_MESSAGE}</span>}
      </div>

      <form onSubmit={search} className="flex gap-2 text-sm">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm tên anime"
          placeholder="Tìm tên anime khác…"
          className="flex-1 rounded bg-slate-800 px-2 py-1"
        />
        <button type="submit" disabled={searching} className="rounded bg-slate-700 px-3 py-1 disabled:opacity-50">
          Tìm
        </button>
      </form>
    </li>
  )
}
