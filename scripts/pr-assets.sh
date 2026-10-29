#!/usr/bin/env bash
# Uploads images for a PR description to the branch pr-assets/<name> without touching
# the checked-out branch or index, then prints one Markdown image link per file.
# Links point at the commit, so they keep working after later uploads.
#
#   scripts/pr-assets.sh <name> <image>...
set -euo pipefail

name=${1:?usage: scripts/pr-assets.sh <name> <image>...}
shift
[ $# -gt 0 ] || { echo "Give at least one image." >&2; exit 1; }

ref=refs/heads/pr-assets/$name
parent=$(git ls-remote origin "$ref" | cut -f1)
[ -z "$parent" ] || git fetch -q origin "$ref"

GIT_INDEX_FILE=$(mktemp -u)
export GIT_INDEX_FILE
for file in "$@"; do
	blob=$(git hash-object -w "$file")
	git update-index --add --cacheinfo "100644,${blob},${name}/$(basename "$file")"
done
tree=$(git write-tree)
rm -f "$GIT_INDEX_FILE"
unset GIT_INDEX_FILE

commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "PR assets: ${name}")
git push -q origin "${commit}:${ref}"

repo=$(git remote get-url origin | sed -E 's#^.*github\.com[:/]##; s#\.git$##')
for file in "$@"; do
	base=$(basename "$file")
	echo "![${base%.*}](https://raw.githubusercontent.com/${repo}/${commit}/${name}/${base})"
done
