import { useState, type ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Callout } from '../components/Callout'
import { PopButton } from '../components/PopButton'
import { popButtonClasses } from '../components/popButtonClasses'
import { PopChip } from '../components/PopPanel'
import { newSet, type QuestionSet } from '../lib/sets/schema'
import { deleteSet, downloadSet, importSetJson, listSets, saveSet } from '../lib/sets/storage'

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

// Nhãn chọn file trông như nút secondary.
const IMPORT_LOOK = popButtonClasses('secondary', 'md')

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
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between pt-4">
        <PopChip as="h1" className="text-4xl">
          Bộ câu hỏi
        </PopChip>
        <Link to="/" className="font-semibold text-pop-lime underline">
          ← Trang chủ
        </Link>
      </header>

      <div className="flex flex-wrap gap-5">
        <PopButton onClick={create}>+ Bộ mới</PopButton>
        <label
          className={`${IMPORT_LOOK.outer} cursor-pointer focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-pop-lime`}
        >
          <span className={IMPORT_LOOK.frame}>
            <span className={IMPORT_LOOK.face}>Nhập file JSON</span>
          </span>
          <input type="file" accept=".json,application/json" className="sr-only" onChange={importFile} />
        </label>
      </div>

      {error && <Callout tone="error">{error}</Callout>}

      {sets.length === 0 ? (
        <p className="text-neutral-400">Chưa có bộ câu hỏi nào. Tạo bộ mới hoặc nhập file .animequiz.json.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sets.map((set) => (
            <li key={set.id} className="flex flex-wrap items-center gap-4 clip-slant bg-neutral-900 py-4 pr-8 pl-6">
              <div className="min-w-0 flex-1">
                <Link to={`/sets/${set.id}`} className="block truncate text-2xl font-black italic hover:text-pop-lime">
                  {set.name || 'Chưa đặt tên'}
                </Link>
                <span className="text-sm text-neutral-400">
                  {set.songs.length} bài · sửa lúc {formatDate(set.updatedAt)}
                </span>
              </div>
              <PopButton variant="secondary" size="sm" onClick={() => downloadSet(set)}>
                Xuất JSON
              </PopButton>
              <PopButton variant="danger" size="sm" onClick={() => remove(set)} aria-label={`Xóa ${set.name}`}>
                Xóa
              </PopButton>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
