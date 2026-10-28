// Headed Chrome for browser checks that never takes focus from the user.
//
// Chrome activates itself when its first window opens, even under `open -g`, so it
// starts with no window and each window is created over CDP with `background: true`.
// The throttling flags keep rAF and requestVideoFrameCallback at full rate while
// the window sits behind other apps.
//
// macOS only. Pass playwright-core's `chromium`, which isn't a repo dependency:
//
//   const { chromium } = createRequire('/tmp/airtime-limits-pw/')('playwright-core');
//   const { page, close } = await launchBackground(chromium);
//
// Don't call page.bringToFront() or context.newPage(); both bring Chrome to the
// front. Use newBackgroundPage() for another window.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchBackground(chromium, { width = 1400, height = 900 } = {}) {
	const port = 9300 + Math.floor(Math.random() * 600);
	const profile = mkdtempSync(join(tmpdir(), 'airtime-chrome-'));
	spawnSync('open', [
		'-g',
		'-n',
		'-a',
		'Google Chrome',
		'--args',
		`--remote-debugging-port=${port}`,
		`--user-data-dir=${profile}`,
		'--no-startup-window',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-background-timer-throttling',
		'--disable-renderer-backgrounding',
		'--disable-backgrounding-occluded-windows',
		'--autoplay-policy=no-user-gesture-required'
	]);

	let browser;
	for (let i = 0; i < 150 && !browser; i++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
		} catch {
			await sleep(100);
		}
	}
	if (!browser) throw new Error('Chrome did not start');
	const context = browser.contexts()[0];
	const cdp = await browser.newBrowserCDPSession();

	async function newBackgroundPage() {
		const known = new Set(context.pages());
		await cdp.send('Target.createTarget', {
			url: 'about:blank',
			newWindow: true,
			background: true,
			width,
			height
		});
		for (let i = 0; i < 100; i++) {
			const page = context.pages().find((p) => !known.has(p));
			if (page) {
				await page.setViewportSize({ width, height });
				return page;
			}
			await sleep(50);
		}
		throw new Error('Background window did not open');
	}

	const page = await newBackgroundPage();
	const close = () => cdp.send('Browser.close').catch(() => {});
	return { browser, context, page, newBackgroundPage, close };
}
