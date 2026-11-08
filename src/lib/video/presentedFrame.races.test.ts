import { afterEach, describe, expect, test, vi } from 'vitest';
import { displayedFrame, settledDisplayedFrame, trackPresentedFrames } from './presentedFrame';
import { frameSeekTime, type FrameTiming } from './frames';
import { clearSeeks, seek, seekPending, setProbing } from './seek';

class Video extends EventTarget {
	paused = true;
	seeking = false;
	duration = 2;
	assigned: number[] = [];
	callbacks = new Map<number, VideoFrameRequestCallback>();
	private serial = 0;
	private time = 0;
	get currentTime() {
		return this.time;
	}
	set currentTime(time: number) {
		this.time = time;
		this.assigned.push(time);
		this.seeking = true;
		this.dispatchEvent(new Event('seeking'));
	}
	advanceTo(time: number) {
		this.time = time; // Playback advances without dispatching a seeking event.
	}
	requestVideoFrameCallback(callback: VideoFrameRequestCallback) {
		this.callbacks.set(++this.serial, callback);
		return this.serial;
	}
	cancelVideoFrameCallback(handle: number) {
		this.callbacks.delete(handle);
	}
	land() {
		this.seeking = false;
		this.dispatchEvent(new Event('seeked'));
	}
	pause() {
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}
	present(mediaTime: number) {
		const callbacks = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of callbacks) {
			callback(performance.now(), { mediaTime } as VideoFrameCallbackMetadata);
		}
	}
	get element() {
		return this as unknown as HTMLVideoElement;
	}
}

const timing: FrameTiming = { fps: 30 };
const cleanups: (() => void)[] = [];
function tracked(getTiming: () => FrameTiming | null = () => timing) {
	const video = new Video();
	const cleanup = trackPresentedFrames(video.element, getTiming);
	cleanups.push(cleanup);
	return { video, cleanup };
}

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
});

