# Thiết kế: Giao diện Pop-Art / Arcade

- **Ngày:** 2026-10-17
- **Trạng thái:** Đã duyệt thiết kế, chờ review spec
- **Liên quan:** spec gốc [2026-10-16-anime-music-quiz-design.md](2026-10-16-anime-music-quiz-design.md), mục 5.2 và 5.3. Spec này chỉ thay phần trình bày. Luồng chơi, nội dung chữ và hành vi giữ nguyên.

## 1. Mục tiêu và phạm vi

Đổi giao diện toàn bộ frontend sang phong cách **Anime Pop-Art / Japanese Arcade**, lấy cảm hứng từ Persona 5 và Muse Dash:
- tương phản cao, bảng màu đen, trắng, đỏ tươi, vàng chanh;
- nền chấm bi (halftone);
- chữ đậm, nghiêng;
- khung và nút cắt vát chéo, có bóng cứng;
- ô đáp án phóng to và đổi màu khi rê chuột hoặc chạm;
- đĩa CD quay ở giữa màn câu hỏi, có nốt nhạc bay ra và tia chớp.

**Mức hiệu ứng theo trang:**

| Trang | Nền | Hoạt ảnh |
|---|---|---|
| Màn quản trò `/host/:code`, màn người chơi `/play/:code` (kể cả form nhập tên) | `halftone-strong` | Đầy đủ: đĩa quay, nốt nhạc, tia chớp, chữ "đập" vào màn hình |
| Trang chủ, danh sách bộ, 404 | `halftone` | Không có, chỉ hiệu ứng hover của nút |
| Trang soạn bộ `/sets/:id` | `halftone` | Không có. Danh sách bài dùng khung chữ nhật thường để dễ đọc |

**Giữ nguyên:**
- backend, giao thức Socket.IO, luật chơi;
- toàn bộ nội dung chữ trong HTML;
- `role`, `aria-label`, `data-testid`, `data-state`, `data-layout` mà test đang dùng;
- cơ chế khung YouTube nằm cố định trong DOM.

**Ngoài phạm vi:**
- âm thanh hiệu ứng;
- nút chuyển giao diện sáng hoặc tối;
- pháo giấy;
- đổi bố cục trang soạn bộ.

## 2. Nền tảng

Cách làm: khai báo token trong `@theme` của Tailwind v4, viết vài utility riêng bằng `@utility` trong `frontend/src/index.css`, và thêm vài component dùng chung. Code vẫn viết bằng class Tailwind như hiện tại.

### 2.1 Màu

```css
@theme {
  --color-pop-ink: #0b0b0b;
  --color-pop-paper: #fbfbf4;
  --color-pop-red: #e8112d;
  --color-pop-lime: #e4ff1a;
}
```

- Thay mọi class `slate-*` bằng `neutral-*` hoặc token `pop-*`:
  - chữ phụ: `text-neutral-400`;
  - nền phụ: `bg-neutral-900`, `bg-neutral-800`.
- Bỏ các màu `sky`, `emerald`, `amber`, `blue`, `green` khỏi UI; nút và thông báo dùng các biến thể ở mục 3.
- Chữ trắng ngà trên nền đỏ có độ tương phản khoảng 4.4:1. Vì vậy chữ trên nền đỏ phải từ 18.66px đậm trở lên, tức là chỉ dùng cho ô đáp án, nút và băng thông báo. Không đặt chữ nhỏ trên nền đỏ.

### 2.2 Font

- Thêm dependency `@fontsource/barlow-condensed` (bản 5.x). Import trong `frontend/src/main.tsx`:
  - `500.css`
  - `600.css`
  - `800-italic.css`
  - `900-italic.css`
- File CSS của Fontsource đã chia theo `unicode-range`, gồm latin, latin-ext và vietnamese. Trình duyệt chỉ tải phần cần dùng, và Vite đóng gói font vào bản build. Không gọi `fonts.googleapis.com`.
- `@theme { --font-sans: 'Barlow Condensed', system-ui, sans-serif; }`: toàn app dùng một họ font.
- Chỉ dùng các độ đậm đã tải:
  - chữ đứng: `font-medium` (500) và `font-semibold` (600);
  - tiêu đề, ô đáp án, nút: `italic font-extrabold` (800) hoặc `italic font-black` (900).
  - Không dùng `font-bold` (700).
- `body` có cỡ chữ mặc định `text-lg` (18px), vì font hẹp trông nhỏ hơn font hệ thống.
- Mọi chỗ đang dùng `font-mono` (mã phòng, điểm, độ trễ) đổi sang `tabular-nums`.
- Chữ in hoa chỉ làm bằng CSS `uppercase`. Nội dung trong HTML giữ nguyên chữ thường, để test tìm theo chữ không phải sửa và trình đọc màn hình đọc tự nhiên.

### 2.3 Utility riêng (`@utility`)

