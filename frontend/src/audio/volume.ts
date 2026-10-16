const KEY = 'animequiz:volume'
export const DEFAULT_VOLUME = 80

export function loadVolume(): number {
  const raw = localStorage.getItem(KEY)
  const value = raw === null ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_VOLUME
}

export function saveVolume(volume: number): void {
  localStorage.setItem(KEY, String(volume))
}
