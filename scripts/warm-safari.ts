// Launch shipping Safari once through SafariDriver before the frame suite.
//
// Safari's first launch on a fresh macOS runner is cold: it took 5–23 s on passing
// CI runs, and SafariDriver gives up after about 30 s ("Finding or launching a
// compatible local Safari and waiting for its RWIApplication to appear"). Later
// sessions on the same machine take about 2 s. This opens one throwaway session,
// retrying only session creation, so tests/frame-stepping/safari.ts starts warm
// and stays strict: it retries nothing.
//
// `bun run test:frames:safari` runs this first. It needs a dedicated Mac with
// `sudo safaridriver --enable`: WebDriver opens Safari windows. The native iOS
// run (FRAME_SAFARI_PLATFORM=ios) drives the simulator, so it skips this.
import { Builder } from 'selenium-webdriver';
import { ServiceBuilder } from 'selenium-webdriver/safari';

const attempts = 3;

for (let attempt = 1; process.env.FRAME_SAFARI_PLATFORM !== 'ios'; attempt++) {
	const service = new ServiceBuilder('/usr/bin/safaridriver').build();
	const started = performance.now();
	const seconds = () => ((performance.now() - started) / 1000).toFixed(1);
	// SafariDriver times out on its own; this only bounds a driver that hangs instead.
	// Killing it rejects the pending session request.
	const alarm = setTimeout(() => void service.kill(), 90_000);
	try {
		const url = await service.start();
		const driver = await new Builder().usingServer(url).forBrowser('safari').build();
		const capabilities = await driver.getCapabilities();
		console.log(
			`Safari ${capabilities.get('browserVersion')} session ready in ${seconds()} s (attempt ${attempt})`
		);
		await driver.quit();
		break;
	} catch (error) {
		console.error(`Safari session attempt ${attempt} failed after ${seconds()} s: ${error}`);
		if (attempt >= attempts) throw error;
	} finally {
		clearTimeout(alarm);
		await service.kill();
	}
}
