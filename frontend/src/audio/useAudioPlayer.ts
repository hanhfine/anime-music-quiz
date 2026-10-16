import { useEffect, useState, type RefObject } from 'react'
import type { AudioPlayer } from './AudioPlayer'
import { createPlayer } from './createPlayer'

// Tạo đúng 1 player khi container đã mount; container phải luôn được render và không có con do React quản lý.
export function useAudioPlayer(containerRef: RefObject<HTMLElement | null>): AudioPlayer | null {
  const [player, setPlayer] = useState<AudioPlayer | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const created = createPlayer(container)
    setPlayer(created)
    return () => {
      created.destroy()
      setPlayer(null)
    }
  }, [containerRef])

  return player
}
