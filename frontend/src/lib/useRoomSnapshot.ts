import { useEffect, useRef, useState } from 'react'
import { clockOffset } from './clock'
import type { ClosedReason } from './protocol'
import { getSocket } from './socket'

export interface RoomConnection<S> {
  snapshot: S | null
  offset: number
  closedReason: ClosedReason | null
}

// Nghe room:state và room:closed của một phòng. `authenticate` chạy mỗi lần socket kết nối
// (kể cả kết nối lại) để gửi host:resume hoặc player:rejoin; server trả snapshot hiện tại.
export function useRoomSnapshot<S extends { code: string; serverNow: number }>(
  code: string,
  authenticate: () => void,
): RoomConnection<S> {
  const [state, setState] = useState<RoomConnection<S>>({ snapshot: null, offset: 0, closedReason: null })
  const authRef = useRef(authenticate)

  useEffect(() => {
    authRef.current = authenticate
  })

  useEffect(() => {
    const socket = getSocket()
    const onState = (snapshot: S) => {
      if (snapshot.code !== code) return
      setState((prev) => ({ ...prev, snapshot, offset: clockOffset(snapshot.serverNow) }))
    }
    const onClosed = ({ reason }: { reason: ClosedReason }) => {
      setState((prev) => ({ ...prev, closedReason: reason }))
    }
    const onConnect = () => authRef.current()
    socket.on('room:state', onState)
    socket.on('room:closed', onClosed)
    socket.on('connect', onConnect)
    if (socket.connected) onConnect()
    return () => {
      socket.off('room:state', onState)
      socket.off('room:closed', onClosed)
      socket.off('connect', onConnect)
    }
  }, [code])

  return state
}