| Utility | Định nghĩa |
|---|---|
| `clip-slant` | `clip-path: polygon(var(--slant, 14px) 0, 100% 0, calc(100% - var(--slant, 14px)) 100%, 0 100%)`. Đổi độ vát bằng `[--slant:8px]` |
| `drop-hard` | `filter: drop-shadow(5px 5px 0 var(--hard-color, var(--color-pop-ink)))`. Đặt trên **phần tử bọc ngoài** phần tử có `clip-slant`, vì `clip-path` cắt mất bóng của chính phần tử đó |
| `hard-*` | utility dạng hàm: `--hard-color: --value(--color-*)`. Ví dụ `hard-pop-red`, `hard-pop-paper`, `hard-pop-lime` |
| `halftone` | nền `pop-ink`, chấm `radial-gradient(rgb(255 255 255 / 0.08) 1.2px, transparent 1.4px)`, `background-size: 10px 10px`, `background-attachment: fixed` |
| `halftone-strong` | nền `pop-ink`, gồm 2 lớp: dải đỏ chéo `linear-gradient(115deg, transparent 0 64%, rgb(232 17 45 / 0.85) 64% 71%, transparent 71%)` và chấm `radial-gradient(rgb(255 255 255 / 0.15) 1.4px, transparent 1.6px)`; `background-size: 100% 100%, 9px 9px`; `background-attachment: fixed` |

- `body` mặc định có `halftone`.
- Màn quản trò và màn người chơi bọc trang trong một `div` rộng toàn màn hình có `halftone-strong min-h-dvh`.
- `background-attachment: fixed` làm hai phần tử cùng dùng `halftone-strong` có chấm và dải đỏ trùng khít nhau. Mục 4.4 dựa vào điều này.
- **Viền đi theo cạnh vát:** dùng 2 lớp `clip-slant` lồng nhau, không dùng `border` hay `ring` vì chúng không chạy theo đường cắt.
  - Lớp ngoài có màu viền và `p-[3px]` (hoặc `p-[2px]`).
  - Lớp trong là mặt chính.

### 2.4 Chuyển động

```css
@theme {
  --animate-disc-spin: disc-spin 2.4s linear infinite;
  --animate-note-fly: note-fly 2.2s ease-out infinite;
  --animate-bolt-flash: bolt-flash 1.6s steps(1) infinite;
  --animate-slam: slam 0.35s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
```

| Keyframes | Diễn biến |
|---|---|
| `disc-spin` | xoay 0 → 360° |
| `note-fly` | từ tâm (`translate(-50%, -50%) scale(0.4)`, mờ) bay tới `translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))) scale(1.3) rotate(var(--rot))` rồi mờ dần; rõ nhất ở mốc 15% |
| `bolt-flash` | ẩn; hiện ở 8–14%; nháy mờ còn 0.2 ở 10% |
| `slam` | từ `scale(1.4) rotate(-4deg)` và mờ hẳn về `scale(1) rotate(0)` và hiện rõ |

- **Hover** (chuột) và **active** (chạm) trên phần tử bấm được:
  - Phóng `scale-[1.07]`, xoay `-rotate-[1.5deg]`, thời gian `duration-150`.
  - Mặt chuyển sang màu cặp:

    | Màu gốc | Màu cặp |
    |---|---|
    | đỏ | vàng chanh |
    | vàng chanh | đỏ |
    | trắng ngà | đen |
    | đen | trắng ngà |

  - Biến thể `hover:` của Tailwind v4 chỉ chạy trên thiết bị có chuột, nên điện thoại dùng `active:`.
  - Nút bị khóa không có hiệu ứng: dùng `enabled:` và `group-enabled:`.
- **Giảm chuyển động:** mọi animation, phóng to, xoay và hiệu ứng khung video bung ra đều đặt sau `motion-safe:`.
  - Nốt nhạc và tia chớp có thêm `motion-reduce:hidden`.
  - Đổi màu khi hover hoặc chạm vẫn giữ, vì đó là phản hồi chứ không phải chuyển động.
- Thêm `-webkit-tap-highlight-color: transparent` cho `body`.

## 3. Component dùng chung

### 3.1 `tiles.ts` và `AnswerTile`

`TILES` giữ `letter` và `symbol`. Bỏ `color`, thay bằng các chuỗi class **viết đầy đủ**, để Tailwind quét thấy:

| Ô | Mặt (`face`) | Màu cặp (`swap`) | Bóng (`hard`) | Bóng khi đổi màu (`hardSwap`) | Lớp viền |
|---|---|---|---|---|---|
| A ▲ | `bg-pop-red text-pop-paper` | `bg-pop-lime text-pop-ink` | `hard-pop-paper` | `hard-pop-paper` | trong suốt |
| B ◆ | `bg-pop-lime text-pop-ink` | `bg-pop-red text-pop-paper` | `hard-pop-red` | `hard-pop-lime` | trong suốt |
| C ● | `bg-pop-paper text-pop-ink` | `bg-pop-ink text-pop-paper` | `hard-pop-red` | `hard-pop-red` | `bg-pop-paper` |
| D ■ | `bg-pop-ink text-pop-paper` | `bg-pop-paper text-pop-ink` | `hard-pop-red` | `hard-pop-red` | `bg-pop-paper` |

