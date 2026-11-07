// Runs the scrub bench suite in a background Chrome window on macOS (background-chrome.mjs).
//   node scripts/scrub-bench/run-chrome.mjs <port> <label> [route]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const { chromium } = createRequire(repo)('playwright-core');
const { launchBackground } = await import(repo + 'scripts/background-chrome.mjs');
const [port, label, route = '/'] = process.argv.slice(2);
const { page, close } = await launchBackground(chromium);
try {
	await page.goto(`http://localhost:${port}${route}?bench=1&suite=0&label=${label}`);
	await page.waitForFunction(() => document.title === 'BENCH DONE', null, { timeout: 900_000 });
} finally {
	await close();
}
