import { describe, expect, test } from 'vitest';
import { scrubBudget } from './scrubCache';

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
