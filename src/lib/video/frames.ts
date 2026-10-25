/**
 * Conversions between frame indexes and media time. Every seek and every frame
 * lookup goes through here, so the frame on screen is the frame Airtime records.
 *
 * With a timing table (`frameTimes`, read from the file by frameRate.ts) frame k
 * is the k-th frame that plays, whatever the spacing: variable frame rate, an
 * iPhone slow-motion pre-roll, an edit list that delays the first frame.
 *
 * - Frame k occupies [frameTimes[k], frameTimes[k + 1]). Stored times (marks,
 *   exports, saved sessions) are frame starts: frameTimes[k].
 * - Seeks go to the middle of a frame. At a frame start, browsers often still
 *   show the previous frame; the middle is unambiguous.
 * - A playhead time maps to the frame it falls in (floor), with a small
 *   tolerance for floating-point error.
 *
 * Without a table (WebM, or a file that couldn't be parsed) frames are assumed
 * evenly spaced: frame k occupies [k / fps, (k + 1) / fps).
 */

/** Frame timing: a frame rate, plus the time of every frame when the file gave them. */
export type FrameTiming = {
	/** Frames per second; with a table, the rate of its regularly spaced frames. */
	fps: number;
	/** Presentation time in seconds of every frame that plays, ascending. */
	frameTimes?: readonly number[] | null;
};

/** A frame timing, or just a constant frame rate. */
export type Timing = FrameTiming | number;

/** Fraction of a frame by which a time may fall short of a frame start and still count as it. */
export const FRAME_TOLERANCE = 1e-3;

/**
 * How far a stored time may be from a table entry and still be that frame's start:
 * exports round times to the microsecond.
 */
const STORED_TIME_TOLERANCE = 2e-6;

function rateOf(timing: Timing): number {
	return typeof timing === 'number' ? timing : timing.fps;
}

function tableOf(timing: Timing): readonly number[] | null {
	if (typeof timing === 'number') return null;
	return timing.frameTimes?.length ? timing.frameTimes : null;
}

/** Index of the last entry at or before `time`; 0 when `time` comes before them all. */
function lastAtOrBefore(times: readonly number[], time: number): number {
	let low = 0;
	let high = times.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (times[middle] <= time) low = middle;
		else high = middle - 1;
	}
	return low;
}

function nearest(times: readonly number[], time: number): number {
	const before = lastAtOrBefore(times, time);
	const after = Math.min(before + 1, times.length - 1);
	return Math.abs(times[after] - time) < Math.abs(time - times[before]) ? after : before;
}

/** The frame a playhead falls in: the frame the browser shows there. */
export function frameAt(time: number, timing: Timing): number {
	const fps = rateOf(timing);
	const times = tableOf(timing);
	if (times) {
		if (!Number.isFinite(time)) return 0;
		const tolerance = fps > 0 ? FRAME_TOLERANCE / fps : 0;
		return lastAtOrBefore(times, time + tolerance);
	}
	if (!(time > 0) || !(fps > 0)) return 0;
	return Math.floor(time * fps + FRAME_TOLERANCE);
}

/**
 * The frame a stored (mark) time refers to. New marks store a table entry exactly.
 * Marks saved before Airtime used the table store `k / fps`, the start of a frame
 * on an even grid, which can sit a little before the real frame start (timestamps
 * rounded to 600 ticks per second) or in a gap between frames (variable frame
 * rate). Those map to the frame the app showed for them, where a seek to the
 * middle of grid frame k, (k + 0.5) / fps, lands.
 *
 * Without a table (and in exports, which only know the rate) a stored time is the
 * nearest grid frame: a real frame start can sit a little either side of k / fps.
 */
export function frameOfMarkTime(time: number, timing: Timing): number {
	const fps = rateOf(timing);
	const times = tableOf(timing);
	if (!(fps > 0) || !Number.isFinite(time)) return frameAt(time, timing);
	if (!times) return Math.max(0, Math.round(time * fps));
	const closest = nearest(times, time);
	if (Math.abs(times[closest] - time) <= STORED_TIME_TOLERANCE) return closest;
	return frameAt((Math.round(time * fps) + 0.5) / fps, timing);
}

