# Thiết kế: Chơi theo đội

- **Ngày:** 2026-10-17
- **Trạng thái:** Đã duyệt thiết kế, chờ review spec

## 1. Mục tiêu và phạm vi

Thêm chế độ **chơi theo đội** cho game đoán anime qua nhạc. Trong mỗi câu, thành viên của một đội bỏ phiếu chọn đáp án; đáp án nhiều phiếu nhất là đáp án của cả đội. Bảng xếp hạng tính theo đội.

**Có trong phạm vi:**
- Quản trò chọn "Chơi thường" hoặc "Chơi theo đội" ở sảnh chờ, sau khi người chơi đã vào phòng.
- 2–4 đội, màu cố định, tên mặc định theo màu và quản trò sửa được.
- Người chơi tự chọn đội. Quản trò chia ngẫu nhiên cho cân và chuyển được từng người.
- Phiếu công khai trong đội và đổi được tới hết giờ.
- Điểm đội tính theo tốc độ trung bình của những người bầu đáp án thắng.

**Không có trong phạm vi:**
- Điểm cá nhân trong chế độ đội.
- Đổi đội giữa ván.
- Đội trưởng, chat trong đội.
- Chơi thường không đổi gì.

Tính năng "tên anime song ngữ Nhật/Anh" và chế độ "Anime Quiz" có spec riêng, không thuộc tài liệu này.

### 1.1 Các quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Đội trả lời thế nào | Mỗi người bỏ một phiếu; đáp án nhiều phiếu nhất trong đội là đáp án của đội |
| Phiếu | Thấy số phiếu của đội mình trên từng ô, đổi được tới hết giờ |
| Điểm đội | Đáp án đội đúng: `points()` hiện có với thời gian = trung bình thời gian hiệu dụng của phiếu cuối cùng của những người bầu đáp án thắng |
| Hòa phiếu | Đội không có đáp án, 0 điểm; điện thoại cả đội báo "ĐANG HÒA!" để tự gỡ |
| Chia đội | Người chơi tự chọn; quản trò có "Chia ngẫu nhiên" và chuyển từng người; người mới tự vào đội ít người nhất |
| Số đội, tên | 2–4 đội; màu cố định Đỏ, Chanh, Trắng, Tím; tên mặc định "Đội <màu>", quản trò sửa được |
| Bật chế độ | Ở sảnh chờ (pha LOBBY, kể cả sau "Chơi lại"): bật/tắt và đổi số đội |
| Cách làm | Thêm lớp đội vào `Room` hiện có; logic đội là hàm thuần trong module mới `game/teams.py` |

## 2. Luật chơi

### 2.1 Sảnh chờ

- `count = 0` là chơi thường. `count ∈ {2, 3, 4}` là chơi theo đội.
- **Bật chế độ đội (từ 0 lên n):**
  - Tạo n đội với tên mặc định.
  - Xếp từng người theo thứ tự vào phòng, mỗi người vào đội đang ít người nhất. Bằng nhau thì chọn đội có chỉ số nhỏ hơn.
