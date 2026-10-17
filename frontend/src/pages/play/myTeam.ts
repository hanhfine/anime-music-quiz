import type { PlayerSnapshot, PlayerTeam } from '../../lib/protocol'

// Đội của người xem; null khi chơi thường.
export function myTeam(snapshot: PlayerSnapshot): PlayerTeam | null {
  const { teams, me } = snapshot
  return teams && me.team !== null ? (teams[me.team] ?? null) : null
}
