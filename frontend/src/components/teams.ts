import type { PodiumEntry } from './podiumEntries'

// Màu cố định theo chỉ số đội: 0 Đỏ, 1 Chanh, 2 Trắng, 3 Tím.
// face: nền và chữ; swatch: vạch màu; hard: màu bóng cứng, khác màu nền để khối nổi trên nền đen.
// Chuỗi class viết nguyên văn để Tailwind quét thấy.
export const TEAM_COLORS = [
  { face: 'bg-pop-red text-pop-paper', swatch: 'bg-pop-red', hard: 'hard-pop-paper' },
  { face: 'bg-pop-lime text-pop-ink', swatch: 'bg-pop-lime', hard: 'hard-pop-red' },
  { face: 'bg-pop-paper text-pop-ink', swatch: 'bg-pop-paper', hard: 'hard-pop-red' },
  { face: 'bg-pop-violet text-pop-paper', swatch: 'bg-pop-violet', hard: 'hard-pop-lime' },
] as const

// Phần chung của HostTeam và PlayerTeam mà bảng xếp hạng và bục vinh quang cần.
export interface TeamRow {
  index: number
  name: string
  score: number
  rank: number
  gained: number | null
}

// Server gửi teams theo chỉ số đội. Hàm này trả bản sao xếp theo hạng, cùng hạng thì theo chỉ số đội.
export function byRank<T extends TeamRow>(teams: T[]): T[] {
  return [...teams].sort((a, b) => a.rank - b.rank || a.index - b.index)
}

export function teamPodium(teams: TeamRow[]): PodiumEntry[] {
  return byRank(teams).map((team) => ({ id: `team-${team.index}`, name: team.name, score: team.score, rank: team.rank }))
}

// Đang hòa: từ hai ô trở lên cùng bằng số phiếu cao nhất, và số đó lớn hơn 0.
export function votesTied(votes: number[]): boolean {
  const top = Math.max(0, ...votes)
  return top > 0 && votes.filter((count) => count === top).length > 1
}
