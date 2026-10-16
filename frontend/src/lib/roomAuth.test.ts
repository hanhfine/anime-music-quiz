import { describe, expect, it } from 'vitest'
import { clearRoomAuth, loadRoomAuth, saveRoomAuth } from './roomAuth'

describe('roomAuth', () => {
  it('returns an empty object when nothing is stored', () => {
    expect(loadRoomAuth('ABC234')).toEqual({})
  })

  it('stores tokens under room:<code> and merges patches', () => {
    saveRoomAuth('ABC234', { hostToken: 'h1' })
    saveRoomAuth('ABC234', { playerToken: 'p1', playerId: 'id1' })
    expect(loadRoomAuth('ABC234')).toEqual({ hostToken: 'h1', playerToken: 'p1', playerId: 'id1' })
    expect(JSON.parse(localStorage.getItem('room:ABC234')!)).toEqual({
      hostToken: 'h1',
      playerToken: 'p1',
      playerId: 'id1',
    })
  })

  it('clears only the given role', () => {
    saveRoomAuth('ABC234', { hostToken: 'h1', playerToken: 'p1', playerId: 'id1' })
    clearRoomAuth('ABC234', 'player')
    expect(loadRoomAuth('ABC234')).toEqual({ hostToken: 'h1' })
    clearRoomAuth('ABC234', 'host')
    expect(localStorage.getItem('room:ABC234')).toBeNull()
  })

  it('ignores corrupted storage', () => {
    localStorage.setItem('room:ABC234', '{oops')
    expect(loadRoomAuth('ABC234')).toEqual({})
    localStorage.setItem('room:ABC234', '"text"')
    expect(loadRoomAuth('ABC234')).toEqual({})
  })
})
