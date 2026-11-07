import { frameAt, frameOfPresentedTime, frameStartTime, type FrameTiming } from './frames';
import { clearMediaTimeline, mediaTime, nativeTime, observeMediaTimeline } from './mediaTime';

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
export type SeekPreview = { show(frame: number): void };

/** Dispatched on the video whenever `seek` changes the target, so the playhead can follow it. */
export const SEEK_EVENT = 'airtime:seek';

const previews = new WeakMap<HTMLVideoElement, SeekPreview>();
/** Latest target, while it hasn't been handed to the video yet. */
const pending = new WeakMap<HTMLVideoElement, { time: number; timing: FrameTiming }>();
/** Completion listener for the current seek; its identity survives equal target times. */
const inFlight = new WeakMap<HTMLVideoElement, () => void>();

export function registerSeekPreview(video: HTMLVideoElement, preview: SeekPreview): () => void {
	previews.set(video, preview);
	return () => {
		if (previews.get(video) === preview) previews.delete(video);
	};
}

function start(video: HTMLVideoElement, time: number, timing: FrameTiming) {
	const previous = inFlight.get(video);
	previous?.();
	let seeked = false;
	const callbacks = typeof video.requestVideoFrameCallback === 'function';
	// Seeking within the picture already on screen need not present a new frame.
	let presented =
		!callbacks || (!timing.editGap && frameAt(mediaTime(video), timing) === frameAt(time, timing));
	let assignedOffset = nativeTime(video, 0);
	let handle: number | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let retried = false;
	const cleanup = () => {
		video.removeEventListener('seeked', landed);
		if (handle !== undefined) video.cancelVideoFrameCallback(handle);
		clearTimeout(timeout);
	};
	const finish = () => {
		if (!seeked || !presented || inFlight.get(video) !== cleanup) return;
		cleanup();
		inFlight.delete(video);
		const next = pending.get(video);
		if (next === undefined) return;
		pending.delete(video);
		start(video, next.time, next.timing);
	};
	const rebase = () => {
		const offset = nativeTime(video, 0);
		if (offset === assignedOffset) return false;
		// The first presentation can establish an edit offset after this seek
		// was assigned. Reissue on the calibrated timeline before acknowledging it.
		assignedOffset = offset;
		seeked = false;
		presented = false;
		clearTimeout(timeout);
		if (handle !== undefined) video.cancelVideoFrameCallback(handle);
		video.removeEventListener('seeked', landed);
		video.addEventListener('seeked', landed, { once: true });
		handle = video.requestVideoFrameCallback(onFrame);
		video.currentTime = nativeTime(video, time);
		return true;
	};
	const landed = () => {
		if (rebase()) return;
		seeked = true;
		finish();
		// Missing callbacks (e.g. a no-op seek, background media, or a truncated
		// final frame) must not hold the queue forever. Normal seeks wait for the
		// picture: WebKit's seeked can arrive well before it is presented.
		if (!presented)
			timeout = setTimeout(() => {
				if (!retried) {
					// A final playback picture can overwrite a paused WebKit seek.
					// Retry once inside the same frame after the decoder has settled.
					retried = true;
					seeked = false;
					video.addEventListener('seeked', landed, { once: true });
					video.currentTime = nativeTime(
						video,
						(frameStartTime(frameAt(time, timing), timing) + time) / 2
					);
					return;
				}
				presented = true;
				finish();
			}, 500);
	};
	const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
		if (inFlight.get(video) !== cleanup) return;
		observeMediaTimeline(video, metadata.mediaTime, timing);
		if (rebase()) return;
		const actual = mediaTime(video, metadata.mediaTime);
		if (
			actual >= (timing.frameTimes?.[0] ?? 0) - 1e-5 &&
			frameOfPresentedTime(actual, timing) === frameAt(time, timing)
		) {
			presented = true;
			finish();
		} else handle = video.requestVideoFrameCallback(onFrame);
	};
	inFlight.set(video, cleanup);
	video.addEventListener('seeked', landed, { once: true });
	if (callbacks && !presented) handle = video.requestVideoFrameCallback(onFrame);
	video.currentTime = nativeTime(video, time);
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

/** Seeks to `time` (a frame middle; see frames.ts), showing the frame at once where a preview can. */
export function seek(video: HTMLVideoElement, time: number, timing: FrameTiming) {
	// Seeking while the frame rate is measured (just after a video opens) ends the
	// probe's playback, and the probe then leaves the playhead where the seek put it.
	if (probing.delete(video)) video.pause();
	previews.get(video)?.show(frameAt(time, timing));
	if (inFlight.has(video)) pending.set(video, { time, timing });
	else {
		pending.delete(video);
		start(video, time, timing);
	}
	video.dispatchEvent(new Event(SEEK_EVENT));
}

/** Where the playhead is headed: the latest seek target until it lands, else `currentTime`. */
export function targetTime(video: HTMLVideoElement): number {
	return pending.get(video)?.time ?? mediaTime(video);
}

/** Forgets queued seeks, when the video is emptied for a new file. */
export function clearSeeks(video: HTMLVideoElement) {
	pending.delete(video);
	inFlight.get(video)?.();
	inFlight.delete(video);
	clearMediaTimeline(video);
}

/** True while a seek from `seek` hasn't landed yet. */
export function seekPending(video: HTMLVideoElement): boolean {
	return pending.has(video) || inFlight.has(video);
}
