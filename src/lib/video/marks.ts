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

export type Jump = {
	takeoff: Mark;
	landing?: Mark;
	contact?: Interval;
	flight?: Interval;
};

export type JumpGroups = {
	jumps: Jump[];
	/** Marks that do not belong to a usable contact or flight interval. */
	unpairedMarks: Mark[];
};

/**
 * Why a mark is unpaired: next to a mark of the same type, or with no neighbour at all
 * (a lone landing).
 */
export type UnpairedReason = 'out-of-sequence' | 'alone';

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

/**
 * Groups intervals into jumps. A landing that ends one flight may also start
 * the next contact interval, which is how rebound jumps share a touchdown.
 */
export function groupJumps(marks: Mark[], analysis: Analysis): JumpGroups {
	const sorted = sortMarks(marks);
	const flightsByTakeoff = new Map(
		analysis.intervals
			.filter((interval) => interval.kind === 'flight')
			.map((interval) => [interval.from.id, interval])
	);
	const contactsByTakeoff = new Map(
		analysis.intervals
			.filter((interval) => interval.kind === 'contact')
			.map((interval) => [interval.to.id, interval])
	);
	const jumps: Jump[] = [];
	const used = new Set<string>();

	for (const takeoff of sorted.filter((mark) => mark.type === 'takeoff')) {
		const flight = flightsByTakeoff.get(takeoff.id);
		const contact = contactsByTakeoff.get(takeoff.id);
		const position = sorted.findIndex((mark) => mark.id === takeoff.id);
		// When repeated takeoffs have no interval between them, keep the earlier
		// duplicate as an unpaired mark instead of presenting it as a jump.
		if (!flight && !contact && sorted[position + 1]?.type === 'takeoff') continue;
		const jump: Jump = { takeoff, flight, contact, landing: flight?.to };
		jumps.push(jump);
		used.add(takeoff.id);
		if (contact) used.add(contact.from.id);
		if (flight) used.add(flight.to.id);
	}

	return { jumps, unpairedMarks: sorted.filter((mark) => !used.has(mark.id)) };
}

export function unpairedReason(marks: Mark[], mark: Mark): UnpairedReason {
	const sorted = sortMarks(marks);
	const position = sorted.findIndex((candidate) => candidate.id === mark.id);
	const neighbours = [sorted[position - 1], sorted[position + 1]];
	return neighbours.some((neighbour) => neighbour?.type === mark.type)
		? 'out-of-sequence'
		: 'alone';
}

/** Reactive strength index: jump height in metres over the contact before the jump. */
export function rsi(jump: Jump): number | undefined {
	if (jump.flight?.heightCm === undefined || !jump.contact) return undefined;
	return jump.flight.heightCm / 100 / jump.contact.realSeconds;
}

/** Random ID; falls back when `crypto.randomUUID` is missing (non-secure contexts such as LAN http). */
export function newId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