/**
 * The frame presented at `mediaTime` (`requestVideoFrameCallback` metadata). With a
 * table that is the nearest frame time: browsers report it with float error (WebKit
 * especially), so it's never compared exactly.
 */
export function frameOfPresentedTime(mediaTime: number, timing: Timing): number {
	const fps = rateOf(timing);
	const times = tableOf(timing);
	if (times) return Number.isFinite(mediaTime) ? nearest(times, mediaTime) : 0;
	if (!(mediaTime > 0) || !(fps > 0)) return 0;
	// Rounding rather than flooring keeps it consistent with `frameSeekTime` even if
	// a file's frames don't start exactly on multiples of 1 / fps.
	return Math.round(mediaTime * fps);
}

/** Start of frame k: the time stored for a mark on that frame. */
export function frameStartTime(frame: number, timing: Timing): number {
	const times = tableOf(timing);
	if (times) return times[Math.max(0, Math.min(times.length - 1, frame))];
	return frame / rateOf(timing);
}

/** Middle of frame k: where to seek to show it. Never past `duration`, when known. */
export function frameSeekTime(frame: number, timing: Timing, duration = Infinity): number {
	const fps = rateOf(timing);
	const times = tableOf(timing);
	let time: number;
	if (times) {
		const k = Math.max(0, Math.min(times.length - 1, frame));
		// The last frame lasts until the end of the video, or one nominal frame.
		let end = k + 1 < times.length ? times[k + 1] : times[k] + 1 / fps;
		if (k + 1 === times.length && duration > times[k]) end = Math.min(end, duration);
		time = (times[k] + end) / 2;
	} else {
		time = (Math.max(0, frame) + 0.5) / fps;
	}
	return duration > 0 ? Math.min(time, duration) : time;
}

/** Index of the last frame; without a table, the last that starts before `duration` (Infinity while unknown). */
export function lastFrameIndex(duration: number, timing: Timing): number {
	const fps = rateOf(timing);
	const times = tableOf(timing);
	if (times) return times.length - 1;
	if (!(fps > 0) || !Number.isFinite(duration) || !(duration > 0)) return Infinity;
	return Math.max(0, Math.ceil(duration * fps - FRAME_TOLERANCE) - 1);
}

export function clampFrame(frame: number, duration: number, timing: Timing): number {
	return Math.max(0, Math.min(lastFrameIndex(duration, timing), frame));
}

/** Snaps any time to the start of the frame it falls in. */
export function snapToFrameStart(time: number, timing: Timing): number {
	return frameStartTime(frameAt(time, timing), timing);
}

/**
 * The frame number a timecode shows for frame k: its place on the frame-rate grid,
 * counted from the first frame. With a table this follows real time, so it skips
 * numbers where frames were dropped and starts at 0 even if the video doesn't.
 */
export function frameLabel(frame: number, timing: Timing): number {
	const times = tableOf(timing);
	const fps = rateOf(timing);
	if (!times || !(fps > 0)) return frame;
	return Math.round((frameStartTime(frame, timing) - times[0]) * fps);
}

/** Shortest and longest frame in the table, in seconds; null without one. */
export function frameDurationRange(timing: Timing): [number, number] | null {
	const times = tableOf(timing);
	if (!times || times.length < 2) return null;
	let shortest = Infinity;
	let longest = 0;
	for (let k = 1; k < times.length; k += 1) {
		const gap = times[k] - times[k - 1];
		shortest = Math.min(shortest, gap);
		longest = Math.max(longest, gap);
	}
	return [shortest, longest];
}

/**
 * The real start of the frame a stored time refers to. Without a table the stored
 * time already is one, and comes back unchanged.
 */
export function markFrameStart(time: number, timing: Timing): number {
	return tableOf(timing) ? frameStartTime(frameOfMarkTime(time, timing), timing) : time;
}
