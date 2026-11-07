// Canonical time of the accepted picture, shared by presentation tracking and
// seek completion. A matching playhead alone does not prove that picture is shown.
const times = new WeakMap<HTMLVideoElement, number | null>();

export function lastPresentedTime(video: HTMLVideoElement): number | null {
	return times.get(video) ?? null;
}

export function setPresentedTime(video: HTMLVideoElement, time: number | null) {
	times.set(video, time);
}

export function clearPresentedTime(video: HTMLVideoElement) {
	times.delete(video);
}
