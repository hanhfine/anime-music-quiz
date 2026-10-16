import { describe, expect, it } from 'vitest'
import { clockOffset, remainingMs } from './clock'

describe('clock', () => {
  it('computes the server clock offset', () => {
    expect(clockOffset(10_500, 10_000)).toBe(500)
    expect(clockOffset(9_000, 10_000)).toBe(-1000)
  })

  it('computes the remaining time on the server clock', () => {
    // Đồng hồ server nhanh hơn 500 ms: lúc local = 10_000 thì server = 10_500.
    expect(remainingMs(12_000, 500, 10_000)).toBe(1500)
  })

  it('never returns a negative remaining time', () => {
    expect(remainingMs(10_000, 0, 11_000)).toBe(0)
  })
})
