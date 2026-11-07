// Serves a built copy of the app (bun run build) with bench.js injected, the test clips
// (make-clips.sh), and collects each run's metrics as a line of JSON in <results>.
//
//   bun scripts/scrub-bench/server.ts <build dir> <port> <results.jsonl> [clips dir]
//
// Then open http://localhost:<port>/?bench=1&suite=0&label=<browser> in any browser; the page
// runs every clip cold and warm (see SUITE in bench.js) and ends with the title BENCH DONE.
// /__bench/probe reports the GPU, WebCodecs and refresh rate instead.
import { appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [buildDir, portArg, resultsFile, clipsArg] = process.argv.slice(2);
const here = import.meta.dir;
const clips = clipsArg ?? '/tmp/airtime-scrub';

Bun.serve({
	port: Number(portArg),
	hostname: '0.0.0.0',
	async fetch(req) {
		const url = new URL(req.url);
		const path = decodeURIComponent(url.pathname);
		if (path === '/__bench/result' && req.method === 'POST') {
			const body = await req.text();
			appendFileSync(resultsFile, body + '\n');
			try {
				const r = JSON.parse(body);
				console.log(r.label, r.clip, 'warm=' + r.warm, 'score=' + r.score, r.error ?? '');
			} catch {
				console.log('unreadable result');
			}
			return new Response('ok');
		}
		if (path === '/__bench/truth')
			return new Response(Bun.file(join(here, 'seek-truth.html')), {
				headers: { 'content-type': 'text/html' }
			});
		if (path === '/__bench/probe')
			return new Response(Bun.file(join(here, 'probe.html')), {
				headers: { 'content-type': 'text/html' }
			});
		if (path === '/__bench/bench.js')
			return new Response(Bun.file(join(here, 'bench.js')), {
				headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' }
			});
		if (path.startsWith('/__bench/clips/'))
			return new Response(Bun.file(join(clips, path.slice(15))));
		let file = join(buildDir, path);
		if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
		if (!existsSync(file) && existsSync(file + '.html')) file = file + '.html';
		if (!existsSync(file)) file = join(buildDir, 'index.html');
		if (file.endsWith('.html')) {
			const html = (await Bun.file(file).text()).replace(
				'<head>',
				'<head><script src="/__bench/bench.js"></script>'
			);
			return new Response(html, {
				headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }
			});
		}
		return new Response(Bun.file(file));
	}
});
console.log('bench server on', portArg);