**Quy tắc viền:** mặt đen luôn có viền trắng ngà 3px, nếu không ô sẽ chìm vào nền đen. Mặt đen xuất hiện ở D lúc bình thường và ở C khi đổi màu.

Mỗi ô có 2 lớp `clip-slant` như mục 2.3: lớp viền với `p-[3px]`, bên trong là lớp mặt.
- C và D có lớp viền màu trắng ngà cố định:
  - khi mặt trắng ngà, viền trùng màu mặt nên không thấy;
  - khi mặt đen, viền hiện ra.
- A và B có lớp viền trong suốt.

Mỗi ô có thêm chuỗi class cho hover, active và chosen, ví dụ `group-enabled:group-hover:bg-pop-lime` và `enabled:hover:hard-pop-lime`. Chuỗi phải viết nguyên văn trong `tiles.ts`, không được ghép chuỗi lúc chạy.

**`AnswerTile`:**
- Props hiện có giữ nguyên: `index`, `label`, `state`, `count`, `disabled`, `onSelect`. Thêm `layout?: 'row' | 'stack'`, mặc định `'row'`.
  - `row`: chữ cái, ký hiệu, tên và số người chọn nằm cùng một hàng. Dùng ở màn quản trò.
  - `stack`: chữ cái to ở trên; ký hiệu và tên ở dưới. Dùng cho lưới 2×2 trên điện thoại.
- Cấu trúc:
  - Phần tử ngoài là `div` (không bấm được) hoặc `button` (bấm được). Phần tử này mang `group drop-hard` và màu bóng, cùng `data-state` và `aria-label` như hiện tại.
  - Bên trong là mặt `clip-slant`.
- **Chữ cái hiện lên mặt ô** (hiện tại chỉ có trong `aria-label`), cỡ khoảng 1.8 lần chữ tên, `italic font-black`. Chữ cái và ký hiệu có `aria-hidden`.
- **Hover và active chỉ áp dụng khi ô là `button` và đang bật.** Ô `div` trên màn quản trò không phản ứng với chuột. Lý do: chuột của quản trò dừng trên ô nào thì cả stream thấy ô đó sáng lên, trông như gợi ý đáp án.
- Hiển thị theo trạng thái:

  | `state` | Hiển thị |
  |---|---|
  | `idle` | mặt gốc, bóng `hard` |
  | `chosen` | mặt màu cặp, bóng `hardSwap`, `scale-[1.04] -rotate-[1.5deg]` |
  | `correct` | mặt gốc, `scale-[1.05]`, tem "✓ ĐÚNG" (nền trắng ngà, chữ đỏ, xoay 8°) ở góc phải trên |
  | `wrong` | như `dimmed`, thêm tem "✕" (nền đỏ, chữ trắng ngà) ở góc phải trên |
  | `dimmed` | lớp viền (bao cả lớp mặt) có `opacity-30 grayscale` |

- `opacity-30 grayscale` đặt trên lớp viền, không đặt trên phần tử ngoài, vì hai lý do:
  - `drop-hard` tự ghi thuộc tính `filter`, nên sẽ đè lên filter của Tailwind nếu cùng nằm trên một phần tử.
  - Bóng được tính từ độ trong suốt của nội dung, nên khi lớp viền mờ thì bóng cũng mờ theo.
- Tem nằm trên phần tử ngoài để không bị `clip-slant` cắt. Tem có `aria-hidden` và không có `data-state`.
- Vì nằm ngoài lớp viền nên tem không bị mờ hay chuyển xám. Tem "✕" vẫn rõ màu đỏ khi ô bị mờ.
- Số người chọn hiện bằng chip đen nghiêng, chữ số vàng chanh `tabular-nums`.

### 3.2 `CdDisc` (thay `CountdownRing`, xóa file `CountdownRing.tsx`)

- Props:
  - `remainingMs?: number`
  - `totalMs?: number`
  - `size: 'lg' | 'sm'`
  - `spin?: boolean`, mặc định `true`. Khi `false`, đĩa đứng yên; dùng ở trang chủ.
  - `className?: string` (phần tử cha dùng để đặt kích thước cho cỡ `lg`)