- **Tăng số đội:** thêm đội mới với tên mặc định. Đội cũ giữ tên và thành viên.
- **Giảm số đội:** bỏ các đội có chỉ số cao nhất. Thành viên của các đội bị bỏ được xếp lần lượt, theo thứ tự vào phòng, vào đội ít người nhất trong các đội còn lại.
- **Tắt chế độ đội:** xóa danh sách đội và đội của mọi người. Bật lại thì tên đội về mặc định.
- **Người vào phòng khi đang ở chế độ đội** được xếp vào đội ít người nhất. Vào phòng được ở cả LOBBY và CALIBRATING, như hiện tại.
- **Chia ngẫu nhiên:** xáo thứ tự người chơi bằng `rng` của phòng, người thứ i vào đội `i % n`. Số người giữa các đội chênh nhau tối đa 1.
- **Chọn đội và chuyển người:** người chơi tự chuyển mình (`player:choose_team`), quản trò chuyển bất kỳ ai (`host:move_player`).
- **Đổi tên đội:** sau khi bỏ khoảng trắng đầu cuối, tên phải dài 1–20 ký tự (`NAME_MAX_LEN`). Sai thì báo `INVALID_NAME`. Cho phép trùng tên.
- **Pha hợp lệ:** đổi số đội, chia, chuyển, chọn và đổi tên chỉ chạy ở **LOBBY**. Pha khác báo `INVALID_STATE`.
- **Đầu vào sai** (chỉ số đội ngoài khoảng, `count` không thuộc {0, 2, 3, 4}, gọi lệnh đội khi đang chơi thường) báo `INVALID_STATE`.
- **Bắt đầu ván:** ở chế độ đội, nếu có đội không có thành viên nào thì báo lỗi mới `EMPTY_TEAM`.
- Đo độ trễ vẫn tính riêng từng người như cũ.

### 2.2 Trả lời

- `player:answer` ở chế độ đội nghĩa là bỏ hoặc đổi phiếu:
  - Chưa có phiếu: lưu phiếu mới.
  - Bấm lại đúng ô đang bầu: không đổi gì và không báo lỗi. Thời điểm bầu giữ nguyên, để bấm nhầm hai lần không bị tính chậm.
  - Bấm ô khác: thay phiếu, thời điểm nhận là lúc đổi.
  - Sau hạn chót: báo `TOO_LATE`, như hiện tại.
- Chơi thường giữ nguyên: bấm là chốt, bấm lần hai báo `ALREADY_ANSWERED`.
- **Công bố sớm** ở chế độ đội khi thỏa cả hai điều kiện:
  1. mọi người đang online đều đã có phiếu;
  2. không đội nào đang hòa.
  Nếu không thì chờ hạn chót. Chơi thường giữ nguyên điều kiện cũ.
- **Kết nối và kick:** phiếu của người đã mất kết nối vẫn được tính. Người bị kick mất phiếu, như hiện tại.

### 2.3 Công bố và tính điểm

Lúc công bố (`_reveal`), với mỗi đội:

1. Lấy phiếu của các thành viên hiện tại của đội, kể cả người đang offline.
2. Đếm phiếu từng ô:
   - Không ai bỏ phiếu: đội không có đáp án, `tied = false`, 0 điểm.
   - Có từ hai ô trở lên cùng bằng số phiếu cao nhất: đội không có đáp án, `tied = true`, 0 điểm.
   - Còn lại thì ô nhiều phiếu nhất là đáp án của đội.
3. Nếu đáp án của đội đúng:
   - `t` = trung bình của `effective_time_ms(received_at, t0, delay)` trên các phiếu bầu ô đó, làm tròn tới ms.
   - `gained = points(True, t, clip_ms)`.
   - Đáp án sai thì 0 điểm.
4. Cộng `gained` vào điểm đội.

Điểm cá nhân (`Player.score`) giữ ở 0 trong chế độ đội: `Answer.gained` của từng phiếu luôn là 0.

### 2.4 Phát lại câu và chơi lại

- **Phát lại câu khi đang công bố:** trừ `gained` của từng đội ở câu đó khỏi điểm đội, rồi vào lại câu như hiện tại.
- **Chơi lại:** điểm mọi đội về 0. Giữ nguyên chế độ, số đội, tên đội và cách chia đội.

## 3. Server

### 3.1 `game/teams.py` (mới, hàm thuần)

```python
@dataclass(frozen=True)
class TeamResult:
    option: int | None  # đáp án đội chốt; None nếu hòa hoặc không ai bỏ phiếu
    tied: bool
    gained: int

def smallest_team(sizes: list[int]) -> int: ...
def balanced_assignment(player_ids: list[str], count: int, rng: Random) -> dict[str, int]: ...
def tally(options: list[int], option_count: int) -> tuple[list[int], int | None, bool]:
    """(số phiếu từng ô, ô thắng hoặc None, có hòa không)."""
def team_result(
    votes: list[tuple[int, int]], option_count: int, correct_index: int, clip_ms: int
) -> TeamResult:
    """votes: (ô, thời gian hiệu dụng ms) của từng phiếu."""
```

