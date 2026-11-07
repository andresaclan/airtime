# Frame stepping is a merge requirement

Frame stepping must show the next or previous **decoded picture**, including videos
whose frames are not evenly spaced. A time readout changing by 1/fps is not proof.

## Architecture and invariants

- `frames.ts` owns frame/time conversion. Use the file's presentation-time table
  when available; seek inside each frame rather than at an ambiguous boundary.
- `seek.ts` owns the seek queue. Keep one decode in flight, accumulate repeated
  input against the latest target, and discard old listeners when a file changes.
  On browsers with frame callbacks, completion waits for both `seeked` and the
  matching picture. If that callback is absent for 500 ms after `seeked`, retry
  once inside the same frame. Another 500 ms without a matching picture releases
  the queue so an unsupported or truncated frame cannot trap later input. Browsers without that API use `seeked` alone.
- `mediaTime.ts` translates only at the native video boundary. Safari retains the
  gap before the first complete frame of a partial-frame edit; Chrome shifts it
  away. The parser preserves that gap, and presentation timestamps establish the
  native convention without user-agent sniffing. Persisted marks and frame indexes
  keep the same canonical meaning in both browsers.
- `presentedFrame.ts` owns the presented picture. `seeked` is not a presentation
  acknowledgement. A callback from an older seek must not rewind a newer target.
- Buttons and keyboard shortcuts share `VideoControls`; both `/` and `/alpha`
  must pass the browser contract. Marks must return to the picture they recorded.
- A preview canvas can make a pending seek feel immediate, but cannot make an
  incorrect native video frame pass the tests.

## What runs for every PR

The existing required check, `verify`, depends on static checks and the entire
browser matrix. It fails if a dependency fails, is cancelled, or is skipped. The
workflow has no changed-path filters or automatic retries. It also runs on main
and for merge queues. A PR can be opened with failing tests; branch protection
prevents it from being merged. No local hook can reliably prevent all PR creation.

| Runner          | Browser                            | Coverage                                         |
| --------------- | ---------------------------------- | ------------------------------------------------ |
| Linux and macOS | Chromium                           | Bundled browser and decoder behavior             |
| Linux and macOS | Google Chrome                      | Branded stable channel                           |
| macOS           | Playwright WebKit                  | WebKit with Apple's media frameworks             |
| macOS           | Playwright WebKit, iPhone profile  | Mobile viewport, touch taps, and shared controls |
| macOS           | Shipping Safari via `safaridriver` | Installed Safari and its media pipeline          |

The iPhone profile is **emulation, not an iOS Simulator or physical iPhone**.
Simulator testing still does not exercise a phone's hardware decoder. A physical
iOS gate requires a dedicated runner/device or an external device service; do not
report mobile WebKit results as a physical iPhone pass.

The Safari job intentionally runs on a dedicated CI machine: WebDriver opens
Safari windows. Do not run it on a user's working desktop during background checks.

## The decoded-frame oracle

`tests/frame-stepping/fixtures/` contains small H.264 videos with 16 black/white
stripes. Eight encode the source frame index; eight encode its inverse. The inverse
prevents a blank/black picture from accidentally passing as frame zero. ffmpeg
independently decodes each fixture to produce `manifest.json`; ffprobe supplies
presentation timestamps. The partial-edit fixture also records the independent
AVFoundation offset from its source frame rate, edit point and media timescale.
Every browser must still display the same frame IDs. The contract imports no
application timing functions.

Cases cover constant frame rate, NTSC timestamps, 240 fps at QuickTime's 600 Hz
time base, dropped frames, B-frame reordering, slow-motion pre-roll, and an edit
list trimming partway through a frame. Both pages walk **every** frame in both
directions using buttons and keyboard shortcuts. Tests also cover boundaries,
rapid input/reversal, holds and release, playback/pause, mark round trips, and
replacing a marked video, and stepping with the preview cache disabled. Native video pixels and any visible cache preview must
agree after settling. Browser logs/traces and failed screenshots are retained as
CI artifacts for 14 days. Safari retains a screenshot and error text on failure.

Unit tests separately exercise callback order, timestamp rounding, late frames
after pause, queued reversals, replacing a file, cleanup, and missing frame APIs.
The existing parser/math tests cover additional rates and container edge cases.
HEVC, arbitrary damaged files, and every hardware/OS/codec combination are not
proven by this H.264 corpus. Add an independently identified fixture when extending
supported media or fixing a regression; do not replace the pixel assertion with
an assertion about `currentTime` alone.

## Run locally

```sh
bun install --frozen-lockfile
bunx playwright install chromium webkit
bun run build
bun run test:frames --project=chromium
bun run test:frames --project=webkit --project=webkit-iphone
```

For focus-safe, real Chrome checks on the working Mac:

```sh
FRAME_BACKGROUND_CHROME=1 bun run test:frames --project=chrome
```

Use one test invocation at a time: runs share an artifact directory and preview
port. The runner starts and stops a production preview automatically. To point
at an existing server, set `FRAME_TEST_URL`; the runner then leaves it alone.
Local background Chrome uses the repository's `background-chrome.mjs` helper and
closes its own browser after each test.

On a dedicated Mac (Safari remote automation enabled):

```sh
sudo safaridriver --enable
# Start a built preview at localhost:4173 in a separate process first.
bun run test:frames:safari
```

To regenerate fixtures with Python 3, ffmpeg/libx264, and ffprobe installed:

```sh
python3 scripts/generate-frame-fixtures.py
bunx prettier --write tests/frame-stepping/fixtures/manifest.json
```

Commit the clips and manifest together. CI needs no ffmpeg installation. The
fixtures live outside `static/` and are never published with the application.
