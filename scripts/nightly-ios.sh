#!/bin/bash
# Nightly decoded-frame check in native iOS Safari, on an iOS Simulator on this Mac.
#
# Installed by scripts/install-nightly-ios.sh, which copies this file next to a
# dedicated clone and has launchd run it a few times each night. It tests origin/main
# only when main has commits it hasn't tested yet, and only once the Mac has been
# idle for a while: the Simulator and SafariDriver can take focus.
#
#   nightly-ios.sh           what launchd runs
#   nightly-ios.sh --force   run now: ignore idle time and the last tested commit
#   nightly-ios.sh --dry-run check the setup: build and serve main, skip the simulator
#
# Results: a notification, a log folder under ~/Library/Logs/airtime-nightly-ios, and
# (unless AIRTIME_NIGHTLY_ISSUES=0) one rolling GitHub issue while main is failing.
set -uo pipefail

export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ROOT="${AIRTIME_NIGHTLY_ROOT:-$HOME/Library/Application Support/airtime-nightly-ios}"
REPO="$ROOT/repo"
STATE="$ROOT/state"
LOGS="$HOME/Library/Logs/airtime-nightly-ios"
IDLE_MINUTES="${AIRTIME_NIGHTLY_IDLE_MINUTES:-20}"
ISSUES="${AIRTIME_NIGHTLY_ISSUES:-1}"
ISSUE_TITLE="Nightly iOS Simulator frame check failing on main"
# SafariDriver sometimes can't reach a freshly booted simulator; that says nothing
# about the app. Give such a commit a few chances before reporting it.
MAX_INFRA_ATTEMPTS=3
FORCE=0
DRY_RUN=0
[[ "${1:-}" == "--force" ]] && FORCE=1
[[ "${1:-}" == "--dry-run" ]] && FORCE=1 && DRY_RUN=1

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
mkdir -p "$STATE" "$LOGS"

# One run at a time; a lock left by a crashed run is reclaimed.
if ! mkdir "$STATE/lock" 2>/dev/null; then
	if kill -0 "$(cat "$STATE/lock/pid" 2>/dev/null)" 2>/dev/null; then
		say "Another nightly run is in progress"
		exit 0
	fi
	rm -rf "$STATE/lock" && mkdir "$STATE/lock"
fi
echo $$ >"$STATE/lock/pid"

server=""
udid=""
simulator_was_running=1
cleanup() {
	[[ -n "$server" ]] && kill "$server" 2>/dev/null
	if [[ -n "$udid" ]]; then
		xcrun simctl shutdown "$udid" >/dev/null 2>&1
		xcrun simctl delete "$udid" >/dev/null 2>&1
	fi
	# Only quit the Simulator app if this run opened it.
	if [[ "$simulator_was_running" == 0 ]] && pgrep -x Simulator >/dev/null; then
		osascript -e 'quit app "Simulator"' >/dev/null 2>&1
	fi
	rm -rf "$STATE/lock"
}
trap cleanup EXIT

if [[ ! -d "$REPO/.git" ]]; then
	say "No clone at $REPO; run scripts/install-nightly-ios.sh first"
	exit 1
fi
if ! git -C "$REPO" fetch -q origin main; then
	say "Could not fetch origin/main; will try again at the next slot"
	exit 0
fi
sha="$(git -C "$REPO" rev-parse origin/main)"
short="${sha:0:7}"

if [[ "$FORCE" == 0 ]]; then
	if [[ "$sha" == "$(cat "$STATE/last-tested" 2>/dev/null)" ]]; then
		say "main $short already tested; nothing merged since"
		exit 0
	fi
	idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF / 1000000000); exit}')
	idle=${idle:-0}
	if ((idle < IDLE_MINUTES * 60)); then
		say "Mac in use (idle ${idle}s); will try again at the next slot"
		exit 0
	fi
fi

# Run the version of this script that main carries. The running copy is replaced by
# a rename, so bash keeps reading the old file it already has open.
self="$ROOT/nightly-ios.sh"
if [[ -z "${AIRTIME_NIGHTLY_UPDATED:-}" && "$0" == "$self" ]]; then
	if git -C "$REPO" show "$sha:scripts/nightly-ios.sh" >"$self.new" 2>/dev/null &&
		! cmp -s "$self.new" "$self"; then
		mv "$self.new" "$self"
		rm -rf "$STATE/lock"
		trap - EXIT
		say "Updated the nightly script from main; restarting it"
		AIRTIME_NIGHTLY_UPDATED=1 exec /bin/bash "$self" "$@"
	fi
	rm -f "$self.new"
fi

run_dir="$LOGS/$(date +%Y%m%d-%H%M)-$short"
mkdir -p "$run_dir"
exec >>"$run_dir/run.log" 2>&1
say "Testing main $short in native iOS Safari"
find "$LOGS" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf {} + 2>/dev/null

notify() {
	osascript -e "display notification \"$2\" with title \"Airtime nightly iOS\" subtitle \"$1\"" \
		>/dev/null 2>&1
}

open_issue() {
	gh issue list --repo andresaclan/airtime --state open --search "in:title \"$ISSUE_TITLE\"" \
		--json number,title --jq ".[] | select(.title == \"$ISSUE_TITLE\") | .number" 2>/dev/null |
		head -1
}

