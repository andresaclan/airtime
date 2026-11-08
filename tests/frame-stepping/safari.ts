// Shipping Safari, not Playwright WebKit. Run on a dedicated macOS CI runner:
// sudo safaridriver --enable && bun run test:frames:safari
import { Builder, By, Key, type WebDriver } from 'selenium-webdriver';
import { ServiceBuilder } from 'selenium-webdriver/safari';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	fixtures,
	browserContractScript,
	load,
	walkEveryFrame,
	interact,
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

// Shipping Safari's WebM renderer can deadlock on CI: its process stacks show the
// renderer blocked on an internal WebKit lock while the compositor queries the
// video layer size. No app change avoids it. Phones record MOV/MP4, and the WebM
// playback-probe path stays covered by Chrome, Chromium and Playwright WebKit.
const nativeFixtures = fixtures.filter((fixture) => !fixture.file.endsWith('.webm'));

type SafariSession = { driver: WebDriver; service: ReturnType<ServiceBuilder['build']> };
let iosSession: SafariSession | undefined;

// Dedicated CI only: capture native stacks while the stalled processes still
// exist. WebDriver cannot retrieve page diagnostics from a blocked WebProcess.
async function captureStacks(name: string) {
	if (process.env.CI !== 'true') return;
	const exec = promisify(execFile);
	try {
		const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,comm='], { timeout: 3000 });
		const processes = stdout
			.split('\n')
			.filter((line) => /Safari\.app\/|com\.apple\.WebKit\.(WebContent|GPU|Networking)/.test(line));
		writeFileSync(`${output}/${name}-processes.txt`, processes.join('\n'));
		await Promise.allSettled(
			processes.map((line) => {
				const pid = line.trim().split(/\s+/)[0];
				return exec('/usr/bin/sample', [pid, '2', '-file', `${output}/${name}-${pid}-sample.txt`], {
					timeout: 8000
				}).catch((error) => {
					writeFileSync(`${output}/${name}-${pid}-sample-error.txt`, String(error));
				});
			})
		);
	} catch (error) {
		console.error('Native stack capture:', String(error));
	}
}

