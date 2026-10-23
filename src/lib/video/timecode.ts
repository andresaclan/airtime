/** SMPTE timecode helpers. Drop-frame is supported for the NTSC-derived 29.97/59.94 rates. */
export function nominalFrameRate(fps: number): number {
	return Math.round(fps);
}

export function isDropFrameRate(fps: number): boolean {
	return Math.abs(fps - 30000 / 1001) < 0.02 || Math.abs(fps - 60000 / 1001) < 0.03;
}

export function formatTimecode(
	seconds: number,
	fps: number,
	dropFrame = isDropFrameRate(fps)
): string {
	if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(fps) || fps <= 0)
		return '00:00:00:00';
	const nominal = nominalFrameRate(fps);
	let frame = Math.round(seconds * fps);
	if (dropFrame && isDropFrameRate(fps)) {
		const drop = nominal === 60 ? 4 : 2;
		const framesPer10Minutes = nominal * 600 - drop * 9;
		const framesPerMinute = nominal * 60 - drop;
		const tenMinuteChunks = Math.floor(frame / framesPer10Minutes);
		const remainder = frame % framesPer10Minutes;
		frame +=
			drop * 9 * tenMinuteChunks +
			drop * Math.max(0, Math.floor((remainder - drop) / framesPerMinute));
	}
	const ff = frame % nominal;
	const totalSeconds = Math.floor(frame / nominal);
	const ss = totalSeconds % 60;
	const mm = Math.floor(totalSeconds / 60) % 60;
	const hh = Math.floor(totalSeconds / 3600);
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${dropFrame && isDropFrameRate(fps) ? ';' : ':'}${String(ff).padStart(2, '0')}`;
}

export function parseTimecode(input: string, fps: number): number | null {
	const m = input.trim().match(/^(\d{1,}:)?(\d{1,2}):(\d{2})[:;](\d{2})$/);
	if (!m || !Number.isFinite(fps) || fps <= 0) return null;
	const hours = Number((m[1] ?? '0:').slice(0, -1));
	const minutes = Number(m[2]);
	const seconds = Number(m[3]);
	const frames = Number(m[4]);
	const nominal = nominalFrameRate(fps);
	if (minutes > 59 || seconds > 59 || frames >= nominal) return null;
	const df = m[0].includes(';');
	if (df && !isDropFrameRate(fps)) return null;
	const totalMinutes = hours * 60 + minutes;
	const dropped = df
		? (nominal === 60 ? 4 : 2) * (totalMinutes - Math.floor(totalMinutes / 10))
		: 0;
	if (df && minutes % 10 !== 0 && seconds === 0 && frames < (nominal === 60 ? 4 : 2)) return null;
	const count = (hours * 3600 + minutes * 60 + seconds) * nominal + frames - dropped;
	return Math.max(0, count / fps);
}