- Cỡ `sm` cố định 64×64px.
- Gốc component là `relative aspect-square @container`. Các lớp từ dưới lên:
  1. **Đĩa:** hình tròn `inset-[9%]`, `motion-safe:animate-disc-spin`. Nền ghép từ các lớp sau (lớp đầu nằm trên cùng):
     - nhãn giữa: `radial-gradient` trắng 0–6%, đen 6–8%, đỏ 8–30%, đen 30–32%;
     - vệt sáng: `conic-gradient` trắng 35% và vàng chanh 35%;
     - rãnh đĩa: `repeating-radial-gradient(#1b1b1b 0 2px, #0b0b0b 2px 4px)`.

     Viền: `box-shadow: 0 0 0 3px var(--color-pop-paper), 6px 6px 0 3px var(--color-pop-red)`.
  2. **Vòng đếm ngược:** SVG `viewBox 0 0 100 100`, xoay −90°, `r=46`, `stroke-width=6`.
     - Nền vòng màu `neutral-800`.
     - Phần còn lại màu `pop-lime`, chuyển `pop-red` khi số giây ≤ 5.
     - `stroke-dashoffset` tính như `CountdownRing` hiện tại.
  3. **Số giây** ở giữa: `italic font-black`, cỡ `text-[22cqw]` (cỡ `sm` dùng `text-xl`), bóng chữ đen.
  4. **Chỉ có ở cỡ `lg`:**
     - 5 nốt nhạc ♪ ♫ ♬ ♩ ♪, mỗi nốt có sẵn bộ `--dx`, `--dy`, `--rot` và độ trễ animation riêng, màu xen kẽ vàng chanh, trắng ngà, đỏ;
     - 2 tia chớp SVG (đa giác `24,0 6,34 18,34 10,60 34,22 22,22 30,0`), một vàng chanh, một trắng ngà, viền đen 3px, đặt ở góc trái trên và góc phải dưới.
     - Cả hai đều `pointer-events-none motion-reduce:hidden`.
- **Khi có `remainingMs`:** gốc mang `role="timer"` và `aria-label="Còn N giây"`, với `N = Math.ceil(remainingMs / 1000)`, giống `CountdownRing` hiện tại.
- **Khi không có `remainingMs`:** không có số, không có vòng tiến độ (chỉ còn nền vòng), không có `role`, và gốc có `aria-hidden`.

### 3.3 `PopButton`, `PopLink`, `popButtonClasses`

File `components/PopButton.tsx`.

- `popButtonClasses(variant, size)` trả về `{ outer, inner }`. `PopButton` (`<button>`, mặc định `type="button"`) và `PopLink` (bọc `Link` của react-router) đều dùng hàm này. Nhãn "Nhập file JSON" ở trang danh sách bộ cũng dùng nó để trông giống nút.
- Biến thể:

  | `variant` | Mặt | Hover/active | Bóng |
  |---|---|---|---|
  | `primary` | vàng chanh, chữ đen | đỏ, chữ trắng ngà | đỏ |
  | `secondary` | đen, chữ trắng ngà, viền trắng ngà 2px theo cạnh vát | trắng ngà, chữ đen | đỏ |
  | `danger` | đỏ, chữ trắng ngà | trắng ngà, chữ đỏ | trắng ngà |

- Cỡ:

  | `size` | Class | `--slant` |
  |---|---|---|
  | `sm` | `px-3 py-1 text-base` | 8px |
  | `md` | `px-5 py-2 text-xl` | 12px |
  | `lg` | `px-8 py-3 text-3xl` | 14px |

- Chữ trên nút luôn `italic font-black uppercase`.
- Khi bị khóa: `opacity-40 cursor-not-allowed`, không phóng to, không đổi màu.
- Tên truy cập của nút là nội dung chữ như hiện tại, ví dụ "Tạo phòng", "Câu tiếp →".

### 3.4 `PopPanel`, `PopChip`

File `components/PopPanel.tsx`.

**`PopChip`:**
- Props: `{ as?: 'h1' | 'h2' | 'p' | 'span'; tone?: 'paper' | 'red' | 'lime'; children }`.
- Hình dạng: `inline-block -skew-x-12 -rotate-2 px-3 py-1 italic font-black uppercase leading-none`.
- Theo `tone`:

  | `tone` | Nền | Chữ | Bóng |
  |---|---|---|---|
  | `paper` (mặc định) | trắng ngà | đen | `shadow-[5px_5px_0_var(--color-pop-red)]` |
  | `red` | đỏ | trắng ngà | đen |
  | `lime` | vàng chanh | đen | đỏ |

- Chip là hình bình hành nhờ `skew`, không dùng `clip-path`, nên dùng `box-shadow` trực tiếp được.

**`PopPanel`:**
- Props: `{ title?: string; titleAs?: 'h1' | 'h2'; className?: string; children }`. `titleAs` mặc định là `'h2'`.
- Hiển thị `<section>` gồm:
  - lớp bọc `drop-hard hard-pop-red`;
  - lớp viền trắng ngà `clip-slant [--slant:18px] p-[3px]`;
  - lớp trong `bg-neutral-950 clip-slant [--slant:18px] p-6`.
- `title` hiện bằng `PopChip`. Chip cách mép trái ít nhất 20px để góc vát không cắt vào. Chữ của tiêu đề giữ nguyên như tiêu đề hiện tại, ví dụ "Người chơi", "Quản trò", "Tạo phòng".

### 3.5 `Callout`

File `components/Callout.tsx`.

- Props: `{ tone: 'error' | 'warn'; role?: 'alert' | 'status'; children }`. `role` mặc định là `'alert'`.
- Theo `tone`:
  - `error`: nền đỏ, chữ trắng ngà;
  - `warn`: nền vàng chanh, chữ đen.
