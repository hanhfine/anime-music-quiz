import { useState, type FormEvent } from 'react'
import { LOOKUP_ERROR_MESSAGE, searchAnime, type Candidate } from '../lib/api'
import type { Song } from '../lib/sets/schema'
import { PopButton } from './PopButton'

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
    <li aria-label={`Bài ${index + 1}`} className="flex flex-col gap-3 border-2 border-neutral-800 bg-neutral-900 p-4">
      <div className="flex items-center gap-3">
        <span className="font-semibold text-neutral-500 tabular-nums">#{index + 1}</span>
        <a
          href={`https://www.youtube.com/watch?v=${song.videoId}`}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-medium text-neutral-300 hover:underline"
        >
          {song.videoTitle || song.videoId}
        </a>
        <span className="text-base text-neutral-500 tabular-nums">{formatDuration(song.durationSec)}</span>
        <PopButton variant="danger" size="sm" onClick={onRemove} aria-label={`Xóa bài ${index + 1}`}>
          Xóa
        </PopButton>
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_8rem]">
        <label className="flex flex-col gap-1 text-base font-semibold">
          Tên anime
          <input
            value={song.animeName}
            onChange={(e) => onChange({ animeName: e.target.value, needsReview: false })}
            className="border border-neutral-700 bg-neutral-800 px-2 py-1 font-medium"
          />
        </label>
        <label className="flex flex-col gap-1 text-base font-semibold">
          Nhãn bài
          <input
            value={song.songLabel ?? ''}
            onChange={(e) => onChange({ songLabel: e.target.value || null })}
            placeholder="VD: OP1"
            className="border border-neutral-700 bg-neutral-800 px-2 py-1 font-medium"
          />
        </label>
        <label className="flex flex-col gap-1 text-base font-semibold">
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
            className="border border-neutral-700 bg-neutral-800 px-2 py-1 font-medium tabular-nums"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-base">
        {song.needsReview && (
          <>
            <span className="border border-pop-lime px-2 py-0.5 font-semibold text-pop-lime">Gợi ý, chưa xác nhận</span>
            <PopButton size="sm" onClick={() => onChange({ needsReview: false })}>
              Xác nhận
            </PopButton>
          </>
        )}
        {suggesting && <span className="text-neutral-400">Đang gợi ý…</span>}
        {suggestFailed && <span className="font-semibold text-pop-lime">Không tra được tên</span>}
        {options.map((candidate) => (
          <button
            key={candidateText(candidate)}
            type="button"
            onClick={() => onChange({ animeName: candidate.animeName, songLabel: candidate.songLabel, needsReview: false })}
            className="-skew-x-6 bg-neutral-800 px-3 py-1 font-semibold hover:bg-pop-lime hover:text-pop-ink"
          >
            {candidateText(candidate)}
          </button>
        ))}
        {results?.length === 0 && !searchFailed && <span className="text-neutral-400">Không tìm thấy</span>}
        {searchFailed && <span className="font-semibold text-pop-lime">{LOOKUP_ERROR_MESSAGE}</span>}
      </div>

      <form onSubmit={search} className="flex items-center gap-3 text-base">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm tên anime"
          placeholder="Tìm tên anime khác…"
          className="flex-1 border border-neutral-700 bg-neutral-800 px-2 py-1 font-medium"
        />
        <PopButton type="submit" variant="secondary" size="sm" disabled={searching}>
          Tìm
        </PopButton>
      </form>
    </li>
  )
}