describe('the frame on screen', () => {
	test('a backstep that emits no picture recovers through a neighboring frame', () => {
		vi.useFakeTimers();
		const timing = {
			fps: 240,
			frameTimes: Array.from({ length: 48 }, (_, frame) => Math.round((frame * 600) / 240) / 600)
		};
		const { video } = tracked(() => timing);
		video.currentTime = frameSeekTime(16, timing);
		video.land();
		video.present(timing.frameTimes[16]);
		seek(video.element, frameSeekTime(15, timing), timing);
		video.land(); // Native iOS reports seeked but keeps frame 16, without a callback.
		vi.advanceTimersByTime(500);
		expect(video.currentTime).toBe(frameSeekTime(14, timing));
		expect(displayedFrame(video.element, timing)).toBe(15);
		video.land();
		video.present(timing.frameTimes[14]);
		expect(video.currentTime).toBe(frameSeekTime(15, timing));
		video.land();
		video.present(timing.frameTimes[15]);
		expect(seekPending(video.element)).toBe(false);
		expect(displayedFrame(video.element, timing)).toBe(15);
	});

	test('pause cannot rewind to a picture recorded before playback started', () => {
		const { video } = tracked();
		video.present(0);
		video.paused = false;
		video.dispatchEvent(new Event('play'));
		video.advanceTo(3.2 / 30);
		video.pause();
		expect(video.assigned).toEqual([]);
		video.present(3 / 30);
		expect(displayedFrame(video.element, timing)).toBe(3);
		expect(video.assigned).toEqual([]);
	});

	test('a matching playhead cannot complete a seek while a late pause picture is shown', () => {
		vi.useFakeTimers();
		const video = new Video();
		video.paused = false;
		video.currentTime = 4.4 / 30;
		video.land();
		cleanups.push(trackPresentedFrames(video.element, () => timing));
		video.present(3 / 30);
		video.pause(); // Reconciliation moves the playhead to frame 3.
		expect(video.currentTime).toBe(frameSeekTime(3, timing));
		video.land();
		video.present(4 / 30); // A final playback picture arrives after that seek.
		expect(displayedFrame(video.element, timing)).toBe(4);
		seek(video.element, frameSeekTime(3, timing), timing);
		// Leave the stale frame's logical interval, then return to force a decode.
		expect(video.currentTime).toBe(frameSeekTime(2, timing));
		video.land();
		expect(seekPending(video.element)).toBe(true);
		video.present(2 / 30);
		expect(video.currentTime).toBe(frameSeekTime(3, timing));
		video.land();
		video.present(3 / 30);
		expect(seekPending(video.element)).toBe(false);
		expect(displayedFrame(video.element, timing)).toBe(3);
	});

	test('a known matching picture still completes a no-op seek without a fresh callback', () => {
		const { video } = tracked();
		video.currentTime = frameSeekTime(3, timing);
		video.land();
		video.present(3 / 30);
		seek(video.element, frameSeekTime(3, timing), timing);
		video.land();
		expect(seekPending(video.element)).toBe(false);
	});

	test('a final probe frame cannot undo the seek restoring the original picture', () => {
		const { video } = tracked();
		video.paused = false;
		setProbing(video.element, true);
		video.present(14 / 30);
		seek(video.element, frameSeekTime(0, timing), timing);
		video.land();
		video.present(14 / 30);
		expect(video.currentTime).toBe(frameSeekTime(0, timing));
		video.present(0);
		expect(displayedFrame(video.element, timing)).toBe(0);
	});
	test('a stale callback after seeked cannot rewind a newer explicit step', () => {
		const { video } = tracked();
		video.present(0);
		seek(video.element, frameSeekTime(1, timing), timing);
		video.land();
		// The first picture has not been presented yet. A second step starts from 1.
		expect(displayedFrame(video.element, timing)).toBe(1);
		seek(video.element, frameSeekTime(2, timing), timing);
		video.land();
		// WebKit delivers the old seek's callback after the new seeked event.
		video.present(1 / 30);
		expect(displayedFrame(video.element, timing)).toBe(2);
		expect(video.assigned).toHaveLength(2);
		video.present(2 / 30);
		expect(displayedFrame(video.element, timing)).toBe(2);
	});

	test('a seek uses its latest target, including a rapid reversal, until it lands', () => {
		const { video } = tracked();
		video.present(0);
		seek(video.element, frameSeekTime(8, timing), timing);
		seek(video.element, frameSeekTime(9, timing), timing);
		seek(video.element, frameSeekTime(7, timing), timing);
		// A late callback for the first seek must not lose the queued reversal.
		video.present(8 / 30);
		expect(displayedFrame(video.element, timing)).toBe(7);
		video.land();
		video.present(8 / 30);
		expect(displayedFrame(video.element, timing)).toBe(7);
		video.land();
		video.present(7 / 30);
		expect(displayedFrame(video.element, timing)).toBe(7);
	});

	test('WebKit float error and Firefox seek-middle timestamps keep the same frame', () => {
		const irregular = { fps: 240, frameTimes: [0, 0.005, 0.008333, 0.013333] };
		const { video } = tracked(() => irregular);
		for (const mediaTime of [0.008333 - 3e-6, 0.008333 + 3e-6, 0.010833]) {
			video.currentTime = frameSeekTime(2, irregular);
			video.land();
			video.present(mediaTime);
			expect(displayedFrame(video.element, irregular)).toBe(2);
		}
	});

	test('a final frame after pause corrects the playhead to the picture, once', () => {
		const { video } = tracked();
		video.paused = false;
		video.currentTime = frameSeekTime(5, timing);
		video.land();
		video.present(5 / 30);
		video.paused = true;
		video.dispatchEvent(new Event('pause'));
		video.present(6 / 30);
		expect(video.currentTime).toBe(frameSeekTime(6, timing));
		video.land();
		// A decoder that refuses the correction cannot cause an endless seek loop.
		video.present(5 / 30);
		video.present(5 / 30);
		expect(video.assigned).toHaveLength(2);
	});

	test('marking waits for the extra frame after pausing playback', async () => {
		vi.useFakeTimers();
		const { video } = tracked();
		video.currentTime = frameSeekTime(5, timing);
		video.land();
		video.present(5 / 30);
		const frame = settledDisplayedFrame(video.element, timing);
		await vi.advanceTimersByTimeAsync(20);
		video.present(6 / 30);
		video.land();
		await vi.advanceTimersByTimeAsync(100);
		expect(await frame).toBe(6);
	});

	test('unknown timing never causes a correcting seek', () => {
		const { video } = tracked(() => null);
		video.present(1);
		expect(video.assigned).toEqual([]);
	});

	test('a new video forgets the old presented frame', () => {
		const { video } = tracked();
		video.currentTime = frameSeekTime(12, timing);
		video.land();
		video.present(12 / 30);
		video.dispatchEvent(new Event('emptied'));
		clearSeeks(video.element);
		video.currentTime = frameSeekTime(0, timing);
		video.land();
		expect(displayedFrame(video.element, timing)).toBe(0);
	});

	test('cleanup cancels the callback and removes reconciliation listeners', () => {
		const { video, cleanup } = tracked();
		video.present(0);
		cleanup();
		expect(video.callbacks.size).toBe(0);
		video.currentTime = 1;
		video.land();
		video.dispatchEvent(new Event('pause'));
		expect(video.assigned).toEqual([1]);
		expect(displayedFrame(video.element, timing)).toBe(30);
	});

	test('without frame callbacks it falls back to the seek target', () => {
		const video = new EventTarget() as HTMLVideoElement;
		Object.assign(video, { currentTime: frameSeekTime(4, timing), paused: true, seeking: false });
		trackPresentedFrames(video, () => timing)();
		expect(displayedFrame(video, timing)).toBe(4);
	});
});