### 3.2 `game/models.py`

- `Team`: dataclass có `name: str` và `score: int = 0`.
- `Player`: thêm `team: int | None = None`.
- `RoundState`: thêm `team_results: dict[int, TeamResult]`, mặc định rỗng, được điền lúc công bố.
- `constants.py`:
  - `TEAM_COUNTS = (2, 3, 4)`;
  - `TEAM_DEFAULT_NAMES = ("Đội Đỏ", "Đội Chanh", "Đội Trắng", "Đội Tím")`.

### 3.3 `game/room.py`

- `self.teams: list[Team] = []` (rỗng nghĩa là chơi thường). Có thêm property `team_mode`.
- Hàm mới:
  - `set_teams(count)`
  - `shuffle_teams()`
  - `move_player(player_id, team)`
  - `choose_team(player_id, team)`
  - `rename_team(team, name)`
  - `team_leaderboard() -> list[tuple[int, Team, int]]`: chỉ số đội, đội, hạng. Hạng tính bằng `competition_ranks`, sắp theo (hạng, chỉ số).
- Hàm sửa:
  - `add_player` và `start_game`: theo §2.1.
  - `answer` và `_maybe_reveal_early`: theo §2.2.
  - `_reveal`: theo §2.3.
  - `replay_round` và `play_again`: theo §2.4.

### 3.4 Socket.IO (`sockets.py`)

| Sự kiện | Payload | Gọi |
|---|---|---|
| `host:set_teams` | `{count}` | `room.set_teams` |
| `host:shuffle_teams` | `{}` | `room.shuffle_teams` |
| `host:move_player` | `{playerId, team}` | `room.move_player` |
| `host:rename_team` | `{team, name}` | `room.rename_team` |
| `player:choose_team` | `{team}` | `room.choose_team` |

- Lệnh quản trò đi qua `_host_command`.
- Sau mỗi lệnh thì gửi lại snapshot cho cả phòng (`_broadcast`), như các lệnh khác.
- `player:answer` giữ nguyên tên và payload.

### 3.5 Snapshot (`views.py`) và `protocol.ts`

Trường không áp dụng luôn có mặt với giá trị `null`, theo quy ước sẵn có. Ở chế độ thường mọi trường mới đều là `null`.

```ts
export type ErrorCode = ... | 'EMPTY_TEAM'

export interface TeamPick {
  team: number
  option: number | null
  tied: boolean
  gained: number
}

// Màn quản trò
export interface HostTeam {
  index: number
  name: string
  score: number
  rank: number
  gained: number | null // chỉ có khi REVEAL
  memberIds: string[]
}
HostPlayer.team: number | null
HostReveal.teamPicks: TeamPick[] | null
HostSnapshot.teams: HostTeam[] | null // theo chỉ số đội

// Điện thoại
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
PlayerMe.team: number | null
PlayerSnapshot.teams: PlayerTeam[] | null // theo chỉ số đội
PlayerRound.teamVotes: number[] | null    // phiếu của đội mình, chỉ khi ANSWERING và REVEAL
PlayerResult.team: PlayerTeamResult | null
```

- **Không lộ thông tin:**
  - `teamVotes` chỉ chứa phiếu của đội người nhận.
  - `teamPicks` và `PlayerResult` chỉ có từ REVEAL.
  - Màn quản trò trong lúc trả lời vẫn chỉ có `answeredCount`.
- **Trường cũ:**
  - `leaderboard` và `leaderboardTop` vẫn được gửi.
  - Giao diện ở chế độ đội dùng `teams` thay cho hai trường này.

## 4. Giao diện

