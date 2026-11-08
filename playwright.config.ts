import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/frame-stepping',
	testMatch: '**/*.spec.ts',
	fullyParallel: false,
	workers: 1,
	// A flaky result is a regression to investigate, not a green rerun.
	retries: 0,
	forbidOnly: !!process.env.CI,
	timeout: 120_000,
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		actionTimeout: 15_000,
		baseURL: process.env.FRAME_TEST_URL ?? 'http://localhost:4173',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { browserName: 'chromium' } },
		{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
		{ name: 'webkit', use: { browserName: 'webkit' } },
		{
			name: 'webkit-iphone',
			use: { ...devices['iPhone 13'], browserName: 'webkit' }
		}
	],
	// Use the production build. Fixtures and test helpers are never shipped in it.
	webServer: process.env.FRAME_TEST_URL
		? undefined
		: {
				command: 'bun run preview -- --port 4173 --strictPort',
				url: 'http://localhost:4173',
				reuseExistingServer: false
			}
});
