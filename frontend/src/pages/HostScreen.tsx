import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useAudioPlayer } from '../audio/useAudioPlayer'
import { useHostPlayback } from '../audio/useHostPlayback'
import { loadVolume, saveVolume } from '../audio/volume'
import { Callout } from '../components/Callout'
import { PopButton } from '../components/PopButton'
import { PopChip } from '../components/PopPanel'
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
// Đặt giữa bằng calc thay vì translate: phần tử có transform làm lớp phủ mất background-attachment: fixed.
const STAGE_CLASSES: Record<StageLayout, string> = {
  hidden: 'invisible left-[calc(50%-160px)] top-[calc(50%-90px)] h-[180px] w-[320px]',
  small: 'left-[calc(50%-160px)] top-[calc(50%-90px)] h-[180px] w-[320px]',
  large: 'left-6 top-20 h-[31.5vw] w-[56vw] border-4 border-pop-paper shadow-[10px_10px_0_var(--color-pop-red)]',
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
    <main className="halftone-strong min-h-dvh">
      <header className="flex items-center gap-6 px-6 py-3">
        <PopChip className="text-2xl tabular-nums">Phòng {code}</PopChip>
        <label className="ml-auto flex items-center gap-2 font-semibold text-neutral-300">
          <span aria-hidden="true">🔊</span> Âm lượng
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            className="accent-pop-lime"
          />
        </label>
        {snapshot?.phase !== 'FINISHED' && (
          <PopButton variant="secondary" size="sm" onClick={() => void closeRoom()}>
            Đóng phòng
          </PopButton>
        )}
      </header>
      {error && (
        <Callout tone="error" className="mx-6 my-2">
          {error}
        </Callout>
      )}
      {snapshot?.notice && (
        <p
          role="status"
          className="fixed top-16 left-1/2 z-30 -translate-x-1/2 -skew-x-12 bg-pop-red px-6 py-2 text-2xl font-black text-pop-paper italic shadow-[5px_5px_0_var(--color-pop-ink)]"
        >
          {NOTICE_MESSAGES[snapshot.notice]}
        </p>
      )}

      {snapshot ? (
        <PhaseView snapshot={snapshot} offset={offset} onClose={() => void closeRoom()} />
      ) : (
        <p className="p-8 text-2xl font-semibold text-neutral-400">Đang kết nối tới phòng…</p>
      )}

      {/* Ẩn thì ẩn ngay: có transition, visibility chỉ đổi khi trượt xong nên khung đè lên màn kết quả 0,7 giây. */}
      <div
        data-testid="stage"
        data-layout={layout}
        className={`fixed z-10 overflow-hidden bg-pop-ink ${
          layout === 'hidden' ? '' : 'motion-safe:transition-all motion-safe:duration-700'
        } ${STAGE_CLASSES[layout]}`}
      >
        {/* Player tự gắn phần tử của nó vào đây; React không render con nào bên trong. */}
        <div ref={stageRef} className="h-full w-full" />
        {/* Cùng nền halftone-strong với trang: góc khung lòi ra ngoài đĩa vẫn gần như không thấy. */}
        <div
          data-testid="stage-cover"
          aria-hidden="true"
          className={`absolute inset-0 halftone-strong motion-safe:transition-opacity motion-safe:duration-700 ${
            layout === 'large' ? 'pointer-events-none opacity-0' : ''
          }`}
        />
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
