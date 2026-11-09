import { expect, test } from 'vitest';
import { analyzeMarks, type Mark } from './marks';
import { bestUnit, jumpUnits, unitMarks } from './jumpUnits';

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
