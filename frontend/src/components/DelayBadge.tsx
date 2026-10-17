export function DelayBadge({ delayMs, calibrated }: { delayMs: number; calibrated: boolean }) {
  const text = `${(delayMs / 1000).toFixed(1)}s`
  return (
    <span
      title={calibrated ? 'Độ trễ đã đo' : 'Chưa đo, dùng trung vị của phòng'}
      className={`inline-block -skew-x-12 px-2 py-0.5 text-base font-semibold tabular-nums ${
        calibrated ? 'bg-pop-lime text-pop-ink' : 'bg-neutral-700 text-pop-paper'
      }`}
    >
      {calibrated ? text : `~${text}`}
    </span>
  )
}
