import { fileURLToPath } from 'node:url';
import manifest from './fixtures/manifest.json' with { type: 'json' };

// Small assertions work unchanged in Node and inside a browser-side batch.
function createAssertions() {
	return {
		equal(actual: unknown, expected: unknown, label = '') {
			if (!Object.is(actual, expected))
				throw new Error(`${label}: expected ${expected}, got ${actual}`);
		},
		ok(value: unknown, label = 'Assertion failed') {
			if (!value) throw new Error(label);
		},
		fail(label: string): never {
			throw new Error(label);
		}
	};
}
const assert = createAssertions();

// The same contract runs through Playwright and shipping Safari's WebDriver.
// No imports from Airtime: expected frames come from ffmpeg, not app calculations.
export interface FramePage {
	engine: 'webkit' | 'chromium';
	batch?(operation: 'ready' | 'walk' | 'interaction' | 'next', fixture: Fixture): Promise<void>;
	goto(path: string, expectedPath?: string): Promise<void>;
	evaluate<R, A>(fn: (arg: A) => R, arg: A): Promise<R>;
	click(selector: string): Promise<void>;
	focus(selector: string): Promise<void>;
	press(key: string): Promise<void>;
	down(selector: string): Promise<void>;
	up(): Promise<void>;
	upload(path: string): Promise<void>;
}

export const fixtures = manifest;
export type Fixture = (typeof fixtures)[number];
const previous = '[aria-label="Previous frame"]';
const next = '[aria-label="Next frame"]';
const timeline = '[aria-label="Video timeline"]';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(
	read: () => Promise<T>,
	accepts: (value: T) => boolean,
	label: string
) {
	const deadline = Date.now() + 10_000;
	let value: T;
	do {
		value = await read();
		if (accepts(value)) return value;
		await pause(25);
	} while (Date.now() < deadline);
	return assert.fail(`${label}: ${JSON.stringify(value)}`);
}

export function readFrame(page: FramePage) {
	return page.evaluate(() => {
		const video = document.querySelector('video');
		const copy = document.createElement('canvas');
		copy.width = 256;
		copy.height = 1;
		const ctx = copy.getContext('2d', { willReadFrequently: true })!;
		const decode = (source: HTMLVideoElement | HTMLCanvasElement) => {
			ctx.drawImage(source, 0, 0, 256, 1);
			const pixels = ctx.getImageData(0, 0, 256, 1).data;
			const bits = Array.from({ length: 16 }, (_, bit) => pixels[(bit * 16 + 8) * 4] > 128);
			if (bits.slice(0, 8).some((bit, k) => bit === bits[k + 8])) return -1;
			return bits.slice(0, 8).reduce((id, bit, k) => id + (Number(bit) << k), 0);
		};
		const overlay = document.querySelector<HTMLCanvasElement>('[data-scrub-surface].visible');
		return {
			id: video && video.readyState >= 2 ? decode(video) : -1,
			overlay: overlay ? decode(overlay) : null,
			time: video?.currentTime ?? -1,
			duration: video?.duration ?? -1,
			paused: video?.paused ?? false,
			seeking: video?.seeking ?? true,
			fps: document.querySelector('.time-fps')?.textContent?.trim() ?? '',
			previousDisabled:
				document.querySelector<HTMLButtonElement>('[aria-label="Previous frame"]')?.disabled ??
				true,
			nextDisabled:
				document.querySelector<HTMLButtonElement>('[aria-label="Next frame"]')?.disabled ?? true
		};
	}, undefined);
}

export async function expectFrame(page: FramePage, fixture: Fixture, index: number) {
	let consecutive = 0;
	const offset = page.engine === 'webkit' ? fixture.webkitOffset : 0;
	return waitFor(
		() => readFrame(page),
		(state) => {
			const correct =
				state.paused &&
				!state.seeking &&
				state.id === fixture.ids[index] &&
				(state.overlay === null || state.overlay === state.id) &&
				state.time >= fixture.times[index] + offset - 2e-6 &&
				state.time <
					(fixture.times[index + 1] === undefined
						? state.duration
						: fixture.times[index + 1] + offset);
			consecutive = correct ? consecutive + 1 : 0;
			return consecutive >= 3;
		},
		`${fixture.file}: expected decoded frame ${index} (barcode ${fixture.ids[index]})`
	);
}

export async function home(page: FramePage) {
	await page.focus(timeline);
	await page.press('Home');
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur(), undefined);
}

