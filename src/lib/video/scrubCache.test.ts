import { describe, expect, test } from 'vitest';
import { nearestBuilt, scrubBudget } from './scrubCache';

const MB = 1024 * 1024;

describe('scrub cache memory budget', () => {
	test('desktops keep the full budget', () => {
		expect(scrubBudget({ coarsePointer: false, touchMac: false })).toEqual({
			maxBytes: 160 * MB,
			lowMemory: false
		});
		expect(scrubBudget({ coarsePointer: false, touchMac: false, deviceMemory: 8 }).lowMemory).toBe(
			false
		);
	});

	test('phones, iPads and small-memory devices get the low-memory budget', () => {
		for (const device of [
			{ coarsePointer: true, touchMac: false },
			{ coarsePointer: false, touchMac: true },
			{ coarsePointer: false, touchMac: false, deviceMemory: 4 }
		]) {
			expect(scrubBudget(device)).toEqual({ maxBytes: 48 * MB, lowMemory: true });
		}
	});
});

describe('nearest built frame', () => {
	// Frames 0, 4 and 8 of ten built, as after the coarse pass.
	const frames: (ArrayBuffer | undefined)[] = new Array(10);
	for (const frame of [0, 4, 8]) frames[frame] = new ArrayBuffer(1);

	test('the frame itself when it is built', () => {
		expect(nearestBuilt(frames, 4)).toBe(4);
	});

	test('the nearest one either side, the earlier of two as near', () => {
		expect(nearestBuilt(frames, 3)).toBe(4);
		expect(nearestBuilt(frames, 5)).toBe(4);
		expect(nearestBuilt(frames, 6)).toBe(4);
		expect(nearestBuilt(frames, 7)).toBe(8);
		expect(nearestBuilt(frames, 9)).toBe(8);
	});

	test('only frames nearer than the limit', () => {
		expect(nearestBuilt(frames, 6, 2)).toBeNull();
		expect(nearestBuilt(frames, 6, 3)).toBe(4);
		expect(nearestBuilt(frames, 4, 0)).toBeNull();
	});

	test('none before anything is built', () => {
		expect(nearestBuilt(new Array(10), 5)).toBeNull();
		expect(nearestBuilt([], 0)).toBeNull();
	});
});