- Dạng: `font-semibold clip-slant [--slant:8px] px-4 py-2`.
- Thay mọi khối `bg-red-500/15 …` và `bg-amber-500/15 …` hiện có (khoảng 12 chỗ).
- Các dòng chú thích chữ màu như `text-amber-300` hay `text-amber-200` (cảnh báo chặn tạo phòng, ghi chú bài bị bỏ qua, "Không tra được tên") đổi sang `text-pop-lime`.

### 3.6 `Leaderboard`, `Podium`, `DelayBadge`

**`Leaderboard`:**
- Mỗi hàng là `clip-slant [--slant:10px] bg-neutral-900`.
- Hàng của chính người chơi (`data-me=true`) có nền `pop-red`.
- Hạng: `w-10 text-right text-2xl italic font-black`; hạng 1 màu `pop-lime`.
- Điểm vừa cộng là chip vàng chanh "+870".
- Tổng điểm dùng `tabular-nums`.

**`Podium`:**
- Ba khối `clip-slant`:

  | Hạng | Màu khối | Chiều cao |
  |---|---|---|
  | 1 | vàng chanh | `h-40` |
  | 2 | trắng ngà | `h-28` |
  | 3 | đỏ | `h-20` |

- Số hạng in to, `italic font-black`, nằm trong khối: chữ đen trên khối vàng chanh và trắng ngà, chữ trắng ngà trên khối đỏ.
- Phía trên mỗi khối là tên và điểm.
- **Bỏ emoji huy chương.**

**`DelayBadge`:**
- Chip nghiêng `-skew-x-12`, chữ `tabular-nums`, nội dung giữ nguyên.
- Đã đo: nền vàng chanh, chữ đen. Chưa đo: nền `neutral-700`, chữ trắng ngà.

## 4. Màn quản trò

### 4.1 Khung chung (`HostScreen`)

- Cả trang bọc trong `halftone-strong min-h-dvh`.
- **Thanh trên cùng:**
  - chip "Phòng K7M2QX" (`PopChip`, `tabular-nums`);
  - thanh âm lượng `accent-pop-lime`;
  - "Đóng phòng" là `PopButton secondary sm`.
- **Thông báo** (`notice`): băng đỏ `-skew-x-12`, chữ trắng ngà `italic font-black text-2xl`, bóng đen, đặt `fixed top-16` ở giữa, `z-30`.

### 4.2 LOBBY

- Bên trái là `PopPanel` gồm:
  - `PopChip` "Mã phòng";
  - mã phòng `text-8xl italic font-black tracking-[0.15em] tabular-nums`, giữ `data-testid="room-code"`;
  - mã QR trong khung trắng `p-4`, giữ `title`;
  - link màu `pop-lime`.
- Bên phải:
  - tiêu đề `PopChip` "Người chơi (3/12)";
  - mỗi người chơi là dải `clip-slant` gồm 2 lớp, viền trắng ngà 2px:
    - người offline `opacity-40`;
    - nút ✕ chuyển đỏ khi rê chuột, giữ `aria-label`.
  - dòng thiết lập phòng;
  - "Đo độ trễ" (`PopButton secondary lg`) và "Bắt đầu" (`PopButton primary lg`);
  - dòng giải thích.

### 4.3 CALIBRATING

- `PopChip` "Đo độ trễ · Lượt 1/3".
- Đếm 3, 2, 1:
  - chữ `text-[12rem] italic font-black`, bóng đỏ `[text-shadow:8px_8px_0_var(--color-pop-red)]`;
  - mỗi số render với `key={step}` và `motion-safe:animate-slam`, để số nào cũng "đập" vào.
- **BẤM!**:
  - chữ vàng chanh, cỡ như trên;
  - nằm trên một hình nổ răng cưa 12 cánh màu đỏ (SVG `aria-hidden`);
  - cũng có `animate-slam`.
- Dòng "x/y người đã bấm" và dòng hướng dẫn giữ nguyên.

### 4.4 PREPARING, ANSWERING và khung YouTube

**Biến kích thước:** phần tử gốc của `HostQuestion` có class `[--disc:min(34vw,60vh)]`. Các phần tử `fixed` bên trong vẫn kế thừa biến này, vì biến CSS kế thừa theo cây DOM.

**Tiêu đề phải giữ role mà test đang tìm:**
- Chip "Câu 3/10" ở ANSWERING và REVEAL là `PopChip as="h1"`.
- Chip "7/12 đã trả lời" là `PopChip as="p"`.
- Dòng "Câu 3/10: chuẩn bị…" là một phần tử chữ duy nhất.

**Đĩa:**
- Lớp bọc `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 size-(--disc)`, bên trong là `CdDisc size="lg"`.
- Như vậy **tâm đĩa luôn trùng tâm màn hình** (viewport), không phụ thuộc chiều cao thanh trên cùng.

**PREPARING:**
- Đĩa không có số.
- Một `PopChip as="p"` cỡ `text-5xl` với nội dung "Câu 3/10: chuẩn bị…", đặt ở `fixed top-20` giữa màn hình. Không thêm chip "Câu 3/10" riêng.
- Dòng hướng dẫn và nút "Phát lại câu này" ở `fixed bottom-6`.

