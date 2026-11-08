import { describe, expect, test } from 'vitest';
import {
	clearMediaTimeline,
	mediaTime,
	mediaTimelineKnown,
	nativeTime,
	observeMediaTimeline,
	MEDIA_TIMELINE_EVENT
} from './mediaTime';

const gap = 0.0233072916666667;
const timing = { fps: 30, frameTimes: [0, 1 / 30, 2 / 30, 3 / 30], editGap: gap };
function video() {
	return Object.assign(new EventTarget(), { currentTime: 0.05 + gap }) as HTMLVideoElement;
}

describe('a trim starting partway through a frame', () => {
	test("zero cannot distinguish a clamped partial frame from Chromium's first frame", () => {
		const element = video();
		observeMediaTimeline(element, 0, timing);
		expect(mediaTimelineKnown(element, timing)).toBe(false);
		observeMediaTimeline(element, 1 / 30, timing);
		expect(mediaTimelineKnown(element, timing)).toBe(true);
		expect(nativeTime(element, 0.05)).toBe(0.05);
	});
	test('WebKit presentation times establish the edit offset, including timestamp error', () => {
		const element = video();
		let changes = 0;
		element.addEventListener(MEDIA_TIMELINE_EVENT, () => changes++);
		observeMediaTimeline(element, gap + 1 / 30 - 3e-6, timing);
		expect(mediaTime(element)).toBeCloseTo(0.05, 9);
		expect(nativeTime(element, 0.05)).toBeCloseTo(element.currentTime, 9);
		observeMediaTimeline(element, gap + 2 / 30, timing);
		expect(changes).toBe(1);
	});

	test('Chromium keeps canonical times even though the file contains an edit gap', () => {
		const element = video();
		observeMediaTimeline(element, 1 / 30, timing);
		expect(nativeTime(element, 0.05)).toBe(0.05);
	});

	test('negative pre-roll and ambiguous timestamps cannot choose a timeline', () => {
		const element = video();
		observeMediaTimeline(element, -0.01, timing);
		expect(nativeTime(element, 0)).toBe(0);
		observeMediaTimeline(element, 0.02, timing);
		expect(nativeTime(element, 0)).toBe(0);
		observeMediaTimeline(element, gap, timing);
		expect(nativeTime(element, 0)).toBeCloseTo(gap, 9);
	});

	test('opening another file discards the old native timeline', () => {
		const element = video();
		observeMediaTimeline(element, gap, timing);
		clearMediaTimeline(element);
		observeMediaTimeline(element, 0, timing);
		expect(nativeTime(element, 0.05)).toBe(0.05);
	});
});
