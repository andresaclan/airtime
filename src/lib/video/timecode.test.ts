import { describe, expect, test } from 'vitest';
import { formatClock, formatFrameClock } from './timecode';

describe('formatClock', () => {
	test('minutes, seconds and milliseconds', () => {
		expect(formatClock(0)).toBe('0:00.000');
		expect(formatClock(2.25)).toBe('0:02.250');
		expect(formatClock(75.5)).toBe('1:15.500');
	});

	test('adds hours once there are any', () => {
		expect(formatClock(3723.5)).toBe('1:02:03.500');
	});

	test('treats invalid times as zero', () => {
		expect(formatClock(Number.NaN)).toBe('0:00.000');
		expect(formatClock(-1)).toBe('0:00.000');
	});

	test('frame labels convert at the nominal rate', () => {
		expect(formatFrameClock(135, 60)).toBe('0:02.250');
		expect(formatFrameClock(30, { fps: 30, frameTimes: null })).toBe('0:01.000');
	});
});
