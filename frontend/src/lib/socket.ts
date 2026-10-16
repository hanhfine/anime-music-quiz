import { io } from 'socket.io-client'
import type { Ack } from './protocol'

// Cùng kiểu listener với socket.io-client.
export type Listener = (...args: any[]) => void

// Phần nhỏ nhất của Socket.IO client mà app dùng; test thay bằng FakeSocket.
export interface GameSocket {
  readonly connected: boolean
  on(event: string, listener: Listener): unknown
  off(event: string, listener: Listener): unknown
  emit(event: string, payload: unknown, ack: Listener): unknown
}

let socket: GameSocket | null = null

export function getSocket(): GameSocket {
  // Cùng origin: lúc dev đi qua proxy của Vite, lúc chạy thật do FastAPI phục vụ.
  socket ??= io()
  return socket
}

export function setSocketForTests(fake: GameSocket | null): void {
  socket = fake
}

export const ACK_TIMEOUT_MS = 8000

export function emitAck<T extends object = object>(
  event: string,
  payload: unknown = {},
  timeoutMs = ACK_TIMEOUT_MS,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'NETWORK' }), timeoutMs)
    getSocket().emit(event, payload, (response: Ack<T>) => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}
