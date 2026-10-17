import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Callout } from '../components/Callout'
import { CLOSED_MESSAGES, errorMessage, type PlayerSnapshot, type RejoinAck } from '../lib/protocol'
import { clearRoomAuth, loadRoomAuth } from '../lib/roomAuth'
import { emitAck } from '../lib/socket'
import { useRoomSnapshot } from '../lib/useRoomSnapshot'
import { JoinForm } from './play/JoinForm'
import { PlayerCalibration } from './play/PlayerCalibration'
import { PlayerFinished } from './play/PlayerFinished'
import { PlayerLobby } from './play/PlayerLobby'
import { PlayerAnswering, PlayerPreparing, PlayerReveal } from './play/PlayerRound'

export default function PlayScreen() {
  // Link gõ tay có thể viết thường; mã phòng luôn là chữ hoa.
  const code = (useParams().code ?? '').toUpperCase()
  return <Play key={code} code={code} />
}

function Play({ code }: { code: string }) {
  const navigate = useNavigate()
  const [joined, setJoined] = useState(() => Boolean(loadRoomAuth(code).playerToken))
  const [message, setMessage] = useState<string | null>(null)

  const leave = useCallback(
    (text: string) => {
      clearRoomAuth(code, 'player')
      navigate('/', { replace: true, state: { message: text } })
    },
    [code, navigate],
  )

  // Mỗi lần socket kết nối: đã có token thì vào lại phòng, chưa có thì chờ người chơi nhập tên.
  const authenticate = () => {
    const { playerToken } = loadRoomAuth(code)
    if (!playerToken) return
    void emitAck<RejoinAck>('player:rejoin', { code, playerToken }).then((response) => {
      // NETWORK: socket sẽ tự kết nối lại và gọi authenticate lần nữa.
      if (response.ok || response.error === 'NETWORK') return
      if (response.error === 'INVALID_TOKEN') {
        clearRoomAuth(code, 'player')
        setJoined(false)
        setMessage(errorMessage(response.error))
        return
      }
      leave(errorMessage(response.error))
    })
  }
  const { snapshot, offset, closedReason } = useRoomSnapshot<PlayerSnapshot>(code, authenticate)

  useEffect(() => {
    if (closedReason) leave(CLOSED_MESSAGES[closedReason])
  }, [closedReason, leave])

  if (!joined) {
    return <JoinForm code={code} message={message} onJoined={() => setJoined(true)} />
  }

  return (
    <div className="halftone-strong min-h-dvh">
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 p-4">
        {snapshot ? (
          <>
            <header className="flex items-center justify-between gap-3">
              <span className="truncate text-xl font-semibold">{snapshot.me.name}</span>
              <span className="shrink-0 -skew-x-12 bg-pop-lime px-3 py-0.5 text-xl font-black text-pop-ink italic tabular-nums">
                {snapshot.me.score.toLocaleString('vi-VN')} điểm
              </span>
            </header>
            {!snapshot.hostOnline && (
              <Callout tone="warn" role="status">
                Quản trò mất kết nối, đang chờ…
              </Callout>
            )}
            <PhaseView snapshot={snapshot} offset={offset} />
          </>
        ) : (
          <p className="py-16 text-center text-xl text-neutral-400">Đang vào phòng…</p>
        )}
      </main>
    </div>
  )
}

function PhaseView({ snapshot, offset }: { snapshot: PlayerSnapshot; offset: number }) {
  const { phase, calib, round } = snapshot
  switch (phase) {
    case 'LOBBY':
      return <PlayerLobby snapshot={snapshot} />
    case 'CALIBRATING':
      return calib && <PlayerCalibration key={calib.round} calib={calib} />
    case 'PREPARING':
      return round && <PlayerPreparing round={round} />
    case 'ANSWERING':
      return round && <PlayerAnswering key={`${round.index}:${round.deadline}`} round={round} offset={offset} />
    case 'REVEAL':
      return round && <PlayerReveal snapshot={snapshot} round={round} />
    case 'FINISHED':
      return <PlayerFinished snapshot={snapshot} />
  }
}
