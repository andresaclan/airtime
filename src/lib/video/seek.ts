import { frameAt, frameOfPresentedTime, frameSeekTime, type FrameTiming } from './frames';
import {
	clearMediaTimeline,
	mediaTime,
	mediaTimelineKnown,
	nativeTime,
	observeMediaTimeline
} from './mediaTime';
import { clearPresentedTime, lastPresentedTime } from './presentationState';

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
/** Logical target and cleanup identity survive native retries and timeline calibration. */
const inFlight = new WeakMap<HTMLVideoElement, { time: number; dispose: () => void }>();

export function registerSeekPreview(video: HTMLVideoElement, preview: SeekPreview): () => void {
	previews.set(video, preview);
	return () => {
		if (previews.get(video) === preview) previews.delete(video);
	};
}

function start(video: HTMLVideoElement, time: number, timing: FrameTiming) {
	const previous = inFlight.get(video);
	previous?.dispose();
	let seeked = false;
	const callbacks = typeof video.requestVideoFrameCallback === 'function' && video.paused;
	const picture = lastPresentedTime(video);
	const targetFrame = frameAt(time, timing);
	// WebKit can retain a late pause picture while currentTime already names the
	// requested frame. Moving within that same frame does not force a decode.
	let detouring =
		callbacks &&
		picture !== null &&
		frameAt(mediaTime(video), timing) === targetFrame &&
		frameOfPresentedTime(picture, timing) !== targetFrame;
	const duration = Number.isFinite(video.duration) ? mediaTime(video, video.duration) : Infinity;
	const adjacent = frameSeekTime(
		targetFrame > 0 ? targetFrame - 1 : targetFrame + 1,
		timing,
		duration
	);
	let nativeTarget = detouring ? adjacent : time;
	let presented =
		!callbacks ||
		(mediaTimelineKnown(video, timing) &&
			picture !== null &&
			frameOfPresentedTime(picture, timing) === frameAt(nativeTarget, timing));
	let assignedOffset = nativeTime(video, 0);
	let handle: number | undefined;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let retried = false;
	const cleanup = () => {
		video.removeEventListener('seeked', landed);
		video.removeEventListener('play', onPlay);
		if (handle !== undefined) video.cancelVideoFrameCallback(handle);
		clearTimeout(timeout);
	};
	const moveTo = (target: number, detour = false) => {
		detouring = detour;
		nativeTarget = target;
		seeked = false;
		presented = !callbacks || !video.paused;
		clearTimeout(timeout);
		if (handle !== undefined) video.cancelVideoFrameCallback(handle);
		video.addEventListener('seeked', landed, { once: true });
		if (!presented) handle = video.requestVideoFrameCallback(onFrame);
		video.currentTime = nativeTime(video, nativeTarget);
	};
	const restoreTarget = () => moveTo(time);
	const finish = () => {
		if (!seeked || !presented || inFlight.get(video)?.dispose !== cleanup) return;
		if (detouring) return restoreTarget();
		cleanup();
		inFlight.delete(video);
		const next = pending.get(video);
		if (next === undefined) return;
		pending.delete(video);
		start(video, next.time, next.timing);
	};
	const onPlay = () => {
		// Watching can skip presentation of the exact paused frame. Drain to the
		// latest target on seeked instead of retrying backward during playback.
		presented = true;
		if (handle !== undefined) video.cancelVideoFrameCallback(handle);
		clearTimeout(timeout);
		finish();
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
		video.currentTime = nativeTime(video, nativeTarget);
		return true;
	};
	const landed = () => {
		if (rebase()) return;
		seeked = true;
		finish();
		if (!seeked) return; // A completed detour just assigned the real target.
		// Missing callbacks (e.g. a no-op seek, background media, or a truncated
		// final frame) must not hold the queue forever. Normal seeks wait for the
		// picture: WebKit's seeked can arrive well before it is presented.
		if (!presented)
			timeout = setTimeout(() => {
				if (detouring) return restoreTarget();
				if (!retried) {
					// Native iOS can report seeked without decoding a backstep.
					// Moving within that frame still leaves the old picture visible;
					// cross a frame boundary, then return to the logical target.
					retried = true;
					moveTo(adjacent, true);
					return;
				}
				presented = true;
				finish();
			}, 500);
	};
	const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
		if (inFlight.get(video)?.dispose !== cleanup) return;
		observeMediaTimeline(video, metadata.mediaTime, timing);
		if (rebase()) return;
		const actual = mediaTime(video, metadata.mediaTime);
		if (
			actual >= (timing.frameTimes?.[0] ?? 0) - 1e-5 &&
			frameOfPresentedTime(actual, timing) === frameAt(nativeTarget, timing)
		) {
			presented = true;
			finish();
		} else handle = video.requestVideoFrameCallback(onFrame);
	};
	inFlight.set(video, { time, dispose: cleanup });
	video.addEventListener('seeked', landed, { once: true });
	video.addEventListener('play', onPlay, { once: true });
	if (callbacks && !presented) handle = video.requestVideoFrameCallback(onFrame);
	video.currentTime = nativeTime(video, nativeTarget);
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
	return pending.get(video)?.time ?? inFlight.get(video)?.time ?? mediaTime(video);
}

/** Forgets queued seeks, when the video is emptied for a new file. */
export function clearSeeks(video: HTMLVideoElement) {
	pending.delete(video);
	inFlight.get(video)?.dispose();
	inFlight.delete(video);
	clearMediaTimeline(video);
	clearPresentedTime(video);
}

/** True while a seek from `seek` hasn't landed yet. */
export function seekPending(video: HTMLVideoElement): boolean {
	return pending.has(video) || inFlight.has(video);
}
