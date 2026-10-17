import { useState, type FormEvent } from 'react'
import { Callout } from '../../components/Callout'
import { PopButton } from '../../components/PopButton'
import { PopChip, PopPanel } from '../../components/PopPanel'
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
    <div className="halftone-strong min-h-dvh">
      <main className="mx-auto flex max-w-sm flex-col gap-6 p-6 pt-14">
        <PopChip as="h1" className="self-center text-4xl">
          Vào phòng <span className="tabular-nums">{code}</span>
        </PopChip>
        <PopPanel>
          <form onSubmit={join} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 font-semibold">
              Tên của bạn
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="nickname"
                className="border-2 border-pop-paper bg-neutral-900 px-3 py-3 text-2xl font-semibold"
              />
            </label>
            <PopButton type="submit" size="lg" disabled={busy || trimmed === ''}>
              Vào phòng
            </PopButton>
          </form>
        </PopPanel>
        {alert && <Callout tone="error">{alert}</Callout>}
      </main>
    </div>
  )
}
