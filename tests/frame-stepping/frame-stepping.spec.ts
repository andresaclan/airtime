import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import {
	fixtures,
	load,
	markAndReturn,
	pauseThenStep,
	rapidAndHold,
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
				headless: true
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
				goto: async (path) => {
					await page.goto(new URL(path, info.project.use.baseURL).href);
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
					writeFileSync(path, JSON.stringify(log, null, 2));
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
		await rapidAndHold(framePage, fixture);
		await pauseThenStep(framePage, fixture);
		await markAndReturn(framePage, fixture, route);
		// Replacing a marked file must discard its old frame/seek/cache state.
		await replace(framePage, fixtures[3]);
		await framePage.press('.');
		await expectFrame(framePage, fixtures[3], 1);
	});
}
