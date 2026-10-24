import { describe, expect, test } from 'vitest';
import {
	analyzeMarks,
	GRAVITY,
	groupJumps,
	rsi,
	unpairedReason,
	type Mark,
	type MarkType
} from './marks';

/** Marks at whole frames, in the order given, with ids naming them (`T1`, `L2`, …). */
function marksAt(fps: number, ...spec: [string, number][]): Mark[] {
	return spec.map(([id, frame]) => ({
		id,
		type: (id.startsWith('T') ? 'takeoff' : 'landing') as MarkType,
		time: frame / fps
	}));
}

const ids = (marks: Mark[]) => marks.map((mark) => mark.id);

// h = g·t²/8, worked by hand: 9.81 × 0.5² / 8 = 0.30656 m.
const HEIGHT_CM_AT_HALF_SECOND = 30.65625;

describe('analyzeMarks', () => {
	test('a takeoff then a landing is a flight, with height from h = g·t²/8', () => {
		const { intervals, outOfSequence } = analyzeMarks(marksAt(60, ['T1', 60], ['L1', 90]), 60);
		expect(outOfSequence.size).toBe(0);
		expect(intervals).toHaveLength(1);
		const [flight] = intervals;
		expect(flight.kind).toBe('flight');
		expect(flight.frames).toBe(30);
		expect(flight.seconds).toBeCloseTo(0.5, 12);
		expect(flight.realSeconds).toBeCloseTo(0.5, 12);
		expect(flight.heightCm).toBeCloseTo(HEIGHT_CM_AT_HALF_SECOND, 10);
		expect(flight.heightCm).toBeCloseTo(((GRAVITY * 0.5 ** 2) / 8) * 100, 10);
	});

	test('a landing then a takeoff is a contact, with no height', () => {
		const { intervals } = analyzeMarks(marksAt(60, ['L0', 90], ['T1', 105]), 60);
		expect(intervals).toHaveLength(1);
		expect(intervals[0]).toMatchObject({ kind: 'contact', frames: 15, heightCm: undefined });
		expect(intervals[0].seconds).toBeCloseTo(0.25, 12);
	});

	test('heights match hand-computed values across flight times', () => {
		const cases: [flightFrames: number, heightCm: number][] = [
			[12, 4.905], // 0.2 s: 9.81 × 0.04 / 8
			[24, 19.62], // 0.4 s: 9.81 × 0.16 / 8
			[36, 44.145] // 0.6 s: 9.81 × 0.36 / 8
		];
		for (const [frames, heightCm] of cases) {
			const [flight] = analyzeMarks(marksAt(60, ['T1', 0], ['L1', frames]), 60).intervals;
			expect(flight.heightCm).toBeCloseTo(heightCm, 10);
		}
	});

	test('frame counts follow the frame rate', () => {
		for (const fps of [23.976, 24, 25, 29.97, 30, 59.94, 60, 120, 240]) {
			const [flight] = analyzeMarks(marksAt(fps, ['T1', 100], ['L1', 160]), fps).intervals;
			expect(flight.frames).toBe(60);
			expect(flight.seconds).toBeCloseTo(60 / fps, 12);
		}
	});

	test.each([0.5, 0.25, 0.125])(
		'slow motion at timeScale %s converts media time to real time',
		(timeScale) => {
			// 0.2 s of contact and 0.5 s of flight, slowed down on screen by 1 / timeScale.
			const fps = 240;
			const contactFrames = Math.round((0.2 / timeScale) * fps);
			const flightFrames = Math.round((0.5 / timeScale) * fps);
			const marks = marksAt(
				fps,
				['L0', 0],
				['T1', contactFrames],
				['L1', contactFrames + flightFrames]
			);
			const [contact, flight] = analyzeMarks(marks, fps, timeScale).intervals;
			expect(flight.frames).toBe(flightFrames);
			expect(flight.seconds).toBeCloseTo(0.5 / timeScale, 12);
			expect(flight.realSeconds).toBeCloseTo(0.5, 12);
			expect(flight.heightCm).toBeCloseTo(HEIGHT_CM_AT_HALF_SECOND, 10);
			expect(contact.realSeconds).toBeCloseTo(0.2, 12);
		}
	);

	test('the height uses real time, not media time', () => {
		// 1 media second of 4× slow motion is 0.25 real seconds: 9.81 × 0.0625 / 8.
		const [flight] = analyzeMarks(marksAt(240, ['T1', 0], ['L1', 240]), 240, 0.25).intervals;
		expect(flight.heightCm).toBeCloseTo(7.6640625, 10);
	});
});

describe('out-of-sequence marks', () => {
	test('a mark repeating the previous type is flagged and gets no interval', () => {
		const marks = marksAt(60, ['T1', 0], ['T2', 10], ['L1', 40], ['L2', 50], ['T3', 70]);
		const { intervals, outOfSequence } = analyzeMarks(marks, 60);
		expect([...outOfSequence]).toEqual(['T2', 'L2']);
		expect(intervals.map((interval) => [interval.kind, interval.from.id, interval.to.id])).toEqual([
			['flight', 'T2', 'L1'],
			['contact', 'L2', 'T3']
		]);
	});

	test('alternating marks are never flagged', () => {
		const marks = marksAt(60, ['L0', 0], ['T1', 12], ['L1', 42], ['T2', 54], ['L2', 84]);
		expect(analyzeMarks(marks, 60).outOfSequence.size).toBe(0);
	});
});

