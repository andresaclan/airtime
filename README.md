# Airtime

**A fast, private video timing tool for frame-accurate review in the browser.**

Airtime helps editors, animators, engineers, and reviewers inspect local video without uploading it to a server. Open a file, move through it frame by frame, mark an in/out range, and inspect the exact timing details in a focused player UI.

> **Privacy first:** videos are loaded from your device into the browser using local object URLs. Airtime does not include an upload API or application backend.

## What it does

- Open a video from the file picker or drag and drop it into the app.
- Play, pause, mute, and adjust volume.
- Scrub through the timeline with pointer, touch, or keyboard controls.
- Step backward and forward one frame at a time.
- Detect source frame rates for supported MP4, M4V, and MOV files.
- Show playback and source frame-rate information, including high-frame-rate video.
- Mark **In** and **Out** points and review frame count and duration in milliseconds.
- Zoom into the video up to 5x, pan around the frame, and reset the view.
- Generate thumbnails for marked timing points.
- Keep video playback inline and disable browser presentation modes such as Picture-in-Picture.

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

1. Open a local video with **Open video**, or drag it onto the app.
2. Use the play controls and timeline to find the moment you want to inspect.
3. Use `,` and `.` for frame stepping. `Shift+ArrowLeft` and `Shift+ArrowRight` are also supported.
4. Turn on **Timing** and set the **In** and **Out** points.
5. Open **View details** to see the selected range's frames, milliseconds, and thumbnails.
6. Use the zoom controls or double-click/tap the viewer when you need to inspect image detail.

## Keyboard shortcuts

| Shortcut                   | Action                                                   |
| -------------------------- | -------------------------------------------------------- |
| `Space` or `K`             | Play or pause                                            |
| `,`                        | Step one frame backward                                  |
| `.`                        | Step one frame forward                                   |
| `Shift` + `ArrowLeft`      | Step one frame backward                                  |
| `Shift` + `ArrowRight`     | Step one frame forward                                   |
| `ArrowUp`                  | Increase volume                                          |
| `ArrowDown`                | Decrease volume                                          |
| `M`                        | Mute or unmute                                           |
| `T`                        | Toggle timing mode                                       |
| `I`                        | Mark the In point while timing mode is active            |
| `O`                        | Mark the Out point while timing mode is active           |
| `ArrowLeft` / `ArrowRight` | Seek when the timeline has focus                         |
| `Escape`                   | Close the timing details drawer                          |

## Supported files and browser behavior

Airtime accepts common video extensions such as MP4, M4V, MOV, WebM, MKV, AVI, WMV, FLV, MPEG, 3GP, and OGV. Actual playback depends on the codecs supported by the browser and operating system.

Source frame-rate parsing is currently implemented for ISO Base Media File Format containers, including MP4, M4V, and MOV. Other formats can still play when supported by the browser, but may fall back to the default or runtime-detected frame rate.

For best results:

- Use an up-to-date Chromium-, Firefox-, or Safari-based browser.
- Use a browser with `requestVideoFrameCallback` support for the most accurate runtime playback detection.
- Keep very large files in mind: the browser must read and decode them locally, and available memory varies by device.
- If a file opens but cannot play, the codec is likely unsupported or the file may be damaged.

## Privacy and data handling

Airtime is designed for local review:

- Selected files are represented with browser-generated object URLs.
- Video bytes are not sent to an Airtime server by the app.
- Timing points and playback state are session-local and are not persisted.
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
bun run lint
bun run build
```

These checks also run in GitHub Actions for pull requests targeting `main`.

## Project structure

```text
src/
├── lib/
│   ├── components/       # Video viewer, controls, scrubber, and timing UI
│   └── video/            # Video metadata and frame-rate detection
└── routes/
    ├── +page.svelte     # Main application screen and local file lifecycle
    └── layout.css       # Application theme and shared styles
```

## Deployment

Airtime is built as a static SvelteKit site:

```sh
bun run build
```
