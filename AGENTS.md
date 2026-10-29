# Agent Instructions

These rules apply to every agent working in this repo, whatever the provider.

## Setup

- The package manager is **bun** (`bun.lock`). Don't use npm, npx or yarn, and don't create `package-lock.json`.
- In a new worktree, run `bun install --frozen-lockfile` before anything else. T3's install-on-create script doesn't always run, so check for `node_modules` rather than assuming it's there. Don't symlink `node_modules` from another checkout; Vite refuses to serve files from outside the worktree.
- Before any commit or PR, run `bun run check && bun run test && bun run lint && bun run build`.

## Dev server

- Start it with `scripts/dev.sh <port>`. It installs dependencies if they're missing, starts the server with `nohup` (background tool tasks are killed at their time limit, and the server with them), waits until it answers and prints the URL. The log is `/tmp/airtime-<port>.log`.
- Stop your servers when you're done with them: `kill $(lsof -tiTCP:<port> -sTCP:LISTEN)`. Leave other agents' servers alone.
- When handing back UI work, list one `http://localhost:<port>` link per branch, labelled with what it shows, and check that each server is still running.
- For testing on a phone, add `--host`; the script also prints the LAN address.

## Browser checks

- Never take focus from the user, who keeps working on this Mac while agents test. Don't launch Chrome with `chromium.launch({headless: false})` or call `page.bringToFront()` / `context.newPage()`; each one brings a window to the front.
- Run automated checks with `scripts/background-chrome.mjs`. It opens a real Chrome window behind the user's apps, and rAF and rVFC stay at full rate. `playwright-core` is a dev dependency; a script outside the repo can load both from the worktree:

```js
import { createRequire } from 'node:module';
const repo = '/path/to/worktree/';
const { chromium } = createRequire(repo)('playwright-core');
const { launchBackground } = await import(repo + 'scripts/background-chrome.mjs');
const { page, close } = await launchBackground(chromium);
try {
	// …
} finally {
	await close(); // otherwise a failed run leaves Chrome running
}
```

- Don't call `execSync` in a timer while Playwright runs; it blocks Node's event loop and Playwright calls time out.

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
- The shell is zsh. Use braces before a colon: zsh reads `$sha:refs/…` as `$sha` plus the `:r` modifier and pushes a mangled ref, so write `${sha}:refs/…`. An unmatched glob is an error, so quote patterns such as `--include='*.ts'`.
- A standalone `sleep` is blocked. Wait with an `until <check>; do sleep 2; done` loop, or start the command with `run_in_background`. Wait on a PID (`kill -0 $pid`) or an output file, not on `pgrep -f <name>`; two waiting shells match each other's command lines and never finish.
- Python has no Pillow and there's no ImageMagick. Use `uv run --with pillow python3 …`, `sips`, or ffmpeg (`hstack`/`vstack`) for crops and contact sheets.
- Keep scratch files in `/tmp/airtime-<branch>/`. Don't delete another agent's `/tmp` folder; other agents may still be using it.

## Git and GitHub

- T3 renames the branch after the first turn (for example from `t3/3edf88bc` to `t3/export-jump-types`), so don't derive it from the worktree's folder name. Push with `git push -u origin HEAD` and open PRs with `gh pr create --head "$(git branch --show-current)"`.
- Put screenshots in PR descriptions with `scripts/pr-assets.sh <name> <image>...`. It uploads them to the branch `pr-assets/<name>` and prints Markdown image links.
- Bring branches up to date with merge commits titled "Merge main into <branch>".
- Commit your work before ending a turn. Never share a checkout with another agent.
- Stacked PRs: merge from the bottom up, and check that every layer actually reached `main`.
- After opening a PR, wait for the Vercel bot's comment and put its preview deployment link in your reply to the user.
- Keep `gh` current; version 2.59 failed on `gh pr edit`. With `--repo`, always pass the PR number, URL or branch as a positional argument:

```bash
gh pr view 123 --repo andresaclan/airtime
gh pr edit 123 --repo andresaclan/airtime --title "Updated title"
```

## Subagents and councils

- Claude's `Agent` tool with `isolation: "worktree"` refuses shell commands it can't confirm stay in the worktree, such as heredocs and multi-step pipelines. Give those agents edit-tool work, or use T3 `delegate_task` with a worktree.
- Before a multi-round council, send each judge model a short test task. Usage limits stopped judges partway through earlier councils: a Codex model was locked out for three weeks and Gemini for two days.

## Agent skills

Skills are installed locally (user-level `~/.claude/skills`), not stored in the repo. `.agents/`, `.claude/` and `skills-lock.json` are gitignored; don't commit skills.

### Issue tracker

Issues and specs live in GitHub Issues for `andresaclan/airtime`, managed with `gh`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
