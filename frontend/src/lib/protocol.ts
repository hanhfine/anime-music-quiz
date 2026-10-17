// Dữ liệu trao đổi với server qua Socket.IO, khớp với backend/app/game/views.py.
// Trường không áp dụng luôn có mặt với giá trị null.

export type Phase = 'LOBBY' | 'CALIBRATING' | 'PREPARING' | 'ANSWERING' | 'REVEAL' | 'FINISHED'
export type Notice = 'AUDIO_REPLACED' | 'ROUND_DROPPED'
export type ClosedReason = 'CLOSED' | 'KICKED' | 'EXPIRED'

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NAME_TAKEN'
  | 'INVALID_NAME'
  | 'INVALID_TOKEN'
  | 'INVALID_STATE'
  | 'INVALID_SET'
  | 'ALREADY_ANSWERED'
  | 'TOO_LATE'
  | 'KICKED'
  | 'EMPTY_TEAM'
  | 'NETWORK' // chỉ có ở client: không nhận được ack

export interface RoomSettings {
  questionCount: number
  clipSec: number
  revealSec: number
  maxPlayers: number
  mode: 'stream'
}

export interface LeaderboardRow {
  playerId: string
  name: string
  score: number
  rank: number
  gained: number | null
}

export interface TeamPick {
  team: number
  option: number | null // null: hòa hoặc không ai bỏ phiếu
  tied: boolean
  gained: number
}

export interface HostTeam {
  index: number
  name: string
  score: number
  rank: number
  gained: number | null // chỉ có khi REVEAL
  memberIds: string[]
}

export interface PlayerTeam {
  index: number
  name: string
  score: number
  rank: number
  gained: number | null // chỉ có khi REVEAL
  members: string[] // tên thành viên
}

export interface PlayerTeamResult {
  option: number | null
  tied: boolean
  correct: boolean
  gained: number
}

export interface HostPlayer {
  id: string
  name: string
  online: boolean
  delayMs: number
  calibrated: boolean
  score: number
  team: number | null
}

export interface HostCalib {
  round: number
  waitMs: number
  flashed: boolean
  tappedCount: number
}

export interface HostReveal {
  correctIndex: number
  optionCounts: number[]
  animeName: string
  songLabel: string | null
  teamPicks: TeamPick[] | null
}

export interface HostRound {
  index: number
  total: number
  videoId: string
  startSec: number
  endSec: number
  options: string[]
  deadline: number | null
  answeredCount: number
  onlineCount: number
  prepareSeq: number
  reveal: HostReveal | null
}

export interface HostSnapshot {
  code: string
  phase: Phase
  mode: 'stream'
  settings: RoomSettings
  serverNow: number
  players: HostPlayer[]
  teams: HostTeam[] | null // theo chỉ số đội; null khi chơi thường
  calib: HostCalib | null
  round: HostRound | null
  leaderboard: LeaderboardRow[]
  notice: Notice | null
}

export interface PlayerMe {
  id: string
  name: string
  score: number
  rank: number
  delayMs: number
  calibrated: boolean
  team: number | null
}

export interface PlayerCalib {
  round: number
  tapped: boolean
}

export interface PlayerResult {
  correctIndex: number
  correct: boolean
  gained: number
  animeName: string
  songLabel: string | null
  team: PlayerTeamResult | null
}

export interface PlayerRound {
  index: number
  total: number
  options: string[] | null
  deadline: number | null
  myAnswer: number | null
  teamVotes: number[] | null // phiếu của đội mình theo từng ô
  result: PlayerResult | null
}

export interface PlayerSnapshot {
  code: string
  phase: Phase
  serverNow: number
  hostOnline: boolean
  playerCount: number
  me: PlayerMe
  teams: PlayerTeam[] | null // theo chỉ số đội; null khi chơi thường
  calib: PlayerCalib | null
  round: PlayerRound | null
  leaderboardTop: LeaderboardRow[] | null
}

export type Ack<T extends object = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode }

export interface CreateRoomAck {
  code: string
  hostToken: string
}

export interface JoinAck {
  playerId: string
  playerToken: string
}

export interface RejoinAck {
  playerId: string
}

export const GRACE_MS = 3000
export const PREPARE_TIMEOUT_MS = 10_000
export const CALIB_ROUNDS = 3
export const TEAM_COUNTS = [2, 3, 4] as const

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: 'Phòng không còn tồn tại',
  ROOM_FULL: 'Phòng đã đủ người',
  GAME_STARTED: 'Ván đã bắt đầu, không vào thêm được',
  NAME_TAKEN: 'Tên này đã có người dùng trong phòng',
  INVALID_NAME: 'Tên phải dài 1–20 ký tự',
  INVALID_TOKEN: 'Phiên đã hết hạn, hãy vào lại phòng',
  INVALID_STATE: 'Thao tác không hợp lệ lúc này',
  INVALID_SET: 'Bộ câu hỏi hoặc thiết lập phòng không hợp lệ',
  ALREADY_ANSWERED: 'Bạn đã trả lời rồi',
  TOO_LATE: 'Hết giờ rồi',
  KICKED: 'Bạn đã bị mời ra khỏi phòng',
  EMPTY_TEAM: 'Còn đội chưa có người',
  NETWORK: 'Mất kết nối tới server, thử lại nhé',
}

export const CLOSED_MESSAGES: Record<ClosedReason, string> = {
  CLOSED: 'Quản trò đã đóng phòng',
  KICKED: 'Bạn đã bị mời ra khỏi phòng',
  EXPIRED: 'Phòng đã hết hạn',
}

export function errorMessage(code: string): string {
  return Object.hasOwn(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code as ErrorCode]
    : `Lỗi không xác định (${code})`
}
