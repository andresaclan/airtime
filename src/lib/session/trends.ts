/**
 * Flight and contact time across saved sessions, for the trends view. Each session is one
 * point on its recorded date: its best jump, with every other completed jump beside it.
 * Sessions are grouped by jump type so a chart only sets like against like.
 */
import { analyzeMarks, groupJumps, sortMarks, type Interval } from '$lib/video/marks';
import { JUMP_TYPES, type JumpType, type Session } from './schema';

export type TrendJump = {
	flightMs: number;
	/** The contact before the jump; null when it has none. */
	contactMs: number | null;
};

export type TrendPoint = {
	session: Session;
	/** The recorded date, in epoch milliseconds. */
	time: number;
	/** The jump with the longest flight, as on the jump cards. */
	best: TrendJump & { heightCm: number };
	/** Every completed jump, the best one included. */
	jumps: TrendJump[];
};

export type TrendGroup = {
	jumpType: JumpType | null;
	label: string;
	/** Whether any jump in the group has a contact marked. */
	showContact: boolean;
	/** Oldest first. */
	points: TrendPoint[];
};

function trendJump(flight: Interval, contact: Interval | undefined): TrendJump {
	return {
		flightMs: flight.realSeconds * 1000,
		contactMs: contact ? contact.realSeconds * 1000 : null
	};
}

/** Null when the session has no completed jump or its recorded date can't be read. */
export function trendPoint(session: Session): TrendPoint | null {
	const time = Date.parse(session.recordedAt);
	if (Number.isNaN(time)) return null;
	const marks = sortMarks(session.marks);
	const analysis = analyzeMarks(marks, session.frameRate.value, session.timeScale);
	const completed = groupJumps(marks, analysis).jumps.flatMap(({ flight, contact }) =>
		flight ? [{ flight, contact }] : []
	);
	if (completed.length === 0) return null;
	const best = completed.reduce((leader, jump) =>
		jump.flight.realSeconds > leader.flight.realSeconds ? jump : leader
	);
	return {
		session,
		time,
		best: { ...trendJump(best.flight, best.contact), heightCm: best.flight.heightCm ?? 0 },
		jumps: completed.map(({ flight, contact }) => trendJump(flight, contact))
	};
}

/** One group per jump type that has a session to chart, in menu order; sessions without a type last. */
export function trendGroups(sessions: Session[]): TrendGroup[] {
	const byType = new Map<JumpType | null, TrendPoint[]>();
	for (const session of sessions) {
		const point = trendPoint(session);
		if (!point) continue;
		byType.set(session.jumpType, [...(byType.get(session.jumpType) ?? []), point]);
	}
	const order: (JumpType | null)[] = [...JUMP_TYPES.map((type) => type.value), null];
	return order.flatMap((jumpType) => {
		const points = byType.get(jumpType);
		if (!points) return [];
		points.sort((a, b) => a.time - b.time);
		return [
			{
				jumpType,
				label: JUMP_TYPES.find((type) => type.value === jumpType)?.label ?? 'No jump type',
				showContact: points.some((point) => point.jumps.some((jump) => jump.contactMs !== null)),
				points
			}
		];
	});
}

function lastTime(group: TrendGroup): number {
	return group.points[group.points.length - 1].time;
}

/** The group holding the most recently recorded session: the jump type being trained now. */
export function latestGroup(groups: TrendGroup[]): TrendGroup | undefined {
	let latest: TrendGroup | undefined;
	for (const group of groups) {
		if (!latest || lastTime(group) > lastTime(latest)) latest = group;
	}
	return latest;
}

export const TREND_RANGES = [
	{ label: '3M', months: 3 },
	{ label: '6M', months: 6 },
	{ label: '1Y', months: 12 },
	{ label: 'All', months: null }
] as const;

/** Points recorded in the last `months` months before `now`; all of them for null. */
export function withinMonths(points: TrendPoint[], months: number | null, now: Date): TrendPoint[] {
	if (months === null) return points;
	const start = new Date(now);
	start.setMonth(start.getMonth() - months);
	return points.filter((point) => point.time >= start.getTime());
}

/**
 * Round tick values for a value axis covering `min`–`max`, with at most `maxIntervals`
 * steps between them. The first and last ticks are the axis ends.
 */
export function valueTicks(min: number, max: number, maxIntervals = 4): number[] {
	// A single value, or nearly one, still gets an axis a few ticks wide.
	if (max - min < 20) {
		const middle = (min + max) / 2;
		min = middle - 10;
		max = middle + 10;
	}
	for (let magnitude = 1; ; magnitude *= 10) {
		for (const step of [magnitude, 2 * magnitude, 5 * magnitude]) {
			const low = Math.floor(min / step) * step;
			const high = Math.ceil(max / step) * step;
			if ((high - low) / step <= maxIntervals) {
				return Array.from(
					{ length: Math.round((high - low) / step) + 1 },
					(_, i) => low + i * step
				);
			}
		}
	}
}

export type TimeTick = { time: number; label: string };

const DAY_MS = 86_400_000;

/**
 * Date ticks between `start` and `end` (epoch ms): the first of every month, or of every
 * second, third, sixth or twelfth month, whichever gives at most `maxTicks`. A span
 * too short for two month ticks gets day ticks instead.
 */
export function timeTicks(start: number, end: number, maxTicks = 6): TimeTick[] {
	for (const step of [1, 2, 3, 6, 12, 24, 60]) {
		const ticks: TimeTick[] = [];
		const cursor = new Date(start);
		cursor.setHours(0, 0, 0, 0);
		cursor.setDate(1);
		if (cursor.getTime() < start) cursor.setMonth(cursor.getMonth() + 1);
		while (cursor.getMonth() % step !== 0) cursor.setMonth(cursor.getMonth() + 1);
		for (; cursor.getTime() <= end; cursor.setMonth(cursor.getMonth() + step)) {
			// The year marks January, so a span across New Year still reads in order.
			const label =
				cursor.getMonth() === 0
					? String(cursor.getFullYear())
					: cursor.toLocaleDateString(undefined, { month: 'short' });
			ticks.push({ time: cursor.getTime(), label });
		}
		if (ticks.length > maxTicks) continue;
		if (ticks.length >= 2) return ticks;
		break;
	}
	for (const days of [1, 2, 7, 14]) {
		const ticks: TimeTick[] = [];
		const cursor = new Date(start);
		cursor.setHours(0, 0, 0, 0);
		if (cursor.getTime() < start) cursor.setDate(cursor.getDate() + 1);
		for (; cursor.getTime() <= end; cursor.setDate(cursor.getDate() + days)) {
			ticks.push({
				time: cursor.getTime(),
				label: cursor.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
			});
		}
		if (ticks.length <= maxTicks) return ticks;
	}
	return [];
}

/** The date range a chart spans: the points' dates, padded so end dots aren't on the edge. */
export function timeDomain(points: TrendPoint[]): [number, number] {
	const first = points[0].time;
	const last = points[points.length - 1].time;
	const pad = Math.max((last - first) * 0.04, 2 * DAY_MS);
	return [first - pad, last + pad];
}
