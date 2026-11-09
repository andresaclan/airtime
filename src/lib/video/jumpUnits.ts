import { groupJumps, sortMarks, type Analysis, type Interval, type Mark } from './marks';

/** A capture can have its plant before it has a takeoff. IDs are derived, never stored. */
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

export function bestUnit(units: JumpUnit[]): JumpUnit | undefined {
	return units
		.filter((unit) => unit.flight)
		.reduce<
			JumpUnit | undefined
		>((best, unit) => (!best || unit.flight!.realSeconds > best.flight!.realSeconds ? unit : best), undefined);
}