export async function load(page: FramePage, route: string, fixture: Fixture, preview = true) {
	await page.goto(route);
	await waitFor(
		() => page.evaluate(() => document.documentElement.dataset.airtimeReady === 'true', undefined),
		Boolean,
		'The app must hydrate before uploading a file'
	);
	if (!preview)
		await page.evaluate(() => Reflect.deleteProperty(window, 'VideoEncoder'), undefined);
	await page.evaluate(() => {
		const log: unknown[] = [];
		(window as typeof window & { __frameLog: unknown[] }).__frameLog = log;
		const record = (event: string, video: HTMLVideoElement, extra?: unknown) => {
			log.push({
				event,
				at: performance.now(),
				time: video?.currentTime ?? -1,
				seeking: video?.seeking ?? true,
				extra
			});
			if (log.length > 1000) log.shift();
		};
		document.addEventListener(
			'keydown',
			(event) => {
				log.push({ event: 'key', key: event.key, shift: event.shiftKey, trusted: event.isTrusted });
			},
			true
		);
		for (const event of ['seeking', 'seeked', 'play', 'pause', 'emptied', 'airtime:seek']) {
			document.addEventListener(
				event,
				(e) => {
					if (e.target instanceof HTMLVideoElement) record(event, e.target);
				},
				true
			);
		}
		const property = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')!;
		Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
			...property,
			set(time: number) {
				record('assign', this, time);
				property.set!.call(this, time);
			}
		});
		const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
		HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
			return request.call(this, (now, metadata) => {
				record('present', this, metadata.mediaTime);
				callback(now, metadata);
			});
		};
	}, undefined);
	await replace(page, fixture);
}

export async function replace(page: FramePage, fixture: Fixture) {
	await page.upload(fileURLToPath(new URL(`./fixtures/${fixture.file}`, import.meta.url)));
	await waitUntilReady(page, fixture);
}

async function waitUntilReady(page: FramePage, fixture: Fixture) {
	if (page.batch) return page.batch('ready', fixture);
	// Do not allocate/read a video canvas while an unparsed file's startup
	// playback probe is running; readiness itself needs no pixel allocation.
	await waitFor(
		() =>
			page.evaluate(() => {
				const video = document.querySelector('video');
				const fps = document.querySelector('.time-fps')?.textContent ?? '';
				return Boolean(
					video &&
					video.readyState >= 2 &&
					video.paused &&
					!video.seeking &&
					fps.includes('fps') &&
					!fps.includes('Detecting')
				);
			}, undefined),
		Boolean,
		'Frame rate must be known and the playback probe finished'
	);
	await home(page);
	await expectFrame(page, fixture, 0);
}

export async function walkEveryFrame(page: FramePage, fixture: Fixture) {
	if (page.batch) return page.batch('walk', fixture);
	assert.equal((await readFrame(page)).previousDisabled, true);
	await page.press(',');
	await expectFrame(page, fixture, 0);
	for (let k = 1; k < fixture.ids.length; k++) {
		if (k % 2) await page.click(next);
		else await page.press(k % 4 ? '.' : 'Shift+ArrowRight');
		await expectFrame(page, fixture, k);
	}
	assert.equal((await readFrame(page)).nextDisabled, true);
	await page.press('.');
	await expectFrame(page, fixture, fixture.ids.length - 1);
	for (let k = fixture.ids.length - 2; k >= 0; k--) {
		if (k % 2) await page.click(previous);
		else await page.press(k % 4 ? ',' : 'Shift+ArrowLeft');
		await expectFrame(page, fixture, k);
	}
	assert.equal((await readFrame(page)).previousDisabled, true);
}

export async function rapidAndHold(page: FramePage, fixture: Fixture) {
	// A focused timeline must let Shift-arrows step exactly once as they bubble.
	await page.focus(timeline);
	await page.press('Shift+ArrowRight');
	await expectFrame(page, fixture, 1);
	await page.press('Shift+ArrowLeft');
	await expectFrame(page, fixture, 0);
	await page.evaluate(() => (document.activeElement as HTMLElement)?.blur(), undefined);
	// Safari's native keyboard backend can emit these legacy arrow characters.
	for (const [key, index] of [
		['\u001d', 1],
		['\u001c', 0]
	] as const) {
		await page.evaluate((key) => {
			window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: true, bubbles: true }));
		}, key);
		await expectFrame(page, fixture, index);
	}
	// One JS turn: later inputs arrive while the first seek is still decoding.
	await page.evaluate(() => {
		for (const [key, count] of [
			['.', 12],
			[',', 5]
		] as const) {
			for (let k = 0; k < count; k++) {
				window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: k > 0, bubbles: true }));
			}
		}
	}, undefined);
	await expectFrame(page, fixture, 7);
	await page.evaluate(() => {
		document.addEventListener(
			'pointerup',
			() => {
				(window as typeof window & { __holdReleaseTime: number }).__holdReleaseTime = Number(
					document.querySelector('[aria-label="Video timeline"]')!.getAttribute('aria-valuenow')
				);
			},
			{ capture: true, once: true }
		);
	}, undefined);
	await page.down(next);
	try {
		await waitFor(
			() => readFrame(page),
			(s) => s.id >= fixture.ids[10],
			'Hold repeats forward'
		);
	} finally {
		await page.up();
	}
	const releaseTime = await page.evaluate(
		() => (window as typeof window & { __holdReleaseTime: number }).__holdReleaseTime,
		undefined
	);
	assert.ok(Number.isFinite(releaseTime), 'Pointer release must be observed');
	const releaseIndex = fixture.times.findLastIndex((time) => time <= releaseTime + 2e-6);
	const released = await expectFrame(page, fixture, releaseIndex);
	await pause(250);
	const stopped = await readFrame(page);
	assert.equal(stopped.id, released.id, 'Releasing a hold must stop repetition');
	assert.ok(stopped.id > fixture.ids[7]);
	await expectFrame(page, fixture, fixture.ids.indexOf(stopped.id));
	await home(page);
	await expectFrame(page, fixture, 0);
}

