import { useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage, type CreateRoomAck, type RoomSettings } from '../lib/protocol'
import { saveRoomAuth } from '../lib/roomAuth'
import { clampRoomSettings, defaultRoomSettings, SETTING_LIMITS } from '../lib/roomSettings'
import { readySongs, roomBlocker, unreadyNote, type Song } from '../lib/sets/schema'
import { emitAck } from '../lib/socket'
import { Callout } from './Callout'
import { PopButton } from './PopButton'
import { PopPanel } from './PopPanel'

type NumericSetting = Exclude<keyof RoomSettings, 'mode'>

export function CreateRoomPanel({ songs }: { songs: Song[] }) {
  const navigate = useNavigate()
  // Chỉ giữ giá trị quản trò đã sửa; còn lại theo mặc định (số câu đổi theo số bài sẵn sàng).
  const [custom, setCustom] = useState<Partial<Record<NumericSetting, number>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Phòng chỉ dùng bài đã có tên và đã xác nhận; bài còn lại được bỏ qua, không phải chờ.
  const ready = readySongs(songs)
  const settings: RoomSettings = { ...defaultRoomSettings(ready.length), ...custom }
  const blocker = roomBlocker(songs)
  const note = blocker ? null : unreadyNote(songs)

  const fields: { key: NumericSetting; label: string; min: number; max: number }[] = [
    { key: 'questionCount', label: 'Số câu', min: 1, max: Math.max(1, ready.length) },
    { key: 'clipSec', label: 'Độ dài đoạn nhạc (giây)', min: SETTING_LIMITS.clipSec[0], max: SETTING_LIMITS.clipSec[1] },
    {
      key: 'revealSec',
      label: 'Phát thêm khi công bố (giây)',
      min: SETTING_LIMITS.revealSec[0],
      max: SETTING_LIMITS.revealSec[1],
    },
    {
      key: 'maxPlayers',
      label: 'Số người tối đa',
      min: SETTING_LIMITS.maxPlayers[0],
      max: SETTING_LIMITS.maxPlayers[1],
    },
  ]

  const create = async () => {
    setBusy(true)
    setError(null)
    const response = await emitAck<CreateRoomAck>('host:create_room', {
      set: { songs: ready },
      settings: clampRoomSettings(settings, ready.length),
    })
    if (!response.ok) {
      setError(errorMessage(response.error))
      setBusy(false)
      return
    }
    saveRoomAuth(response.code, { hostToken: response.hostToken })
    navigate(`/host/${response.code}`)
  }

  return (
    <PopPanel title="Tạo phòng">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {fields.map(({ key, label, min, max }) => (
          <label key={key} className="flex flex-col gap-1 text-base font-semibold">
            {label}
            <input
              type="number"
              min={min}
              max={max}
              value={Number.isNaN(settings[key]) ? '' : settings[key]}
              onChange={(e) => setCustom((prev) => ({ ...prev, [key]: e.target.valueAsNumber }))}
              className="border border-neutral-700 bg-neutral-800 px-2 py-1 font-medium tabular-nums"
            />
          </label>
        ))}
      </div>
      <p className="text-base text-neutral-400">
        Mở màn hình quản trò rồi chia sẻ tab đó kèm âm thanh trên Discord. Phát thêm 0 giây nghĩa là không phát video khi
        công bố đáp án.
      </p>
      {blocker && <p className="font-semibold text-pop-lime">{blocker}</p>}
      {note && <p className="text-base text-pop-lime">{note}</p>}
      {error && <Callout tone="error">{error}</Callout>}
      <PopButton onClick={create} disabled={blocker !== null || busy} className="self-start">
        {busy ? 'Đang tạo…' : 'Tạo phòng'}
      </PopButton>
    </PopPanel>
  )
}
