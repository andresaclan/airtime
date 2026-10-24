/**
 * Conversions between frame indexes and media time. Every seek and every frame
 * lookup goes through here, so the frame on screen is the frame Airtime records.
 *
 * - Frame k occupies [k / fps, (k + 1) / fps). Stored times (marks, exports,
 *   saved sessions) are frame starts: k / fps.
 * - Seeks go to the middle of a frame, (k + 0.5) / fps. At a frame start,
 *   browsers often still show the previous frame; the middle is unambiguous.
 * - A playhead time maps to the frame it falls in (floor), with a small
 *   tolerance so k / fps, and copies of it rounded for export, still map to k
 *   despite floating-point error.
 */

/** Fraction of a frame by which a time may fall short of a frame start and still count as it. */
export const FRAME_TOLERANCE = 1e-3;

/** The frame a playhead or stored time falls in. */
export function frameAt(time: number, fps: number): number {
	if (!(time > 0) || !(fps > 0)) return 0;
	return Math.floor(time * fps + FRAME_TOLERANCE);
}

/**
 * The frame whose middle-of-frame seek shows the frame presented at `mediaTime`
 * (`requestVideoFrameCallback` metadata). Rounding rather than flooring keeps it
 * consistent with `frameSeekTime` even if a file's frames don't start exactly on
 * multiples of 1 / fps.
 */
export function frameOfPresentedTime(mediaTime: number, fps: number): number {
	if (!(mediaTime > 0) || !(fps > 0)) return 0;
	return Math.round(mediaTime * fps);
}

/** Start of frame k: the time stored for a mark on that frame. */
export function frameStartTime(frame: number, fps: number): number {
	return frame / fps;
}

/** Middle of frame k: where to seek to show it. Never past `duration`, when known. */
export function frameSeekTime(frame: number, fps: number, duration = Infinity): number {
	const time = (Math.max(0, frame) + 0.5) / fps;
	return duration > 0 ? Math.min(time, duration) : time;
}

/** Index of the last frame that starts before `duration`; Infinity while the duration is unknown. */
export function lastFrameIndex(duration: number, fps: number): number {
	if (!(fps > 0) || !Number.isFinite(duration) || !(duration > 0)) return Infinity;
	return Math.max(0, Math.ceil(duration * fps - FRAME_TOLERANCE) - 1);
}

export function clampFrame(frame: number, duration: number, fps: number): number {
	return Math.max(0, Math.min(lastFrameIndex(duration, fps), frame));
}

/** Snaps any time to the start of the frame it falls in. */
export function snapToFrameStart(time: number, fps: number): number {
	return frameStartTime(frameAt(time, fps), fps);
}
