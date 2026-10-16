import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAudioPlayer } from '../audio/useAudioPlayer'
import { useHostPlayback } from '../audio/useHostPlayback'
import { loadVolume, saveVolume } from '../audio/volume'
import { CLOSED_MESSAGES, errorMessage, type HostSnapshot, type Notice } from '../lib/protocol'
import { clearRoomAuth, loadRoomAuth } from '../lib/roomAuth'
import { emitAck } from '../lib/socket'
import { useRoomSnapshot } from '../lib/useRoomSnapshot'
import { HostCalibration } from './host/HostCalibration'
import { HostFinished } from './host/HostFinished'
import { HostLobby } from './host/HostLobby'
import { HostQuestion } from './host/HostQuestion'
import { useHostCommand } from './host/useHostCommand'

const NOTICE_MESSAGES: Record<Notice, string> = {
  AUDIO_REPLACED: 'Video lỗi, đã đổi bài khác',
  ROUND_DROPPED: 'Video lỗi và hết bài dự phòng, đã bỏ câu này',
}

type StageLayout = 'hidden' | 'small' | 'large'

// Khung nhạc luôn nằm một chỗ trong DOM; chỉ đổi CSS để iframe YouTube không bị tải lại.
const STAGE_CLASSES: Record<StageLayout, string> = {
  hidden: 'invisible right-6 bottom-6 h-[180px] w-[320px]',
  small: 'right-6 bottom-6 h-[180px] w-[320px]',
  large: 'top-20 left-6 aspect-video w-[56vw]',
}

function stageLayout(snapshot: HostSnapshot | null): StageLayout {
  switch (snapshot?.phase) {
    case 'PREPARING':
    case 'ANSWERING':
      return 'small'
    case 'REVEAL':
      return 'large'
    default:
      return 'hidden'
  }
}

export default function HostScreen() {
  const { code = '' } = useParams()
  return <Host key={code} code={code} />
}

function Host({ code }: { code: string }) {
  const navigate = useNavigate()
  const leave = useCallback(
    (message: string) => {
      clearRoomAuth(code, 'host')
      navigate('/', { replace: true, state: { message } })
    },
    [code, navigate],
  )

  // Chạy mỗi lần socket kết nối (kể cả kết nối lại) để gắn lại quyền quản trò.
  const authenticate = () => {
    const { hostToken } = loadRoomAuth(code)
    if (!hostToken) {
      navigate('/', { replace: true, state: { message: `Trình duyệt này không giữ quyền quản trò phòng ${code}` } })
      return
    }
    void emitAck('host:resume', { code, hostToken }).then((response) => {
      // NETWORK: socket sẽ tự kết nối lại và gọi authenticate lần nữa.
      if (!response.ok && response.error !== 'NETWORK') leave(errorMessage(response.error))
    })
  }
  const { snapshot, offset, closedReason } = useRoomSnapshot<HostSnapshot>(code, authenticate)

  useEffect(() => {
    if (closedReason) leave(closedReason === 'CLOSED' ? 'Đã đóng phòng' : CLOSED_MESSAGES[closedReason])
  }, [closedReason, leave])

  const stageRef = useRef<HTMLDivElement>(null)
  const player = useAudioPlayer(stageRef)
  useHostPlayback(player, snapshot)

  const [volume, setVolume] = useState(loadVolume)
  useEffect(() => {
    player?.setVolume(volume)
  }, [player, volume])
  const changeVolume = (value: number) => {
    setVolume(value)
    saveVolume(value)
  }

  const { run, error } = useHostCommand()
  const closeRoom = async () => {
    if (!window.confirm('Đóng phòng? Mọi người chơi sẽ bị đưa ra ngoài.')) return
    if (await run('host:close_room')) leave('Đã đóng phòng')
  }

  const layout = stageLayout(snapshot)

  return (
    <main className="min-h-screen">
      <header className="flex items-center gap-6 border-b border-slate-800 px-6 py-3">
        <span className="font-mono text-xl font-bold">Phòng {code}</span>
        <label className="ml-auto flex items-center gap-2 text-slate-300">
          <span aria-hidden="true">🔊</span> Âm lượng
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
          />
        </label>
        {snapshot?.phase !== 'FINISHED' && (
          <button
            type="button"
            onClick={() => void closeRoom()}
            className="rounded-lg bg-slate-800 px-3 py-1 text-slate-300 hover:bg-red-800"
          >
            Đóng phòng
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="m-4 rounded-lg bg-red-500/15 p-2 text-red-200">
          {error}
        </p>
      )}
      {snapshot?.notice && (
        <p
          role="status"
          className="fixed top-16 left-1/2 z-20 -translate-x-1/2 rounded-full bg-amber-400 px-6 py-2 text-lg font-bold text-slate-950"
        >
          {NOTICE_MESSAGES[snapshot.notice]}
        </p>
      )}

      {snapshot ? (
        <PhaseView snapshot={snapshot} offset={offset} onClose={() => void closeRoom()} />
      ) : (
        <p className="p-8 text-2xl text-slate-400">Đang kết nối tới phòng…</p>
      )}

      <div
        data-testid="stage"
        data-layout={layout}
        className={`fixed z-10 overflow-hidden rounded-2xl bg-black shadow-2xl transition-all duration-700 ${STAGE_CLASSES[layout]}`}
      >
        {/* Player tự gắn phần tử của nó vào đây; React không render con nào bên trong. */}
        <div ref={stageRef} className="h-full w-full" />
        <div
          data-testid="stage-cover"
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center bg-slate-900 transition-opacity duration-700 ${
            layout === 'large' ? 'pointer-events-none opacity-0' : ''
          }`}
        >
          <span className="animate-spin text-7xl">💿</span>
        </div>
      </div>
    </main>
  )
}

interface PhaseViewProps {
  snapshot: HostSnapshot
  offset: number
  onClose: () => void
}

function PhaseView({ snapshot, offset, onClose }: PhaseViewProps) {
  switch (snapshot.phase) {
    case 'LOBBY':
      return <HostLobby snapshot={snapshot} />
    case 'CALIBRATING':
      return (
        snapshot.calib && (
          <HostCalibration key={snapshot.calib.round} calib={snapshot.calib} players={snapshot.players} />
        )
      )
    case 'FINISHED':
      return <HostFinished snapshot={snapshot} onClose={onClose} />
    default:
      return (
        snapshot.round && (
          <HostQuestion key={snapshot.round.index} snapshot={snapshot} round={snapshot.round} offset={offset} />
        )
      )
  }
}
