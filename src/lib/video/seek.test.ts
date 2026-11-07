import { afterEach, describe, expect, test, vi } from 'vitest';
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
afterEach(() => vi.useRealTimers());

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

	test("a cleared seek cannot drain a new video's queued steps", () => {
		const { fake, element } = video();
		seek(element, 0.15, timing);
		clearSeeks(element);
		// Reuse the same video element for a new file before the old seeked arrives.
		fake.seeking = false;
		seek(element, 0.35, timing);
		seek(element, 0.45, timing);
		fake.land();
		expect(fake.assigned).toEqual([0.15, 0.35, 0.45]);
		expect(seekPending(element)).toBe(true);
		seek(element, 0.55, timing);
		// No stale listener may clear the new in-flight seek and restart its decode.
		expect(fake.assigned).toEqual([0.15, 0.35, 0.45]);
		fake.land();
		expect(fake.assigned).toEqual([0.15, 0.35, 0.45, 0.55]);
	});
});

describe('seek completion with frame callbacks', () => {
	class PresentingVideo extends FakeVideo {
		private serial = 0;
		callbacks = new Map<number, VideoFrameRequestCallback>();
		requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
			this.callbacks.set(++this.serial, callback);
			return this.serial;
		}
		cancelVideoFrameCallback(handle: number) {
			this.callbacks.delete(handle);
		}
		present(mediaTime: number) {
			const callbacks = [...this.callbacks.values()];
			this.callbacks.clear();
			for (const callback of callbacks) callback(0, { mediaTime } as VideoFrameCallbackMetadata);
		}
	}

	test('an edit offset learned after assignment rebases the seek before it completes', () => {
		const fake = new PresentingVideo();
		const element = fake as unknown as HTMLVideoElement;
		const edited = { fps: 10, frameTimes: [0, 0.1, 0.2], editGap: 0.02 };
		seek(element, 0.05, edited);
		fake.land();
		fake.present(0.02);
		expect(fake.assigned).toEqual([0.05, 0.07]);
		expect(seekPending(element)).toBe(true);
		fake.land();
		fake.present(0); // WebKit's partial frame before the first complete sample.
		expect(seekPending(element)).toBe(true);
		fake.present(0.02);
		expect(seekPending(element)).toBe(false);
		expect(targetTime(element)).toBeCloseTo(0.05, 9);
	});

	test('seeked alone does not release a decode before its picture arrives', () => {
		const fake = new PresentingVideo();
		const element = fake as unknown as HTMLVideoElement;
		seek(element, 0.15, timing);
		fake.land();
		seek(element, 0.25, timing);
		seek(element, 0.35, timing);
		expect(fake.assigned).toEqual([0.15]);
		expect(targetTime(element)).toBe(0.35);
		expect(seekPending(element)).toBe(true);
		fake.present(0); // A stale callback cannot release it either.
		expect(fake.assigned).toEqual([0.15]);
		fake.present(0.1);
		expect(fake.assigned).toEqual([0.15, 0.35]);
		fake.present(0.3); // Presentation can also precede seeked.
		expect(seekPending(element)).toBe(true);
		fake.land();
		expect(seekPending(element)).toBe(false);
		expect(fake.callbacks.size).toBe(0);
	});

	test('a missing picture retries once within the same frame, then releases the queue', () => {
		vi.useFakeTimers();
		const fake = new PresentingVideo();
		const element = fake as unknown as HTMLVideoElement;
		seek(element, 0.15, timing);
		fake.land();
		seek(element, 0.25, timing);
		vi.advanceTimersByTime(499);
		expect(fake.assigned).toEqual([0.15]);
		vi.advanceTimersByTime(1);
		expect(fake.assigned).toEqual([0.15, 0.125]);
		fake.land();
		vi.advanceTimersByTime(500);
		expect(fake.assigned).toEqual([0.15, 0.125, 0.25]);
		clearSeeks(element);
		expect(fake.callbacks.size).toBe(0);
	});

	test('replacing a file cancels presentation callbacks and the fallback timer', () => {
		vi.useFakeTimers();
		const fake = new PresentingVideo();
		const element = fake as unknown as HTMLVideoElement;
		seek(element, 0.15, timing);
		fake.land();
		seek(element, 0.25, timing);
		clearSeeks(element);
		expect(fake.callbacks.size).toBe(0);
		vi.advanceTimersByTime(1000);
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