### 4.1 Màu và component dùng chung

- **Màu mới:** thêm `--color-pop-violet: #9d4dff` vào `@theme`.
- **`components/teams.ts`:** màu theo chỉ số đội, gồm nền, chữ và màu bóng cứng:
  - 0 Đỏ (`pop-red`, chữ `pop-paper`)
  - 1 Chanh (`pop-lime`, chữ `pop-ink`)
  - 2 Trắng (`pop-paper`, chữ `pop-ink`)
  - 3 Tím (`pop-violet`, chữ `pop-paper`)
- **`TeamChip`:** chip vát chéo màu đội, viền mực 2px để nổi trên ô đáp án cùng màu. Có cỡ `sm` và `md`.
- **`TeamBoard`:** bảng xếp hạng đội. Mỗi hàng gồm hạng, vạch màu đội, tên đội, cột cộng điểm và tổng điểm.
  - Cột cộng điểm hiện "+870" khi công bố. Đội hòa hiện "HÒA".
  - Có tham số đánh dấu đội của người xem.
- **`Podium`:** đổi kiểu prop sang `{ id, name, score, rank }[]`, để dùng được cho cả người chơi lẫn đội. Nơi gọi tự chuyển dữ liệu sang kiểu này.
- **`AnswerTile`** thêm 2 prop tùy chọn:
  - `votes?: number`: huy hiệu "n phiếu" ở góc ô; ẩn khi 0.
  - `teamMarks?: number[]`: chip `TeamChip sm` của các đội đã chọn ô này.

### 4.2 Màn quản trò

- **LOBBY:**
  - Nút gạt "CHƠI THƯỜNG | THEO ĐỘI" nằm trên danh sách người chơi.
  - Ở chế độ đội có thêm nút chọn số đội 2/3/4 và nút "Chia ngẫu nhiên".
  - Danh sách người chơi đổi thành các cột đội.
  - Đầu cột là `TeamChip md`. Bấm vào thì thành ô nhập: Enter hoặc rời ô là lưu, Esc là hủy.
  - Mỗi người trong cột có huy hiệu độ trễ, nút kick và các ô màu của những đội khác để chuyển sang.
  - Còn đội trống thì nút "Bắt đầu" bị khóa, kèm dòng nhắc "Còn đội chưa có người".
  - Phần này đặt trong file mới `pages/host/HostTeams.tsx`.
- **ANSWERING:** chip góc phải đổi chữ thành "x/y đã bỏ phiếu".
- **REVEAL:**
  - Ô đáp án hiện số phiếu như hiện tại, kèm `teamMarks` từ `teamPicks`. Đội hòa không gắn chip lên ô nào.
  - Bảng bên dưới là `TeamBoard` thay cho `Leaderboard`.
- **FINISHED:** `Podium` và `TeamBoard` hiện các đội.

### 4.3 Điện thoại

- **Đầu trang:** chip điểm đổi thành `TeamChip` kèm tên đội và điểm đội.
- **LOBBY:**
  - Dưới "Bạn là ___" có danh sách đội. Mỗi đội là một nút vát chéo màu đội, ghi tên đội và tên các thành viên.
  - Đội của mình có nhãn "ĐỘI CỦA BẠN". Bấm đội khác là gửi `player:choose_team`.
  - Phần này đặt trong file mới `pages/play/TeamPicker.tsx`.
- **ANSWERING:**
  - Vẫn là lưới 2×2. Mỗi ô có `votes` của đội mình.
  - Ô mình đang bầu ở trạng thái `chosen`. Các ô khác vẫn bấm được để đổi phiếu.
  - Dòng trạng thái ghi "<Tên đội> · x/y đã bỏ phiếu":
    - x là tổng `teamVotes`;
    - y là số thành viên của đội trong `teams`.
  - Khi hòa (từ hai ô trở lên cùng bằng số phiếu cao nhất, số đó lớn hơn 0; điện thoại tự tính từ `teamVotes`), dòng này thành dải đỏ "ĐANG HÒA!" nhấp nháy, tắt khi bật giảm chuyển động.
