#!/usr/bin/env bash
# Starts this worktree's dev server in the background, waits until it answers and
# prints its URL. nohup keeps it alive after the agent's tool call ends.
#
#   scripts/dev.sh <port> [--host]
#
# Stop it with: kill $(lsof -tiTCP:<port> -sTCP:LISTEN)
set -euo pipefail

port=${1:?usage: scripts/dev.sh <port> [--host]}
shift
cd "$(dirname "$0")/.."

# T3's install-on-create script doesn't always run.
[ -x node_modules/.bin/vite ] || bun install --frozen-lockfile >&2

if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
	echo "Port $port is already in use." >&2
	exit 1
fi

log=/tmp/airtime-$port.log
nohup bun run dev -- --port "$port" --strictPort "$@" >"$log" 2>&1 &
server=$!

for _ in $(seq 1 100); do
	if curl -s -o /dev/null "http://localhost:$port/"; then
		echo "http://localhost:$port"
		if [[ " $* " == *" --host "* ]]; then
			echo "http://$(ipconfig getifaddr en0):$port"
		fi
		exit 0
	fi
	if ! kill -0 "$server" 2>/dev/null; then
		tail -20 "$log" >&2
		exit 1
	fi
	sleep 0.3
done

echo "The dev server didn't answer on port $port; see $log." >&2
exit 1
