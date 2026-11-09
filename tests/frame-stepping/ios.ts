// Native iOS Safari decoded-frame check, run by the agent (or person) changing the
// player, on a Mac with Xcode and an iOS Simulator runtime:
//
//   bun run test:frames:ios                 # build, test in a fresh simulator
//   bun run test:frames:ios --post-status   # also record the result on GitHub
//
// No SafariDriver: it can't see simulators on every Mac. This serves the built app
// and a test page (ios-page.ts) that runs the shared contract in-page, opens it with
// `simctl openurl`, and collects the results the page posts back. With
// --post-status, a clean and pushed HEAD gets an `ios-frames` commit status, which
// CI requires on pull requests that change playback (scripts/check-ios-frames.ts).
import { $ } from 'bun';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTEXT } from '../../scripts/check-ios-frames';

const repo = join(import.meta.dir, '../..');
const postStatus = process.argv.includes('--post-status');
const scratch = mkdtempSync(join(tmpdir(), 'airtime-ios-frames-'));
const say = (line: string) => console.log(line);

async function freePort() {
	// Safari refuses some ports outright (4190 is ManageSieve); 4280-4299 has none.
	for (let port = 4280; port < 4300; port++) {
		try {
			Bun.serve({ port, fetch: () => new Response() }).stop(true);
			return port;
		} catch {
			// In use: try the next one.
		}
	}
	throw new Error('No free port in 4280-4299');
}

async function bundlePage() {
	const built = await Bun.build({
		entrypoints: [join(import.meta.dir, 'ios-page.ts')],
		target: 'browser',
		plugins: [
			{
				// contract.ts names fixtures by file URL for Node runners; in the page
				// only the file name matters, and upload() fetches it from this server.
				name: 'url-shim',
				setup(build) {
					build.onResolve({ filter: /^node:url$/ }, () => ({ path: 'url', namespace: 'shim' }));
					build.onLoad({ filter: /.*/, namespace: 'shim' }, () => ({
						contents: 'export const fileURLToPath = (url) => String(url);',
						loader: 'js'
					}));
				}
			}
		]
	});
	if (!built.success) throw new AggregateError(built.logs, 'Could not bundle the iOS test page');
	return built.outputs[0].text();
}

type CaseResult = { name: string; ok: boolean; error: string | null; ms: number };

async function serve(port: number, script: string) {
	const results: CaseResult[] = [];
	let expected: string[] = [];
	let userAgent = '';
	// Each page load has its own id. Safari can reload the page during its first
	// launch on a fresh simulator; only the newest load's cases count, once.
	let run = '';
	let restarts = 0;
	const { promise: done, resolve: finish } = Promise.withResolvers<void>();
	const { promise: started, resolve: start } = Promise.withResolvers<void>();
	const page = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style>
<iframe id="app" src="about:blank"></iframe><script type="module">${script}</script>`;
	const server = Bun.serve({
		port,
		async fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === '/__ios')
				return new Response(page, { headers: { 'content-type': 'text/html' } });
			if (pathname.startsWith('/__fixtures/')) {
				const name = pathname.slice('/__fixtures/'.length);
				if (!/^[\w.-]+$/.test(name)) return new Response('Not found', { status: 404 });
				return new Response(Bun.file(join(import.meta.dir, 'fixtures', name)));
			}
			if (request.method === 'POST') {
				const body = await request.json();
				if (pathname === '/__start') {
					if (run) {
						restarts += 1;
						say(`The test page restarted (${restarts}); counting only the new run`);
					}
					run = body.run;
					results.length = 0;
					expected = body.cases;
					userAgent = body.ua;
					start();
					say(`Running ${expected.length} cases in ${userAgent}`);
				} else if (body.run !== run) {
					// A post from a load that has since been replaced.
				} else if (pathname === '/__case') {
					results.push(body);
					say(`${body.ok ? 'PASS' : 'FAIL'} ${body.name} (${(body.ms / 1000).toFixed(1)} s)`);
					if (!body.ok) say(`  ${String(body.error).split('\n').slice(0, 3).join('\n  ')}`);
				} else if (pathname === '/__done') finish();
				return new Response('ok');
			}
			// The built app (adapter-static): a file, a prerendered page, or the shell.
			const base = join(repo, 'build');
			for (const candidate of [pathname, `${pathname}.html`, join(pathname, 'index.html')]) {
				const file = Bun.file(join(base, candidate));
				if (!candidate.includes('..') && (await file.exists())) return new Response(file);
			}
			return new Response(Bun.file(join(base, 'index.html')));
		}
	});
	return { server, started, done, results, expected: () => expected, restarts: () => restarts };
}

async function createSimulator() {
	const output = join(scratch, 'simulator.txt');
	const created = await $`python3 ${join(repo, 'scripts/frame-ios-simulator.py')}`
		.env({ ...process.env, GITHUB_OUTPUT: output })
		.quiet()
		.text();
	const udid = /^udid=(.+)$/m.exec(readFileSync(output, 'utf8'))?.[1];
	if (!udid) throw new Error('The simulator script returned no UDID');
	const runtime = /iOS ([\d.]+)/.exec(created)?.[1] ?? 'unknown';
	say(created.trim().split('\n')[0]);
	return { udid, runtime };
}

async function commitToReport() {
	const sha = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
	if ((await $`git -C ${repo} status --porcelain`.text()).trim())
		return {
			sha,
			why: 'the working tree has uncommitted changes, so the result is not that commit'
		};
	const remote = (await $`git -C ${repo} remote get-url origin`.text()).trim();
	const slug = /github\.com[/:](.+?)(?:\.git)?$/.exec(remote)?.[1];
	if (!slug) return { sha, why: `origin (${remote}) is not a GitHub repository` };
	const pushed = await $`gh api repos/${slug}/commits/${sha} --silent`.nothrow().quiet();
	if (pushed.exitCode !== 0)
		return { sha, why: `${sha.slice(0, 7)} is not on GitHub yet; push it first` };
	return { sha, slug, why: null };
}

/** CI's `verify` job checks for this status; re-run it where it already failed. */
async function rerunVerify(slug: string, sha: string) {
	const runs = await $`gh run list --repo ${slug} --commit ${sha} --json databaseId --limit 20`
		.nothrow()
		.quiet();
	if (runs.exitCode !== 0) return;
	for (const { databaseId } of runs.json() as { databaseId: number }[]) {
		const jobs = await $`gh run view ${databaseId} --repo ${slug} --json jobs`.nothrow().quiet();
		if (jobs.exitCode !== 0) continue;
		const verify = (
			jobs.json() as { jobs: { databaseId: number; name: string; conclusion: string }[] }
		).jobs.find((job) => job.name === 'verify' && job.conclusion === 'failure');
		if (!verify) continue;
		const rerun = await $`gh run rerun --repo ${slug} --job ${verify.databaseId}`.nothrow().quiet();
		say(
			rerun.exitCode === 0
				? `Re-running CI's verify job (run ${databaseId})`
				: `Could not re-run CI's verify job (run ${databaseId}); re-run it on GitHub`
		);
	}
}

