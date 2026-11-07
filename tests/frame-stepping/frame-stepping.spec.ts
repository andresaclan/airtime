import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
	fixtures,
	browserContractScript,
	load,
	interact,
	walkEveryFrame,
	replace,
	expectFrame,
	type FramePage
} from './contract';

// Fresh processes isolate decoder teardown between cases. Replacing a video in
// the same process is exercised explicitly by the interaction contract below.
const test = base.extend<{ framePage: FramePage }>({
	framePage: async ({ playwright, browserName }, use, info) => {
		let page: Page;
		let context: BrowserContext;
		let close: () => Promise<unknown>;
		if (process.env.FRAME_BACKGROUND_CHROME === '1') {
			if (info.project.name !== 'chrome')
				throw new Error('Background launcher requires --project=chrome');
			const { launchBackground } = await import('../../scripts/background-chrome.mjs');
			const session = await launchBackground(playwright.chromium);
			page = session.page;
			context = session.context;
			close = session.close;
		} else {
			const browser = await playwright[browserName].launch({
				channel: info.project.use.channel,
				headless: true,
				args:
					browserName === 'chromium'
						? [
								'--disable-background-timer-throttling',
								'--disable-renderer-backgrounding',
								'--disable-backgrounding-occluded-windows'
							]
						: []
			});
			close = () => browser.close();
			const { viewport, userAgent, hasTouch, isMobile, deviceScaleFactor } = info.project.use;
			context = await browser.newContext({
				viewport,
				userAgent,
				hasTouch,
				isMobile,
				deviceScaleFactor,
				recordVideo: { dir: info.outputPath('recordings') }
			});
			page = await context.newPage();
		}
		try {
			page.setDefaultTimeout(15_000);
			page.on('dialog', (dialog) => void dialog.accept());
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await use({
				engine: info.project.name.startsWith('webkit') ? 'webkit' : 'chromium',
				goto: async (path, expectedPath = path) => {
					await page.goto(new URL(path, info.project.use.baseURL).href, {
						waitUntil: 'domcontentloaded'
					});
					await page.waitForURL(new URL(expectedPath, info.project.use.baseURL).href, {
						waitUntil: 'domcontentloaded'
					});
				},
				evaluate: <R, A>(fn: (arg: A) => R, arg: A) =>
					page.evaluate(fn as (arg: unknown) => R, arg),
				click: async (selector) => {
					if (info.project.use.hasTouch) await page.locator(selector).tap();
					else await page.locator(selector).click();
				},
				focus: (selector) => page.locator(selector).focus(),
				press: (key) => page.keyboard.press(key),
				down: async (selector) => {
					const box = await page.locator(selector).boundingBox();
					if (!box) throw new Error(`Missing hold target ${selector}`);
					await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
					await page.mouse.down();
				},
				up: () => page.mouse.up(),
				upload: (path) => page.locator('#video-file-input').setInputFiles(path)
			});
			if (errors.length) throw new Error(`Browser errors: ${errors.join('\n')}`);
		} finally {
			try {
				if (info.status !== info.expectedStatus) {
					const log = await page.evaluate(
						() => (window as typeof window & { __frameLog: unknown[] }).__frameLog
					);
					const path = info.outputPath('frame-events.json');
					writeFileSync(path, JSON.stringify(log ?? [], null, 2));
					await info.attach('frame-events', { path, contentType: 'application/json' });
					await page.screenshot({ path: info.outputPath('decoded-picture.png') });
				}
			} finally {
				const video = page.video();
				await close();
				if (video && info.status !== info.expectedStatus) {
					await info.attach('decoded-picture-video', {
						path: await video.path(),
						contentType: 'video/webm'
					});
				}
			}
		}
	}
});

for (const route of ['/', '/alpha']) {
	test(`${route}: stepping works without the WebCodecs preview cache`, async ({ framePage }) => {
		await load(framePage, route, fixtures[3], false);
		await walkEveryFrame(framePage, fixtures[3]);
	});

	for (const fixture of fixtures) {
		test(`${route}: visits every decoded frame forward and backward in ${fixture.file}`, async ({
			framePage
		}) => {
			await load(framePage, route, fixture);
			await walkEveryFrame(framePage, fixture);
		});
	}

	test(`${route}: rapid reversals, holds, pause and marks stay on the picture`, async ({
		framePage
	}) => {
		const fixture = fixtures[0];
		await load(framePage, route, fixture);
		await interact(framePage, fixture);
		// Replacing a marked file must discard its old frame/seek/cache state.
		await replace(framePage, fixtures[3]);
		await framePage.press('.');
		await expectFrame(framePage, fixtures[3], 1);
	});
}

// A busy/background compositor can present only 10 pictures per second. The
// source is still 30 fps: the probe must slow playback instead of adopting 10 fps.
test('unparsed video keeps every frame when playback callbacks are throttled', async ({
	framePage
}) => {
	const fixture = fixtures.find((fixture) => fixture.file === 'fallback.webm')!;
	await load(
		{
			...framePage,
			upload: async (path) => {
				await framePage.evaluate(() => {
					const request = HTMLVideoElement.prototype.requestVideoFrameCallback;
					const last = new WeakMap<VideoFrameRequestCallback, number>();
					HTMLVideoElement.prototype.requestVideoFrameCallback = function (callback) {
						const present: VideoFrameRequestCallback = (now, metadata) => {
							if (!this.paused && now - (last.get(callback) ?? -Infinity) < 90) {
								request.call(this, present);
								return;
							}
							last.set(callback, now);
							callback(now, metadata);
						};
						return request.call(this, present);
					};
				}, undefined);
				await framePage.upload(path);
			}
		},
		'/',
		fixture
	);
	const rate = await framePage.evaluate(
		() => document.querySelector('video')!.playbackRate,
		undefined
	);
	if (rate !== 1) throw new Error(`Playback probe left the user at ${rate} speed`);
	await walkEveryFrame(framePage, fixture);
});

// Exercise the exact serialized source used by native iOS, including rejection
// of a wrong barcode. This catches serializer/transport mistakes independently.
test('native iOS browser batch keeps the decoded-frame oracle strict', async ({ framePage }) => {
	const fixture = fixtures[3];
	await load(framePage, '/', fixture, false);
	await framePage.click('[aria-label="Mute"]');
	const batch = async (operation: string, expected: typeof fixture) =>
		framePage.evaluate(
			({ script, operation, fixture }) =>
				new Promise<{ ok: boolean; error?: string }>((resolve) => {
					new Function(script)(operation, fixture, resolve);
				}),
			{ script: browserContractScript(), operation, fixture: expected }
		);
	for (const operation of ['ready', 'walk', 'interaction']) {
		const result = await batch(operation, fixture);
		if (!result.ok) throw new Error(`${operation}: ${result.error}`);
	}
	const wrong = { ...fixture, ids: fixture.ids.map(() => 255) };
	const rejected = await batch('ready', wrong);
	if (rejected.ok || !rejected.error?.includes('expected decoded frame 0 (barcode 255)')) {
		throw new Error(
			`Browser batch must reject the wrong decoded picture: ${JSON.stringify(rejected)}`
		);
	}
});
