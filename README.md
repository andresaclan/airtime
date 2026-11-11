# Airtime

**Measure jump height from video, frame by frame, in the browser.**

Airtime turns a clip of a jump into flight time, contact time and jump height. Open a local video, step to the frame the feet leave the ground and the frame they touch down, and Airtime does the math (h = g·t²/8), including for slow-motion footage.

> **Privacy first:** videos are loaded from your device into the browser using local object URLs. Airtime does not include an upload API or application backend.

## What it does

- Open a video from the file picker or drag and drop it into the app.
- Step one frame at a time, and slow playback to ½× or ¼× to find the moment quickly.
- Mark **takeoff** and **landing** frames; marks show on the timeline and can be nudged a frame at a time.
- Show each jump's flight time as it lands, and the session's results: flight time, contact time and RSI for every jump in the clip, with the best jump highlighted.
- Correct for slow-motion footage (2×, 4×, 8×) so times are real-world.
- Detect the source frame rate from MP4, M4V and MOV files, or measure it during playback for other formats. A video whose frame rate can't be read or measured can be watched but not marked.
- Save sessions to the browser, reopen them by opening the same video again, and export or import them as JSON.
- Correct when each video was recorded, so sessions sort in the right order.
- Zoom into the video up to 5x and pan around the frame.

## Quick start

### Use the hosted app

Open the deployed Airtime site in a modern desktop or mobile browser, then choose **Open video** or drag a video onto the player.

### Run locally

Requirements:

- [Bun](https://bun.sh/) 1.x
- A modern browser with HTML video support

```sh
git clone https://github.com/andresaclan/airtime.git
cd airtime
bun install
bun run dev -- --open
```

The development server starts at `http://localhost:5173`.

## Basic workflow

Airtime is built around an approach jump: three marks give contact time, flight time, jump height and RSI. The **Mark** button always names the step that belongs at the frame on screen (plant step, takeoff or landing), and a line under the video says which frame that is.

1. Open a local video with **Open video**, or drag it onto the app.
2. Play (press `R` to slow down) until you're near your last step before the jump, then pause.
3. **Plant step:** step with `,` and `.` to the first frame your plant foot touches the ground and press **Mark plant step** (`M`).
4. **Takeoff:** step forward to the first frame both feet are off the ground and press **Mark takeoff** (`M`).
5. **Landing:** step forward to the first frame your feet touch back down and press **Mark landing** (`M`). The jump's flight time appears, with **Review** to correct a mark and **Next jump** to carry on.
6. **Results** lists every jump in the session, with its contact time and RSI. Each jump needs its own plant step for those; only repeat hops share a touchdown.
7. Press `⌘S` / `Ctrl+S` to save. Open the same file later to pick up where you left off.

The arrow button beside **Mark** marks the other type instead (`T` for a takeoff, `L` for a touchdown or landing). Pressing **Mark** on a frame that's already marked opens that jump for review, with the mark selected: step to the frame it belongs on and press **Set here**, move it a frame at a time, or remove it. The mark stays selected while you step away from it. Pressing `M` there removes the mark instead. The line under the video retires itself after three measured jumps, or hide it sooner with **Got it**; bring it back from the keyboard shortcuts dialog (`?`).

## Keyboard shortcuts

Press `?` in the app to see these at any time.

| Shortcut                     | Action                               |
| ---------------------------- | ------------------------------------ |
| `Space` or `K`               | Play or pause                        |
| `,` / `.`                    | Step one frame backward / forward    |
| `Shift` + `←` / `→`          | Step one frame backward / forward    |
| `R`                          | Cycle playback speed 1× / ½× / ¼×    |
| `↑` / `↓`                    | Volume up / down                     |
| `Shift` + `M`                | Mute or unmute                       |
| `M`                          | Mark the step the Mark button names  |
| `T`                          | Mark a takeoff on this frame         |
| `L`                          | Mark a touchdown or landing          |
| `[` / `]`                    | Jump to previous / next mark         |
| `Backspace` / `Delete`       | Delete the mark at the playhead      |
| `⌘` / `Ctrl` + `Z`           | Undo a mark change                   |
| `⌘` / `Ctrl` + `Shift` + `Z` | Redo a mark change                   |
| `A`                          | Show or hide the session's results   |
| `⌘` / `Ctrl` + `S`           | Save the session to this browser     |
| `←` / `→`, `Home` / `End`    | Scrub the timeline when it has focus |

## Supported files and browser behavior

Airtime accepts common video extensions such as MP4, M4V, MOV, WebM, MKV, AVI, WMV, FLV, MPEG, 3GP, and OGV. Actual playback depends on the codecs supported by the browser and operating system.

Source frame-rate parsing is currently implemented for ISO Base Media File Format containers, including MP4, M4V, and MOV. Other formats can still play when supported by the browser, and their frame rate is measured during playback. If that fails too, Airtime won't mark the video rather than guess its frame rate.

For best results:

- Use an up-to-date Chromium-, Firefox-, or Safari-based browser.
- Use a browser with `requestVideoFrameCallback` support for the most accurate runtime playback detection.
- Keep very large files in mind: the browser must read and decode them locally, and available memory varies by device.
- If a file opens but cannot play, the codec is likely unsupported or the file may be damaged.

## Privacy and data handling

Airtime is designed for local review:

- Selected files are represented with browser-generated object URLs.
- Video bytes are not sent to an Airtime server by the app.
- Marks, titles and notes are saved only when you save, to this browser's IndexedDB. The video itself is never stored.
- Exports are JSON files you download yourself.
- Clearing site data deletes saved sessions. The Sessions dialog shows whether the browser has agreed to protect them from automatic clearing, and how many sessions haven't been exported yet; the Sessions button shows a dot when a backup is overdue.
- Exports from older versions of Airtime can always be imported; sessions are upgraded to the current format automatically.
- Object URLs are released when the active video is replaced or the page is unloaded.

If you use a hosted deployment, the hosting provider may still collect normal website and infrastructure metadata. See the deployment configuration and hosting provider policies for those details.

## Development

Install dependencies with Bun:

```sh
bun install
```

Useful commands:

```sh
bun run dev -- --open  # Start the Vite development server
bun run check          # Run Svelte and TypeScript diagnostics
bun run test           # Run unit tests
bun run lint           # Check formatting and ESLint rules
bun run format         # Format the repository
bun run build          # Create the static production build
bun run preview        # Preview the production build locally
```

The project uses:

- [Svelte 5](https://svelte.dev/)
- [SvelteKit](https://kit.svelte.dev/)
- [Vite](https://vite.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- TypeScript
- `@sveltejs/adapter-static`

Before opening a pull request, run:

```sh
bun run check
bun run test
bun run lint
bun run build
```

These checks also run in GitHub Actions for pull requests targeting `main`.

## Project structure

```text
src/
├── lib/
│   ├── components/       # Video viewer, controls, scrubber, jump workspace, dialogs
│   ├── session/          # Saved sessions (IndexedDB), fingerprinting, export/import
│   └── video/            # Frame-rate detection, timecode, marks and jump analysis
└── routes/
    ├── +page.svelte     # The app and its local file lifecycle
    └── layout.css       # Application theme and shared styles
```

## Deployment

Airtime is built as a static SvelteKit site:

```sh
bun run build
```
