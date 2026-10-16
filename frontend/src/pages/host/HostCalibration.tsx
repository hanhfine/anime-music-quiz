import { useEffect, useState } from 'react'
import { beep } from '../../lib/beep'
import { CALIB_ROUNDS, type HostCalib, type HostPlayer } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

type Step = 3 | 2 | 1 | 'flash' | null

// Mount với key={calib.round}: mỗi lượt là một bộ đếm mới.
export function HostCalibration({ calib, players }: { calib: HostCalib; players: HostPlayer[] }) {
  const { round, waitMs, flashed } = calib
  const [step, setStep] = useState<Step>(null)

  useEffect(() => {
    if (flashed) return
    const timers = ([3, 2, 1] as const).map((n, i) => setTimeout(() => setStep(n), waitMs + i * 1000))
    timers.push(
      setTimeout(() => {
        setStep('flash')
        beep()
        void emitAck('host:calib_flash', { round })
      }, waitMs + 3000),
    )
    return () => timers.forEach(clearTimeout)
  }, [round, waitMs, flashed])

  const showFlash = flashed || step === 'flash'
  const onlineCount = players.filter((player) => player.online).length

  return (
    <div className="flex min-h-[80vh] flex-col items-center justify-center gap-8 text-center">
      <p className="text-3xl text-slate-400">
        Đo độ trễ · Lượt {round}/{CALIB_ROUNDS}
      </p>
      {showFlash ? (
        <p className="text-[12rem] leading-none font-black text-amber-400">BẤM!</p>
      ) : step === null ? (
        <p className="text-6xl font-bold text-slate-300">Chuẩn bị…</p>
      ) : (
        <p className="text-[12rem] leading-none font-black">{step}</p>
      )}
      {showFlash && (
        <p className="text-3xl">
          {calib.tappedCount}/{onlineCount} người đã bấm
        </p>
      )}
      <p className="max-w-2xl text-xl text-slate-400">
        Người chơi bấm nút trên điện thoại ngay khi thấy hoặc nghe BẤM! trên stream.
      </p>
    </div>
  )
}
