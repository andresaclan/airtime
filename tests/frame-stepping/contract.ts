import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import manifest from './fixtures/manifest.json' with { type: 'json' };

// The same contract runs through Playwright and shipping Safari's WebDriver.
// No imports from Airtime: expected frames come from ffmpeg, not app calculations.
export interface FramePage {
	engine: 'webkit' | 'chromium';
	goto(path: string): Promise<void>;
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
	assert.fail(`${label}: ${JSON.stringify(value)}`);
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
	await waitFor(
		() => readFrame(page),
		(s) =>
			s.id >= 0 && s.fps.includes('fps') && !s.fps.includes('Detecting') && s.paused && !s.seeking,
		'Frame rate must be known and the playback probe finished'
	);
	await home(page);
	await expectFrame(page, fixture, 0);
}

export async function walkEveryFrame(page: FramePage, fixture: Fixture) {
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
