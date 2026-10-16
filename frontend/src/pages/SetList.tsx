import { useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { newSet, type QuestionSet } from '../lib/sets/schema'
import { deleteSet, downloadSet, importSetJson, listSets, saveSet } from '../lib/sets/storage'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export default function SetList() {
  const navigate = useNavigate()
  const [sets, setSets] = useState(listSets)
  const [error, setError] = useState<string | null>(null)

  const create = () => {
    const set = saveSet(newSet())
    navigate(`/sets/${set.id}`)
  }

  const remove = (set: QuestionSet) => {
    if (!window.confirm(`Xóa bộ câu hỏi “${set.name}”?`)) return
    deleteSet(set.id)
    setSets(listSets())
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = importSetJson(await file.text())
    if (!result.ok) {
      setError(`Không nhập được file: ${result.error}`)
      return
    }
    setError(null)
    setSets(listSets())
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-black">Bộ câu hỏi</h1>
        <Link to="/" className="text-sky-400 underline">
          ← Trang chủ
        </Link>
      </header>

      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={create} className="rounded-lg bg-emerald-600 px-4 py-2 font-bold">
          + Bộ mới
        </button>
        <label className="cursor-pointer rounded-lg bg-slate-700 px-4 py-2 font-bold focus-within:ring-2">
          Nhập file JSON
          <input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} />
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}

      {sets.length === 0 ? (
        <p className="text-slate-400">Chưa có bộ câu hỏi nào. Tạo bộ mới hoặc nhập file .animequiz.json.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sets.map((set) => (
            <li key={set.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 p-4">
              <div className="min-w-0 flex-1">
                <Link to={`/sets/${set.id}`} className="block truncate text-lg font-bold hover:underline">
                  {set.name || 'Chưa đặt tên'}
                </Link>
                <span className="text-sm text-slate-400">
                  {set.songs.length} bài · sửa lúc {formatDate(set.updatedAt)}
                </span>
              </div>
              <button type="button" onClick={() => downloadSet(set)} className="rounded-lg bg-slate-700 px-3 py-1">
                Xuất JSON
              </button>
              <button
                type="button"
                onClick={() => remove(set)}
                aria-label={`Xóa ${set.name}`}
                className="rounded-lg bg-red-700 px-3 py-1"
              >
                Xóa
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
