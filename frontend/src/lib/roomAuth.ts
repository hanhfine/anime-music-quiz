// Token phòng lưu ở localStorage theo khóa `room:<code>` để kết nối lại sau khi tải lại trang.

export interface RoomAuth {
  hostToken?: string
  playerToken?: string
  playerId?: string
}

const key = (code: string) => `room:${code}`

export function loadRoomAuth(code: string): RoomAuth {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(code)) ?? '{}')
    return typeof data === 'object' && data !== null ? (data as RoomAuth) : {}
  } catch {
    return {}
  }
}

export function saveRoomAuth(code: string, patch: RoomAuth): void {
  localStorage.setItem(key(code), JSON.stringify({ ...loadRoomAuth(code), ...patch }))
}

export function clearRoomAuth(code: string, role: 'host' | 'player'): void {
  const { hostToken, playerToken, playerId } = loadRoomAuth(code)
  const rest: RoomAuth = role === 'host' ? { playerToken, playerId } : { hostToken }
  const kept = Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined))
  if (Object.keys(kept).length === 0) {
    localStorage.removeItem(key(code))
  } else {
    localStorage.setItem(key(code), JSON.stringify(kept))
  }
}
