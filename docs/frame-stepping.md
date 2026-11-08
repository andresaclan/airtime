# Frame stepping is a merge requirement

Frame stepping must show the next or previous **decoded picture**, including videos
whose frames are not evenly spaced. A time readout changing by 1/fps is not proof.

## Architecture and invariants

- `frames.ts` owns frame/time conversion. Use the file's presentation-time table
  when available; seek inside each frame rather than at an ambiguous boundary.
- `seek.ts` owns the seek queue. Keep one decode in flight, accumulate repeated
  input against the latest target, and discard old listeners when a file changes.
  On browsers with frame callbacks, completion waits for both `seeked` and the
  matching picture. A no-op seek may skip that wait only when the last presented
  picture matches; matching `currentTime` is insufficient after a late pause frame.
  If the playhead already names the target but a different picture is known, decode
  an adjacent frame and return, keeping the user's logical target stable. If that callback is absent for 500 ms after `seeked`, also decode
  a neighboring frame and return: native iOS may leave the previous picture visible
  after a backstep, even after a second seek inside the target frame. Each recovery
  leg waits at most 500 ms for presentation before returning or releasing the queue,
  so an unsupported or truncated frame cannot trap later input. Browsers without that API use `seeked` alone.
- `mediaTime.ts` translates only at the native video boundary. Safari retains the
  gap before the first complete frame of a partial-frame edit; Chrome shifts it
  away. The parser preserves that gap, and presentation timestamps establish the
  native convention without user-agent sniffing. Persisted marks and frame indexes
  keep the same canonical meaning in both browsers.
- `presentedFrame.ts` owns the presented picture. `seeked` is not a presentation
  acknowledgement. A callback from an older seek must not rewind a newer target.
- `keyboardKey` normalizes standard and legacy Safari arrow input. Focused timeline
  Shift-arrows bubble to the single-frame handler without also scrubbing.
- Buttons and keyboard shortcuts share `VideoControls`; the player at `/` and its legacy `/alpha` redirect
  must pass the browser contract. Marks must return to the picture they recorded.
- A preview canvas can make a pending seek feel immediate, but cannot make an
  incorrect native video frame pass the tests.

## What runs for every PR

The existing required check, `verify`, depends on static checks and the entire
browser matrix. It fails if a dependency fails, is cancelled, or is skipped. The
workflow has no changed-path filters or automatic retries. It also runs on main
and for merge queues. A PR can be opened with failing tests; branch protection
prevents it from being merged. No local hook can reliably prevent all PR creation.

| Runner          | Browser                                 | Coverage                                         |
| --------------- | --------------------------------------- | ------------------------------------------------ |
| Linux and macOS | Chromium                                | Bundled browser and decoder behavior             |
| Linux and macOS | Google Chrome                           | Branded stable channel                           |
| macOS           | Playwright WebKit                       | WebKit with Apple's media frameworks             |
| macOS           | Playwright WebKit, iPhone profile       | Mobile viewport, touch taps, and shared controls |
| macOS           | Shipping Safari via `safaridriver`      | Installed Safari and its media pipeline          |
| macOS           | iOS Simulator Safari via `safaridriver` | Native iOS Safari, selected by simulator UDID    |

The iPhone profile is **emulation, not an iOS Simulator or physical iPhone**.
A separate `safari-ios` job creates an isolated iPhone on the newest installed iOS
runtime and requires a native iOS Safari session. Missing runtimes or failed device
startup fail the gate; they never silently skip it. CI waits for the isolated device to finish booting before starting SafariDriver.
Simulator testing still does not exercise a phone's hardware decoder. A physical
iOS gate requires a dedicated runner/device or an external device service; do not
report mobile WebKit results as a physical iPhone pass.

Playwright cases use fresh browser processes; macOS Safari uses fresh WebDriver
sessions. Native iOS retains one owned session because repeated session creation
can race Safari's RWI application handoff. Each iOS case navigates through a blank
document to tear down its old player/decoder before loading the app again.
Replacing a file within one running app is also exercised explicitly.

The Safari job intentionally runs on a dedicated CI machine: WebDriver opens
Safari windows. Do not run it on a user's working desktop during background checks.

