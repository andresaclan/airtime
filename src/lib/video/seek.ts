import { frameAt, type FrameTiming } from './frames';

/**
 * Seeking that keeps up with a finger or a mouse. Every seek in the app goes
 * through `seek`.
 *
 * - A seek lands only after the browser decodes from the last keyframe, which on
 *   long-GOP clips (iPhone video, slow motion) takes far longer than the gap
 *   between pointer moves. Setting `currentTime` again before it lands restarts
 *   that decode, so the picture freezes until the pointer stops. Instead one seek
 *   is in flight at a time and, when it lands, the next goes to the latest target.
 * - A preview (scrubCache.ts, drawn by VideoViewer) shows the target frame straight
 *   away from frames decoded in advance, until the video itself shows it.
 */

/** Shows a frame immediately, before the video's own seek lands. */
export type SeekPreview = { show(frame: number): void; hide(): void };

/** Dispatched on the video whenever `seek` changes the target, so the playhead can follow it. */
export const SEEK_EVENT = 'airtime:seek';

const previews = new WeakMap<HTMLVideoElement, SeekPreview>();
/** Latest target, while it hasn't been handed to the video yet. */
const pending = new WeakMap<HTMLVideoElement, number>();
/** Latest target handed to the video, until that seek lands. */
const inFlight = new WeakMap<HTMLVideoElement, number>();

export function registerSeekPreview(video: HTMLVideoElement, preview: SeekPreview): () => void {
	previews.set(video, preview);
	return () => {
		if (previews.get(video) === preview) previews.delete(video);
	};
}

function start(video: HTMLVideoElement, time: number) {
	inFlight.set(video, time);
	video.currentTime = time;
	video.addEventListener(
		'seeked',
		() => {
			if (inFlight.get(video) === time) inFlight.delete(video);
			const next = pending.get(video);
			if (next === undefined) return;
			pending.delete(video);
			start(video, next);
		},
		{ once: true }
	);
}

/** Videos playing only so VideoViewer can measure the frame rate, not for the athlete. */
const probing = new WeakSet<HTMLVideoElement>();

export function setProbing(video: HTMLVideoElement, on: boolean) {
	if (on) probing.add(video);
	else probing.delete(video);
}

/** True while `setProbing` is on and no seek has cut the probe short. */
export function isProbing(video: HTMLVideoElement): boolean {
	return probing.has(video);
}

/** Playing for the athlete to watch, rather than for a frame-rate probe. */
export function isWatching(video: HTMLVideoElement): boolean {
	return !video.paused && !probing.has(video);
}

/**
 * Seeks to `time` (a frame middle; see frames.ts), showing the frame at once where a
 * preview can. Frame steps pass `preview: false`: a step's seek lands fast enough on
 * its own, and cached frames look different enough from the video to flicker.
 */
export function seek(
	video: HTMLVideoElement,
	time: number,
	timing: FrameTiming,
	{ preview = true } = {}
) {
	// Seeking while the frame rate is measured (just after a video opens) ends the
	// probe's playback, and the probe then leaves the playhead where the seek put it.
	if (probing.delete(video)) video.pause();
	if (preview) previews.get(video)?.show(frameAt(time, timing));
	else previews.get(video)?.hide();
	if (video.seeking && inFlight.has(video)) pending.set(video, time);
	else {
		pending.delete(video);
		start(video, time);
	}
	video.dispatchEvent(new Event(SEEK_EVENT));
}

/** Where the playhead is headed: the latest seek target until it lands, else `currentTime`. */
export function targetTime(video: HTMLVideoElement): number {
	return pending.get(video) ?? video.currentTime;
}

/** Forgets queued seeks, when the video is emptied for a new file. */
export function clearSeeks(video: HTMLVideoElement) {
	pending.delete(video);
	inFlight.delete(video);
}

/** True while a seek from `seek` hasn't landed yet. */
export function seekPending(video: HTMLVideoElement): boolean {
	return pending.has(video) || (inFlight.has(video) && video.seeking);
}
