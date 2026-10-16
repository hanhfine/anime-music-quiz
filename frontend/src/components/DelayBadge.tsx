export function DelayBadge({ delayMs, calibrated }: { delayMs: number; calibrated: boolean }) {
  const text = `${(delayMs / 1000).toFixed(1)}s`
  return (
    <span
      title={calibrated ? 'Độ trễ đã đo' : 'Chưa đo, dùng trung vị của phòng'}
      className={`rounded-full px-2 py-0.5 font-mono text-sm ${calibrated ? 'bg-emerald-800 text-emerald-100' : 'bg-slate-700 text-slate-300'}`}
    >
      {calibrated ? text : `~${text}`}
    </span>
  )
}
