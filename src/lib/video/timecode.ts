/** Clock readouts for media time and frame labels. */
import type { Timing } from './frames';

/**
 * Clock time to the millisecond, e.g. 0:02.250 or 1:02:03.500. Reads unambiguously as
 * minutes and seconds, where a SMPTE timecode's last field (frames) is easy to misread.
 */
export function formatClock(seconds: number): string {
	const totalMs = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
	const ms = totalMs % 1000;
	const totalSeconds = Math.floor(totalMs / 1000);
	const s = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const m = totalMinutes % 60;
	const h = Math.floor(totalMinutes / 60);
	const tail = `${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`;
}

/** Clock time of frame number `label` (a frame count at the nominal rate; see `frameLabel`). */
export function formatFrameClock(label: number, timing: Timing): string {
	const fps = typeof timing === 'number' ? timing : timing.fps;
	return formatClock(fps > 0 ? label / fps : 0);
}