- **REVEAL:**
  - Băng kết quả theo `result.team`:
    - "ĐỘI ĐÚNG! +870" màu chanh;
    - "ĐỘI SAI" màu trắng;
    - "HÒA PHIẾU · 0 ĐIỂM" màu đỏ.
  - Ô đúng đánh dấu như hiện tại. Đội chọn sai thì ô đội chọn mang dấu ✕.
- **FINISHED:** "<Tên đội> · Hạng r/n" kèm `TeamBoard`.

## 5. Kiểm thử

- **`backend/tests/game/test_teams.py`** (mới) cho các hàm trong `teams.py`:
  - đội ít người nhất, bằng nhau thì lấy chỉ số nhỏ;
  - chia ngẫu nhiên chênh tối đa 1;
  - hòa, không ai bỏ phiếu, thắng rõ;
  - trung bình thời gian chỉ tính phiếu của ô thắng.
- **`tests/game/test_room_lobby.py` và `test_room_game.py`**, phần chế độ đội:
  - bật, tắt, tăng và giảm số đội;
  - người mới vào đội ít người nhất;
  - các lệnh đội báo `INVALID_STATE` ngoài LOBBY;
  - `EMPTY_TEAM`;
  - đổi phiếu, và bấm lại cùng ô không đổi thời điểm;
  - công bố sớm, và không công bố sớm khi đang hòa;
  - điểm đội, điểm cá nhân giữ ở 0;
  - phát lại câu trừ điểm đội;
  - chơi lại giữ đội.
- **`tests/game/test_views.py`:**
  - `teamVotes` chỉ có phiếu của đội người nhận;
  - không có `teamPicks` hoặc kết quả trước REVEAL;
  - chế độ thường có các trường mới là `null`.
- **`tests/sockets/test_server_lobby.py`:** 5 sự kiện mới đến được `Room`, và quyền quản trò được kiểm tra.
- **Frontend (Vitest):** `TeamChip`, `TeamBoard`, `AnswerTile` với `votes` và `teamMarks`, `HostTeams`, `TeamPicker`, `PlayerRound` ở chế độ đội (đổi phiếu, "ĐANG HÒA!", băng kết quả), và `HostQuestion` REVEAL có chip đội.
- **E2E:** `e2e/teams.spec.ts`. Quản trò bật 2 đội, hai người chơi mỗi người một đội. Người A đổi phiếu một lần. Công bố hiện đúng chip đội. Màn kết thúc có bảng đội.

## 6. Tóm tắt thay đổi file

| File | Thay đổi |
|---|---|
| `backend/app/game/teams.py` | Mới |
| `backend/app/game/models.py`, `constants.py` | `Team`, `Player.team`, `RoundState.team_results`, hằng số đội |
| `backend/app/game/room.py` | Lệnh đội, luật bỏ phiếu, tính điểm đội |
| `backend/app/game/views.py` | Trường đội trong snapshot |
| `backend/app/sockets.py` | 5 sự kiện mới |
| `frontend/src/lib/protocol.ts` | Kiểu mới, `EMPTY_TEAM` và thông báo lỗi tiếng Việt "Còn đội chưa có người" |
| `frontend/src/index.css` | `--color-pop-violet` |
| `frontend/src/components/` | `teams.ts`, `TeamChip`, `TeamBoard` mới; sửa `AnswerTile`, `Podium` |
| `frontend/src/pages/host/` | `HostTeams.tsx` mới; sửa `HostLobby`, `HostQuestion`, `HostFinished` |
| `frontend/src/pages/play/` | `TeamPicker.tsx` mới; sửa `PlayerLobby`, `PlayerRound`, `PlayerFinished`; sửa `PlayScreen` |
| `frontend/e2e/teams.spec.ts` | Mới |
