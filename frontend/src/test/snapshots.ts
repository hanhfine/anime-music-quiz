import type { HostRound, HostSnapshot } from '../lib/protocol'

// Snapshot đầy đủ trường (trường không áp dụng là null), sửa bằng patch cho từng test.
export function hostRound(patch: Partial<HostRound> = {}): HostRound {
  return {
    index: 0,
    total: 2,
    videoId: 'AAAAAAAAAAA',
    startSec: 30,
    endSec: 60,
    options: ['Shingeki no Kyojin', 'Naruto', 'One Piece', 'Bleach'],
    deadline: null,
    answeredCount: 0,
    onlineCount: 2,
    prepareSeq: 1,
    reveal: null,
    ...patch,
  }
}

export function hostSnapshot(patch: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    code: 'K7M2QX',
    phase: 'LOBBY',
    mode: 'stream',
    settings: { questionCount: 2, clipSec: 15, revealSec: 15, maxPlayers: 30, mode: 'stream' },
    serverNow: Date.now(),
    players: [],
    calib: null,
    round: null,
    leaderboard: [],
    notice: null,
    ...patch,
  }
}
