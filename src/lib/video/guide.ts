/** The marking guide: which mark a jump needs next, read from the marks placed so far. */
import { sortMarks, type Mark, type MarkType } from './marks';
import type { JumpType } from '$lib/session/schema';

/**
 * A jump is marked in the order it happens: the touchdown before it (an approach jump's
 * plant step), the takeoff, then the landing. `done` once the latest takeoff has landed.
 */
export type GuideStep = 'plant' | 'takeoff' | 'landing' | 'done';

export const GUIDE_STEPS = ['plant', 'takeoff', 'landing'] as const;

/** The button each step is marked with. The plant step is a landing: the foot touches down. */
export const STEP_MARK: Record<Exclude<GuideStep, 'done'>, MarkType> = {
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

const HIDDEN_KEY = 'airtime:markingGuideHidden';

/** Shown until the athlete hides it; it comes back from the keyboard shortcuts dialog. */
export function isGuideHidden(): boolean {
	try {
		return localStorage.getItem(HIDDEN_KEY) === 'true';
	} catch {
		return false;
	}
}

export function setGuideHidden(hidden: boolean): void {
	try {
		if (hidden) localStorage.setItem(HIDDEN_KEY, 'true');
		else localStorage.removeItem(HIDDEN_KEY);
	} catch {
		// Storage unavailable; the choice lasts until the page reloads.
	}
}

/** What the touchdown before the takeoff is called for each jump type. */
export function plantLabel(jumpType: JumpType | null): string {
	if (jumpType === 'drop-jump') return 'Box landing';
	if (jumpType === 'repeat-hops') return 'Touchdown';
	return 'Plant step';
}