**ANSWERING:**
- Phía trên (`fixed top-20 inset-x-8`, `flex justify-between`):
  - bên trái là `PopChip as="h1"` "Câu 3/10";
  - bên phải là `PopChip as="p" tone="red"` "7/12 đã trả lời".
- **Lưới ô đáp án:**
  - `fixed inset-x-8 top-1/2 -translate-y-1/2 h-(--disc) grid grid-cols-[1fr_var(--disc)_1fr] grid-rows-2 gap-x-[3vw] gap-y-6`;
  - A ở cột 1 hàng 1, B ở cột 3 hàng 1, C ở cột 1 hàng 2, D ở cột 3 hàng 2;
  - cột giữa để trống cho đĩa;
  - ô dùng `layout="row"`, chữ tên `text-3xl`, tên dài được xuống dòng.
- Đĩa có số giây, `totalMs = clipSec * 1000 + GRACE_MS` như hiện tại.
- "Phát lại câu này": `PopButton secondary sm` ở `fixed bottom-6 left-6`.
- Bỏ `pb-56`.

**Khung YouTube (`STAGE_CLASSES` trong `HostScreen`):**

| Layout | Class |
|---|---|
| `hidden` | `invisible left-1/2 top-1/2 h-[180px] w-[320px] -translate-x-1/2 -translate-y-1/2` |
| `small` | `left-1/2 top-1/2 h-[180px] w-[320px] -translate-x-1/2 -translate-y-1/2` |
| `large` | `left-6 top-20 aspect-video w-[56vw] translate-x-0 translate-y-0 border-4 border-pop-paper shadow-[10px_10px_0_var(--color-pop-red)]` |

- Khung chung: `fixed z-10 overflow-hidden bg-pop-ink motion-safe:transition-all motion-safe:duration-700`. Bỏ `rounded-2xl` và `shadow-2xl`.
- Lúc PREPARING và ANSWERING, khung 320×180 nằm **ngay dưới đĩa** (đĩa ở `z-20`). Ở 1280×720, đĩa rộng khoảng 432px, đủ che hình chữ nhật 320×180 (đường chéo khoảng 367px).
- Lớp phủ (`data-testid="stage-cover"`):
  - vẫn đục và chặn click;
  - dùng `halftone-strong`, nên ở màn hình nhỏ, nếu góc khung lòi ra ngoài đĩa thì vẫn trùng nền và gần như không thấy;
  - **bỏ hình 💿**;
  - ở layout `large` vẫn có `opacity-0 pointer-events-none` như hiện tại.
- Sang REVEAL, khung chuyển từ giữa màn hình sang góc trái trên và phóng to: video "bung" ra từ chỗ đĩa.
- Khung vẫn là một phần tử cố định trong DOM, chỉ đổi class, nên iframe không bị tải lại.

### 4.5 REVEAL

- Giữ lưới `grid-cols-[58vw_1fr]`; cột trái để trống cho video.
- Cột phải, theo thứ tự:
  1. `PopChip as="h1"` "Câu 3/10";
  2. tên anime `text-5xl italic font-black text-pop-lime`, bóng đỏ `[text-shadow:4px_4px_0_var(--color-pop-red)]`, `motion-safe:animate-slam`;
  3. nhãn bài: `PopChip` cỡ nhỏ;
  4. 4 ô xếp dọc (`layout="row"`, có `count`): ô đúng ở trạng thái `correct`, các ô khác `dimmed`;
  5. `Leaderboard` top 10;
  6. "Câu tiếp →" hoặc "Xem kết quả" (`PopButton primary lg`) và "Phát lại câu này" (`PopButton secondary md`).

### 4.6 FINISHED

- `PopChip as="h1"` "Kết quả chung cuộc", cỡ `text-5xl`.
- `Podium` rồi `Leaderboard`.
- "Chơi lại" (`PopButton primary lg`) và "Đóng phòng" (`PopButton danger lg`).

## 5. Màn người chơi (điện thoại)

- `PlayScreen` bọc trang trong `halftone-strong min-h-dvh`. Bên trong là `main` rộng tối đa `max-w-lg`, `min-h-dvh flex flex-col gap-4 p-4`.
- **Thanh trên cùng:** tên người chơi `font-semibold` bên trái; chip điểm vàng chanh nghiêng "2.450 điểm" (`tabular-nums`) bên phải.
- **Quản trò mất kết nối:** `Callout tone="warn" role="status"`.
- **JoinForm:**
  - tiêu đề "Vào phòng K7M2QX": `PopChip as="h1"`, mã phòng `tabular-nums`;
  - `PopPanel` chứa ô nhập tên và `PopButton primary lg` "Vào phòng";
  - ô nhập là hình chữ nhật `bg-neutral-900 border-2 border-pop-paper text-2xl`.
- **Sảnh chờ:**
  - `PopChip` "Bạn là";
  - tên `text-5xl italic font-black text-pop-lime`, bóng đỏ;
  - dòng "Chờ quản trò bắt đầu…" kèm `CdDisc size="sm"` không có số;
  - số người trong phòng và `DelayBadge`.
