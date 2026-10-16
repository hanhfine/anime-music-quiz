import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'
import { CreateRoomPanel } from '../components/CreateRoomPanel'
import { SongRow } from '../components/SongRow'
import { ApiError, describeSkipped, IMPORT_ERROR_MESSAGES, importUrl, suggestAnime, type Candidate } from '../lib/api'
import { mapLimit } from '../lib/async'
import { MAX_SONGS, type QuestionSet, type Song } from '../lib/sets/schema'
import { loadSet, saveSet } from '../lib/sets/storage'

const SUGGEST_CONCURRENCY = 3

export default function SetEditor() {
  const { id = '' } = useParams()
  // key: đổi sang bộ khác thì dựng lại toàn bộ state.
  return <Editor key={id} id={id} />
}

function Editor({ id }: { id: string }) {
  const [initial] = useState(() => loadSet(id))
  const [set, setSet] = useState<QuestionSet | null>(initial)
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importInfo, setImportInfo] = useState<string[]>([])
  const [candidates, setCandidates] = useState<Record<string, Candidate[]>>({})
  const [suggesting, setSuggesting] = useState<ReadonlySet<string>>(new Set())
  // Bài tra tên thất bại (AnimeThemes lỗi hoặc quá tải), khác với bài tra được mà không có kết quả.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  // Dòng quản trò đã sửa tay: gợi ý đến muộn không ghi đè lên nữa.
  const touched = useRef(new Set<string>())

  useEffect(() => {
    // So sánh với object lúc mở để chỉ lưu khi có thay đổi thật (StrictMode chạy effect 2 lần).
    if (set && set !== initial) saveSet(set)
  }, [set, initial])

  if (!set) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-2xl font-bold">Không tìm thấy bộ câu hỏi</h1>
        <Link className="mt-4 inline-block text-sky-400 underline" to="/sets">
          Về danh sách bộ câu hỏi
        </Link>
      </main>
    )
  }

  const patchSong = (videoId: string, patch: Partial<Song>) =>
    setSet((prev) =>
      prev && { ...prev, songs: prev.songs.map((song) => (song.videoId === videoId ? { ...song, ...patch } : song)) },
    )

  const editSong = (videoId: string, patch: Partial<Song>) => {
    touched.current.add(videoId)
    patchSong(videoId, patch)
  }

  const removeSong = (videoId: string) =>
    setSet((prev) => prev && { ...prev, songs: prev.songs.filter((song) => song.videoId !== videoId) })

  const suggest = async (songs: Song[]) => {
    const ids = new Set(songs.map((song) => song.videoId))
    setSuggesting((prev) => new Set([...prev, ...ids]))
    setFailed((prev) => new Set([...prev].filter((videoId) => !ids.has(videoId))))
    await mapLimit(songs, SUGGEST_CONCURRENCY, async (song) => {
      const found = await suggestAnime(song.videoTitle).catch(() => null)
      setSuggesting((prev) => new Set([...prev].filter((videoId) => videoId !== song.videoId)))
      if (found === null) {
        setFailed((prev) => new Set([...prev, song.videoId]))
        return
      }
      setCandidates((prev) => ({ ...prev, [song.videoId]: found }))
      const best = found[0]
      if (best && !touched.current.has(song.videoId)) {
        patchSong(song.videoId, { animeName: best.animeName, songLabel: best.songLabel, needsReview: true })
      }
    })
  }

  const runImport = async (event: FormEvent) => {
    event.preventDefault()
    if (!url.trim()) return
    setImporting(true)
    setImportError(null)
    setImportInfo([])
    try {
      const result = await importUrl(url.trim())
      const known = new Set(set.songs.map((song) => song.videoId))
      const added: Song[] = []
      let duplicates = 0
      let overflow = 0
      for (const track of result.tracks) {
        if (known.has(track.videoId)) {
          duplicates += 1
        } else if (set.songs.length + added.length >= MAX_SONGS) {
          overflow += 1
        } else {
          known.add(track.videoId)
          added.push({ ...track, animeName: '', songLabel: null, startSec: null, needsReview: false })
        }
      }
      // Chỉ phần import thêm bài, và nút Thêm bị khóa khi đang import, nên không thể thêm trùng ở đây.
      setSet((prev) => prev && { ...prev, songs: [...prev.songs, ...added] })
      const summary = [`Đã thêm ${added.length} bài`]
      if (duplicates > 0) summary.push(`bỏ qua ${duplicates} bài đã có trong bộ`)
      if (overflow > 0) summary.push(`bỏ ${overflow} bài vì bộ câu hỏi có tối đa ${MAX_SONGS} bài`)
      setImportInfo([summary.join(', '), describeSkipped(result.skipped)].filter(Boolean))
      setUrl('')
      void suggest(added)
    } catch (error) {
      setImportError(error instanceof ApiError ? error.message : IMPORT_ERROR_MESSAGES.UPSTREAM_ERROR)
    } finally {
      setImporting(false)
    }
  }

  const unnamed = set.songs.filter((song) => !song.animeName.trim())
  const failedCount = unnamed.filter((song) => failed.has(song.videoId)).length
  // Quản trò chủ động bấm: điền gợi ý cả vào bài từng sửa tay, vì bài đó vẫn chưa có tên.
  const resuggest = () => {
    for (const song of unnamed) touched.current.delete(song.videoId)
    void suggest(unnamed)
  }

  const reviewable = set.songs.filter((song) => song.needsReview && song.animeName.trim()).length
  const acceptAll = () =>
    setSet(
      (prev) =>
        prev && {
          ...prev,
          songs: prev.songs.map((song) =>
            song.needsReview && song.animeName.trim() ? { ...song, needsReview: false } : song,
          ),
        },
    )

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-sm tracking-widest text-slate-400 uppercase">Soạn bộ câu hỏi</h1>
        <Link to="/sets" className="text-sky-400 underline">
          ← Danh sách bộ
        </Link>
      </header>
      <input
        aria-label="Tên bộ câu hỏi"
        value={set.name}
        onChange={(e) => setSet((prev) => prev && { ...prev, name: e.target.value })}
        className="rounded-lg bg-slate-900 px-3 py-2 text-3xl font-black"
      />

      <CreateRoomPanel songs={set.songs} />

      <form onSubmit={runImport} className="flex flex-col gap-2 rounded-2xl bg-slate-900 p-4">
        <label className="flex flex-col gap-1">
          Link YouTube
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Link video, shorts hoặc playlist (playlist tối đa 200 bài)"
            className="rounded bg-slate-800 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={importing || !url.trim()}
          className="self-start rounded-lg bg-sky-600 px-4 py-2 font-bold disabled:opacity-40"
        >
          {importing ? 'Đang lấy danh sách…' : 'Thêm'}
        </button>
        {importError && (
          <p role="alert" className="rounded-lg bg-red-500/15 p-2 text-red-200">
            {importError}
          </p>
        )}
        {importInfo.length > 0 && (
          <div role="status" className="text-sm text-slate-300">
            {importInfo.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">{set.songs.length} bài</h2>
        <div className="flex flex-wrap gap-2">
          {unnamed.length > 0 && (
            <button
              type="button"
              onClick={resuggest}
              disabled={suggesting.size > 0}
              className="rounded-lg bg-sky-700 px-3 py-1 disabled:opacity-40"
            >
              Gợi ý lại ({unnamed.length})
            </button>
          )}
          <button
            type="button"
            onClick={acceptAll}
            disabled={reviewable === 0}
            className="rounded-lg bg-emerald-700 px-3 py-1 disabled:opacity-40"
          >
            Chấp nhận tất cả gợi ý ({reviewable})
          </button>
        </div>
      </div>
      {failedCount > 0 && suggesting.size === 0 && (
        <p role="alert" className="rounded-lg bg-amber-500/15 p-2 text-amber-200">
          Không tra được tên cho {failedCount} bài vì AnimeThemes đang bận. Đợi một lát rồi bấm Gợi ý lại.
        </p>
      )}

      <ol className="flex flex-col gap-3">
        {set.songs.map((song, index) => (
          <SongRow
            key={song.videoId}
            song={song}
            index={index}
            candidates={candidates[song.videoId] ?? []}
            suggesting={suggesting.has(song.videoId)}
            suggestFailed={failed.has(song.videoId) && !song.animeName.trim()}
            onChange={(patch) => editSong(song.videoId, patch)}
            onRemove={() => removeSong(song.videoId)}
          />
        ))}
      </ol>
    </main>
  )
}
