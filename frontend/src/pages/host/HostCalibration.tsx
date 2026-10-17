import { useEffect, useState } from 'react'
import { Burst } from '../../components/Burst'
import { PopChip } from '../../components/PopPanel'
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
      {/* z-10: hình nổ BẤM! nằm sau trong DOM nên sẽ vẽ đè lên chip. */}
      <PopChip as="p" className="relative z-10 text-4xl">
        Đo độ trễ · Lượt {round}/{CALIB_ROUNDS}
      </PopChip>
      {showFlash ? (
        <div className="relative grid place-items-center">
          <Burst className="absolute size-[34rem] fill-pop-red motion-safe:animate-slam" />
          <p className="relative text-[12rem] leading-none font-black text-pop-lime italic [text-shadow:8px_8px_0_var(--color-pop-ink)] motion-safe:animate-slam">
            BẤM!
          </p>
        </div>
      ) : step === null ? (
        <p className="text-6xl font-black text-neutral-300 italic">Chuẩn bị…</p>
      ) : (
        // key={step}: mỗi số là một phần tử mới nên lần nào cũng "đập" vào.
        <p
          key={step}
          className="text-[12rem] leading-none font-black italic [text-shadow:8px_8px_0_var(--color-pop-red)] motion-safe:animate-slam"
        >
          {step}
        </p>
      )}
      {showFlash && (
        <p className="relative text-3xl font-semibold">
          {calib.tappedCount}/{onlineCount} người đã bấm
        </p>
      )}
      <p className="relative max-w-2xl text-xl text-neutral-400">
        Người chơi bấm nút trên điện thoại ngay khi thấy hoặc nghe BẤM! trên stream.
      </p>
    </div>
  )
}