let simulator: { udid: string; runtime: string } | undefined;
let exitCode = 1;
try {
	say('Building the app');
	await $`bun run build`.cwd(repo).quiet();
	const port = await freePort();
	const { server, started, done, results, expected, restarts } = await serve(
		port,
		await bundlePage()
	);
	try {
		simulator = await createSimulator();
		const url = `http://localhost:${port}/__ios`;
		// Safari's first launch on a fresh simulator can leave the first URL loading
		// forever. Open it again until the page checks in.
		for (let attempt = 1; ; attempt++) {
			await $`xcrun simctl openurl ${simulator.udid} ${url}`;
			const checkedIn = await Promise.race([
				started.then(() => true),
				new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20_000))
			]);
			if (checkedIn) break;
			if (attempt === 3) throw new Error('Safari never opened the test page in the simulator');
			say('The test page has not started yet; opening it again');
		}
		// Each case has its own 240 s watchdog in the page; this catches a page that
		// stops reporting altogether (a crashed WebContent process, say).
		let timer: ReturnType<typeof setTimeout> | undefined;
		await Promise.race([
			done,
			new Promise((resolve) => (timer = setTimeout(resolve, 45 * 60_000)))
		]);
		clearTimeout(timer);
		const passed = results.filter((result) => result.ok).length;
		const total = expected().length;
		// One restart is Safari's first launch; more suggests the page is crashing.
		const ok = total > 0 && passed === total && results.length === total && restarts() <= 1;
		if (restarts() > 1) say(`The test page restarted ${restarts()} times`);
		say(
			`${ok ? 'PASSED' : 'FAILED'}: ${passed}/${total} cases in native iOS ${simulator.runtime} Safari`
		);
		exitCode = ok ? 0 : 1;

		if (postStatus) {
			const commit = await commitToReport();
			if (commit.why) {
				say(`Not recording a GitHub status: ${commit.why}`);
			} else {
				const description = `Native iOS ${simulator.runtime} Safari: ${passed}/${total} cases`;
				const posted =
					await $`gh api repos/${commit.slug}/statuses/${commit.sha} -f state=${ok ? 'success' : 'failure'} -f context=${CONTEXT} -f description=${description} --silent`
						.nothrow()
						.quiet();
				if (posted.exitCode !== 0) {
					say(`Could not record the ${CONTEXT} status: ${posted.stderr.toString().trim()}`);
					say(
						'The GitHub token needs to write commit statuses (a fine-grained token: Commit statuses, Read and write; a classic token: repo:status).'
					);
					exitCode = 1;
				} else {
					say(`Recorded ${CONTEXT} = ${ok ? 'success' : 'failure'} on ${commit.sha.slice(0, 7)}`);
					if (ok && commit.slug) await rerunVerify(commit.slug, commit.sha);
				}
			}
		}
	} finally {
		server.stop(true);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	exitCode = 1;
} finally {
	if (simulator) {
		await $`xcrun simctl shutdown ${simulator.udid}`.nothrow().quiet();
		await $`xcrun simctl delete ${simulator.udid}`.nothrow().quiet();
	}
	rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
