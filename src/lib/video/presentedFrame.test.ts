import { describe, expect, test } from 'vitest';
import { displayedFrame, trackPresentedFrames } from './presentedFrame';

/**
 * Just enough of a paused video element: seeks land when `land()` is called, and
 * `present(time)` fires the frame callback as the browser does when a frame is shown.
 */
class FakeVideo extends EventTarget {
	paused = true;
	seeking = false;
	duration = 10;
	private time = 0;
	private callbacks: ((now: number, metadata: { mediaTime: number }) => void)[] = [];
	get currentTime() {
		return this.time;
	}
	set currentTime(time: number) {
		this.time = time;
		this.seeking = true;
		this.dispatchEvent(new Event('seeking'));
	}
	land() {
		this.seeking = false;
		this.dispatchEvent(new Event('seeked'));
	}
	present(mediaTime: number) {
		const callbacks = this.callbacks;
		this.callbacks = [];
		for (const callback of callbacks) callback(0, { mediaTime });
	}
	requestVideoFrameCallback(callback: (now: number, metadata: { mediaTime: number }) => void) {
		this.callbacks.push(callback);
		return this.callbacks.length;
	}
	cancelVideoFrameCallback() {}
}

const timing = { fps: 60 };
/** Middle of frame k at 60 fps, where a step seeks to. */
const middle = (frame: number) => (frame + 0.5) / 60;

function tracked() {
	const fake = new FakeVideo();
	const element = fake as unknown as HTMLVideoElement;
	const stop = trackPresentedFrames(element, () => timing);
	return { fake, element, stop };
}

describe('trackPresentedFrames', () => {
	test('a paused seek that presents its frame is the frame on screen', () => {
		const { fake, element, stop } = tracked();
		fake.currentTime = middle(1);
		fake.land();
		fake.present(1 / 60);
		expect(displayedFrame(element, timing)).toBe(1);
		expect(fake.currentTime).toBe(middle(1));
		stop();
	});

	// WebKit (Safari, and iPhones especially) can present a paused seek's frame only after
	// the next seek has landed. Reading that late frame as the new one pulled the playhead
	// back a frame on every step, so stepping forward never got anywhere.
	test("a late frame from the seek before doesn't pull the playhead back", () => {
		const { fake, element, stop } = tracked();
		fake.currentTime = middle(1);
		fake.land();
		// Nothing presented for frame 1 yet; the next step seeks on to frame 2.
		fake.currentTime = middle(2);
		fake.land();
		fake.present(1 / 60);
		expect(fake.currentTime).toBe(middle(2));
		expect(displayedFrame(element, timing)).toBe(2);
		// When frame 2 does arrive, it counts.
		fake.present(2 / 60);
		expect(displayedFrame(element, timing)).toBe(2);
		stop();
	});

	test('after a pause, the frame left on screen still moves the playhead to it', () => {
		const { fake, element, stop } = tracked();
		fake.paused = false;
		fake.dispatchEvent(new Event('play'));
		fake.present(5 / 60);
		fake.paused = true;
		// Playback stopped with the playhead already in the next frame.
		Object.defineProperty(fake, 'time', { value: middle(6), writable: true });
		fake.dispatchEvent(new Event('pause'));
		expect(displayedFrame(element, timing)).toBe(5);
		expect(fake.currentTime).toBe(middle(5));
		stop();
	});
});