export async function pauseThenStep(page: FramePage, fixture: Fixture) {
	await page.click('[aria-label="Play"]');
	await waitFor(
		() => readFrame(page),
		(s) => !s.paused && s.id >= fixture.ids[3],
		'Playback advances'
	);
	await page.click('[aria-label="Pause"]');
	// A decoder may present one more picture after pause; use the picture that settles.
	await pause(350);
	const paused = await readFrame(page);
	const index = fixture.ids.indexOf(paused.id);
	assert.ok(index > 0, 'Paused picture must be an identifiable frame');
	await page.click(previous);
	await expectFrame(page, fixture, index - 1);
	await page.click(next);
	await expectFrame(page, fixture, index);
}

export async function markAndReturn(page: FramePage, fixture: Fixture) {
	await home(page);
	for (let k = 0; k < 4; k++) await page.press('.');
	await expectFrame(page, fixture, 4);
	await page.press('t');
	const pin = '[aria-label="Go to takeoff"]';
	await waitFor(
		() => page.evaluate((selector) => !!document.querySelector(selector), pin),
		Boolean,
		'A mark must be created'
	);
	for (let k = 0; k < 5; k++) await page.press('.');
	await expectFrame(page, fixture, 9);
	// Pins use the band's pointer hit testing; activate the accessible button.
	await page.focus(pin);
	await page.press('Enter');
	await expectFrame(page, fixture, 4);
}

export async function interact(page: FramePage, fixture: Fixture) {
	if (page.batch) return page.batch('interaction', fixture);
	await rapidAndHold(page, fixture);
	await pauseThenStep(page, fixture);
	await markAndReturn(page, fixture);
}

// This factory has no external references, so WebDriver can run it in iOS's page.
// DOM input avoids the native pointer-actions bug; all picture checks stay shared.
function createDOMFramePage(): FramePage {
	let held: HTMLElement | null = null;
	return {
		engine: 'webkit',
		goto: async () => {
			throw new Error('Navigation belongs outside a browser batch');
		},
		upload: async () => {
			throw new Error('Upload belongs outside a browser batch');
		},
		evaluate: async <R, A>(fn: (arg: A) => R, arg: A): Promise<R> => fn(arg),
		click: async (selector) => {
			document.querySelector<HTMLElement>(selector)!.click();
		},
		focus: async (selector) => {
			document.querySelector<HTMLElement>(selector)!.focus();
		},
		press: async (shortcut) => {
			const target = document.activeElement as HTMLElement;
			if (shortcut === 'Enter') {
				target.click();
				return;
			}
			target.dispatchEvent(
				new KeyboardEvent('keydown', {
					key: shortcut.replace('Shift+', ''),
					shiftKey: shortcut.startsWith('Shift+'),
					bubbles: true,
					cancelable: true
				})
			);
		},
		down: async (selector) => {
			held = document.querySelector<HTMLElement>(selector)!;
			held.dispatchEvent(
				new PointerEvent('pointerdown', {
					bubbles: true,
					button: 0,
					pointerType: 'touch',
					pointerId: 1,
					isPrimary: true
				})
			);
		},
		up: async () => {
			if (!held) throw new Error('No held frame button');
			held.dispatchEvent(
				new PointerEvent('pointerup', {
					bubbles: true,
					button: 0,
					pointerType: 'touch',
					pointerId: 1,
					isPrimary: true
				})
			);
			held.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
			held = null;
		}
	};
}

/** The identical oracle and scenarios, with polling beside the native decoder. */
export function browserContractScript(): string {
	const helpers = {
		waitFor,
		readFrame,
		expectFrame,
		home,
		waitUntilReady,
		walkEveryFrame,
		rapidAndHold,
		pauseThenStep,
		markAndReturn,
		interact
	};
	return `
		const assert = (${createAssertions.toString()})();
		const previous = ${JSON.stringify(previous)};
		const next = ${JSON.stringify(next)};
		const timeline = ${JSON.stringify(timeline)};
		const pause = ${pause.toString()};
		${Object.entries(helpers)
			.map(([name, fn]) => `const ${name} = ${fn.toString()};`)
			.join('\n')}
		const page = (${createDOMFramePage.toString()})();
		const [operation, fixture, done] = arguments;
		const run = async () => {
			if (operation === 'ready') await waitUntilReady(page, fixture);
			else if (operation === 'walk') await walkEveryFrame(page, fixture);
			else if (operation === 'interaction') await interact(page, fixture);
			else if (operation === 'next') { await page.press('.'); await expectFrame(page, fixture, 1); }
			else throw new Error('Unknown browser contract operation: ' + operation);
		};
		run().then(() => done({ ok: true }), error => done({ ok: false, error: String(error.message || error) + '\\n' + String(error.stack || '') }));
	`;
}
