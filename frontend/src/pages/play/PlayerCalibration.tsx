import { useState } from 'react'
import { Callout } from '../../components/Callout'
import { PopChip } from '../../components/PopPanel'
import { CALIB_ROUNDS, errorMessage, type ErrorCode, type PlayerCalib } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

const TAP_ERRORS: Partial<Record<ErrorCode, string>> = {
  INVALID_STATE: 'Chưa tới lúc, chờ thấy BẤM! trên stream rồi bấm',
  TOO_LATE: 'Bấm trễ quá, lượt này không tính',
}

// Mount với key={calib.round}: mỗi lượt bắt đầu không có lỗi cũ.
export function PlayerCalibration({ calib }: { calib: PlayerCalib }) {
  const [error, setError] = useState<string | null>(null)

  const tap = async () => {
    setError(null)
    const response = await emitAck('player:calib_tap', { round: calib.round })
    if (!response.ok && response.error !== 'ALREADY_ANSWERED') {
      setError(TAP_ERRORS[response.error] ?? errorMessage(response.error))
    }
  }

  return (
    <section className="flex flex-col gap-4 text-center">
      <PopChip as="h1" className="self-center text-3xl">
        Đo độ trễ · Lượt {calib.round}/{CALIB_ROUNDS}
      </PopChip>
      {calib.tapped ? (
        <p className="py-16 text-4xl font-black text-pop-lime italic">Đã bấm lượt {calib.round}</p>
      ) : (
        <>
          <p className="text-lg font-semibold text-neutral-300">Bấm đúng lúc thấy hoặc nghe BẤM! trên stream</p>
          <button
            type="button"
            onClick={() => void tap()}
            className="group flex drop-hard hard-pop-red motion-safe:transition-transform motion-safe:active:scale-95"
          >
            <span className="flex min-h-[50dvh] flex-1 items-center justify-center clip-slant bg-pop-lime text-8xl font-black text-pop-ink italic [--slant:24px] group-active:bg-pop-red group-active:text-pop-paper">
              BẤM
            </span>
          </button>
        </>
      )}
      {error && <Callout tone="error">{error}</Callout>}
    </section>
  )
}
