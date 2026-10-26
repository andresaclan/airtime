import { describe, expect, test } from 'vitest';
import {
	formatTimecode,
	isDropFrameRate,
	nominalFrameRate,
	parseTimecode,
	formatClock,
	formatFrameClock
} from './timecode';

const NTSC_30 = 30000 / 1001;
const NTSC_60 = 60000 / 1001;

/**
 * Drop-frame labels by counting: each minute skips the first `drop` frame labels, except
 * every tenth minute. Independent of the arithmetic in `formatTimecode`.
 */
function* dropFrameLabels(nominal: number, drop: number) {
	for (let hh = 0; ; hh += 1) {
		for (let mm = 0; mm < 60; mm += 1) {
			for (let ss = 0; ss < 60; ss += 1) {
				for (let ff = 0; ff < nominal; ff += 1) {
					if (ss === 0 && ff < drop && mm % 10 !== 0) continue;
					const pad = (value: number) => String(value).padStart(2, '0');
					yield `${pad(hh)}:${pad(mm)}:${pad(ss)};${pad(ff)}`;
				}
			}
		}
	}
}

describe('frame rates', () => {
	test('drop-frame applies only to the NTSC 29.97 and 59.94 rates', () => {
		for (const fps of [29.97, NTSC_30, 59.94, NTSC_60]) expect(isDropFrameRate(fps)).toBe(true);
		for (const fps of [23.976, 24, 25, 30, 50, 60, 119.88, 120, 240]) {
			expect(isDropFrameRate(fps)).toBe(false);
		}
	});

	test('timecode counts frames at the nearest whole rate', () => {
		expect(nominalFrameRate(23.976)).toBe(24);
		expect(nominalFrameRate(29.97)).toBe(30);
		expect(nominalFrameRate(59.94)).toBe(60);
		expect(nominalFrameRate(240)).toBe(240);
	});
});

describe('formatTimecode', () => {
	test('non-drop-frame rates count whole frames', () => {
		expect(formatTimecode(0, 30)).toBe('00:00:00:00');
		expect(formatTimecode(45 / 30, 30)).toBe('00:00:01:15');
		expect(formatTimecode(24 / 25, 25)).toBe('00:00:00:24');
		expect(formatTimecode(3661 + 23 / 24, 24)).toBe('01:01:01:23');
		expect(formatTimecode(239 / 240, 240)).toBe('00:00:00:239');
		expect(formatTimecode(245 / 240, 240)).toBe('00:00:01:005');
		expect(formatTimecode(5 / 120, 120)).toBe('00:00:00:005');
	});

	test('23.976 counts 24 labels per timecode second without dropping any', () => {
		expect(formatTimecode(1800 / 23.976, 23.976)).toBe('00:01:15:00');
	});

	test('29.97 drop-frame skips ;00 and ;01 each minute except every tenth', () => {
		const at = (frame: number) => formatTimecode(frame / NTSC_30, NTSC_30);
		expect(at(1799)).toBe('00:00:59;29');
		expect(at(1800)).toBe('00:01:00;02');
		expect(at(17981)).toBe('00:09:59;29');
		expect(at(17982)).toBe('00:10:00;00');
		expect(at(17982 * 6)).toBe('01:00:00;00');
	});

	test('59.94 drop-frame skips four labels a minute', () => {
		const at = (frame: number) => formatTimecode(frame / NTSC_60, NTSC_60);
		expect(at(3599)).toBe('00:00:59;59');
		expect(at(3600)).toBe('00:01:00;04');
		expect(at(35964)).toBe('00:10:00;00');
	});

	test.each([
		[NTSC_30, 30, 2],
		[NTSC_60, 60, 4]
	])('drop-frame labels match counting them out at %d fps', (fps, nominal, drop) => {
		// Twelve minutes covers the per-minute drops and the tenth-minute exception.
		const labels = dropFrameLabels(nominal, drop);
		const total = Math.round(12 * 60 * fps);
		for (let frame = 0; frame < total; frame += 1) {
			expect(formatTimecode(frame / fps, fps)).toBe(labels.next().value);
		}
	});

	test('drop-frame can be turned off for NTSC rates', () => {
		expect(formatTimecode(1800 / NTSC_30, NTSC_30, false)).toBe('00:01:00:00');
	});

	test('invalid input shows zero', () => {
		expect(formatTimecode(-1, 30)).toBe('00:00:00:00');
		expect(formatTimecode(Number.NaN, 30)).toBe('00:00:00:00');
		expect(formatTimecode(1, 0)).toBe('00:00:00:00');
		expect(formatTimecode(1, Number.POSITIVE_INFINITY)).toBe('00:00:00:00');
	});
});

describe('parseTimecode', () => {
	test('reads non-drop-frame timecode back to seconds', () => {
		expect(parseTimecode('00:00:01:15', 30)).toBeCloseTo(1.5, 12);
		expect(parseTimecode('1:01:01:23', 24)).toBeCloseTo(3661 + 23 / 24, 9);
		expect(parseTimecode('0:01:00', 25)).toBe(1);
	});

	test.each([24, 25, 30, 60, 240, 23.976, NTSC_30, NTSC_60])(
		'round-trips every frame label at %d fps',
		(fps) => {
			const total = Math.round(11 * 60 * fps);
			const step = Math.max(1, Math.floor(total / 5000));
			for (let frame = 0; frame < total; frame += step) {
				const parsed = parseTimecode(formatTimecode(frame / fps, fps), fps);
				expect(parsed).not.toBeNull();
				expect((parsed as number) * fps).toBeCloseTo(frame, 6);
			}
		}
	);

	test('rejects labels that drop-frame skips', () => {
		expect(parseTimecode('00:01:00;00', NTSC_30)).toBeNull();
		expect(parseTimecode('00:01:00;01', NTSC_30)).toBeNull();
		expect(parseTimecode('00:01:00;03', NTSC_60)).toBeNull();
		expect(parseTimecode('00:10:00;00', NTSC_30)).toBeCloseTo(17982 / NTSC_30, 9);
	});

	test('rejects drop-frame on other rates, and out-of-range fields', () => {
		expect(parseTimecode('00:00:01;00', 30)).toBeNull();
		expect(parseTimecode('00:00:00:30', 30)).toBeNull();
		expect(parseTimecode('00:60:00:00', 30)).toBeNull();
		expect(parseTimecode('00:00:60:00', 30)).toBeNull();
		expect(parseTimecode('1.5', 30)).toBeNull();
		expect(parseTimecode('00:00:01:00', 0)).toBeNull();
	});
});

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