## The decoded-frame oracle

`tests/frame-stepping/fixtures/` contains small H.264 videos and a VP8 WebM fallback video with 16 black/white
stripes. Eight encode the source frame index; eight encode its inverse. The inverse
prevents a blank/black picture from accidentally passing as frame zero. ffmpeg
independently decodes each fixture to produce `manifest.json`; ffprobe supplies
presentation timestamps. The partial-edit fixture also records the independent
AVFoundation offset from its source frame rate, edit point and media timescale.
Every browser must still display the same frame IDs. The contract imports no
application timing functions.

Cases cover constant frame rate, NTSC timestamps over enough frames to cross the
600 Hz rounding boundary, WebM playback-rate detection, 240 fps at QuickTime's 600 Hz
time base, dropped frames, B-frame reordering, slow-motion pre-roll, and an edit
list trimming partway through a frame. Both entry links walk **every** frame in both
directions using buttons and keyboard shortcuts. Tests also cover boundaries,
rapid input/reversal, holds and release, playback/pause, mark round trips, and
replacing a marked video, and stepping with the preview cache disabled. Native video pixels and any visible cache preview must
agree after settling. Browser logs/traces and failed screenshots are retained as
CI artifacts for 14 days. Safari retains capabilities, frame events, a screenshot
and error text on failure. Each native Safari case has a hard watchdog (120 seconds
on macOS, 240 on iOS), including startup and cleanup. A wedged IPC channel kills
only that case's owned SafariDriver process and records its last stage. Driver
diagnostics are collected even when a job is cancelled. On a dedicated CI runner,
a stall also captures bounded Safari/WebKit process-stack samples before cleanup.

Safari fixtures are transferred as `File` bytes through the real input's change
handler: SafariDriver's path upload can expose filenames without readable sandboxed
bytes, and Mac fixture paths do not exist in the iOS simulator. Buttons use
WebDriver clicks on macOS. On iOS, buttons, keyboard shortcuts, and sustained
pointer holds use DOM activation/events, then verify the real native decoded
picture. This avoids [WebKit bug 322937](https://bugs.webkit.org/show_bug.cgi?id=322937),
where pointer actions can wedge the iOS remote automation connection. Autoplay is
allowed in the iOS automation session so synthetic controls can exercise playback.
Native iOS executes the shared contract functions in a browser-side batch.
Pixel sampling still requires three consecutive matching reads 25 ms apart, with
the same per-frame deadline. Slow WebDriver round trips cannot consume that
sampling budget. A local browser test runs the serialized batch and confirms it
rejects a wrong barcode. This tests the app's real control handlers and native iOS decoding, but does not
test the Photos picker, physical keyboard delivery, or OS touch gesture delivery.
The desktop jobs exercise native keyboard and pointer input; the mobile WebKit
profile uses actual emulated taps.

Startup readiness is polled without a canvas, so pixel readback cannot contend
with Safari's WebM playback probe. Every subsequent step still uses the strict pixel oracle.

For parsed files, the authoritative container timing avoids an unnecessary
playback probe. Files without readable timing retain the playback probe. It samples
at quarter speed from the start and restores the user’s speed after pausing, so
the probe never changes the native decoder’s rate during playback. Compositor throttling can
otherwise turn a 30 fps file into a false 10 fps estimate. A separate decoded-frame
case limits playback callbacks to 10 Hz to cover this regression. A
partial-frame edit actively samples a later picture to disambiguate zero, which
WebKit can report for a clipped partial frame.

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
# On an isolated, explicitly selected iPhone Simulator:
FRAME_SAFARI_PLATFORM=ios FRAME_IOS_SIMULATOR_UDID=<uuid> bun run test:frames:safari
```

To regenerate fixtures with Python 3, ffmpeg/libx264, and ffprobe installed:

```sh
python3 scripts/generate-frame-fixtures.py
bunx prettier --write tests/frame-stepping/fixtures/manifest.json
```

Commit the clips and manifest together. CI needs no ffmpeg installation. The
fixtures live outside `static/` and are never published with the application.
