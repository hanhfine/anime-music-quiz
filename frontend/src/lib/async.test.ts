import { describe, expect, it } from 'vitest'
import { mapLimit } from './async'

describe('mapLimit', () => {
  it('keeps input order and never exceeds the limit', async () => {
    let active = 0
    let peak = 0
    const results = await mapLimit([30, 10, 20, 5, 15], 3, async (ms, index) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, ms))
      active -= 1
      return `${index}:${ms}`
    })
    expect(results).toEqual(['0:30', '1:10', '2:20', '3:5', '4:15'])
    expect(peak).toBe(3)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([])
  })
})
