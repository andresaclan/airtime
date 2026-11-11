import { expect, test } from 'vitest';
import { analyzeMarks, type Mark } from './marks';
import {
	averageFlight,
	bestUnit,
	fillsSlot,
	jumpUnits,
	settleWorkspace,
	unitMarks,
	unitOf,
	unitStep,
	unpairedMarks,
	type Workspace
} from './jumpUnits';

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

test('a mark is found in its jump, as the step it is there', () => {
	const all = units(marks);
	expect(unitOf(all, 'landing')?.id).toBe('takeoff');
	expect(unitOf(all, 'next-plant')?.id).toBe('next-plant');
	expect(unitOf(all, 'gone')).toBeUndefined();
	expect(unitOf(all, null)).toBeUndefined();
	expect(GUIDE.map((id) => unitStep(all[0], id))).toEqual(['plant', 'takeoff', 'landing']);
	expect(unitStep(all[0], 'next-plant')).toBeUndefined();
});
const GUIDE = ['plant', 'takeoff', 'landing'];

test('repeat hops share a touchdown: it is the first hop’s landing and the second’s plant', () => {
	const hops: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'takeoff-2', type: 'takeoff', time: 0.9 },
		{ id: 'landing-2', type: 'landing', time: 1.3 }
	];
	const [first, second] = units(hops, 'repeat-hops');
	expect(second.plant?.id).toBe('landing');
	expect(unitOf([first, second], 'landing')?.id).toBe('takeoff');
	expect(unitStep(second, 'landing')).toBe('plant');
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

const workspace = (state: Partial<Workspace>): Workspace => ({
	mode: 'capture',
	activeId: null,
	selectedId: null,
	emptySlot: null,
	...state
});

test('a settled workspace is left alone', () => {
	const jump = marks.slice(0, 3);
	for (const state of [
		workspace({}),
		workspace({ mode: 'complete', activeId: 'takeoff' }),
		workspace({ mode: 'review', activeId: 'takeoff', selectedId: 'landing' }),
		workspace({ mode: 'results', activeId: 'takeoff' })
	]) {
		expect(settleWorkspace(state, units(jump), jump)).toEqual(state);
	}
});

test('a jump follows its marks when its takeoff is added or undone', () => {
	// The plant-only jump gains its takeoff, which renames it.
	const withTakeoff = marks.slice(0, 2);
	expect(
		settleWorkspace(workspace({ activeId: 'plant' }), units(withTakeoff), withTakeoff).activeId
	).toBe('takeoff');
	// Undoing the takeoff brings back the plant-only jump.
	const plantOnly = marks.slice(0, 1);
	expect(
		settleWorkspace(workspace({ activeId: 'takeoff' }), units(plantOnly), plantOnly).activeId
	).toBe('plant');
});

test('a result without its landing goes back to marking', () => {
	const noLanding = marks.slice(0, 2);
	expect(
		settleWorkspace(
			workspace({ mode: 'complete', activeId: 'takeoff' }),
			units(noLanding),
			noLanding
		).mode
	).toBe('capture');
});

test('marking carries on with the unfinished jump, or starts the next', () => {
	// Undoing a landing while the next jump was up: the unfinished jump comes back.
	const noLanding = marks.slice(0, 2);
	expect(settleWorkspace(workspace({}), units(noLanding), noLanding).activeId).toBe('takeoff');
	// The jump being marked lost its only mark: the next jump is a new one, not the last.
	const jump = marks.slice(0, 3);
	expect(
		settleWorkspace(workspace({ activeId: 'next-plant' }), units(jump), jump).activeId
	).toBeNull();
});

test('review keeps something selected, or ends when nothing is left', () => {
	// The selected landing was removed: the jump's takeoff takes the selection.
	const noLanding = marks.slice(0, 2);
	expect(
		settleWorkspace(
			workspace({ mode: 'review', activeId: 'takeoff', selectedId: 'landing' }),
			units(noLanding),
			noLanding
		)
	).toEqual(workspace({ mode: 'review', activeId: 'takeoff', selectedId: 'takeoff' }));
	// The last mark was removed.
	expect(
		settleWorkspace(workspace({ mode: 'review', activeId: 'plant', selectedId: 'plant' }), [], [])
	).toEqual(workspace({}));
});

