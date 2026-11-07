// Shipping Safari, not Playwright WebKit. Run on a dedicated macOS CI runner:
// sudo safaridriver --enable && bun run test:frames:safari
import { Builder, By, Key, type WebDriver } from 'selenium-webdriver';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import {
	fixtures,
	load,
	walkEveryFrame,
	rapidAndHold,
	pauseThenStep,
	markAndReturn,
	replace,
	expectFrame,
	type FramePage
} from './contract';

const baseURL = process.env.FRAME_TEST_URL ?? 'http://localhost:4173';
const ios = process.env.FRAME_SAFARI_PLATFORM === 'ios';
const udid = process.env.FRAME_IOS_SIMULATOR_UDID;
if (ios && !udid) throw new Error('Native iOS tests require an explicit simulator UDID');
const output = ios ? 'test-results/safari-ios' : 'test-results/safari';
mkdirSync(output, { recursive: true });

function adapter(driver: WebDriver): FramePage {
	return {
		engine: 'webkit',
		goto: async (path, expectedPath = path) => {
			await driver.get(new URL(path, baseURL).href);
			const expected = new URL(expectedPath, baseURL).href;
			await driver.wait(
				async () => (await driver.getCurrentUrl()) === expected,
				15_000,
				'Entry redirect must finish'
			);
		},
		evaluate: async <R, A>(fn: (arg: A) => R, arg: A): Promise<R> =>
			driver.executeScript(`return (${fn.toString()})(arguments[0]);`, arg ?? null),
		click: async (selector) => {
			if (ios) {
				// iOS 26/27 pointer actions can wedge the remote automation channel:
				// https://bugs.webkit.org/show_bug.cgi?id=322937
				// Exercise the real button handler; never mutate player/seek state.
				await driver.executeScript('document.querySelector(arguments[0]).click()', selector);
				return;
			}
			await driver.findElement(By.css(selector)).click();
		},
		focus: async (selector) => {
			await driver.executeScript('document.querySelector(arguments[0]).focus()', selector);
		},
		press: async (key) => {
			// Mobile Safari has no hardware keyboard in CI. Exercise the same key
			// handlers with DOM events; DOM activation exercises the buttons.
			if (ios) {
				await driver.executeScript(
					`
					const shortcut = arguments[0];
					const target = document.activeElement || document.body;
					if (shortcut === 'Enter') { target.click(); return; }
					const key = shortcut.replace('Shift+', '');
					target.dispatchEvent(new KeyboardEvent('keydown', {
						key, shiftKey: shortcut.startsWith('Shift+'), bubbles: true, cancelable: true
					}));
				`,
					key
				);
				return;
			}
			if (key.startsWith('Shift+Arrow')) {
				await driver
					.actions({ async: true })
					.keyDown(Key.SHIFT)
					.sendKeys(key.endsWith('Right') ? Key.ARROW_RIGHT : Key.ARROW_LEFT)
					.keyUp(Key.SHIFT)
					.perform();
				return;
			}
			const keys: Record<string, string> = {
				Home: Key.HOME,
				Enter: Key.ENTER
			};
			await driver
				.switchTo()
				.activeElement()
				.then((element) => element.sendKeys(keys[key] ?? key));
		},
		down: async (selector) => {
			if (ios) {
				// Exercise sustained touch handlers and the release click explicitly.
				// This tests app repetition; OS gesture delivery needs device UI tests.
				await driver.executeScript(
					`
					const target = document.querySelector(arguments[0]);
					window.__heldFrameButton = target;
					target.dispatchEvent(new PointerEvent('pointerdown', {
						bubbles: true, button: 0, pointerType: 'touch', pointerId: 1, isPrimary: true
					}));
				`,
					selector
				);
				return;
			}
			const target = await driver.findElement(By.css(selector));
			await driver.actions({ async: true }).move({ origin: target }).press().perform();
		},
		up: async () => {
			if (ios) {
				await driver.executeScript(`
					const target = window.__heldFrameButton;
					target.dispatchEvent(new PointerEvent('pointerup', {
						bubbles: true, button: 0, pointerType: 'touch', pointerId: 1, isPrimary: true
					}));
					target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
					delete window.__heldFrameButton;
				`);
				return;
			}
			await driver.actions({ async: true }).release().perform();
		},
		upload: async (path) => {
			// SafariDriver's path upload can expose the filename without readable
			// sandboxed bytes. The Mac path also does not exist inside iOS. Transfer
			// the fixture through the real input handler; decoding stays in Safari.
			await driver.executeScript(
				`
				const bytes = Uint8Array.from(atob(arguments[0]), c => c.charCodeAt(0));
				const transfer = new DataTransfer();
				transfer.items.add(new File([bytes], arguments[1], { type: arguments[2] }));
				const input = document.getElementById('video-file-input');
				input.files = transfer.files;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			`,
				readFileSync(path).toString('base64'),
				basename(path),
				path.endsWith('.webm') ? 'video/webm' : 'video/mp4'
			);
		}
	};
}

