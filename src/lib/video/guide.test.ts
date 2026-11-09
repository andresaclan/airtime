import { describe, expect, test } from 'vitest';
import { guideStep, markAction, markStep, plantLabel, stepLabel } from './guide';
import type { Mark } from './marks';
import type { JumpType } from '$lib/session/schema';

/**
 * One mark per letter, a frame apart at 1 fps: `P`/`L` a landing, `T` a takeoff, and
 * `.` an unmarked frame.
 */
function marks(sequence: string): Mark[] {
	return [...sequence].flatMap((letter, index) =>
		letter === '.'
			? []
			: [{ id: `${letter}${index}`, type: letter === 'T' ? 'takeoff' : 'landing', time: index }]
	);
}

/** What marking does on frame `frame` of `sequence`, at 1 fps. */
function actionAt(sequence: string, frame: number, jumpType: JumpType | null = 'approach') {
	const action = markAction(marks(sequence), frame, 1, jumpType);
	return action.kind === 'add'
		? action.step
		: action.kind === 'on-frame'
			? `on ${action.step}`
			: 'choose';
}

describe('guideStep', () => {
	test('walks an approach jump in order: plant step, takeoff, landing', () => {
		expect(guideStep(marks(''))).toBe('plant');
		expect(guideStep(marks('P'))).toBe('takeoff');
		expect(guideStep(marks('PT'))).toBe('landing');
		expect(guideStep(marks('PTL'))).toBe('done');
	});

	test('a jump marked without its plant step is still done', () => {
		expect(guideStep(marks('T'))).toBe('landing');
		expect(guideStep(marks('TL'))).toBe('done');
	});

	test('the next jump starts again from its plant step', () => {
		expect(guideStep(marks('PTLP'))).toBe('takeoff');
		expect(guideStep(marks('PTLPT'))).toBe('landing');
	});

	test('follows the latest mark in the video, not the order they were placed', () => {
		const placed = marks('PTL').reverse();
		expect(guideStep(placed)).toBe('done');
	});

	test('a repeated landing still asks for the takeoff', () => {
		expect(guideStep(marks('PP'))).toBe('takeoff');
	});
});

describe('plantLabel', () => {
	test('names the touchdown before takeoff for each jump type', () => {
		expect(plantLabel('approach')).toBe('Plant step');
		expect(plantLabel(null)).toBe('Plant step');
		expect(plantLabel('drop-jump')).toBe('Box landing');
		expect(plantLabel('repeat-hops')).toBe('Touchdown');
	});
});

describe('markAction', () => {
	test('walks an approach jump forward: plant step, takeoff, landing, then the next plant step', () => {
		expect(actionAt('', 0)).toBe('plant');
		expect(actionAt('P', 1)).toBe('takeoff');
		expect(actionAt('PT', 2)).toBe('landing');
		expect(actionAt('PTL', 3)).toBe('plant');
	});

	test('names the mark on the frame on screen', () => {
		expect(actionAt('PTL', 0)).toBe('on plant');
		expect(actionAt('PTL', 1)).toBe('on takeoff');
		expect(actionAt('PTL', 2)).toBe('on landing');
	});

	test('follows the playhead, not the last mark: going back suggests what belongs there', () => {
		// The takeoff and landing are in; the plant step before them is missing.
		expect(actionAt('.TL', 0)).toBe('plant');
		// The second jump is missing its plant step.
		expect(actionAt('PTL..TL', 3)).toBe('plant');
	});

	test('asks for a choice where the step that would follow is already marked next', () => {
		// Between a takeoff and its landing, another landing would sit beside one.
		expect(actionAt('PT.L', 2)).toBe('choose');
		// Before a plant step, another touchdown would sit beside it.
		expect(actionAt('.P', 0)).toBe('choose');
		// A takeoff with no landing: the next jump's plant step already ends its flight.
		expect(actionAt('PT..PTL', 2)).toBe('choose');
	});

	test('repeat hops reuse a landing as the next touchdown', () => {
		expect(actionAt('PTL', 3, 'repeat-hops')).toBe('takeoff');
		expect(actionAt('PTLT', 4, 'repeat-hops')).toBe('landing');
	});

	test('a drop jump starts each jump from its box landing', () => {
		expect(actionAt('PTL', 3, 'drop-jump')).toBe('plant');
	});
});

describe('markStep', () => {
	test('a landing after a takeoff ends the flight; any other landing starts a contact', () => {
		const sequence = marks('PTLPTL');
		expect(sequence.map((mark) => markStep(sequence, mark))).toEqual([
			'plant',
			'takeoff',
			'landing',
			'plant',
			'takeoff',
			'landing'
		]);
	});
});

describe('stepLabel', () => {
	test('names the first touchdown by jump type and the rest plainly', () => {
		expect(stepLabel('plant', 'approach')).toBe('Plant step');
		expect(stepLabel('plant', 'drop-jump')).toBe('Box landing');
		expect(stepLabel('takeoff', 'drop-jump')).toBe('Takeoff');
		expect(stepLabel('landing', 'repeat-hops')).toBe('Landing');
	});
});
