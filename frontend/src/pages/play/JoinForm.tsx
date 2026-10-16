import { useState, type FormEvent } from 'react'
import { errorMessage, type JoinAck } from '../../lib/protocol'
import { saveRoomAuth } from '../../lib/roomAuth'
import { emitAck } from '../../lib/socket'

const NAME_MAX_LENGTH = 20

interface Props {
  code: string
  message: string | null
  onJoined: () => void
}

export function JoinForm({ code, message, onJoined }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const trimmed = name.trim()

  const join = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await emitAck<JoinAck>('player:join', { code, name: trimmed })
    setBusy(false)
    if (!response.ok) {
      setError(errorMessage(response.error))
      return
    }
    saveRoomAuth(code, { playerId: response.playerId, playerToken: response.playerToken })
    onJoined()
  }

  const alert = error ?? message
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-6">
      <h1 className="pt-8 text-center text-3xl font-black">
        Vào phòng <span className="font-mono">{code}</span>
      </h1>
      <form onSubmit={join} className="flex flex-col gap-3 rounded-2xl bg-slate-900 p-5">
        <label className="flex flex-col gap-1">
          Tên của bạn
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="nickname"
            className="rounded-lg bg-slate-800 px-3 py-3 text-xl"
          />
        </label>
        <button
          type="submit"
          disabled={busy || trimmed === ''}
          className="rounded-lg bg-sky-600 px-4 py-3 text-lg font-bold disabled:opacity-40"
        >
          Vào phòng
        </button>
      </form>
      {alert && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {alert}
        </p>
      )}
    </main>
  )
}