// Start a fresh session per case: marks, queued seeks and decoder state cannot leak.
async function run(name: string, scenario: (page: FramePage) => Promise<void>) {
	const driver = await new Builder()
		.withCapabilities({
			unhandledPromptBehavior: 'accept',
			pageLoadStrategy: 'eager',
			'safari:diagnose': true,
			...(ios
				? {
						platformName: 'iOS',
						'safari:useSimulator': true,
						'safari:deviceUDID': udid,
						'webkit:alwaysAllowAutoplay': true
					}
				: {})
		})
		.forBrowser('safari')
		.build();
	try {
		await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 15_000 });
		if (!ios) await driver.manage().window().setRect({ width: 1400, height: 1000 });
		const capabilities = await driver.getCapabilities();
		assert.match(String(capabilities.get('platformName')), ios ? /^ios$/i : /^mac(?:os)?$/i);
		writeFileSync(
			`${output}/capabilities.json`,
			JSON.stringify(
				Object.fromEntries([...capabilities.keys()].map((key) => [key, capabilities.get(key)])),
				null,
				2
			)
		);
		console.log(
			`Safari ${capabilities.get('browserVersion')} on ${capabilities.get('platformName')}`
		);
		await scenario(adapter(driver));
		console.log(`PASS ${name}`);
	} catch (error) {
		writeFileSync(`${output}/${name}.png`, await driver.takeScreenshot(), 'base64');
		writeFileSync(`${output}/${name}.txt`, String(error));
		const events = await driver.executeScript(`
			const video = document.querySelector('video');
			return {
				events: window.__frameLog || [],
				media: video && {
					readyState: video.readyState, networkState: video.networkState,
					error: video.error && { code: video.error.code, message: video.error.message },
					src: video.currentSrc
				}
			};
		`);
		writeFileSync(`${output}/${name}-events.json`, JSON.stringify(events, null, 2));
		throw error;
	} finally {
		await driver.quit();
	}
}

for (const route of ['/', '/alpha']) {
	const name = route === '/' ? 'player' : 'legacy-link';
	await run(`${name}-no-preview-cache`, async (page) => {
		await load(page, route, fixtures[3], false);
		await walkEveryFrame(page, fixtures[3]);
	});
	for (const fixture of fixtures) {
		await run(`${name}-${fixture.file}`, async (page) => {
			await load(page, route, fixture);
			await walkEveryFrame(page, fixture);
		});
	}
	await run(`${name}-interaction`, async (page) => {
		const fixture = fixtures[0];
		await load(page, route, fixture);
		await rapidAndHold(page, fixture);
		await pauseThenStep(page, fixture);
		await markAndReturn(page, fixture);
		await replace(page, fixtures[3]);
		await page.press('.');
		await expectFrame(page, fixtures[3], 1);
	});
}
