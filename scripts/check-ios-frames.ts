// CI's check that a pull request changing playback was tested in native iOS Safari.
//
// Native iOS runs on the Mac of whoever changes the player (`bun run
// test:frames:ios --post-status`, tests/frame-stepping/ios.ts), which records an
// `ios-frames` commit status. This passes when the pull request changes no playback
// files, or when a commit in it has a passing `ios-frames` status and no playback
// file changed after that commit. Merging main without playback changes keeps it.
//
// Env: BASE_SHA and HEAD_SHA (the pull request's), GITHUB_REPOSITORY, GH_TOKEN.
import { $ } from 'bun';

export const CONTEXT = 'ios-frames';

/** Code that decides which picture is on screen, as git pathspecs. */
export const PLAYBACK_PATHS = [
	'src/lib/video/',
	'src/lib/components/VideoViewer.svelte',
	'src/lib/components/VideoControls.svelte',
	'src/lib/components/VideoScrubber.svelte',
	'src/lib/keybinds.ts',
	'src/routes/+page.svelte',
	'tests/frame-stepping/',
	':(exclude,glob)**/*.test.ts'
];

async function changed(from: string, to: string) {
	const out = await $`git diff --name-only ${from} ${to} -- ${PLAYBACK_PATHS}`.text();
	return out.split('\n').filter(Boolean);
}

if (import.meta.main) {
	const { BASE_SHA: base, HEAD_SHA: head, GITHUB_REPOSITORY: repository } = process.env;
	if (!base || !head || !repository) {
		console.log('Not a pull request: nothing to check.');
		process.exit(0);
	}
	const mergeBase = (await $`git merge-base ${base} ${head}`.text()).trim();
	const files = await changed(mergeBase, head);
	if (files.length === 0) {
		console.log('No playback files changed: no native iOS check needed.');
		process.exit(0);
	}
	console.log(`Playback files changed:\n  ${files.join('\n  ')}`);

	// Newest first. A receipt counts only if playback hasn't changed since it.
	const commits = (await $`git rev-list ${head} --not ${base}`.text()).split('\n').filter(Boolean);
	for (const commit of commits) {
		const statuses: { context: string; state: string; description: string | null }[] =
			await $`gh api repos/${repository}/commits/${commit}/statuses --paginate`.json();
		const latest = statuses.find((status) => status.context === CONTEXT);
		if (!latest) continue;
		const since = await changed(commit, head);
		if (latest.state === 'success' && since.length === 0) {
			console.log(`Native iOS passed on ${commit.slice(0, 7)}: ${latest.description ?? ''}`);
			process.exit(0);
		}
		if (latest.state === 'success') {
			console.log(
				`${commit.slice(0, 7)} passed native iOS, but playback changed after it:\n  ${since.join('\n  ')}`
			);
		} else {
			console.log(
				`Native iOS ${latest.state} on ${commit.slice(0, 7)}: ${latest.description ?? ''}`
			);
		}
		break;
	}
	console.log(
		[
			'',
			'This pull request changes playback, and no passing native iOS run covers its',
			'latest playback change. On a Mac with Xcode, check out the pushed head and run:',
			'',
			'  bun run test:frames:ios --post-status',
			'',
			'It records an `ios-frames` status on the commit and re-runs this check.'
		].join('\n')
	);
	process.exit(1);
}
