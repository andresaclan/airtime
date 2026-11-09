import { describe, expect, test } from 'vitest';
import { expectFrame, fixtures, replace, type FramePage, type readFrame } from './contract';

type State = Awaited<ReturnType<typeof readFrame>>;
const fixture = fixtures.find((f) => f.file === 'cfr30.mp4')!;
// Frame 1 of cfr30.mp4, settled: paused, inside the frame, preview gone.
const settled: State = {
	id: 1,
	overlay: null,
	previewOffBy: null,
	time: 0.05,
	duration: 1.2,
	paused: true,
	seeking: false,
	fps: '30 fps',
	previousDisabled: false,
	nextDisabled: false
};

/** A page whose picture reads as `states` in turn, holding the last one. */
function scripted(states: Partial<State>[], extra: Partial<FramePage> = {}): FramePage {
	let read = 0;
	return {
		engine: 'chromium',
		goto: async () => {},
		evaluate: async () => ({ ...settled, ...states[Math.min(read++, states.length - 1)] }) as never,
		click: async () => {},
		focus: async () => {},
		press: async () => {},
		down: async () => {},
		up: async () => {},
		upload: async () => {},
		...extra
	};
}

describe('the decoded-frame oracle', () => {
	test('accepts a step whose preview hands over to the same native frame', async () => {
		const page = scripted([{ id: 0, overlay: 1 }, { id: 1, overlay: 1 }, {}]);
		await expect(expectFrame(page, fixture, 1)).resolves.toMatchObject({ id: 1 });
	});

	test('rejects a picture that flashes back after showing the target', async () => {
		// The preview shows frame 1, then hides before the video has painted it.
		const page = scripted([{ id: 0, overlay: 1 }, { id: 0, overlay: null }, {}]);
		await expect(expectFrame(page, fixture, 1)).rejects.toThrow(/was shown, then barcode 0/);
	});

	test('rejects a preview that does not cover exactly the picture', async () => {
		const page = scripted([{ id: 0, overlay: 1, previewOffBy: 84 }, {}]);
		await expect(expectFrame(page, fixture, 1)).rejects.toThrow(/84\.0 px off the picture/);
	});

	test('rejects playback while opening a file with container timing', async () => {
		let plays = 0;
		const page = scripted([], {
			// Readiness is the batch's job here; this checks only the playback count.
			batch: async () => {},
			evaluate: async () => plays as never,
			upload: async () => {
				plays += 1;
			}
		});
		await expect(replace(page, fixture)).rejects.toThrow(/must not start playback/);
	});
});
