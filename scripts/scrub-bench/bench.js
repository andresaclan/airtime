// Self-driving scrub benchmark, injected into the built app by server.ts.
//   /?bench=1&suite=0&label=<name>          every clip in SUITE, cold then warm
//   /?bench=1&clip=<file>&warm=0|1&label=<name>   one run
// Drags a synthetic mouse pointer along the timeline every animation frame (sweep, slow,
// wiggle, flick), records which frame is on screen each frame (the scrub preview canvas
// or the video itself), and posts the metrics to /__bench/result. Cold runs start once the
// frame rate is known; warm runs wait for the scrub cache to finish building.
//
// Per phase: latP50/latP95 = how long ago the pointer was on the frame now shown, or for
// a frame ahead of it how soon it gets there (ms); errP50/errP95 = frames off the pointer;
// freezeMax = longest stretch the pointer moved while the picture didn't (ms); freshPct =
// share of pointer moves answered by a new frame on the next refresh; settledMs = time
// from the pointer stopping to the exact frame; finalOk = the video itself (not the
// preview) shows the exact frame after letting go.
(() => {
	const params = new URLSearchParams(location.search);
	if (!params.has('bench')) return;
	const SUITE = [
		{ clip: 'h264-1080p60.mp4', warm: 0 },
		{ clip: 'h264-1080p60.mp4', warm: 1 },
		{ clip: 'hevc-4k60.mp4', warm: 0 },
		{ clip: 'hevc-4k60.mp4', warm: 1 },
		{ clip: 'h264-1080p240.mp4', warm: 0 },
		{ clip: 'h264-1080p240.mp4', warm: 1 }
	];
	const suiteIndex = params.has('suite') ? Number(params.get('suite')) : null;
	const conf = suiteIndex !== null ? SUITE[suiteIndex] : null;
	const clip = conf?.clip ?? params.get('clip') ?? 'h264-1080p60.mp4';
	const warm = Number(conf?.warm ?? params.get('warm') ?? 0);
	const label = params.get('label') ?? navigator.userAgent;
	const fpsOf = { 'h264-1080p60.mp4': 60, 'hevc-4k60.mp4': 60, 'h264-1080p240.mp4': 240 };
	const fps = fpsOf[clip] ?? 60;

	// Synthetic pointers have no capture to set.
	for (const name of ['setPointerCapture', 'releasePointerCapture']) {
		const original = Element.prototype[name];
		Element.prototype[name] = function (id) {
			try {
				return original.call(this, id);
			} catch {
				/* synthetic pointer */
			}
		};
	}

	// Scrub cache progress, through the worker's messages.
	const cache = { frames: 0, total: 0, startedAt: 0, firstMs: null, doneAt: 0, unsupported: '' };
	const NativeWorker = window.Worker;
	window.Worker = class extends NativeWorker {
		constructor(...args) {
			super(...args);
			cache.startedAt = performance.now();
			this.addEventListener('message', (e) => {
				const m = e.data;
				if (m?.type === 'start') cache.total = m.frameCount;
				else if (m?.type === 'frame') {
					cache.frames += 1;
					cache.firstMs ??= Math.round(performance.now() - cache.startedAt);
				} else if (m?.type === 'done') {
					cache.doneAt = performance.now();
					if (m.stats) cache.stats = m.stats;
				} else if (m?.type === 'unsupported') cache.unsupported = m.reason;
			});
		}
	};

	// The last events around the preview and the video, posted with a phase that ends
	// on the wrong frame.
	const trace = [];
	const note = (k, f) => {
		trace.push([Math.round(performance.now()), k, f]);
		if (trace.length > 60) trace.shift();
	};

	// Frames drawn on the preview canvas (VideoFrame timestamps are frame indices).
	let previewDrawn = -1;
	const nativeDraw = CanvasRenderingContext2D.prototype.drawImage;
	CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
		if (
			typeof VideoFrame !== 'undefined' &&
			image instanceof VideoFrame &&
			this.canvas.classList.contains('scrub-preview')
		)
			note('draw', (previewDrawn = image.timestamp));
		return nativeDraw.call(this, image, ...rest);
	};

	const longTasks = [];
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) longTasks.push(e.duration);
		}).observe({ type: 'longtask', buffered: true });
	} catch {
		/* not supported */
	}

	const raf = () => new Promise((r) => requestAnimationFrame(r));
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const status = document.createElement('pre');
	status.style.cssText =
		'position:fixed;z-index:99999;right:8px;top:8px;margin:0;padding:8px;max-width:46vw;max-height:90vh;overflow:auto;font:11px/1.35 monospace;background:#000c;color:#0f0;pointer-events:none;white-space:pre-wrap';
	const say = (text) => {
		status.textContent = text;
		document.title = 'bench: ' + text.replace(/\s+/g, ' ').slice(0, 120);
		if (!status.isConnected) document.body.append(status);
	};

	async function until(check, ms, what) {
		const start = performance.now();
		while (!check()) {
			if (performance.now() - start > ms) throw new Error('timeout: ' + what);
			await wait(50);
		}
	}

	async function main() {
		await until(() => document.body, 10000, 'body');
		say(`bench ${label}\nloading ${clip}`);
		const blob = await (await fetch('/__bench/clips/' + clip)).blob();
		await until(() => document.querySelector('#video-file-input'), 10000, 'file input');
		const input = document.querySelector('#video-file-input');
		const dt = new DataTransfer();
		dt.items.add(new File([blob], clip, { type: 'video/mp4' }));
		input.files = dt.files;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await until(() => document.querySelector('video')?.readyState >= 2, 20000, 'video');
		const video = document.querySelector('video');
		const loadedAt = performance.now();

		// Frames the video presents.
		let videoShown = -1;
		const hasRvfc = 'requestVideoFrameCallback' in video;
		if (hasRvfc) {
			const onFrame = (_n, meta) => {
				// Firefox reports the time sought (mid-frame), others the frame's start.
				videoShown = Math.floor(meta.mediaTime * fps + 0.25);
				note(video.seeking ? 'rvfc-seeking' : 'rvfc', videoShown);
				video.requestVideoFrameCallback(onFrame);
			};
			video.requestVideoFrameCallback(onFrame);
		} else {
			video.addEventListener('seeked', () => (videoShown = Math.floor(video.currentTime * fps)));
		}

		// Marking waits on the frame rate; so does scrubbing frame by frame.
		await until(() => /\d+ fps/.test(document.body.innerText), 20000, 'frame rate');
		await until(() => video.paused, 10000, 'probe end');
		if (warm) {
			await until(() => cache.doneAt || cache.unsupported, 120000, 'cache build');
		} else await wait(300);
		const track = document.querySelector('.timeline-track');
		const container = document.querySelector('.timeline-container');
		// The frame the app seeks to for a position on the track (getTimeFromPosition).
		const lastFrame = Math.ceil(video.duration * fps - 1e-3) - 1;
		const rect = track.getBoundingClientRect();
		const y = rect.top + rect.height / 2;
		const xOf = (p) => rect.left + p * rect.width;
		// From the coordinate the event carried: Firefox snaps them to its own grid.
		let sentX = 0;
		const targetOf = () => {
			const at = Math.max(0, Math.min(1, (sentX - rect.left) / rect.width));
			return Math.min(lastFrame, Math.floor(at * video.duration * fps + 1e-3));
		};
		const send = (type, x) => {
			const event = ev(type, x);
			sentX = event.clientX;
			container.dispatchEvent(event);
			if (type !== 'pointermove') note(type, targetOf());
		};
		for (const type of ['seeking', 'seeked'])
			video.addEventListener(type, () => note(type, Math.floor(video.currentTime * fps + 1e-3)));

		const ev = (type, x) =>
			new PointerEvent(type, {
				bubbles: true,
				cancelable: true,
				composed: true,
				pointerId: 1,
				pointerType: 'mouse',
				isPrimary: true,
				button: type === 'pointermove' ? -1 : 0,
				buttons: type === 'pointerup' ? 0 : 1,
				clientX: x,
				clientY: y
			});
		const preview = document.querySelector('canvas.scrub-preview');
		if (preview)
			new MutationObserver(() =>
				note('visible', preview.classList.contains('visible') ? 1 : 0)
			).observe(preview, { attributes: true, attributeFilter: ['class'] });
		const shownNow = () =>
			preview && preview.classList.contains('visible')
				? { f: previewDrawn, src: 'c' }
				: { f: videoShown, src: 'v' };

		// Each phase: position (0..1) over time.
		const ease = (u) => 0.5 - 0.5 * Math.cos(Math.PI * u);
		const phases = [
			{ name: 'sweep', ms: 2000, at: (u) => 0.1 + 0.8 * ease(u) },
			{ name: 'slow', ms: 2500, at: (u) => 0.4 + 0.06 * u },
			{ name: 'wiggle', ms: 3000, at: (u) => 0.5 + 0.3 * Math.sin(2 * Math.PI * 3 * u) },
			{ name: 'flick', ms: 600, at: (u) => 0.9 - 0.8 * ease(u) }
		];
		const results = [];
		for (const phase of phases) {
			say(
				`bench ${label}\n${clip} warm=${warm}\nphase ${phase.name}\ncache ${cache.frames}/${cache.total}`
			);
			const ticks = [];
			let p = phase.at(0);
			send('pointerdown', xOf(p));
			const cacheAtStart = cache.frames;
			const t0 = (await raf(), performance.now());
			let handlerMs = [];
			for (;;) {
				const now = await raf();
				const shown = shownNow();
				const u = Math.min(1, (performance.now() - t0) / phase.ms);
				ticks.push({ t: now, target: targetOf(), shown: shown.f, src: shown.src });
				if (u >= 1) break;
				p = phase.at(u);
				const h0 = performance.now();
				send('pointermove', xOf(p));
				handlerMs.push(performance.now() - h0);
			}
			// Hold still until the picture catches up.
			const holdStart = performance.now();
			let settledMs = null;
			for (;;) {
				const now = await raf();
				const shown = shownNow();
				ticks.push({ t: now, target: targetOf(), shown: shown.f, src: shown.src, hold: true });
				if (shown.f === targetOf() && settledMs === null) settledMs = now - holdStart;
				if (now - holdStart > 1000) break;
			}
			send('pointerup', xOf(p));
			await wait(250);
			const finalShown = shownNow();
			results.push({
				phase: phase.name,
				...analyse(ticks),
				settledMs,
				finalOk: finalShown.f === targetOf() && finalShown.src === 'v',
				trace: finalShown.f === targetOf() && finalShown.src === 'v' ? undefined : [...trace],
				finalSrc: finalShown.src,
				finalFrame: finalShown.f,
				target: targetOf(),
				currentFrame: Math.floor(video.currentTime * fps + 1e-3),
				handlerP95: pct(handlerMs, 0.95),
				cacheCoverage: cache.total ? cacheAtStart / cache.total : 0
			});
			await wait(300);
		}
		const summary = {
			label,
			ua: navigator.userAgent,
			clip,
			warm,
			rvfc: hasRvfc,
			gpu: (() => {
				try {
					const gl = document.createElement('canvas').getContext('webgl');
					const ext = gl.getExtension('WEBGL_debug_renderer_info');
					return gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
				} catch {
					return null;
				}
			})(),
			webcodecs: typeof VideoEncoder !== 'undefined',
			cache: {
				...cache,
				buildMs: cache.doneAt ? Math.round(cache.doneAt - cache.startedAt) : null
			},
			loadToScrubMs: Math.round(performance.now() - loadedAt),
			longTasks: longTasks.length,
			longTaskMax: Math.round(Math.max(0, ...longTasks)),
			phases: results
		};
		summary.score = score(summary);
		say(JSON.stringify(summary, null, 1));
		await fetch('/__bench/result', { method: 'POST', body: JSON.stringify(summary) });
		nextInSuite();
	}

	function nextInSuite() {
		if (suiteIndex !== null && suiteIndex + 1 < SUITE.length) {
			const next = new URLSearchParams(params);
			next.set('suite', String(suiteIndex + 1));
			location.search = next.toString();
		} else document.title = 'BENCH DONE';
	}

	function pct(values, q) {
		if (!values.length) return null;
		const sorted = [...values].sort((a, b) => a - b);
		return +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(1);
	}

	// Latency: how long ago the pointer was on the frame now shown. Freeze: the longest
	// stretch the pointer moved while the picture stayed on one frame.
	function analyse(ticks) {
		const moving = ticks.filter((t) => !t.hold);
		const intervals = moving.slice(1).map((t, i) => t.t - moving[i].t);
		const latency = [];
		const error = [];
		let freeze = 0;
		let freezeStart = null;
		let fresh = 0;
		let changed = 0;
		let cacheTicks = 0;
		for (let i = 1; i < moving.length; i++) {
			const tick = moving[i];
			if (tick.src === 'c') cacheTicks++;
			// When the pointer was (or, for a frame ahead of it, will be) on the frame shown.
			const passes = (j) => {
				const a = moving[j - 1].target;
				const b = moving[j].target;
				return tick.shown >= Math.min(a, b) && tick.shown <= Math.max(a, b);
			};
			let lat = tick.shown === tick.target ? 0 : null;
			for (let j = i; lat === null && j >= 1; j--) if (passes(j)) lat = tick.t - moving[j].t;
			for (let j = i + 1; j < moving.length; j++) {
				if (!passes(j)) continue;
				lat = Math.min(lat ?? Infinity, moving[j].t - tick.t);
				break;
			}
			latency.push(lat ?? Math.max(tick.t - moving[0].t, moving[moving.length - 1].t - tick.t));
			error.push(Math.abs(tick.shown - tick.target));
			if (tick.target !== moving[i - 1].target) {
				changed++;
				if (tick.shown !== moving[i - 1].shown) fresh++;
			}
			if (tick.shown === moving[i - 1].shown && tick.target !== tick.shown) {
				freezeStart ??= moving[i - 1].t;
				freeze = Math.max(freeze, tick.t - freezeStart);
			} else freezeStart = null;
		}
		return {
			hz: Math.round(1000 / (pct(intervals, 0.5) || 16.7)),
			latP50: pct(latency, 0.5),
			latP95: pct(latency, 0.95),
			errP50: pct(error, 0.5),
			errP95: pct(error, 0.95),
			freezeMax: Math.round(freeze),
			freshPct: changed ? Math.round((100 * fresh) / changed) : 100,
			cachePct: Math.round((100 * cacheTicks) / Math.max(1, moving.length - 1)),
			distinct: new Set(moving.map((t) => t.shown)).size
		};
	}

	// 10: the picture keeps up within about two refreshes, never freezes for long and
	// lands on the exact frame when the pointer stops (iOS Photos). 1: slideshow.
	function score(summary) {
		const scores = summary.phases.map((r) => {
			let s = 10;
			s -= Math.max(0, (r.latP95 - 35) / 30);
			s -= Math.max(0, (r.freezeMax - 50) / 60);
			s -= Math.max(0, (90 - r.freshPct) / 15);
			if (!r.finalOk) s -= 2;
			if (r.settledMs > 150) s -= Math.min(2, (r.settledMs - 150) / 200);
			return Math.max(1, s);
		});
		return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
	}

	main().catch((error) => {
		say('bench failed: ' + error.message);
		fetch('/__bench/result', {
			method: 'POST',
			body: JSON.stringify({ label, clip, warm, error: String(error.stack || error) })
		}).then(nextInSuite);
	});
})();
