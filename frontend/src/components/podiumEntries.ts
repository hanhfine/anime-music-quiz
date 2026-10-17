import type { LeaderboardRow } from '../lib/protocol'

// Một chỗ trên bục vinh quang: người chơi hoặc đội.
export interface PodiumEntry {
  id: string
  name: string
  score: number
  rank: number
}

export function playerPodium(rows: LeaderboardRow[]): PodiumEntry[] {
  return rows.map((row) => ({ id: row.playerId, name: row.name, score: row.score, rank: row.rank }))
}
