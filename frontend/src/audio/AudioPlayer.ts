// Interface phát nhạc ở tab quản trò (spec mục 5.1). Chỉ có 1 player cho cả ván.

export interface Clip {
  videoId: string
  startSec: number
  endSec: number
}

export interface AudioPlayer {
  load(clip: Clip): void
  // Gọi 1 lần cho mỗi load, khi chính đoạn nhạc (không phải quảng cáo) đang phát.
  onPlaying(callback: () => void): void
  onError(callback: (code: number) => void): void
  setVolume(volume: number): void
  stop(): void
  currentTime(): number
  destroy(): void
}

// Mã lỗi YouTube: 2 tham số sai, 5 lỗi HTML5, 100 không tìm thấy, 101/150 chủ video chặn nhúng.
export const FATAL_ERROR_CODES: readonly number[] = [2, 5, 100, 101, 150]

export const isFatalError = (code: number) => FATAL_ERROR_CODES.includes(code)

// Quảng cáo cũng ở trạng thái PLAYING nhưng currentTime gần 0, nên chờ tới gần startSec.
export const START_TOLERANCE_SEC = 1