- **Đo độ trễ:**
  - `PopChip` "Đo độ trễ · Lượt 1/3" và dòng hướng dẫn;
  - nút **BẤM**:
    - `min-h-[50dvh]`, mặt vàng chanh, `clip-slant`, bóng đỏ;
    - chữ `text-8xl italic font-black`;
    - khi chạm: `active:scale-95` và mặt chuyển đỏ;
  - bấm xong hiện "Đã bấm lượt 1": `text-4xl italic font-black text-pop-lime`.
- **Chuẩn bị:** một `PopChip as="p"` "Câu 3/10: chuẩn bị nghe…" (một phần tử chữ duy nhất, test tìm đúng chuỗi này), bên dưới là `CdDisc size="sm"` ở giữa.
- **Trả lời:**
  - Hàng trên: `PopChip as="h1"` "Câu 3/10" bên trái, `CdDisc size="sm"` có đếm ngược bên phải.
  - Lưới `grid flex-1 grid-cols-2 grid-rows-2 gap-3 min-h-[55dvh]`, ô `layout="stack"`.
  - Thứ tự ô là A, B, C, D, nên vị trí trùng với màn stream: A trên-trái, B trên-phải, C dưới-trái, D dưới-phải.
  - Chạm: ô nảy lên và đổi màu cặp (`active:`).
  - Đã chọn: ô chọn ở trạng thái `chosen`, 3 ô kia `dimmed`, kèm dòng "Đã chọn B, chờ kết quả" (`italic font-black text-pop-lime`).
- **Công bố:**
  - Băng kết quả `-skew-x-6 text-3xl italic font-black px-4 py-3`. Nội dung chữ giữ nguyên.

    | Kết quả | Nội dung | Kiểu |
    |---|---|---|
    | Đúng | "✅ Đúng! +870 · Hạng 4" | nền vàng chanh, chữ đen, có hình nổ răng cưa đỏ phía sau (`aria-hidden`) |
    | Sai | "❌ Sai, đáp án là …" | nền đỏ, chữ trắng ngà |
    | Hết giờ | "⌛ Hết giờ, đáp án là …" | nền trắng ngà, chữ đen |

  - Tiếp theo là nhãn bài, rồi lưới 2×2 (`layout="stack"`): ô đúng `correct`, ô đã chọn sai `wrong`, các ô còn lại `dimmed`.
- **Kết thúc:**
  - `PopChip as="h1"` "Kết thúc! 🏁";
  - "Hạng 3/12" `text-6xl italic font-black`, tổng điểm;
  - `Podium`, rồi `Leaderboard` với hàng của mình tô đỏ;
  - dòng chờ quản trò.

## 6. Các trang ngoài game

- **Trang chủ:**
  - Tiêu đề `h1` vẫn có nội dung "Đoán anime qua nhạc 🎵". Bên trong là hai `span`, mỗi span trông như một chip nghiêng: "Đoán anime" (trắng ngà) và "qua nhạc 🎵" (đỏ), lệch nhau.
  - Bên cạnh là `CdDisc size="sm" spin={false}`: đĩa đứng yên, không có số, vì trang ngoài game không có hoạt ảnh.
  - `PopPanel` "Người chơi": ô nhập mã phòng `text-3xl tracking-[0.3em] tabular-nums` trên nền `neutral-900`, viền trắng ngà; `PopButton primary lg` "Vào phòng".
  - `PopPanel` "Quản trò": dòng mô tả và `PopLink primary lg` "Tạo phòng".
  - Thông báo chuyển trang: `Callout tone="warn"`.
- **Danh sách bộ:**
  - `PopChip as="h1"` "Bộ câu hỏi" và link "← Trang chủ" (`text-pop-lime underline`).
  - "+ Bộ mới" (`PopButton primary md`).
  - "Nhập file JSON" là `label` dùng `popButtonClasses('secondary', 'md')`, giữ `focus-within` để người dùng bàn phím vẫn thấy viền khi chọn.
  - Mỗi bộ là dải `clip-slant` nền `neutral-900`, có "Xuất JSON" (`secondary sm`) và "Xóa" (`danger sm`, giữ `aria-label`).
- **Soạn bộ** (nhẹ nhất):
  - Ô tên bộ: `text-3xl italic font-black`, hình chữ nhật `bg-neutral-900 border-2 border-neutral-700`.
  - `CreateRoomPanel` và form "Link YouTube" nằm trong `PopPanel`. Nút "Thêm" và "Tạo phòng" là `PopButton primary md`.
  - "Gợi ý lại (N)" là `PopButton secondary sm`; "Chấp nhận tất cả gợi ý (N)" là `PopButton primary sm`.
  - **`SongRow`** là hình chữ nhật `bg-neutral-900 border-2 border-neutral-800`, không vát, không bóng.
    - Ô nhập: `bg-neutral-800 border border-neutral-700`.
    - Chip gợi ý tên: `-skew-x-6 bg-neutral-800`, hover `bg-pop-lime text-pop-ink`.
    - Nhãn "Gợi ý, chưa xác nhận": viền `pop-lime`, chữ `pop-lime`.
    - "Xác nhận" là `PopButton primary sm`; "Xóa" là `PopButton danger sm`; "Tìm" là `PopButton secondary sm`.
