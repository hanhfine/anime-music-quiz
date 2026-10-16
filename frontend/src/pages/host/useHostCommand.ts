import { useState } from 'react'
import { errorMessage } from '../../lib/protocol'
import { emitAck } from '../../lib/socket'

// Gửi lệnh của quản trò; snapshot mới đến qua room:state, ở đây chỉ giữ lỗi để hiện.
export function useHostCommand() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (event: string, payload: object = {}): Promise<boolean> => {
    setBusy(true)
    setError(null)
    const response = await emitAck(event, payload)
    setBusy(false)
    if (!response.ok) setError(errorMessage(response.error))
    return response.ok
  }

  return { run, error, busy }
}
