import type { RoomSettings } from './protocol'

export const SETTING_LIMITS = {
  clipSec: [5, 30],
  revealSec: [0, 30],
  maxPlayers: [2, 50],
} as const

export function defaultRoomSettings(songCount: number): RoomSettings {
  return {
    questionCount: Math.max(1, Math.min(10, songCount)),
    clipSec: 15,
    revealSec: 15,
    maxPlayers: 30,
    mode: 'stream',
  }
}

const clamp = (value: number, [min, max]: readonly [number, number]) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min

export function clampRoomSettings(settings: RoomSettings, songCount: number): RoomSettings {
  return {
    questionCount: clamp(settings.questionCount, [1, Math.max(1, songCount)]),
    clipSec: clamp(settings.clipSec, SETTING_LIMITS.clipSec),
    revealSec: clamp(settings.revealSec, SETTING_LIMITS.revealSec),
    maxPlayers: clamp(settings.maxPlayers, SETTING_LIMITS.maxPlayers),
    mode: 'stream',
  }
}
