import { describe, expect, test } from 'vitest';
import {
	clampFrame,
	frameAt,
	frameOfPresentedTime,
	frameSeekTime,
	frameStartTime,
	lastFrameIndex,
	snapToFrameStart
} from './frames';
import { frameOf, placeMark } from './marks';
import { formatTimecode } from './timecode';

const RATES: [string, number][] = [
	['24', 24],
	['25', 25],
	['29.97', 30000 / 1001],
	['29.97 (rounded)', 29.97],
	['30', 30],
	['59.94', 60000 / 1001],
	['59.94 (rounded)', 59.94],
	['60', 60],
	['120', 120],
	['240', 240]
];

// Every frame of a 10-minute clip at the highest rate is plenty to catch float drift.
const frames = (fps: number) => Array.from({ length: Math.ceil(fps * 600) }, (_, k) => k);

describe.each(RATES)('%s fps', (_label, fps) => {
	test('a frame start maps back to its own frame', () => {
		for (const k of frames(fps)) expect(frameAt(frameStartTime(k, fps), fps)).toBe(k);
	});

	test('a seek lands on the frame it was aimed at', () => {
		for (const k of frames(fps)) expect(frameAt(frameSeekTime(k, fps), fps)).toBe(k);
	});

	test('start, middle and end of a frame all map to that frame', () => {
		for (const k of [0, 1, 7, 100, 1799]) {
			expect(frameAt(k / fps, fps)).toBe(k);
			expect(frameAt((k + 0.5) / fps, fps)).toBe(k);
			expect(frameAt((k + 0.99) / fps, fps)).toBe(k);
			expect(frameAt((k + 1) / fps, fps)).toBe(k + 1);
		}
	});

	test('a playhead paused just past halfway stays on the frame shown', () => {
		// Math.round would report k + 1 here.
		expect(frameAt((42 + 0.6) / fps, fps)).toBe(42);
	});

	test('times rounded for export still map to their frame', () => {
		for (const k of frames(fps)) {
			const exported = Math.round(frameStartTime(k, fps) * 1e6) / 1e6;
			expect(frameAt(exported, fps)).toBe(k);
		}
	});

	test('presented media times map to the frame whose seek shows them', () => {
		for (const k of [0, 1, 59, 1000]) {
			expect(frameOfPresentedTime(k / fps, fps)).toBe(k);
			// Browsers report media time to the microsecond.
			expect(frameOfPresentedTime(Math.floor((k / fps) * 1e6) / 1e6, fps)).toBe(k);
		}
	});

	test('the last frame is reachable and a seek to it stays inside the clip', () => {
		const count = Math.round(4 * fps);
		const duration = count / fps;
		const last = lastFrameIndex(duration, fps);
		expect(last).toBe(count - 1);
		expect(frameSeekTime(last, fps, duration)).toBeLessThan(duration);
		expect(frameAt(frameSeekTime(last, fps, duration), fps)).toBe(last);
		expect(clampFrame(last + 1, duration, fps)).toBe(last);
	});

	test('marks are stored at the frame start of the frame on screen', () => {
		const [mark] = placeMark([], 'takeoff', (12 + 0.7) / fps, fps);
		expect(mark.time).toBe(frameStartTime(12, fps));
		expect(frameOf(mark.time, fps)).toBe(12);
	});
});

describe('edge cases', () => {
	test('times before zero, NaN and a missing rate map to frame 0', () => {
		expect(frameAt(-0.01, 60)).toBe(0);
		expect(frameAt(Number.NaN, 60)).toBe(0);
		expect(frameAt(1, 0)).toBe(0);
		expect(frameOfPresentedTime(-1, 60)).toBe(0);
	});

	test('a time a hair short of a frame start counts as that frame', () => {
		// Classic float error: 0.1 + 0.2 > 0.3, and 3 * (1/30) < 0.1.
		expect(frameAt(3 * (1 / 30), 30)).toBe(3);
		expect(frameAt(0.30000000000000004, 10)).toBe(3);
		expect(frameAt(1 / 60 - 1e-9, 60)).toBe(1);
	});

	test('a time well before a frame start is still the previous frame', () => {
		expect(frameAt(1 / 60 - 0.01 / 60, 60)).toBe(0);
	});

	test('a duration that is not a whole number of frames keeps its partial last frame', () => {
		// 3.630013 s at 60 fps is 217.8 frames: frames 0..217.
		expect(lastFrameIndex(3.630013, 60)).toBe(217);
		expect(frameSeekTime(217, 60, 3.630013)).toBeLessThanOrEqual(3.630013);
	});

	test('an unknown duration does not clamp', () => {
		expect(lastFrameIndex(Number.NaN, 60)).toBe(Infinity);
		expect(lastFrameIndex(0, 60)).toBe(Infinity);
		expect(lastFrameIndex(Infinity, 60)).toBe(Infinity);
		expect(clampFrame(500, Number.NaN, 60)).toBe(500);
		expect(clampFrame(-3, Number.NaN, 60)).toBe(0);
	});

	test('a seek to a frame before 0 goes to frame 0', () => {
		expect(frameSeekTime(-2, 60)).toBe(0.5 / 60);
	});

	test('snapToFrameStart is idempotent', () => {
		const once = snapToFrameStart(1.2345, 59.94);
		expect(snapToFrameStart(once, 59.94)).toBe(once);
	});

	test('frames 1000s into a 240 fps clip still round-trip', () => {
		const k = 240 * 1000 + 17;
		expect(frameAt(frameStartTime(k, 240), 240)).toBe(k);
		expect(frameAt(frameSeekTime(k, 240), 240)).toBe(k);
	});

	test('the timecode readout shows the frame on screen, not the next one', () => {
		expect(formatTimecode((5 + 0.5) / 60, 60)).toBe('00:00:00:05');
		expect(formatTimecode((5 + 0.9) / 60, 60)).toBe('00:00:00:05');
		expect(formatTimecode(1, 60)).toBe('00:00:01:00');
	});
});