describe('groupJumps', () => {
	const group = (marks: Mark[], fps = 60, timeScale = 1) =>
		groupJumps(marks, analyzeMarks(marks, fps, timeScale));

	test('rebound jumps share the landing that ends one flight and starts the next contact', () => {
		const marks = marksAt(60, ['L0', 0], ['T1', 12], ['L1', 42], ['T2', 54], ['L2', 84]);
		const { jumps, unpairedMarks } = group(marks);
		expect(unpairedMarks).toEqual([]);
		expect(jumps).toHaveLength(2);
		const [first, second] = jumps;
		expect(first.takeoff.id).toBe('T1');
		expect(first.contact?.from.id).toBe('L0');
		expect(first.landing?.id).toBe('L1');
		expect(second.contact?.from.id).toBe('L1');
		expect(second.landing?.id).toBe('L2');
		expect(first.flight?.to).toBe(second.contact?.from);
	});

	test('repeated takeoffs keep the earlier one unpaired, as out of sequence', () => {
		const marks = marksAt(60, ['T1', 0], ['T2', 10], ['L1', 40]);
		const { jumps, unpairedMarks } = group(marks);
		expect(jumps.map((jump) => jump.takeoff.id)).toEqual(['T2']);
		expect(jumps[0].flight?.frames).toBe(30);
		expect(ids(unpairedMarks)).toEqual(['T1']);
		expect(unpairedReason(marks, unpairedMarks[0])).toBe('out-of-sequence');
	});

	test('repeated landings are both unpaired, as out of sequence', () => {
		const marks = marksAt(60, ['L1', 0], ['L2', 10]);
		const { jumps, unpairedMarks } = group(marks);
		expect(jumps).toEqual([]);
		expect(ids(unpairedMarks)).toEqual(['L1', 'L2']);
		for (const mark of unpairedMarks) {
			expect(unpairedReason(marks, mark)).toBe('out-of-sequence');
		}
	});

	test('a landing after a complete jump is out of sequence', () => {
		const marks = marksAt(60, ['T1', 0], ['L1', 30], ['L2', 40]);
		const { jumps, unpairedMarks } = group(marks);
		expect(jumps).toHaveLength(1);
		expect(ids(unpairedMarks)).toEqual(['L2']);
		expect(unpairedReason(marks, unpairedMarks[0])).toBe('out-of-sequence');
	});

	test('a lone landing is unpaired and alone', () => {
		const marks = marksAt(60, ['L1', 30]);
		const { jumps, unpairedMarks } = group(marks);
		expect(jumps).toEqual([]);
		expect(ids(unpairedMarks)).toEqual(['L1']);
		expect(unpairedReason(marks, unpairedMarks[0])).toBe('alone');
	});

	test('a lone takeoff is a jump still waiting for its landing', () => {
		const { jumps, unpairedMarks } = group(marksAt(60, ['T1', 30]));
		expect(unpairedMarks).toEqual([]);
		expect(jumps).toHaveLength(1);
		expect(jumps[0]).toMatchObject({ flight: undefined, landing: undefined, contact: undefined });
	});

	test('marks are grouped in time order whatever order they arrive in', () => {
		const marks = marksAt(60, ['L1', 42], ['T1', 12], ['L0', 0]);
		const sorted = [...marks].sort((a, b) => a.time - b.time);
		const { jumps } = groupJumps(marks, analyzeMarks(sorted, 60));
		expect(jumps).toHaveLength(1);
		expect(jumps[0].contact?.from.id).toBe('L0');
		expect(jumps[0].landing?.id).toBe('L1');
	});
});

describe('rsi', () => {
	test('is jump height in metres over the contact time before it', () => {
		// 0.2 s contact, 0.5 s flight: 0.3065625 m / 0.2 s.
		const marks = marksAt(60, ['L0', 0], ['T1', 12], ['L1', 42]);
		const [jump] = groupJumps(marks, analyzeMarks(marks, 60)).jumps;
		expect(rsi(jump)).toBeCloseTo(1.5328125, 10);
	});

	test('uses real contact and flight time for slow motion', () => {
		// 4× slow motion: 0.8 media s of contact and 2 media s of flight are 0.2 s and 0.5 s.
		const marks = marksAt(240, ['L0', 0], ['T1', 192], ['L1', 672]);
		const [jump] = groupJumps(marks, analyzeMarks(marks, 240, 0.25)).jumps;
		expect(rsi(jump)).toBeCloseTo(1.5328125, 10);
	});

	test('is undefined without a contact before the jump or a flight after it', () => {
		const countermovement = marksAt(60, ['T1', 0], ['L1', 30]);
		expect(rsi(groupJumps(countermovement, analyzeMarks(countermovement, 60)).jumps[0])).toBe(
			undefined
		);
		const noLanding = marksAt(60, ['L0', 0], ['T1', 12]);
		expect(rsi(groupJumps(noLanding, analyzeMarks(noLanding, 60)).jumps[0])).toBe(undefined);
	});
});
