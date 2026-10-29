import { describe, expect, test } from 'vitest';
import { elapsed, findPoint, setPoint } from './timer';
import type { Mark } from './marks';

const FPS = 60;
/** Playhead in the middle of a frame, the way seeks land. */
const at = (frame: number) => (frame + 0.5) / FPS;
const frames = (marks: Mark[]) => marks.map((mark) => Math.round(mark.time * FPS));

describe('setPoint', () => {
	test('sets the in point on the frame start', () => {
		const marks = setPoint([], 'in', at(12), FPS);
		expect(frames(marks)).toEqual([12]);
		expect(findPoint(marks, 'in')?.time).toBeCloseTo(12 / FPS, 12);
	});

	test('setting a point again moves it rather than adding another', () => {
		let marks = setPoint([], 'in', at(12), FPS);
		marks = setPoint(marks, 'out', at(40), FPS);
		marks = setPoint(marks, 'in', at(20), FPS);
		expect(marks).toHaveLength(2);
		expect(frames(marks)).toEqual([20, 40]);
	});

	test('setting a point on the frame it is already on clears it', () => {
		let marks = setPoint([], 'in', at(12), FPS);
		marks = setPoint(marks, 'in', at(12), FPS);
		expect(marks).toEqual([]);
	});

	test('a point set on the other point’s frame replaces it', () => {
		let marks = setPoint([], 'in', at(12), FPS);
		marks = setPoint(marks, 'out', at(12), FPS);
		expect(findPoint(marks, 'in')).toBeUndefined();
		expect(frames(marks)).toEqual([12]);
	});
});

describe('elapsed', () => {
	test('is null until both points are set', () => {
		expect(elapsed(setPoint([], 'in', at(12), FPS), FPS)).toBeNull();
	});

	test('counts the frames and seconds between the points', () => {
		let marks = setPoint([], 'in', at(60), FPS);
		marks = setPoint(marks, 'out', at(90), FPS);
		const result = elapsed(marks, FPS);
		expect(result?.frames).toBe(30);
		expect(result?.seconds).toBeCloseTo(0.5, 12);
		expect(result?.reversed).toBe(false);
	});

	test('an out point before the in point still gives the time between them', () => {
		let marks = setPoint([], 'in', at(90), FPS);
		marks = setPoint(marks, 'out', at(60), FPS);
		expect(elapsed(marks, FPS)).toMatchObject({ frames: 30, reversed: true });
	});

	test('slow-motion footage is scaled to real time', () => {
		let marks = setPoint([], 'in', at(0), 240);
		marks = setPoint(marks, 'out', at(0) + 120 / 240, 240);
		// 120 frames at 240 fps is 0.5 s of media; 4× slow motion makes it 0.125 s.
		expect(elapsed(marks, 240, 0.25)?.seconds).toBeCloseTo(0.125, 12);
	});

	test('uses the real frame times when the file gives them', () => {
		const timing = { fps: 30, frameTimes: [0, 0.033, 0.1, 0.133, 0.2] };
		let marks = setPoint([], 'in', 0.01, timing);
		marks = setPoint(marks, 'out', 0.15, timing);
		expect(elapsed(marks, timing)).toMatchObject({ frames: 3 });
		expect(elapsed(marks, timing)?.seconds).toBeCloseTo(0.133, 12);
	});
});