test('review of an unpaired mark stays on it', () => {
	const doubled: Mark[] = [
		{ id: 'stray', type: 'takeoff', time: 0 },
		{ id: 'takeoff', type: 'takeoff', time: 0.2 },
		{ id: 'landing', type: 'landing', time: 0.7 }
	];
	const state = workspace({ mode: 'review', selectedId: 'stray' });
	expect(settleWorkspace(state, units(doubled), doubled)).toEqual(state);
});

test('a gap chosen to be filled is dropped once the mark is there', () => {
	const noPlant = marks.slice(1, 3);
	const gap = workspace({ mode: 'review', activeId: 'takeoff', emptySlot: 'plant' });
	expect(settleWorkspace(gap, units(noPlant), noPlant)).toEqual(gap);
	const filled = marks.slice(0, 3);
	expect(settleWorkspace(gap, units(filled), filled)).toEqual(
		workspace({ mode: 'review', activeId: 'takeoff', selectedId: 'takeoff' })
	);
});

test('a mark moved into another jump takes the review with it', () => {
	// Jump 1's landing dragged past jump 2's takeoff: it now ends jump 2's flight.
	const moved: Mark[] = [
		{ id: 'plant', type: 'landing', time: 0 },
		{ id: 'takeoff', type: 'takeoff', time: 0.2 },
		{ id: 'takeoff-2', type: 'takeoff', time: 1.2 },
		{ id: 'landing', type: 'landing', time: 1.5 }
	];
	const all = units(moved);
	expect(unitOf(all, 'landing')?.id).toBe('takeoff-2');
	expect(
		settleWorkspace(
			workspace({ mode: 'review', activeId: 'takeoff', selectedId: 'landing' }),
			all,
			moved
		)
	).toEqual(workspace({ mode: 'review', activeId: 'takeoff-2', selectedId: 'landing' }));
});

test('repeat hops: the shared touchdown stays with the hop it was chosen from', () => {
	const hops: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'takeoff-2', type: 'takeoff', time: 0.9 },
		{ id: 'landing-2', type: 'landing', time: 1.3 }
	];
	const state = workspace({ mode: 'review', activeId: 'takeoff-2', selectedId: 'landing' });
	expect(settleWorkspace(state, units(hops, 'repeat-hops'), hops)).toEqual(state);
});

test('a missing mark is only filled by a mark that lands in the same jump', () => {
	// Two jumps; the second has no plant step.
	const before: Mark[] = [
		...marks.slice(0, 3),
		{ id: 'takeoff-2', type: 'takeoff', time: 1.5 },
		{ id: 'landing-2', type: 'landing', time: 1.9 }
	];
	const second = units(before)[1];
	expect(second.plant).toBeUndefined();
	const withMark = (time: number) => {
		const next = [...before, { id: 'new', type: 'landing' as const, time }].sort(
			(a, b) => a.time - b.time
		);
		return units(next);
	};
	// Between the first landing and the second takeoff: the second jump's plant step.
	expect(fillsSlot(second, 'plant', withMark(1.3), 'new')).toBe(true);
	// After the second landing it would start a third jump instead.
	expect(fillsSlot(second, 'plant', withMark(2.5), 'new')).toBe(false);
	// A jump that has the mark already has nothing to fill.
	expect(fillsSlot(units(before)[0], 'plant', withMark(1.3), 'new')).toBe(false);
});

test('a jump waiting for its takeoff or landing is filled in place', () => {
	const plantOnly = marks.slice(0, 1);
	const [waiting] = units(plantOnly);
	const takeoff = [...plantOnly, { id: 'new', type: 'takeoff' as const, time: 0.2 }];
	expect(fillsSlot(waiting, 'takeoff', units(takeoff), 'new')).toBe(true);

	const noLanding = marks.slice(0, 2);
	const [flying] = units(noLanding);
	const landing = [...noLanding, { id: 'new', type: 'landing' as const, time: 0.7 }];
	expect(fillsSlot(flying, 'landing', units(landing), 'new')).toBe(true);
	expect(fillsSlot(flying, 'takeoff', units(landing), 'new')).toBe(false);
});
