// Runs the decoded-frame contract inside native iOS Safari, without SafariDriver.
// tests/frame-stepping/ios.ts serves this page, opens it in an iOS Simulator, and
// collects what it posts back. The app runs in a same-origin iframe, so the page
// can drive it like the WebDriver runner does: the same contract functions, the
// same browser-side batch, and fixture bytes through the app's real file input.
import {
	browserContractScript,
	fixtures,
	interact,
	load,
	replace,
	walkEveryFrame,
	type Fixture,
	type FramePage
} from './contract';

type AppWindow = Window & typeof globalThis;
const frame = document.querySelector<HTMLIFrameElement>('#app')!;
const app = () => frame.contentWindow as AppWindow;
const CASE_MS = 240_000;

// Identifies this load, so the runner can ignore one that Safari has replaced.
const run = crypto.randomUUID();
const post = (path: string, body: object) =>
	fetch(path, { method: 'POST', body: JSON.stringify({ ...body, run }) }).catch(() => {});

function navigate(path: string) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Loading ${path} timed out`)), 30_000);
		frame.addEventListener(
			'load',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{ once: true }
		);
		frame.src = path;
	});
}

/** The app's own realm, so `document`, `window` and prototypes are the iframe's. */
function inApp<R, A>(fn: (arg: A) => R, arg: A): R {
	return new (app().Function)(`return (${fn.toString()})`)()(arg);
}

const page: FramePage = {
	engine: 'webkit',
	async goto(path, expectedPath = path) {
		// A blank document first tears down the old player and decoder, as the
		// WebDriver runner does between cases.
		await navigate('about:blank');
		await navigate(path);
		// The app asks before discarding unsaved marks; accept, as the WebDriver
		// runners do (unhandledPromptBehavior: accept).
		app().confirm = () => true;
		app().alert = () => {};
		const landed = app().location.pathname;
		if (landed !== expectedPath) throw new Error(`Expected ${expectedPath}, landed on ${landed}`);
	},
	evaluate: async (fn, arg) => inApp(fn, arg),
	async upload(path) {
		const name = path.split('/').pop()!;
		const bytes = await (await fetch(`/__fixtures/${name}`)).arrayBuffer();
		const win = app();
		const transfer = new win.DataTransfer();
		const type = name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4';
		transfer.items.add(new win.File([bytes], name, { type }));
		const input = win.document.getElementById('video-file-input') as HTMLInputElement;
		input.files = transfer.files;
		input.dispatchEvent(new win.Event('change', { bubbles: true }));
	},
	async batch(operation, fixture) {
		// iOS only plays a video without a real tap while it's muted; the batch's
		// play button is a DOM click. The picture checks don't depend on sound.
		inApp(() => {
			const video = document.querySelector('video');
			if (video) video.muted = true;
		}, undefined);
		const result = await new Promise<{ ok: boolean; error?: string }>((done) =>
			new (app().Function)(browserContractScript())(operation, fixture, done)
		);
		if (!result.ok) throw new Error(result.error ?? 'Browser contract did not complete');
	},
	click: async () => {
		throw new Error('The iOS page drives controls through the browser batch');
	},
	focus: async () => {
		throw new Error('The iOS page drives controls through the browser batch');
	},
	press: async () => {
		throw new Error('The iOS page drives controls through the browser batch');
	},
	down: async () => {
		throw new Error('The iOS page drives controls through the browser batch');
	},
	up: async () => {
		throw new Error('The iOS page drives controls through the browser batch');
	}
};

// The same cases, in the same order, as the native iOS run in safari.ts.
const cases: [string, () => Promise<void>][] = [
	[
		'player-no-preview-cache',
		async () => {
			await load(page, '/', fixtures[3], false);
			await walkEveryFrame(page, fixtures[3]);
		}
	],
	...fixtures.map((fixture: Fixture): [string, () => Promise<void>] => [
		`player-${fixture.file}`,
		async () => {
			await load(page, '/', fixture);
			await walkEveryFrame(page, fixture);
		}
	]),
	[
		'player-interaction',
		async () => {
			await load(page, '/', fixtures[0]);
			await interact(page, fixtures[0]);
			await replace(page, fixtures[3]);
			await page.batch!('next', fixtures[3]);
		}
	]
];

(async () => {
	const ua = navigator.userAgent;
	await post('/__start', { ua, cases: cases.map(([name]) => name) });
	for (const [name, run] of cases) {
		const started = performance.now();
		let error: string | null = null;
		try {
			await Promise.race([
				run(),
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error(`Case exceeded ${CASE_MS / 1000} s`)), CASE_MS)
				)
			]);
		} catch (failure) {
			error =
				failure instanceof Error ? `${failure.message}\n${failure.stack ?? ''}` : String(failure);
		}
		await post('/__case', {
			name,
			ok: error === null,
			error,
			ms: Math.round(performance.now() - started)
		});
	}
	await post('/__done', {});
})();
