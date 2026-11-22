# Airtime for Mac

A native macOS app with the same features as the web app: SwiftUI, with AVFoundation for playback. It also fixes two problems the browser can't:

- **It remembers where each video is.** Opening a saved session opens its video directly. A bookmark follows the file when it's moved or renamed. If the bookmark can't find it, Airtime searches your video folders by content, so a renamed copy is found too. It only asks you to locate the file when it can't find it anywhere.
- **Sessions are files on your Mac.** They're stored as JSON in `~/Library/Application Support/Airtime`, so no browser can clear them and Time Machine backs them up. Unsaved work is written to a draft as you go and comes back after quitting or a crash.

Sessions use the web app's schema and fingerprints, so either app imports the other's exports. To move your sessions over, use **Export all** in the web app, then **Import backup** here.

## Run

```sh
macos/scripts/bundle.sh            # builds macos/build/Airtime.app
macos/scripts/bundle.sh --install  # and copies it to /Applications
open macos/build/Airtime.app
```

The app needs macOS 15 and Xcode (or the Swift 6 toolchain). `swift run Airtime [video]` also works for quick checks.

## Scrubbing and stepping

Each paused frame comes from an exact seek (zero tolerance either side) to the middle of a frame in the file's own frame table. That table is `VideoTiming`, a port of `frameRate.ts`, so variable frame rate, slow-motion pre-rolls and trims behave exactly as on the web. Steps never queue up: while a seek is decoding, a new request only replaces the next target.

Some moves use something faster than an exact seek:

- **Stepping back** uses AVFoundation's own frame stepping, which keeps recently decoded frames. On long-GOP footage this takes about 1.4 ms, where decoding from the previous keyframe takes 60–90 ms.
- **Timeline drags and jumps** show a cached preview of the target frame while the exact seek catches up. The cache holds every frame as a small JPEG, built in the background in one AVAssetReader pass. Each preview decodes in under 1 ms.

Measured with `frame-check --bench`:

| File                | Step forward | Step back | Drag preview | Preview cache                |
| ------------------- | ------------ | --------- | ------------ | ---------------------------- |
| 1080p HEVC, 240 fps | 3.9 ms       | 1.4 ms    | 0.4 ms       | 1,200 frames in 3.1 s, 28 MB |
| 4K HEVC, 60 fps     | 7.0 ms       | 1.5 ms    | 0.6 ms       | 300 frames in 1.8 s, 7 MB    |

The first backward step after moving forward is slower (about 70–130 ms), because AVFoundation has to build up its cache of recent frames.

## Checks

```sh
cd macos
swift test                         # the port against the web app's own output
swift run -c release frame-check   # decoded-frame oracle
swift run -c release frame-check --bench clip.mov
```

- **`swift test`** checks the Swift port against `Tests/AirtimeKitTests/golden.json`. `scripts/golden.ts` writes that file by running the web app's TypeScript on the shared fixtures. It covers:
  - frame tables and fingerprints for every fixture video
  - 160 generated mark sequences on constant and variable timings, for every jump type
  - an export file and the trends built from it

  After changing frame, mark or export logic in `src/lib`, run `bun macos/scripts/golden.ts` from the repo root and commit the result; `git diff --exit-code macos/Tests/AirtimeKitTests/golden.json` should then be clean.

- **`frame-check`** is the native counterpart of `tests/frame-stepping`. It drives the player through every barcode fixture: walking every frame forward and back, held-key bursts, random jumps, a drag, pause-then-step, and reopening a file. After each move it reads back the picture AVFoundation decoded and compares its barcode with ffmpeg's. It also checks the playhead sits inside the right frame, that nothing older flashes back, and that every cached scrub preview is the frame it's filed under.

### Looking at the UI without taking focus

`AIRTIME_SCRIPT=steps.txt` makes the app run a script of steps and render its own window to PNG files. It draws the exact decoded frame where the video layer is. This needs no screen recording permission, and the app never comes to the front. `AIRTIME_DATA_DIR` keeps test sessions away from your real ones.

```text
size 1280x760
import ../src/lib/session/fixtures/export-v3.json
open /tmp/airtime-test/clip60.mp4
key ....................m............m
snap /tmp/airtime-shots/player.png
key a
snap /tmp/airtime-shots/results.png
quit
```

```sh
AIRTIME_SCRIPT=steps.txt AIRTIME_DATA_DIR=/tmp/airtime-data macos/build/Airtime.app/Contents/MacOS/Airtime
```

`Sources/Airtime/DebugScript.swift` lists every step.

## Layout

```text
Sources/AirtimeKit/     frame math, marks, guide, sessions, export/import, trends, store (no UI)
Sources/AirtimePlayer/  VideoPlayer (AVFoundation) and the scrub preview cache
Sources/Airtime/        the SwiftUI app
Sources/frame-check/    decoded-frame oracle and benchmark
Tests/AirtimeKitTests/  golden comparisons with the web app, store round trips
scripts/                bundle.sh, make-icon.swift, golden.ts
```