function adapter(driver: WebDriver, stage: (label: string) => void): FramePage {
	return {
		engine: 'webkit',
		...(ios
			? {
					batch: async (
						operation: 'ready' | 'walk' | 'interaction' | 'next',
						fixture: (typeof fixtures)[number]
					) => {
						stage(`browser batch ${operation}: ${fixture.file}`);
						const result = await driver.executeAsyncScript<{ ok: boolean; error?: string }>(
							browserContractScript(),
							operation,
							fixture
						);
						assert.ok(
							result?.ok === true,
							result?.error ?? 'Native browser contract did not complete'
						);
					}
				}
			: {}),
		goto: async (path, expectedPath = path) => {
			stage(`navigate ${path}`);
			console.log(`  navigate ${path}`);
			if (ios) {
				// Tear down the old document/decoder while retaining the native session.
				// Recreating iOS sessions can race Safari's RWI application handoff.
				await driver.get('about:blank');
			}
			await driver.get(new URL(path, baseURL).href);
			const expected = new URL(expectedPath, baseURL).href;
			await driver.wait(
				async () => (await driver.getCurrentUrl()) === expected,
				15_000,
				'Entry redirect must finish'
			);
		},
		evaluate: async <R, A>(fn: (arg: A) => R, arg: A): Promise<R> => {
			stage(`evaluate ${fn.toString().slice(0, 120)}`);
			return driver.executeScript(`return (${fn.toString()})(arguments[0]);`, arg ?? null);
		},
		click: async (selector) => {
			stage(`click ${selector}`);
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
			stage(`focus ${selector}`);
			await driver.executeScript('document.querySelector(arguments[0]).focus()', selector);
		},
		press: async (key) => {
			stage(`press ${key}`);
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
			stage(`down ${selector}`);
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
			stage('release hold');
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
			stage(`upload ${basename(path)}`);
			console.log(`  upload ${basename(path)}`);
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

// Own the service explicitly so a wedged WebKit command can be terminated.
// WebDriver's script/page timeouts cannot interrupt an unresponsive IPC channel.
async function run(name: string, scenario: (page: FramePage) => Promise<void>) {
	const service = iosSession?.service ?? new ServiceBuilder('/usr/bin/safaridriver').build();
	let driver: WebDriver | undefined = iosSession?.driver;
	let activeStage = 'start SafariDriver';
	let timeoutError: Error | undefined;
	let failure: unknown;
	let diagnostics: Promise<unknown> | undefined;
	const limit = ios ? 240_000 : 120_000;
	console.log(`START ${name}`);
	const watchdog = setTimeout(() => {
		timeoutError = new Error(`${name} exceeded ${limit / 1000}s during ${activeStage}`);
		writeFileSync(`${output}/${name}-timeout.txt`, timeoutError.message);
		console.error(timeoutError.message);
		// Only this case's driver process. Killing it also rejects stalled HTTP calls.
		diagnostics = captureStacks(name)
			.finally(() => service.kill())
			.catch((error) => console.error('Driver cleanup failed:', error));
	}, limit);
	try {
		if (!driver) {
			const url = await service.start();
			activeStage = 'create Safari session';
			driver = await new Builder()
				.usingServer(url)
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
			if (ios) iosSession = { driver, service };
		}
		activeStage = 'configure Safari session';
		await driver
			.manage()
			.setTimeouts({ implicit: 0, pageLoad: 30_000, script: ios ? 120_000 : 15_000 });
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
		await scenario(
			adapter(driver, (label) => {
				activeStage = label;
			})
		);
	} catch (error) {
		failure = timeoutError ?? error;
		writeFileSync(`${output}/${name}.txt`, String(failure));
		if (driver && !timeoutError) {
			try {
				activeStage = 'capture failure artifacts';
				writeFileSync(`${output}/${name}.png`, await driver.takeScreenshot(), 'base64');
				const events = await driver.executeScript(`
					const video = document.querySelector('video');
					return {
						events: window.__frameLog || [],
						media: video && { readyState: video.readyState, networkState: video.networkState,
							error: video.error && { code: video.error.code, message: video.error.message }, src: video.currentSrc }
					};
				`);
				writeFileSync(`${output}/${name}-events.json`, JSON.stringify(events, null, 2));
			} catch (captureError) {
				console.error('Failure artifact capture:', String(captureError));
			}
		}
	} finally {
		await diagnostics;
		if (!ios || failure || timeoutError) {
			try {
				if (driver && !timeoutError) {
					activeStage = 'quit Safari session';
					await driver.quit();
				}
			} catch (error) {
				failure ??= timeoutError ?? error;
			}
			await service.kill();
			if (ios) iosSession = undefined;
		}
		clearTimeout(watchdog);
	}
	if (timeoutError || failure) throw timeoutError ?? failure;
	console.log(`PASS ${name}`);
}

try {
	for (const route of ['/', '/alpha']) {
		const name = route === '/' ? 'player' : 'legacy-link';
		await run(`${name}-no-preview-cache`, async (page) => {
			await load(page, route, fixtures[3], false);
			await walkEveryFrame(page, fixtures[3]);
		});
		for (const fixture of nativeFixtures) {
			await run(`${name}-${fixture.file}`, async (page) => {
				await load(page, route, fixture);
				await walkEveryFrame(page, fixture);
			});
		}
		await run(`${name}-interaction`, async (page) => {
			const fixture = fixtures[0];
			await load(page, route, fixture);
			await interact(page, fixture);
			await replace(page, fixtures[3]);
			if (page.batch) await page.batch('next', fixtures[3]);
			else {
				await page.press('.');
				await expectFrame(page, fixtures[3], 1);
			}
		});
	}
} finally {
	if (iosSession) {
		const { driver, service } = iosSession;
		const alarm = setTimeout(() => {
			void service.kill();
		}, 15_000);
		try {
			await driver.quit();
		} finally {
			await service.kill();
			clearTimeout(alarm);
			iosSession = undefined;
		}
	}
}
