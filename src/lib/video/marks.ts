/** Manually marked jump events and the timings derived from them. */
export type MarkType = 'takeoff' | 'landing';
/** `time` is media seconds, snapped to a frame boundary when placed. */
export type Mark = { id: string; type: MarkType; time: number };

export type Interval = {
	kind: 'flight' | 'contact';
	from: Mark;
	to: Mark;
	/** Media seconds between the marks. */
	seconds: number;
	/** Real-world seconds: `seconds × timeScale`. Differs from `seconds` only for slow-motion footage. */
	realSeconds: number;
	frames: number;
	/** Jump height from real flight time (h = g·t²/8); flight intervals only. */
	heightCm?: number;
};

export type Analysis = {
	intervals: Interval[];
	/** Marks whose type repeats the previous mark's (e.g. two takeoffs in a row). */
	outOfSequence: Set<string>;
};

export const GRAVITY = 9.81;

export function frameOf(time: number, fps: number): number {
	return Math.round(time * fps);
}

export function sortMarks(marks: Mark[]): Mark[] {
	return [...marks].sort((a, b) => a.time - b.time);
}

/**
 * Adds a mark at `time`. A mark already on the same frame is replaced, or
 * removed when it has the same type, so pressing a key twice toggles it.
 */
export function placeMark(marks: Mark[], type: MarkType, time: number, fps: number): Mark[] {
	const frame = frameOf(time, fps);
	const existing = marks.find((mark) => frameOf(mark.time, fps) === frame);
	const rest = marks.filter((mark) => mark !== existing);
	if (existing?.type === type) return rest;
	return sortMarks([...rest, { id: newId(), type, time: frame / fps }]);
}

export function moveMark(marks: Mark[], id: string, time: number): Mark[] {
	return sortMarks(marks.map((mark) => (mark.id === id ? { ...mark, time } : mark)));
}

export function removeMark(marks: Mark[], id: string): Mark[] {
	return marks.filter((mark) => mark.id !== id);
}

export function markAtFrame(marks: Mark[], time: number, fps: number): Mark | undefined {
	const frame = frameOf(time, fps);
	return marks.find((mark) => frameOf(mark.time, fps) === frame);
}

/**
 * `timeScale` is real seconds per media second: 1 for real-time footage, 0.25 for
 * a clip that plays back 4× slower than it was captured.
 */
export function analyzeMarks(marks: Mark[], fps: number, timeScale = 1): Analysis {
	const intervals: Interval[] = [];
	const outOfSequence = new Set<string>();
	for (let i = 1; i < marks.length; i += 1) {
		const from = marks[i - 1];
		const to = marks[i];
		if (from.type === to.type) {
			outOfSequence.add(to.id);
			continue;
		}
		const seconds = to.time - from.time;
		const realSeconds = seconds * timeScale;
		const kind = from.type === 'takeoff' ? 'flight' : 'contact';
		intervals.push({
			kind,
			from,
			to,
			seconds,
			realSeconds,
			frames: frameOf(to.time, fps) - frameOf(from.time, fps),
			heightCm: kind === 'flight' ? ((GRAVITY * realSeconds * realSeconds) / 8) * 100 : undefined
		});
	}
	return { intervals, outOfSequence };
}

/** Random ID; falls back when `crypto.randomUUID` is missing (non-secure contexts such as LAN http). */
export function newId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
