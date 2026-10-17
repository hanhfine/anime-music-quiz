import { describe, expect, it } from 'vitest'
import { playerPodium } from './podiumEntries'
import { byRank, teamPodium, votesTied, type TeamRow } from './teams'

const team = (index: number, score: number, rank: number): TeamRow => ({
  index,
  name: `Đội ${index}`,
  score,
  rank,
  gained: null,
})

describe('byRank', () => {
  it('sorts a copy by rank, then by team index', () => {
    const teams = [team(0, 0, 3), team(1, 900, 1), team(2, 900, 1)]
    expect(byRank(teams).map((t) => t.index)).toEqual([1, 2, 0])
    expect(teams.map((t) => t.index)).toEqual([0, 1, 2])
  })
})

describe('podium entries', () => {
  it('turns teams and leaderboard rows into podium entries', () => {
    expect(teamPodium([team(0, 100, 2), team(1, 900, 1)])).toEqual([
      { id: 'team-1', name: 'Đội 1', score: 900, rank: 1 },
      { id: 'team-0', name: 'Đội 0', score: 100, rank: 2 },
    ])
    expect(playerPodium([{ playerId: 'p1', name: 'Mai', score: 870, rank: 1, gained: 870 }])).toEqual([
      { id: 'p1', name: 'Mai', score: 870, rank: 1 },
    ])
  })
})

describe('votesTied', () => {
  it('needs two or more tiles sharing the highest non-zero count', () => {
    expect(votesTied([0, 0, 0, 0])).toBe(false)
    expect(votesTied([2, 1, 0, 0])).toBe(false)
    expect(votesTied([1, 0, 1, 0])).toBe(true)
    expect(votesTied([2, 2, 2, 0])).toBe(true)
    expect(votesTied([])).toBe(false)
  })
})
