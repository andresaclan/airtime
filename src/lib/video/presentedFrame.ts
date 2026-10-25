import { frameAt, frameOfPresentedTime, frameSeekTime, type FrameTiming } from './frames';

/**
 * Which frame is actually on screen. `currentTime` only says where the playhead
 * is: after pausing it can sit anywhere in a frame, and Chromium may present one
 * more frame after it stops. `requestVideoFrameCallback` reports the media time
 * of each frame as it is presented, so where it's supported that is the truth.
 */

type FrameCallbackVideo = HTMLVideoElement & {
	requestVideoFrameCallback(
		callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
	): number;
	cancelVideoFrameCallback(handle: number): void;
};

/** Media time of the frame last presented; null while a seek is pending or nothing is known. */
const presented = new WeakMap<HTMLVideoElement, number | null>();
/** `performance.now()` when the last frame was presented. */
const presentedAt = new WeakMap<HTMLVideoElement, number>();

/** How long without a new frame before the picture counts as settled. */
const QUIET_MS = 60;
const MAX_SETTLE_MS = 300;

function supportsFrameCallbacks(video: HTMLVideoElement): video is FrameCallbackVideo {
	return 'requestVideoFrameCallback' in video;
}

/** The frame on screen, falling back to the playhead where the browser can't say. */
export function displayedFrame(video: HTMLVideoElement, timing: FrameTiming): number {
	const mediaTime = presented.get(video);
	if (video.paused && !video.seeking && mediaTime != null) {
		return frameOfPresentedTime(mediaTime, timing);
	}
	return frameAt(video.currentTime, timing);
}

/**
 * The frame on screen once it has stopped changing. Chromium can present one more
 * frame after `pause()`, so while frames are still arriving this waits until none
 * has for a moment.
 */
export async function settledDisplayedFrame(
	video: HTMLVideoElement,
	timing: FrameTiming
): Promise<number> {
	const start = performance.now();
	while (performance.now() - start < MAX_SETTLE_MS) {
		const quietFor = performance.now() - (presentedAt.get(video) ?? -Infinity);
		if (quietFor >= QUIET_MS) break;
		await new Promise((resolve) => setTimeout(resolve, QUIET_MS - quietFor));
	}
	return displayedFrame(video, timing);
}

/**
 * Records each presented frame and, whenever the video is paused, moves the
 * playhead to the middle of the frame on screen if it points at another one
 * (after pausing playback, or a seek past the last real frame). Returns a cleanup.
 *
 * It corrects at most once per seek or pause of its own: if the browser won't
 * land on that frame either (say, a duration that cuts it off), it gives up
 * rather than seeking forever.
 */
export function trackPresentedFrames(
	video: HTMLVideoElement,
	getTiming: () => FrameTiming | null
): () => void {
	if (!supportsFrameCallbacks(video)) return () => {};

	// True from our own correcting seek until the next seek or play that isn't ours.
	let corrected = false;
	let correcting = false;
	const reconcile = () => {
		const timing = getTiming();
		const mediaTime = presented.get(video);
		if (corrected || !video.paused || video.seeking || mediaTime == null) return;
		if (!timing || !(timing.fps > 0)) return;
		const frame = frameOfPresentedTime(mediaTime, timing);
		if (frameAt(video.currentTime, timing) !== frame) {
			correcting = true;
			video.currentTime = frameSeekTime(frame, timing, video.duration);
		}
	};
	const onSeeking = () => {
		presented.set(video, null);
		corrected = correcting;
		correcting = false;
	};
	const onPlay = () => (corrected = false);
	const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
		presented.set(video, metadata.mediaTime);
		presentedAt.set(video, performance.now());
		handle = video.requestVideoFrameCallback(onFrame);
		reconcile();
	};
	const forget = () => presented.set(video, null);

	let handle = video.requestVideoFrameCallback(onFrame);
	video.addEventListener('seeking', onSeeking);
	video.addEventListener('emptied', forget);
	video.addEventListener('play', onPlay);
	video.addEventListener('pause', reconcile);
	return () => {
		video.cancelVideoFrameCallback(handle);
		video.removeEventListener('seeking', onSeeking);
		video.removeEventListener('emptied', forget);
		video.removeEventListener('play', onPlay);
		video.removeEventListener('pause', reconcile);
		presented.delete(video);
		presentedAt.delete(video);
	};
}
