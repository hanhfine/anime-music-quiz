import { useState } from 'react'
import { errorMessage } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

export type HostRun = (event: string, payload?: object) => Promise<boolean>

// Gửi lệnh của quản trò; snapshot mới đến qua room:state, ở đây chỉ giữ lỗi để hiện.
export function useHostCommand() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run: HostRun = async (event, payload = {}) => {
    setBusy(true)
    setError(null)
    const response = await emitAck(event, payload)
    setBusy(false)
    if (!response.ok) setError(errorMessage(response.error))
    return response.ok
  }

  return { run, error, busy }
}
