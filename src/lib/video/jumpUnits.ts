import { frameOf, groupJumps, sortMarks, type Analysis, type Interval, type Mark } from './marks';
import type { Timing } from './frames';

/**
 * A jump as the workspace shows it: its plant step, takeoff and landing, with the
 * flight and contact they give. A jump being marked can have its plant before it has
 * a takeoff. IDs are derived from the marks, never stored.
 */
export type JumpUnit = {
	id: string;
	plant?: Mark;
	takeoff?: Mark;
	landing?: Mark;
	flight?: Interval;
	contact?: Interval;
};

export function jumpUnits(marks: Mark[], analysis: Analysis): JumpUnit[] {
	const { jumps } = groupJumps(marks, analysis);
	const units: JumpUnit[] = jumps.map((jump) => ({
		...jump,
		id: jump.takeoff.id,
		plant: jump.contact?.from
	}));
	const sorted = sortMarks(marks);
	const last = sorted.at(-1);
	if (last?.type === 'landing' && sorted.at(-2)?.type !== 'takeoff') {
		units.push({ id: last.id, plant: last });
	}
	return units;
}

export function unitMarks(unit: JumpUnit): Mark[] {
	return [unit.plant, unit.takeoff, unit.landing].filter((mark): mark is Mark => !!mark);
}

/** Marks that no jump uses. */
export function unpairedMarks(marks: Mark[], units: JumpUnit[]): Mark[] {
	const used = new Set(units.flatMap((unit) => unitMarks(unit).map((mark) => mark.id)));
	return marks.filter((mark) => !used.has(mark.id));
}

export function bestUnit(units: JumpUnit[]): JumpUnit | undefined {
	return units
		.filter((unit) => unit.flight)
		.reduce<
			JumpUnit | undefined
		>((best, unit) => (!best || unit.flight!.realSeconds > best.flight!.realSeconds ? unit : best), undefined);
}

/** Compare at the precision displayed to the athlete. */
export function bestFlightLabel(unit: JumpUnit, completed: JumpUnit[], best?: JumpUnit): string {
	if (!best?.flight || !unit.flight) return '';
	const longest = Math.round(best.flight.realSeconds * 1000);
	if (Math.round(unit.flight.realSeconds * 1000) !== longest) return '';
	return completed.filter(
		(candidate) => candidate.flight && Math.round(candidate.flight.realSeconds * 1000) === longest
	).length > 1
		? 'Joint best'
		: 'Best';
}

/** Mean flight of the measured jumps, in real seconds. */
export function averageFlight(units: JumpUnit[]): number | undefined {
	const flights = units.flatMap((unit) => (unit.flight ? [unit.flight.realSeconds] : []));
	return flights.length
		? flights.reduce((sum, value) => sum + value, 0) / flights.length
		: undefined;
}

/**
 * The jump the playhead is in, or the last one it has passed: the latest jump whose first
 * mark is on or before `frame`. Before the first jump, the first.
 */
export function unitAt(units: JumpUnit[], frame: number, timing: Timing): JumpUnit | undefined {
	return (
		units.findLast((unit) => {
			const first = unitMarks(unit)[0];
			return !!first && frameOf(first.time, timing) <= frame;
		}) ?? units[0]
	);
}
