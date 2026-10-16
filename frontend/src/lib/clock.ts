// Đồng hồ client chỉ dùng để hiển thị; server mới quyết định thời gian.

export function clockOffset(serverNow: number, localNow = Date.now()): number {
  return serverNow - localNow
}

export function remainingMs(deadline: number, offset: number, localNow = Date.now()): number {
  return Math.max(0, deadline - (localNow + offset))
}
