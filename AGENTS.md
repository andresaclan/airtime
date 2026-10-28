# Agent Instructions

These rules apply to every agent working in this repo, whatever the provider.

## Setup

- The package manager is **bun** (`bun.lock`). Don't use npm, npx or yarn, and don't create `package-lock.json`.
- In a new worktree, run `bun install --frozen-lockfile` before anything else. Don't symlink `node_modules` from another checkout; Vite refuses to serve files from outside the worktree.
- Before any commit or PR, run `bun run check && bun run test && bun run lint && bun run build`.

## Dev server

- Start it with `nohup bun run dev -- --port <port> --strictPort > /tmp/airtime-<port>.log 2>&1 &`. Background tool tasks are killed when they hit their time limit, which takes the server down with them.
- When handing back UI work, list one `http://localhost:<port>` link per branch, labelled with what it shows, and check that each server is still running.
- For testing on a phone, add `--host` and give the LAN address.

## Browser checks

- Never take focus from the user, who keeps working on this Mac while agents test. Don't launch Chrome with `chromium.launch({headless: false})` or call `page.bringToFront()` / `context.newPage()`; each one brings a window to the front.
- Run automated checks with `scripts/background-chrome.mjs`. It opens a real Chrome window behind the user's apps, and rAF and rVFC stay at full rate. Get playwright-core from `/tmp/airtime-limits-pw` (if it's gone, `bun add playwright-core` in that directory):

```js
import { createRequire } from 'node:module';
import { launchBackground } from './scripts/background-chrome.mjs';
const { chromium } = createRequire('/tmp/airtime-limits-pw/')('playwright-core');
const { page, close } = await launchBackground(chromium);
```

## Browser preview (T3 `preview_*` tools)

- Use these only when the user asks to see a page, not for background testing. Open tabs in the incognito profile: `preview_open {open: true, profileId: "incognito"}`. Snapshots hang in background tabs; if one times out, call `preview_open {tabId, open: true}` and retry.
- Load videos with `preview_upload {locator: "#video-file-input"}`. Clicking "Open video" doesn't open a file chooser in automation.
- Don't call `location.reload()` inside `preview_evaluate`; use `preview_navigate`.
- The unsaved-changes `confirm()` makes uploads and navigation hang for 15 seconds. Answer it with `preview_dialog`.
- `preview_press` takes key names (`"Space"`, not `" "`).
- Generate test clips into `/tmp/airtime-test`, for example `ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=60:duration=6" -pix_fmt yuv420p clip60.mp4`. Don't use the user's personal videos unless asked.
- Wait for the frame-rate badge to settle before placing marks; marking is disabled until the frame rate is read or measured, and stays disabled if neither works.

## macOS shell

- BSD sed needs an explicit suffix: `sed -i '' …`. For multi-line changes, use Python or an edit tool.
- Search with `git grep` or `rg`. `grep` may be wrapped by ugrep and treat flags differently.

## Git and GitHub

- Bring branches up to date with merge commits titled "Merge main into <branch>".
- Commit your work before ending a turn. Never share a checkout with another agent.
- Stacked PRs: merge from the bottom up, and check that every layer actually reached `main`.
- After opening a PR, wait for the Vercel bot's comment and put its preview deployment link in your reply to the user.
- Keep `gh` current; version 2.59 failed on `gh pr edit`. With `--repo`, always pass the PR number, URL or branch as a positional argument:

```bash
gh pr view 123 --repo andresaclan/airtime
gh pr edit 123 --repo andresaclan/airtime --title "Updated title"
```

## Agent skills

Skills are installed locally (user-level `~/.claude/skills`), not stored in the repo. `.agents/`, `.claude/` and `skills-lock.json` are gitignored; don't commit skills.

### Issue tracker

Issues and specs live in GitHub Issues for `andresaclan/airtime`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
