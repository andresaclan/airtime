import { describe, expect, test } from 'vitest';
import {
	clearSeeks,
	isProbing,
	isWatching,
	registerSeekPreview,
	seek,
	seekPending,
	SEEK_EVENT,
	setProbing,
	targetTime
} from './seek';

/** Just enough of a video element: seeks land when `land()` is called. */
class FakeVideo extends EventTarget {
	seeking = false;
	/** Every time the playhead was moved, which restarts the browser's decode. */
	assigned: number[] = [];
	private time = 0;
	get currentTime() {
		return this.time;
	}
	set currentTime(time: number) {
		this.time = time;
		this.seeking = true;
		this.assigned.push(time);
		this.dispatchEvent(new Event('seeking'));
	}
	land() {
		this.seeking = false;
		this.dispatchEvent(new Event('seeked'));
	}
}

const timing = { fps: 10 };

function video() {
	const fake = new FakeVideo();
	return { fake, element: fake as unknown as HTMLVideoElement };
}

describe('seek', () => {
	test('seeks straight away when nothing is landing', () => {
		const { fake, element } = video();
		seek(element, 0.25, timing);
		expect(fake.assigned).toEqual([0.25]);
		expect(seekPending(element)).toBe(true);
		fake.land();
		expect(seekPending(element)).toBe(false);
	});

	// A drag sends a seek per pointer move. Moving the playhead while a seek is landing
	// restarts the decode, so on long-GOP clips no seek ever finished until the pointer
	// stopped.
	test('while a seek lands, later ones wait and only the latest is made', () => {
		const { fake, element } = video();
		seek(element, 0.15, timing);
		seek(element, 0.25, timing);
		seek(element, 0.35, timing);
		seek(element, 0.45, timing);
		expect(fake.assigned).toEqual([0.15]);
		expect(targetTime(element)).toBe(0.45);
		fake.land();
		expect(fake.assigned).toEqual([0.15, 0.45]);
		expect(seekPending(element)).toBe(true);
		fake.land();
		expect(fake.assigned).toEqual([0.15, 0.45]);
		expect(seekPending(element)).toBe(false);
		expect(targetTime(element)).toBe(0.45);
	});

	test('shows each target on the preview at once, by frame', () => {
		const { fake, element } = video();
		const shown: number[] = [];
		const unregister = registerSeekPreview(element, { show: (frame) => shown.push(frame) });
		seek(element, 0.15, timing);
		seek(element, 0.35, timing);
		expect(shown).toEqual([1, 3]);
		unregister();
		fake.land();
		seek(element, 0.55, timing);
		expect(shown).toEqual([1, 3]);
	});

	test('tells listeners the target moved', () => {
		const { fake, element } = video();
		let events = 0;
		fake.addEventListener(SEEK_EVENT, () => (events += 1));
		seek(element, 0.15, timing);
		seek(element, 0.25, timing);
		expect(events).toBe(2);
	});

	test("a seek someone else started doesn't hold ours back", () => {
		const { fake, element } = video();
		fake.currentTime = 0.05;
		seek(element, 0.25, timing);
		expect(fake.assigned).toEqual([0.05, 0.25]);
	});

	test('a new file drops queued seeks', () => {
		const { fake, element } = video();
		seek(element, 0.15, timing);
		seek(element, 0.25, timing);
		clearSeeks(element);
		fake.land();
		expect(fake.assigned).toEqual([0.15]);
		expect(seekPending(element)).toBe(false);
	});
});

describe('seeking during a frame-rate probe', () => {
	class PlayingVideo extends FakeVideo {
		paused = false;
		pause() {
			this.paused = true;
		}
	}

	test('ends the probe and pauses, so nothing resumes playback afterwards', () => {
		const fake = new PlayingVideo();
		const element = fake as unknown as HTMLVideoElement;
		setProbing(element, true);
		expect(isWatching(element)).toBe(false);
		seek(element, 0.25, timing);
		expect(fake.paused).toBe(true);
		expect(isProbing(element)).toBe(false);
	});
});
