import type { AudioPlayer } from './AudioPlayer'
import { FakePlayer } from './FakePlayer'
import { YouTubePlayer } from './YouTubePlayer'

type Factory = (container: HTMLElement) => AudioPlayer

// E2E chạy với VITE_FAKE_PLAYER=1: player giả tự "phát" sau 300 ms.
const FAKE_AUTOPLAY_MS = 300

let factoryOverride: Factory | null = null

export function setPlayerFactoryForTests(factory: Factory | null): void {
  factoryOverride = factory
}

export function createPlayer(container: HTMLElement): AudioPlayer {
  if (factoryOverride) return factoryOverride(container)
  if (import.meta.env.VITE_FAKE_PLAYER === '1') return new FakePlayer(container, { autoPlayMs: FAKE_AUTOPLAY_MS })
  return new YouTubePlayer(container)
}
