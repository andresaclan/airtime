import { expect, test } from 'vitest';
import { analyzeMarks, type Mark } from './marks';
import { averageFlight, bestUnit, jumpUnits, unitAt, unitMarks, unpairedMarks } from './jumpUnits';

const marks: Mark[] = [
	{ id: 'plant', type: 'landing', time: 0 },
	{ id: 'takeoff', type: 'takeoff', time: 0.2 },
	{ id: 'landing', type: 'landing', time: 0.7 },
	{ id: 'next-plant', type: 'landing', time: 1 }
];

test('capture units progress from plant to incomplete to complete without storing boundaries', () => {
	for (const count of [1, 2, 3, 4]) {
		const subset = marks.slice(0, count);
		const units = jumpUnits(subset, analyzeMarks(subset, 60));
		expect(units).toHaveLength(count === 4 ? 2 : 1);
		expect(unitMarks(units[0]).map((mark) => mark.id)).toEqual(
			marks.slice(0, Math.min(count, 3)).map((mark) => mark.id)
		);
	}
});

test('a flight without its own plant stays visible with missing contact', () => {
	const subset = marks.slice(1, 3);
	const [unit] = jumpUnits(subset, analyzeMarks(subset, 60));
	expect(unit.plant).toBeUndefined();
	expect(unit.contact).toBeUndefined();
	expect(unit.flight?.realSeconds).toBeCloseTo(0.5);
});

test('best is chosen by flight and ignores an unfinished capture', () => {
	const units = jumpUnits(marks, analyzeMarks(marks, 60));
	expect(bestUnit(units)?.id).toBe('takeoff');
	expect(bestUnit([])).toBeUndefined();
});

const units = (subset: Mark[], jumpType: 'approach' | 'repeat-hops' = 'approach') =>
	jumpUnits(subset, analyzeMarks(subset, 60, 1, jumpType));

test('repeat hops share a touchdown: it is the first hop’s landing and the second’s plant', () => {
	const hops: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'takeoff-2', type: 'takeoff', time: 0.9 },
		{ id: 'landing-2', type: 'landing', time: 1.3 }
	];
	const [first, second] = units(hops, 'repeat-hops');
	expect(second.plant?.id).toBe('landing');
	expect(first.landing?.id).toBe('landing');
	// Any other jump type needs its own plant step: the second jump has no contact.
	expect(units(hops)[1].contact).toBeUndefined();
});

test('marks no jump uses are unpaired', () => {
	const doubled: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'stray', type: 'takeoff', time: 2 },
		{ id: 'takeoff-2', type: 'takeoff', time: 2.1 }
	];
	expect(unpairedMarks(doubled, units(doubled)).map((mark) => mark.id)).toEqual(['stray']);
	expect(unpairedMarks(marks, units(marks))).toEqual([]);
});

test('average flight covers only measured jumps', () => {
	const two: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'takeoff-2', type: 'takeoff', time: 2 },
		{ id: 'landing-2', type: 'landing', time: 2.3 },
		{ id: 'takeoff-3', type: 'takeoff', time: 3 }
	];
	expect(averageFlight(units(two))).toBeCloseTo(0.4);
	expect(averageFlight(units(marks.slice(0, 2)))).toBeUndefined();
});

test('the panel shows the jump at the playhead, or the last one it passed', () => {
	// At 60 fps: plant on frame 0, takeoff 12, landing 42, the next plant 60.
	const all = units(marks);
	expect(unitAt(all, 0, 60)?.id).toBe('takeoff');
	expect(unitAt(all, 30, 60)?.id).toBe('takeoff');
	// Past the landing, the landed jump stays until the next one's first mark.
	expect(unitAt(all, 50, 60)?.id).toBe('takeoff');
	expect(unitAt(all, 60, 60)?.id).toBe('next-plant');
	expect(unitAt(all, 500, 60)?.id).toBe('next-plant');
	// Before every jump, the first.
	const later = marks.map((mark) => ({ ...mark, time: mark.time + 1 }));
	expect(unitAt(units(later), 10, 60)?.id).toBe('takeoff');
	expect(unitAt([], 10, 60)).toBeUndefined();
});
