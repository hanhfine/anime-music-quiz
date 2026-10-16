import { act } from '@testing-library/react'
import { setSocketForTests, type GameSocket, type Listener } from '../lib/socket'

type Reply = object | ((payload: unknown) => object)

export interface SentEvent {
  event: string
  payload: unknown
}

// Socket giả: ghi lại event client gửi, trả ack theo cấu hình, và giả lập event từ server.
export class FakeSocket implements GameSocket {
  connected = true
  sent: SentEvent[] = []
  private listeners = new Map<string, Set<Listener>>()
  private replies = new Map<string, Reply>()

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
    return this
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  emit(event: string, payload: unknown, ack: Listener) {
    this.sent.push({ event, payload })
    const reply = this.replies.get(event) ?? { ok: true }
    ack(typeof reply === 'function' ? reply(payload) : reply)
    return this
  }

  reply(event: string, response: Reply): void {
    this.replies.set(event, response)
  }

  serverEmit(event: string, payload?: unknown): void {
    act(() => {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
    })
  }

  payloads(event: string): unknown[] {
    return this.sent.filter((sent) => sent.event === event).map((sent) => sent.payload)
  }
}

export function installFakeSocket(): FakeSocket {
  const socket = new FakeSocket()
  setSocketForTests(socket)
  return socket
}