- **404:** `PopChip as="h1"` "Không tìm thấy trang" và link về trang chủ (`text-pop-lime underline`). Trang "Không tìm thấy bộ câu hỏi" trong trình soạn bộ làm tương tự.

## 7. Kiểm thử

**Unit test (Vitest):**
- Các test hiện có phải qua mà **không đổi cách tìm phần tử** (theo role, nhãn, chữ, `data-state`, `data-testid`, `data-layout`).
- Chỉ sửa các chỗ kiểm tra hình thức đã bị bỏ:
  - `components.test.tsx`:
    - test `Podium` đang tìm `🥇`; đổi sang kiểm tra số hạng trong bục;
    - test `CountdownRing` chuyển thành test `CdDisc`.
  - `hostPhases.test.tsx` và `playPhases.test.tsx`: mỗi file có 1 chỗ tìm `🥇`; đổi sang kiểm tra bục vinh quang theo số hạng.
- Test mới:
  - `CdDisc`:
    - có `remainingMs` thì có `role="timer"`, đúng tên "Còn N giây" và đúng số;
    - không có `remainingMs` thì không có `timer` và không có số;
    - cỡ `lg` có 5 nốt nhạc và 2 tia chớp; cỡ `sm` không có.
  - `AnswerTile`:
    - chữ cái hiện trên ô;
    - `button` có class hover, còn `div` thì không;
    - `correct` có tem "✓ ĐÚNG", `wrong` có tem "✕", các trạng thái khác không có tem;
    - `layout="stack"` đặt chữ cái lên trên.
  - `PopButton`: khi `disabled`, bấm không gọi `onClick`; tên truy cập là nội dung chữ.
  - `Callout`: `role` mặc định `alert`, đổi được sang `status`.
  - `HostScreen`: khung YouTube ở layout `small` có class đặt giữa màn hình (`left-1/2`, `top-1/2`).

**Lệnh kiểm tra:** `npm test && npx tsc -b && npm run lint`, rồi `npm run e2e`, rồi `npm run build` (để `backend/app/static` lại là bản thật).

**E2E (Playwright):** một ván đầy đủ phải qua mà không sửa test.

**Kiểm tra bằng mắt:**
- Chạy app với player giả (`VITE_FAKE_PLAYER=1`). Dùng một script Playwright tạm (không commit) chụp từng màn:
  - quản trò: LOBBY, CALIBRATING, PREPARING, ANSWERING, REVEAL, FINISHED, ở cỡ 1280×720 và 1920×1080;
  - người chơi: JoinForm, sảnh, đo độ trễ, trả lời, công bố, kết thúc, ở cỡ 390×844 và 360×640;
  - trang chủ, danh sách bộ, soạn bộ.
- Kiểm tra:
  - tên anime dài khoảng 60 ký tự vẫn nằm gọn trong ô;
  - đĩa che kín khung YouTube ở 1280×720;
  - chế độ `prefers-reduced-motion: reduce` (Playwright `reducedMotion: 'reduce'`) tắt đĩa quay, nốt nhạc và tia chớp;
  - bản build không có request tới `fonts.googleapis.com`.

## 8. Tóm tắt thay đổi file (`frontend/`)

| File | Thay đổi |
|---|---|
| `package.json` | thêm `@fontsource/barlow-condensed` |
| `src/main.tsx` | import 4 file CSS font |
| `src/index.css` | `@theme` (màu, font, animation), `@keyframes`, `@utility`, style cho `body` |
| `src/components/tiles.ts` | bảng màu A, chuỗi class mặt, màu cặp, bóng |
| `src/components/AnswerTile.tsx` | cấu trúc 2 lớp, chữ cái, tem, `layout` |
| `src/components/CdDisc.tsx` | **mới**, thay `CountdownRing.tsx` (**xóa**) |
| `src/components/PopButton.tsx` | **mới**: `PopButton`, `PopLink`, `popButtonClasses` |
| `src/components/PopPanel.tsx` | **mới**: `PopPanel`, `PopChip` |
| `src/components/Callout.tsx` | **mới** |
| `src/components/Leaderboard.tsx`, `Podium.tsx`, `DelayBadge.tsx` | đổi giao diện |
| `src/components/CreateRoomPanel.tsx`, `SongRow.tsx` | đổi giao diện |
| `src/pages/HostScreen.tsx` | nền, thanh trên cùng, thông báo, `STAGE_CLASSES`, lớp phủ |
| `src/pages/host/*.tsx` | đổi giao diện theo mục 4 |
| `src/pages/PlayScreen.tsx`, `src/pages/play/*.tsx` | đổi giao diện theo mục 5 |
| `src/pages/Home.tsx`, `SetList.tsx`, `SetEditor.tsx`, `src/App.tsx` | đổi giao diện theo mục 6 |
| Các file test liên quan | theo mục 7 |