report_failure() {
	local kind="$1" detail="$2" public="${3:-1}"
	notify "main $short: $kind" "$detail"
	[[ "$ISSUES" == 1 && "$public" == 1 ]] || return
	# The repository is public: report the commit and the assertion, never local logs.
	local body
	body="$(printf '%s\n\n%s\n\n```\n%s\n```\n\n%s' \
		"The nightly native iOS Simulator frame check failed on main at $sha ($kind)." \
		"It ran \`bun run test:frames:safari\` with \`FRAME_SAFARI_PLATFORM=ios\` on a fresh simulator. See docs/frame-stepping.md." \
		"$detail" \
		"Full log on the Mac that ran it: \`~/Library/Logs/airtime-nightly-ios/$(basename "$run_dir")\`.")"
	local number
	number="$(open_issue)"
	if [[ -n "$number" ]]; then
		gh issue comment "$number" --repo andresaclan/airtime --body "$body" >/dev/null
	else
		gh issue create --repo andresaclan/airtime --title "$ISSUE_TITLE" --body "$body" >/dev/null
	fi
}

report_pass() {
	notify "main $short passed" "Every frame stepped correctly in native iOS Safari."
	[[ "$ISSUES" == 1 ]] || return
	local number
	number="$(open_issue)"
	if [[ -n "$number" ]]; then
		gh issue close "$number" --repo andresaclan/airtime \
			--comment "Passing again on main at $sha." >/dev/null
	fi
}

# Infrastructure trouble: retry this commit at the next slot, up to a limit.
infra() {
	say "Infrastructure problem: $1"
	local key="$STATE/infra-$sha"
	local count=$(($(cat "$key" 2>/dev/null || echo 0) + 1))
	echo "$count" >"$key"
	if ((count >= MAX_INFRA_ATTEMPTS)); then
		# A problem with this Mac's setup says nothing about main: notify only.
		report_failure "could not run" "$1 (attempt $count of $MAX_INFRA_ATTEMPTS)" 0
		echo "$sha" >"$STATE/last-tested"
	fi
	exit 1
}

cd "$REPO" || infra "clone missing"
git checkout -q --detach "$sha" && git clean -fdq || infra "checkout failed"
bun install --frozen-lockfile || infra "bun install failed"
bun run build || infra "build failed"

port=""
for candidate in $(seq 4180 4199); do
	if ! lsof -tiTCP:"$candidate" -sTCP:LISTEN >/dev/null; then
		port="$candidate"
		break
	fi
done
[[ -n "$port" ]] || infra "no free preview port in 4180-4199"
bun run preview -- --port "$port" --strictPort >"$run_dir/preview.log" 2>&1 &
server=$!
for _ in $(seq 1 100); do
	curl --fail --silent "http://localhost:$port/" >/dev/null && break
	kill -0 "$server" 2>/dev/null || infra "preview server exited"
	sleep 0.3
done
curl --fail --silent "http://localhost:$port/" >/dev/null || infra "preview server never answered"
if [[ "$DRY_RUN" == 1 ]]; then
	say "Dry run: built main $short and served it on port $port; skipping the simulator"
	exit 0
fi

pgrep -x Simulator >/dev/null || simulator_was_running=0
# The same isolated device CI used: newest iOS runtime, booted before SafariDriver.
GITHUB_OUTPUT="$run_dir/simulator.txt" python3 scripts/frame-ios-simulator.py ||
	infra "could not create or boot the iOS Simulator"
udid="$(sed -n 's/^udid=//p' "$run_dir/simulator.txt")"
[[ -n "$udid" ]] || infra "simulator script returned no UDID"

attempt=0
status=1
while ((attempt < 2)); do
	attempt=$((attempt + 1))
	say "Native iOS frame check, attempt $attempt"
	FRAME_SAFARI_PLATFORM=ios FRAME_IOS_SIMULATOR_UDID="$udid" \
		FRAME_TEST_URL="http://localhost:$port" \
		bun run test:frames:safari 2>&1 | tee "$run_dir/frames-$attempt.log"
	status=${PIPESTATUS[0]}
	((status == 0)) && break
	# Retry only when no session was created; a wrong picture is never retried.
	grep -q "SessionNotCreatedError" "$run_dir/frames-$attempt.log" || break
done
[[ -d test-results/safari-ios ]] && cp -R test-results/safari-ios "$run_dir/"
log="$run_dir/frames-$attempt.log"

if ((status == 0)); then
	say "Passed"
	echo "$sha" >"$STATE/last-tested"
	rm -f "$STATE/infra-$sha"
	report_pass
	exit 0
fi
if grep -qi "remote automation" "$log"; then
	infra "SafariDriver is not enabled on this Mac. Run once: sudo safaridriver --enable"
fi
if grep -q "Could not find any session hosts" "$log"; then
	infra "SafariDriver found no simulator to automate. Check that Xcode's Simulator app is installed and SafariDriver is enabled (sudo safaridriver --enable)"
fi
if grep -q "SessionNotCreatedError" "$log"; then
	infra "SafariDriver could not start a session in the simulator"
fi
detail="$(grep -m1 -E "AssertionError|Error:" "$log" | cut -c1-600)"
say "Failed: ${detail:-see log}"
echo "$sha" >"$STATE/last-tested"
report_failure "frames wrong" "${detail:-The run failed without an assertion message.}"
exit 1
