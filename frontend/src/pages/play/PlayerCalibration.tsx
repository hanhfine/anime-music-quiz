import { useState } from 'react'
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
      <h1 className="text-2xl font-bold">
        Đo độ trễ · Lượt {calib.round}/{CALIB_ROUNDS}
      </h1>
      {calib.tapped ? (
        <p className="py-16 text-3xl font-bold text-emerald-300">Đã bấm lượt {calib.round}</p>
      ) : (
        <>
          <p className="text-lg text-slate-300">Bấm đúng lúc thấy hoặc nghe BẤM! trên stream</p>
          <button
            type="button"
            onClick={() => void tap()}
            className="min-h-[50vh] rounded-3xl bg-amber-500 text-7xl font-black text-slate-950 active:scale-95"
          >
            BẤM
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/15 p-3 text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}
