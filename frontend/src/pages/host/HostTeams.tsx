import { useRef, useState } from 'react'
import { PopButton } from '../../components/PopButton'
import { TeamChip } from '../../components/TeamChip'
import { TEAM_COLORS } from '../../components/teams'
import { TEAM_COUNTS, type HostPlayer, type HostTeam } from '../../lib/protocol'
import { LobbyPlayer } from './LobbyPlayer'
import type { HostRun } from './useHostCommand'

const NAME_MAX_LENGTH = 20

interface SegmentsProps<T> {
  label: string
  options: { value: T; text: string }[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}

// Nút gạt kiểu radio. Bấm lại lựa chọn đang bật thì không gửi gì.
function Segments<T extends string | number>({ label, options, value, disabled, onChange }: SegmentsProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit -skew-x-12 border-2 border-pop-paper">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onChange(option.value)
          }}
          className="px-4 py-1 text-xl font-black italic aria-checked:bg-pop-lime aria-checked:text-pop-ink not-aria-checked:enabled:hover:bg-neutral-800"
        >
          {option.text}
        </button>
      ))}
    </div>
  )
}

export function TeamModeBar({ teams, run, busy }: { teams: HostTeam[] | null; run: HostRun; busy: boolean }) {
  const setCount = (count: number) => void run('host:set_teams', { count })
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Segments
        label="Cách chơi"
        options={[
          { value: 'solo', text: 'Chơi thường' },
          { value: 'teams', text: 'Theo đội' },
        ]}
        value={teams ? 'teams' : 'solo'}
        disabled={busy}
        onChange={(mode) => setCount(mode === 'teams' ? TEAM_COUNTS[0] : 0)}
      />
      {teams && (
        <>
          <Segments
            label="Số đội"
            options={TEAM_COUNTS.map((count) => ({ value: count, text: `${count} đội` }))}
            value={teams.length}
            disabled={busy}
            onChange={setCount}
          />
          <PopButton variant="secondary" size="sm" onClick={() => void run('host:shuffle_teams')} disabled={busy}>
            Chia ngẫu nhiên
          </PopButton>
        </>
      )}
    </div>
  )
}

// Bấm chip để đổi tên: Enter hoặc rời ô thì lưu, Esc thì hủy.
function TeamName({ team, run }: { team: HostTeam; run: HostRun }) {
  const [editing, setEditing] = useState(false)
  // Enter/Esc làm ô nhập biến mất, có thể kéo theo blur: chỉ xử lý lần kết thúc đầu tiên.
  const done = useRef(false)

  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    const name = value?.trim()
    if (name && name !== team.name) void run('host:rename_team', { team: team.index, name })
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`Đổi tên ${team.name}`}
        onClick={() => {
          done.current = false
          setEditing(true)
        }}
        className="w-fit max-w-full text-left"
      >
        <TeamChip team={team.index} name={team.name} />
      </button>
    )
  }
  return (
    <input
      autoFocus
      defaultValue={team.name}
      maxLength={NAME_MAX_LENGTH}
      aria-label={`Tên ${team.name}`}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      className={`w-full max-w-60 -skew-x-12 border-2 border-pop-ink px-3 py-1 text-2xl font-black italic ${TEAM_COLORS[team.index].face}`}
    />
  )
}

interface ColumnsProps {
  teams: HostTeam[]
  players: HostPlayer[]
  run: HostRun
  busy: boolean
  onKick: (player: HostPlayer) => void
}

export function TeamColumns({ teams, players, run, busy, onKick }: ColumnsProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
      {teams.map((team) => {
        const members = players.filter((player) => player.team === team.index)
        return (
          <section key={team.index} aria-label={team.name} className="flex flex-col gap-3">
            <TeamName team={team} run={run} />
            {members.length === 0 ? (
              <p className="text-neutral-400">Chưa có ai</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {members.map((player) => (
                  <LobbyPlayer key={player.id} player={player} onKick={onKick}>
                    {teams
                      .filter((other) => other.index !== team.index)
                      .map((other) => (
                        <button
                          key={other.index}
                          type="button"
                          aria-label={`Chuyển ${player.name} sang ${other.name}`}
                          title={`Chuyển sang ${other.name}`}
                          disabled={busy}
                          onClick={() => void run('host:move_player', { playerId: player.id, team: other.index })}
                          className={`size-5 shrink-0 -skew-x-12 ${TEAM_COLORS[other.index].swatch} motion-safe:transition-transform motion-safe:enabled:hover:scale-125`}
                        />
                      ))}
                  </LobbyPlayer>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
