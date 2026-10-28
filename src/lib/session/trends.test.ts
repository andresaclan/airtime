import { describe, expect, test } from 'vitest';
import type { Mark, MarkType } from '$lib/video/marks';
import { SCHEMA_VERSION, type Session } from './schema';
import {
	latestGroup,
	timeDomain,
	timeTicks,
	trendGroups,
	trendPoint,
	valueTicks,
	withinMonths
} from './trends';

/** Marks on frames at `fps`: ids starting with T are takeoffs, the rest landings. */
function marksAt(fps: number, ...spec: [string, number][]): Mark[] {
	return spec.map(([id, frame]) => ({
		id,
		type: (id.startsWith('T') ? 'takeoff' : 'landing') as MarkType,
		time: frame / fps
	}));
}

function session(id: string, overrides: Partial<Session>): Session {
	return {
		schemaVersion: SCHEMA_VERSION,
		id,
		title: id,
		notes: '',
		jumpType: 'approach',
		createdAt: '2026-10-01T10:00:00.000Z',
		updatedAt: '2026-10-01T10:00:00.000Z',
		recordedAt: '2026-10-01T09:00:00.000Z',
		media: {
			fileName: `${id}.mov`,
			mimeType: 'video/quicktime',
			sizeBytes: 1000,
			lastModified: '2026-10-01T09:00:00.000Z',
			durationSeconds: 10,
			width: 1920,
			height: 1080,
			fingerprint: id
		},
		frameRate: { value: 100, source: 'container' },
		timeScale: 1,
		marks: [],
		...overrides
	};
}

describe('trendPoint', () => {
	test('the best jump is the longest flight, with the contact before it', () => {
		const point = trendPoint(
			session('a', {
				// Contact 300 ms then flight 800 ms; contact 250 ms then flight 850 ms; a takeoff with no landing yet.
				marks: marksAt(
					100,
					['L0', 100],
					['T1', 130],
					['L1', 210],
					['L2', 300],
					['T2', 325],
					['L3', 410],
					['T3', 500]
				)
			})
		);
		expect(point?.best.flightMs).toBeCloseTo(850);
		expect(point?.best.contactMs).toBeCloseTo(250);
		expect(point?.best.heightCm).toBeCloseTo(((9.81 * 0.85 ** 2) / 8) * 100);
		// The incomplete jump isn't charted.
		expect(point?.jumps).toHaveLength(2);
		expect(point?.time).toBe(Date.parse('2026-10-01T09:00:00.000Z'));
	});

	test('timings are real time for slow-motion footage', () => {
		const point = trendPoint(
			session('slow', { timeScale: 0.25, marks: marksAt(100, ['T1', 100], ['L1', 420]) })
		);
		expect(point?.best.flightMs).toBeCloseTo(800);
		expect(point?.best.contactMs).toBeNull();
	});

	test('marks stored out of order are sorted first', () => {
		const point = trendPoint(session('a', { marks: marksAt(100, ['L1', 180], ['T1', 100]) }));
		expect(point?.best.flightMs).toBeCloseTo(800);
	});

	test('a session without a completed jump, or with an unreadable date, has no point', () => {
		expect(trendPoint(session('a', { marks: marksAt(100, ['L0', 10], ['T1', 40]) }))).toBeNull();
		expect(
			trendPoint(
				session('a', { recordedAt: 'not a date', marks: marksAt(100, ['T1', 10], ['L1', 90]) })
			)
		).toBeNull();
	});
});

