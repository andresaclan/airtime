import type { FrameTiming } from './frames';

// Chromium shifts a partial-frame edit to its first complete sample. WebKit
// keeps the edit's original timestamps. Keep persisted times on the former,
// canonical timeline, translating only at the HTMLVideoElement boundary.
const offsets = new WeakMap<HTMLVideoElement, number>();
export const MEDIA_TIMELINE_EVENT = 'airtime:media-timeline';

export function mediaTime(video: HTMLVideoElement, nativeTime = video.currentTime): number {
	return nativeTime - (offsets.get(video) ?? 0);
}

export function nativeTime(video: HTMLVideoElement, time: number): number {
	return time + (offsets.get(video) ?? 0);
}

export function clearMediaTimeline(video: HTMLVideoElement) {
	offsets.delete(video);
}

export function mediaTimelineKnown(video: HTMLVideoElement, timing: FrameTiming): boolean {
	return !(timing.editGap && timing.editGap > 1e-5) || offsets.has(video);
}

function distance(time: number, times: readonly number[]): number {
	let low = 0;
	let high = times.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (times[middle] < time) low = middle + 1;
		else high = middle;
	}
	return Math.min(
		Math.abs(time - (times[low] ?? Infinity)),
		Math.abs(time - (times[low - 1] ?? -Infinity))
	);
}

/** Calibrate from actual presentation timestamps, without browser sniffing. */
export function observeMediaTimeline(
	video: HTMLVideoElement,
	presentedTime: number,
	timing: FrameTiming
) {
	const gap = timing.editGap ?? 0;
	const times = timing.frameTimes;
	if (!(gap > 1e-5) || !times?.length || offsets.has(video) || presentedTime <= times[0] + 1e-5)
		return;
	const canonical = distance(presentedTime, times) <= 1e-5;
	const shifted = distance(presentedTime - gap, times) <= 1e-5;
	// Ambiguous timestamps do not establish a browser's presentation convention.
	if (canonical === shifted) return;
	offsets.set(video, shifted ? gap : 0);
	video.dispatchEvent(new Event(MEDIA_TIMELINE_EVENT));
}
