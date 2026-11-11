import { groupJumps, sortMarks, type Analysis, type Interval, type Mark } from './marks';
import type { MarkStep } from './guide';

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

/** What the workspace is showing: marking a jump, its result, correcting it, or the session. */
export type WorkspaceMode = 'capture' | 'complete' | 'review' | 'results';

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

/** The jump a mark belongs to. Repeat hops share a touchdown: the earlier hop wins. */
export function unitOf(units: JumpUnit[], markId: string | null): JumpUnit | undefined {
	if (!markId) return undefined;
	return units.find((unit) => unitMarks(unit).some((mark) => mark.id === markId));
}

/** Which of a jump's three marks this one is. */
export function unitStep(unit: JumpUnit, markId: string): MarkStep | undefined {
	if (unit.takeoff?.id === markId) return 'takeoff';
	if (unit.landing?.id === markId) return 'landing';
	return unit.plant?.id === markId ? 'plant' : undefined;
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

/** Mean flight of the measured jumps, in real seconds. */
export function averageFlight(units: JumpUnit[]): number | undefined {
	const flights = units.flatMap((unit) => (unit.flight ? [unit.flight.realSeconds] : []));
	return flights.length
		? flights.reduce((sum, value) => sum + value, 0) / flights.length
		: undefined;
}

/** What the workspace points at: its state, the jump in it, and what is being corrected. */
export type Workspace = {
	mode: WorkspaceMode;
	/** The jump in the workspace; null while the next one has no marks yet. */
	activeId: string | null;
	/** Review: the mark being corrected. */
	selectedId: string | null;
	/** Review: the active jump's missing mark chosen to be added, instead of a mark. */
	emptySlot: MarkStep | null;
};

/**
 * Marks change under the workspace (an undo, a removed mark, a restored draft), so what
 * it points at is checked against them: a jump, a mark or a gap that no longer exists
 * gives way to the nearest thing that does.
 */
export function settleWorkspace(state: Workspace, units: JumpUnit[], marks: Mark[]): Workspace {
	let { mode, activeId, selectedId, emptySlot } = state;
	let active = units.find((unit) => unit.id === activeId);
	if (activeId && !active) {
		// A jump is named after its takeoff, so it changes name as it gains or loses one.
		active = unitOf(units, selectedId) ?? units.at(-1);
		activeId = active?.id ?? null;
	}
	if (selectedId && !marks.some((mark) => mark.id === selectedId)) selectedId = null;
	// A mark moved out of its jump takes the workspace with it, to the jump it's in now
	// or to none. A touchdown repeat hops share stays with the hop it was chosen from.
	if (mode === 'review' && selectedId && !(active && unitStep(active, selectedId))) {
		active = unitOf(units, selectedId);
		activeId = active?.id ?? null;
	}
	if (emptySlot && (!active || active[emptySlot])) emptySlot = null;
	if (mode === 'complete' && !active?.flight) mode = 'capture';
	if (mode === 'review' && !selectedId && !emptySlot) {
		const mark = active?.takeoff ?? active?.plant;
		if (mark) selectedId = mark.id;
		else mode = 'capture';
	}
	// Marking carries on with the jump still waiting for a mark, or starts the next one.
	if (mode === 'capture' && (!active || active.flight)) {
		const last = units.at(-1);
		activeId = last && !last.flight ? last.id : null;
	}
	return { mode, activeId, selectedId, emptySlot };
}

/**
 * Whether adding the mark `markId` gave `unit` its missing `step`: the mark is that
 * step of the same jump in `after`, the jumps as they are with it. A mark that would
 * start another jump, or end a different one, doesn't.
 */
export function fillsSlot(
	unit: JumpUnit,
	step: MarkStep,
	after: JumpUnit[],
	markId: string
): boolean {
	// A jump keeps its takeoff; one still waiting for a takeoff keeps its plant.
	const anchor = step === 'takeoff' ? 'plant' : 'takeoff';
	const kept = unit[anchor];
	if (!kept || unit[step]) return false;
	return after.some((filled) => filled[step]?.id === markId && filled[anchor]?.id === kept.id);
}
