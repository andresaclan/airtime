/**
 * The time tool at `/`: one in point and one out point, and the time between them.
 *
 * Points are stored as marks so the shared timeline can draw them: the in point is a
 * takeoff mark and the out point a landing. That mapping stays in here; the page
 * only ever says In and Out.
 */
import { frameAt, frameStartTime, type Timing } from './frames';
import { frameOf, newId, sortMarks, type Mark, type MarkType } from './marks';

export type TimerPoint = 'in' | 'out';

export const POINT_MARK: Record<TimerPoint, MarkType> = { in: 'takeoff', out: 'landing' };

/** What the timeline calls each point, for its buttons' labels. */
export const POINT_LABELS: Record<MarkType, string> = { takeoff: 'in point', landing: 'out point' };

export function pointOf(mark: Mark): TimerPoint {
	return mark.type === POINT_MARK.in ? 'in' : 'out';
}

export function findPoint(marks: Mark[], point: TimerPoint): Mark | undefined {
	return marks.find((mark) => mark.type === POINT_MARK[point]);
}

/**
 * Sets the in or out point on the frame at playhead `time`, moving it if it was set
 * elsewhere. Setting it again on the same frame clears it, and the other point is
 * cleared if it sat on that frame.
 */
export function setPoint(marks: Mark[], point: TimerPoint, time: number, timing: Timing): Mark[] {
	const type = POINT_MARK[point];
	const frame = frameAt(time, timing);
	const previous = marks.find((mark) => mark.type === type);
	const rest = marks.filter((mark) => mark.type !== type && frameOf(mark.time, timing) !== frame);
	if (previous && frameOf(previous.time, timing) === frame) return sortMarks(rest);
	return sortMarks([...rest, { id: newId(), type, time: frameStartTime(frame, timing) }]);
}

/**
 * Sets `point` on `frame` from a hold on the timeline (see VideoScrubber). A hold
 * only ever places a point: on the frame the point already has, or the other
 * point's frame, it changes nothing and returns null, where `setPoint` would clear.
 */
export function holdPoint(
	marks: Mark[],
	point: TimerPoint,
	frame: number,
	timing: Timing
): Mark[] | null {
	if (marks.some((mark) => frameOf(mark.time, timing) === frame)) return null;
	return setPoint(marks, point, frameStartTime(frame, timing), timing);
}

export type Elapsed = {
	/** Real-world seconds between the two points' frames (see `timeScale` in marks.ts). */
	seconds: number;
	frames: number;
	/** The out point comes before the in point; the time between them is still shown. */
	reversed: boolean;
};

/** The time between the in and out points, once both are set. */
export function elapsed(marks: Mark[], timing: Timing, timeScale = 1): Elapsed | null {
	const inMark = findPoint(marks, 'in');
	const outMark = findPoint(marks, 'out');
	if (!inMark || !outMark) return null;
	const [from, to] = inMark.time <= outMark.time ? [inMark, outMark] : [outMark, inMark];
	const fromFrame = frameOf(from.time, timing);
	const toFrame = frameOf(to.time, timing);
	return {
		seconds: (frameStartTime(toFrame, timing) - frameStartTime(fromFrame, timing)) * timeScale,
		frames: toFrame - fromFrame,
		reversed: from !== inMark
	};
}
