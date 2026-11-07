/**
 * What to mark next: the step a jump needs at the frame on screen, the name each mark
 * goes by, and the one-line hint that explains a step until the athlete knows them.
 */
import { frameOf, sortMarks, type Mark, type MarkType } from './marks';
import type { Timing } from './frames';
import type { JumpType } from '$lib/session/schema';

/**
 * A jump is marked in the order it happens: the touchdown before it (an approach jump's
 * plant step), the takeoff, then the landing. `done` once the latest takeoff has landed.
 */
export type GuideStep = 'plant' | 'takeoff' | 'landing' | 'done';
export type MarkStep = Exclude<GuideStep, 'done'>;

export const GUIDE_STEPS = ['plant', 'takeoff', 'landing'] as const;

/** The mark type each step is stored as. The plant step is a landing: the foot touches down. */
export const STEP_MARK: Record<MarkStep, MarkType> = {
	plant: 'landing',
	takeoff: 'takeoff',
	landing: 'landing'
};

/** Follows the latest mark in the video, so marks placed in any order still lead somewhere. */
export function guideStep(marks: Mark[]): GuideStep {
	const sorted = sortMarks(marks);
	const last = sorted.at(-1);
	if (!last) return 'plant';
	if (last.type === 'takeoff') return 'landing';
	return sorted.at(-2)?.type === 'takeoff' ? 'done' : 'takeoff';
}

/** The step a mark is: a landing straight after a takeoff ends a flight; any other starts a contact. */
function stepAt(sorted: Mark[], index: number): MarkStep {
	if (sorted[index].type === 'takeoff') return 'takeoff';
	return sorted[index - 1]?.type === 'takeoff' ? 'landing' : 'plant';
}

/** The step that follows the mark at `index` (or starts the clip, for -1). */
function stepAfter(sorted: Mark[], index: number, jumpType: JumpType | null): MarkStep {
	if (index < 0) return 'plant';
	const step = stepAt(sorted, index);
	if (step === 'takeoff') return 'landing';
	if (step === 'plant') return 'takeoff';
	// A landing ends the jump. Repeat hops reuse it as the next hop's touchdown;
	// other jumps start again from their own touchdown.
	return jumpType === 'repeat-hops' ? 'takeoff' : 'plant';
}

/**
 * What marking does at `frame`, worked out from the marks around it rather than the last
 * one in the clip, so going back to fill a gap suggests what belongs there.
 * - `add`: the step that belongs here.
 * - `on-frame`: a mark is already on this frame.
 * - `choose`: the step that would follow the mark before is already marked after this
 *   frame, so nothing obviously belongs here and the athlete picks the type.
 */
export type MarkAction =
	| { kind: 'add'; step: MarkStep; type: MarkType }
	| { kind: 'on-frame'; step: MarkStep; mark: Mark }
	| { kind: 'choose' };

export function markAction(
	marks: Mark[],
	frame: number,
	timing: Timing,
	jumpType: JumpType | null
): MarkAction {
	const sorted = sortMarks(marks);
	const frames = sorted.map((mark) => frameOf(mark.time, timing));
	const onFrame = frames.indexOf(frame);
	if (onFrame >= 0)
		return { kind: 'on-frame', step: stepAt(sorted, onFrame), mark: sorted[onFrame] };
	const next = frames.findIndex((markFrame) => markFrame > frame);
	const prev = (next < 0 ? sorted.length : next) - 1;
	const step = stepAfter(sorted, prev, jumpType);
	const type = STEP_MARK[step];
	if (next >= 0 && sorted[next].type === type) return { kind: 'choose' };
	return { kind: 'add', step, type };
}

/** The step a placed mark is, for naming it. */
export function markStep(marks: Mark[], mark: Mark): MarkStep {
	const sorted = sortMarks(marks);
	const index = sorted.findIndex((candidate) => candidate.id === mark.id);
	return index < 0 ? (mark.type === 'takeoff' ? 'takeoff' : 'landing') : stepAt(sorted, index);
}

/** What the touchdown before the takeoff is called for each jump type. */
export function plantLabel(jumpType: JumpType | null): string {
	if (jumpType === 'drop-jump') return 'Box landing';
	if (jumpType === 'repeat-hops') return 'Touchdown';
	return 'Plant step';
}

export function stepLabel(step: MarkStep, jumpType: JumpType | null): string {
	if (step === 'plant') return plantLabel(jumpType);
	return step === 'takeoff' ? 'Takeoff' : 'Landing';
}

/** Which frame a step is, as the hint says it. */
export function stepDefinition(step: MarkStep, jumpType: JumpType | null): string {
	if (step === 'takeoff') return 'First frame both feet are off the ground.';
	if (step === 'landing') return 'First frame your feet touch back down.';
	if (jumpType === 'drop-jump') return 'First frame your feet touch the ground after the box.';
	if (jumpType === 'repeat-hops') return 'First frame your feet touch down before the first hop.';
	return 'First frame your plant foot touches the ground.';
}

// The hint keeps the old guide's key, so an athlete who hid the guide doesn't get it back.
const HIDDEN_KEY = 'airtime:markingGuideHidden';
const MEASURED_KEY = 'airtime:measuredJumps';
/** The hint retires itself once the athlete has measured this many jumps. */
export const HINT_RETIRES_AFTER = 3;

/** Shown until the athlete hides it or it retires; it comes back from the keyboard shortcuts dialog. */
export function isHintHidden(): boolean {
	try {
		return localStorage.getItem(HIDDEN_KEY) === 'true';
	} catch {
		return false;
	}
}

export function setHintHidden(hidden: boolean): void {
	try {
		if (hidden) localStorage.setItem(HIDDEN_KEY, 'true');
		else {
			localStorage.removeItem(HIDDEN_KEY);
			localStorage.removeItem(MEASURED_KEY);
		}
	} catch {
		// Storage unavailable; the choice lasts until the page reloads.
	}
}

/** Counts a newly measured jump; true once the hint has retired. */
export function noteMeasuredJump(): boolean {
	try {
		const count = (Number(localStorage.getItem(MEASURED_KEY)) || 0) + 1;
		localStorage.setItem(MEASURED_KEY, String(count));
		if (count < HINT_RETIRES_AFTER) return false;
		localStorage.setItem(HIDDEN_KEY, 'true');
		return true;
	} catch {
		return false;
	}
}