describe('trendGroups', () => {
	const jump = marksAt(100, ['L0', 0], ['T1', 30], ['L1', 110]);

	test('groups by jump type in menu order, oldest session first', () => {
		const groups = trendGroups([
			session('new-approach', { recordedAt: '2026-10-20T09:00:00Z', marks: jump }),
			session('untyped', { jumpType: null, marks: jump }),
			session('drop', { jumpType: 'drop-jump', marks: jump }),
			session('old-approach', { recordedAt: '2026-09-01T09:00:00Z', marks: jump }),
			session('empty', { recordedAt: '2026-10-25T09:00:00Z', marks: [] })
		]);
		expect(groups.map((group) => group.label)).toEqual(['Approach', 'Drop jump', 'No jump type']);
		expect(groups[0].points.map((point) => point.session.id)).toEqual([
			'old-approach',
			'new-approach'
		]);
		expect(latestGroup(groups)?.jumpType).toBe('approach');
	});

	test('contact shows only where it was marked', () => {
		const flightOnly = marksAt(100, ['T1', 30], ['L1', 110]);
		const groups = trendGroups([
			session('approach', { marks: flightOnly }),
			session('drop', { jumpType: 'drop-jump', marks: jump }),
			session('untyped', { jumpType: null, marks: jump })
		]);
		expect(groups.map((group) => [group.label, group.showContact])).toEqual([
			['Approach', false],
			['Drop jump', true],
			['No jump type', true]
		]);
	});
});

describe('withinMonths', () => {
	test('keeps points from the last few months; null keeps all', () => {
		const groups = trendGroups([
			session('june', {
				recordedAt: '2026-06-15T09:00:00Z',
				marks: marksAt(100, ['T', 0], ['L', 80])
			}),
			session('sept', {
				recordedAt: '2026-09-15T09:00:00Z',
				marks: marksAt(100, ['T', 0], ['L', 80])
			})
		]);
		const now = new Date('2026-10-27T12:00:00Z');
		expect(withinMonths(groups[0].points, 3, now).map((point) => point.session.id)).toEqual([
			'sept'
		]);
		expect(withinMonths(groups[0].points, null, now)).toHaveLength(2);
	});
});

describe('valueTicks', () => {
	test('a few round ticks that cover the values', () => {
		expect(valueTicks(762, 868)).toEqual([750, 800, 850, 900]);
		expect(valueTicks(288, 360)).toEqual([280, 300, 320, 340, 360]);
	});

	test('a single value still gets an axis around it', () => {
		const ticks = valueTicks(851, 851);
		expect(ticks.length).toBeGreaterThanOrEqual(3);
		expect(ticks[0]).toBeLessThan(851);
		expect(ticks.at(-1)).toBeGreaterThan(851);
	});
});

describe('timeTicks', () => {
	const at = (iso: string) => new Date(iso).getTime();

	test('month starts, every month while they fit', () => {
		const months = (ticks: { time: number }[]) =>
			ticks.map((tick) => new Date(tick.time).getMonth() + 1);
		expect(months(timeTicks(at('2026-04-26T00:00:00'), at('2026-10-20T00:00:00')))).toEqual([
			5, 6, 7, 8, 9, 10
		]);
		// Seven month starts are too many: every second month instead.
		expect(months(timeTicks(at('2026-04-26T00:00:00'), at('2026-11-02T00:00:00')))).toEqual([
			5, 7, 9, 11
		]);
	});

	test('a span across New Year labels January with the year', () => {
		const ticks = timeTicks(at('2025-11-10T00:00:00'), at('2026-03-10T00:00:00'));
		expect(ticks.find((tick) => new Date(tick.time).getMonth() === 0)?.label).toBe('2026');
	});

	test('a short span gets day ticks', () => {
		const ticks = timeTicks(at('2026-10-01T00:00:00'), at('2026-10-20T00:00:00'));
		expect(ticks.length).toBeGreaterThanOrEqual(2);
		expect(ticks.length).toBeLessThanOrEqual(6);
	});

	test('the domain pads the first and last dates', () => {
		const groups = trendGroups([session('only', { marks: marksAt(100, ['T', 0], ['L', 80]) })]);
		const [start, end] = timeDomain(groups[0].points);
		expect(start).toBeLessThan(groups[0].points[0].time);
		expect(end).toBeGreaterThan(groups[0].points[0].time);
	});
});
