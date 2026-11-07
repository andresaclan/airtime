// Shipping Safari, not Playwright WebKit. Run on a dedicated macOS CI runner:
// sudo safaridriver --enable && bun run test:frames:safari
import { Builder, By, Key, type WebDriver } from 'selenium-webdriver';
import { mkdirSync, writeFileSync } from 'node:fs';
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
const output = 'test-results/safari';
mkdirSync(output, { recursive: true });

function adapter(driver: WebDriver): FramePage {
	return {
		engine: 'webkit',
		goto: async (path) => {
			await driver.get(new URL(path, baseURL).href);
		},
		evaluate: async <R, A>(fn: (arg: A) => R, arg: A): Promise<R> =>
			driver.executeScript(`return (${fn.toString()})(arguments[0]);`, arg ?? null),
		click: async (selector) => {
			await driver.findElement(By.css(selector)).click();
		},
		focus: async (selector) => {
			await driver.executeScript('document.querySelector(arguments[0]).focus()', selector);
		},
		press: async (key) => {
			const keys: Record<string, string> = {
				Home: Key.HOME,
				Enter: Key.ENTER,
				'Shift+ArrowRight': Key.chord(Key.SHIFT, Key.ARROW_RIGHT),
				'Shift+ArrowLeft': Key.chord(Key.SHIFT, Key.ARROW_LEFT)
			};
			await driver
				.switchTo()
				.activeElement()
				.then((element) => element.sendKeys(keys[key] ?? key));
		},
		down: async (selector) => {
			const target = await driver.findElement(By.css(selector));
			await driver.actions({ async: true }).move({ origin: target }).press().perform();
		},
		up: async () => {
			await driver.actions({ async: true }).release().perform();
		},
		upload: async (path) => {
			await driver.findElement(By.id('video-file-input')).sendKeys(path);
			// SafariDriver can populate FileList without dispatching change.
			// A handled change clears the input, so this never loads a file twice.
			await driver.executeScript(`
				const input = document.getElementById('video-file-input');
				if (input.files.length) input.dispatchEvent(new Event('change', { bubbles: true }));
			`);
		}
	};
}

// Start a fresh session per case: marks, queued seeks and decoder state cannot leak.
async function run(name: string, scenario: (page: FramePage) => Promise<void>) {
	const driver = await new Builder()
		.withCapabilities({ unhandledPromptBehavior: 'accept' })
		.forBrowser('safari')
		.build();
	try {
		await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 15_000 });
		await driver.manage().window().setRect({ width: 1400, height: 1000 });
		const capabilities = await driver.getCapabilities();
		console.log(
			`Safari ${capabilities.get('browserVersion')} on ${capabilities.get('platformName')}`
		);
		await scenario(adapter(driver));
		console.log(`PASS ${name}`);
	} catch (error) {
		writeFileSync(`${output}/${name}.png`, await driver.takeScreenshot(), 'base64');
		writeFileSync(`${output}/${name}.txt`, String(error));
		throw error;
	} finally {
		await driver.quit();
	}
}

for (const route of ['/', '/alpha']) {
	const name = route === '/' ? 'timer' : 'alpha';
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
		await markAndReturn(page, fixture, route);
		await replace(page, fixtures[3]);
		await page.press('.');
		await expectFrame(page, fixtures[3], 1);
	});
}
