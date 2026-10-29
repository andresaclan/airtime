/**
 * Touch scrubbing on the time tool, after iOS Photos' scrubber: the playhead follows
 * how far the finger moves, not where it is, and how fast it moves sets the rate.
 *
 * - A slow drag steps one frame every `FINE_PX_PER_FRAME`, so a thumb can walk a
 *   jump frame by frame.
 * - A quick swipe covers at least a second per `COARSE_PX_PER_SECOND`, or the whole
 *   clip in one width of the bar if that is more, so one swipe reaches the next
 *   moment of interest whatever the frame rate.
 *
 * In between the rate eases from one to the other, as a trackpad's pointer does.
 */

/** Finger travel per frame on a slow drag. */
export const FINE_PX_PER_FRAME = 7;
/** Finger travel per second of video on a quick swipe, at least. */
export const COARSE_PX_PER_SECOND = 160;
/** Finger speeds, in px/ms, where the rate starts leaving fine and reaches coarse. */
export const SLOW_PX_PER_MS = 0.15;
export const FAST_PX_PER_MS = 0.8;

/** How quickly the speed estimate forgets, in ms: a pause leaves none of a swipe's speed. */
const SPEED_MEMORY_MS = 32;

/** The finger's speed in px/ms after it moves `dx` px in `dt` ms, smoothed over recent moves. */
export function fingerSpeed(previous: number, dx: number, dt: number): number {
	const elapsed = Math.max(1, dt);
	const keep = Math.exp(-elapsed / SPEED_MEMORY_MS);
	return previous * keep + (Math.abs(dx) / elapsed) * (1 - keep);
}

/** How many frames one pixel of finger travel moves the playhead at `speed` (px/ms). */
export function framesPerPx(
	speed: number,
	fps: number,
	frameCount: number,
	trackWidth: number
): number {
	const fine = 1 / FINE_PX_PER_FRAME;
	const coarse = Math.max(
		fine,
		fps > 0 ? fps / COARSE_PX_PER_SECOND : 0,
		trackWidth > 0 && Number.isFinite(frameCount) ? frameCount / trackWidth : 0
	);
	const t = Math.max(0, Math.min(1, (speed - SLOW_PX_PER_MS) / (FAST_PX_PER_MS - SLOW_PX_PER_MS)));
	return fine + (coarse - fine) * t * t * (3 - 2 * t);
}
