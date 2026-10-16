import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

const CODE_LENGTH = 6

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const message = (location.state as { message?: string } | null)?.message
  const [code, setCode] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code.length === CODE_LENGTH) navigate(`/play/${code}`)
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="pt-8 text-center text-4xl font-black">Đoán anime qua nhạc 🎵</h1>
      {message && (
        <p role="alert" className="rounded-xl bg-amber-500/15 p-3 text-amber-200">
          {message}
        </p>
      )}

      <section className="rounded-2xl bg-slate-900 p-5">
        <h2 className="mb-3 text-xl font-bold">Người chơi</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            Mã phòng
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
              placeholder="VD: K7M2QX"
              autoCapitalize="characters"
              autoComplete="off"
              className="rounded-lg bg-slate-800 px-3 py-3 text-center font-mono text-2xl tracking-[0.3em] uppercase"
            />
          </label>
          <button
            type="submit"
            disabled={code.length !== CODE_LENGTH}
            className="rounded-lg bg-sky-600 px-4 py-3 text-lg font-bold disabled:opacity-40"
          >
            Vào phòng
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-slate-900 p-5">
        <h2 className="mb-1 text-xl font-bold">Quản trò</h2>
        <p className="mb-3 text-slate-400">Soạn bộ câu hỏi từ link YouTube rồi tạo phòng để stream.</p>
        <Link to="/sets" className="block rounded-lg bg-emerald-600 px-4 py-3 text-center text-lg font-bold">
          Tạo phòng
        </Link>
      </section>
    </main>
  )
}
