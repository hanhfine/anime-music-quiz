# Spike results: YouTube IFrame API

Date: 2026-10-16 · Testers: the project owner (manual, desktop browser) and Claude (automated, Playwright 1.64.1)

| Check | Manual | Automated: Chromium (headless + headed) | Automated: WebKit 27.2 (headed) | Notes |
|---|---|---|---|---|
| 1. PLAYING during ads; `currentTime ≥ start−1` only fires on real content | ✅ | not tested (no ad was served) | not tested | |
| 2. `endSeconds` stops at the mark | ✅ | not tested | not tested | |
| 3. CSS resize/reposition does not reload | ❌ reported as "reloads" | ✅ CSS and transform | ✅ CSS | See below. |
| 4. Sound after 1 click; later loads need no click | ✅ | not tested | not tested | Both the first and the second Load played with sound. |

## Check 3

The manual run reported a reload after **Toggle**. The automated runs could not reproduce it. Each run did the following:
1. Click **Load** (`8OkpRK2_gVs`, 60 → 80 s) and wait for `audio_started`.
2. Toggle small ↔ large 4 times, 2.5 s apart.
3. Sample the player state and `currentTime` every 100 ms.

In every run (Chromium headless and headed, WebKit headed; CSS toggle and the new transform toggle):
- the state stayed `PLAYING` from `audio_started` to the end;
- `currentTime` rose without a jump (e.g. 60.17 → 72.67 over 12.6 s);
- no `UNSTARTED` or `BUFFERING` line appeared after the first `PLAYING`.

Likely cause of the manual result: the `UNSTARTED`/`BUFFERING` lines that `loadVideoById` writes just before playback starts are easy to read as caused by the toggle.

The page now has a second button, **Toggle small/large (transform)**. It keeps the iframe's layout size fixed at 853×480 and only scales and moves it with `transform`. Each toggle line also logs `currentTime` and the iframe size. If a real browser ever does restart on resize, Task 23 can switch `STAGE_CLASSES` to this technique.

Conclusion: assumptions hold. Task 23 keeps the CSS resize. The real-Discord check in Task 27 Step 6 confirms that the music keeps playing when the stage grows at REVEAL.
