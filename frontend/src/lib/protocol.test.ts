import { describe, expect, it } from 'vitest'
import { errorMessage } from './protocol'

describe('errorMessage', () => {
  it('translates server error codes to Vietnamese', () => {
    expect(errorMessage('ROOM_NOT_FOUND')).toBe('Phòng không còn tồn tại')
    expect(errorMessage('NAME_TAKEN')).toBe('Tên này đã có người dùng trong phòng')
    expect(errorMessage('NETWORK')).toBe('Mất kết nối tới server, thử lại nhé')
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(errorMessage('WAT')).toBe('Lỗi không xác định (WAT)')
    expect(errorMessage('toString')).toBe('Lỗi không xác định (toString)')
  })
})
