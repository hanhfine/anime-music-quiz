import { describe, expect, it } from 'vitest'
import { clampRoomSettings, defaultRoomSettings } from './roomSettings'

describe('roomSettings', () => {
  it('defaults questionCount to min(10, songs)', () => {
    expect(defaultRoomSettings(25)).toEqual({
      questionCount: 10,
      clipSec: 15,
      revealSec: 15,
      maxPlayers: 30,
      mode: 'stream',
    })
    expect(defaultRoomSettings(4).questionCount).toBe(4)
    expect(defaultRoomSettings(0).questionCount).toBe(1)
  })

  it('clamps every field into its range and rounds to integers', () => {
    expect(
      clampRoomSettings({ questionCount: 99, clipSec: 2, revealSec: 31, maxPlayers: 1.6, mode: 'stream' }, 12),
    ).toEqual({ questionCount: 12, clipSec: 5, revealSec: 30, maxPlayers: 2, mode: 'stream' })
  })

  it('replaces non-numbers (empty inputs) with the minimum', () => {
    expect(
      clampRoomSettings({ questionCount: Number.NaN, clipSec: 15, revealSec: Number.NaN, maxPlayers: 30, mode: 'stream' }, 5),
    ).toMatchObject({ questionCount: 1, revealSec: 0 })
  })
})
