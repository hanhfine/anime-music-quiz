import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Callout } from '../components/Callout'
import { CdDisc } from '../components/CdDisc'
import { PopButton, PopLink } from '../components/PopButton'
import { PopPanel } from '../components/PopPanel'

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
    <main className="mx-auto flex max-w-md flex-col gap-8 p-6">
      <div className="flex items-center justify-center gap-5 pt-10">
        {/* {' '}: tên tiêu đề vẫn là "Đoán anime qua nhạc 🎵" dù hai chip tách dòng. */}
        <h1 className="flex flex-col items-start gap-3 text-5xl leading-none font-black uppercase italic">
          <span className="-skew-x-12 -rotate-2 bg-pop-paper px-3 py-1 text-pop-ink shadow-[5px_5px_0_var(--color-pop-red)]">
            Đoán anime
          </span>{' '}
          <span className="ml-8 -skew-x-12 -rotate-2 bg-pop-red px-3 py-1 text-pop-paper shadow-[5px_5px_0_var(--color-pop-ink)]">
            qua nhạc 🎵
          </span>
        </h1>
        <CdDisc size="sm" spin={false} />
      </div>
      {message && <Callout tone="warn">{message}</Callout>}

      <PopPanel title="Người chơi">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 font-semibold">
            Mã phòng
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
              placeholder="VD: K7M2QX"
              autoCapitalize="characters"
              autoComplete="off"
              className="border-2 border-pop-paper bg-neutral-900 px-3 py-3 text-center text-3xl font-semibold tracking-[0.3em] uppercase tabular-nums"
            />
          </label>
          <PopButton type="submit" size="lg" disabled={code.length !== CODE_LENGTH}>
            Vào phòng
          </PopButton>
        </form>
      </PopPanel>

      <PopPanel title="Quản trò">
        <p className="text-neutral-300">Soạn bộ câu hỏi từ link YouTube rồi tạo phòng để stream.</p>
        <PopLink to="/sets" size="lg">
          Tạo phòng
        </PopLink>
      </PopPanel>
    </main>
  )
}
