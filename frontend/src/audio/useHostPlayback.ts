import { useEffect } from 'react'
import { PREPARE_TIMEOUT_MS, type HostSnapshot } from '../lib/protocol'
import { emitAck } from '../lib/socket'
import { isFatalError, type AudioPlayer } from './AudioPlayer'

// Nối snapshot của quản trò với player: nạp bài ở PREPARING, báo audio_started / audio_failed, dừng khi rời câu.
export function useHostPlayback(player: AudioPlayer | null, snapshot: HostSnapshot | null): void {
  const phase = snapshot?.phase ?? null
  const round = snapshot?.round ?? null
  const preparing = phase === 'PREPARING' && round !== null
  const idle = phase === 'LOBBY' || phase === 'CALIBRATING' || phase === 'FINISHED'

  // Snapshot đến liên tục; chỉ nạp lại khi prepareSeq đổi (câu mới, phát lại, hoặc bài thay thế).
  const prepareSeq = preparing ? round.prepareSeq : null
  const roundIndex = round?.index ?? -1
  const videoId = round?.videoId ?? ''
  const startSec = round?.startSec ?? 0
  const endSec = round?.endSec ?? 0

  useEffect(() => {
    if (!player || prepareSeq === null) return
    let reported = false
    const report = (event: string, payload: object) => {
      if (reported) return
      reported = true
      clearTimeout(timer)
      void emitAck(event, payload)
    }
    player.onPlaying(() => report('host:audio_started', { roundIndex }))
    player.onError((code) => {
      if (isFatalError(code)) report('host:audio_failed', { roundIndex, reason: `ERROR_${code}` })
    })
    const timer = setTimeout(
      () => report('host:audio_failed', { roundIndex, reason: 'TIMEOUT' }),
      PREPARE_TIMEOUT_MS,
    )
    player.load({ videoId, startSec, endSec })
    return () => {
      // Rời PREPARING: nhạc vẫn phát tiếp (ANSWERING/REVEAL) nhưng không báo gì nữa.
      reported = true
      clearTimeout(timer)
    }
  }, [player, prepareSeq, roundIndex, videoId, startSec, endSec])

  useEffect(() => {
    if (player && idle) player.stop()
  }, [player, idle])
}
