import { describe, expect, test } from 'vitest';
import { guideStep, plantLabel } from './guide';
import type { Mark } from './marks';

/** One mark per letter, a frame apart at 1 fps: `P`/`L` a landing, `T` a takeoff. */
function marks(sequence: string): Mark[] {
	return [...sequence].map((letter, index) => ({
		id: `${letter}${index}`,
		type: letter === 'T' ? 'takeoff' : 'landing',
		time: index
	}));
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
