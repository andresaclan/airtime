import { describe, expect, test } from 'vitest';
import {
	analyzeMarks,
	frameOf,
	groupJumps,
	rsi,
	sortMarks,
	unpairedReason,
	type Mark,
	type MarkType
} from '$lib/video/marks';
import { buildExport, parseImport } from './exportFile';
import { SCHEMA_VERSION, type Session } from './schema';

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
		jumpType: 'repeat-hops',
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
		frameRate: { value: 60, source: 'container' },
		timeScale: 1,
		marks: [],
		...overrides
	};
}

const NTSC = 60000 / 1001;

const sessions: Session[] = [
	// Rebounds at 59.94 fps, then two takeoffs in a row.
	session('rebounds', {
		frameRate: { value: 59.94, source: 'container' },
		marks: marksAt(
			NTSC,
			['L0', 100],
			['T1', 112],
			['L1', 142],
			['T2', 155],
			['L2', 187],
			['T3', 300],
			['T4', 310],
			['L4', 340]
		)
	}),
	// A 4× slow-motion drop jump at 240 fps with a lone landing at the end.
	session('slow-drop', {
		recordedAt: '2026-10-02T09:00:00.000Z',
		jumpType: 'drop-jump',
		frameRate: { value: 240, source: 'playback-estimate' },
		timeScale: 0.25,
		marks: marksAt(240, ['L0', 240], ['T1', 432], ['L1', 912], ['L9', 2000])
	})
];

const exported = buildExport(sessions);

describe('derived numbers in the export match analyzeMarks', () => {
	test.each(sessions.map((s) => [s.id, s] as const))('%s', (_, source) => {
		const fps = source.frameRate.value;
		const marks = sortMarks(source.marks);
		const analysis = analyzeMarks(marks, fps, source.timeScale);
		const grouped = groupJumps(marks, analysis);
		const out = exported.sessions.find((s) => s.id === source.id);
		if (!out) throw new Error(`missing ${source.id}`);

		expect(out.marks.map((mark) => mark.frame)).toEqual(marks.map((m) => frameOf(m.time, fps)));

		expect(out.derived.intervals).toHaveLength(analysis.intervals.length);
		analysis.intervals.forEach((interval, i) => {
			const row = out.derived.intervals[i];
			expect(row).toMatchObject({
				kind: interval.kind,
				fromMarkId: interval.from.id,
				toMarkId: interval.to.id,
				frames: interval.frames
			});
			expect(row.seconds).toBeCloseTo(interval.seconds, 4);
			expect(row.realSeconds).toBeCloseTo(interval.realSeconds, 4);
			if (interval.heightCm === undefined) expect(row.heightCm).toBeUndefined();
			else expect(row.heightCm).toBeCloseTo(interval.heightCm, 1);
		});

		expect(out.derived.jumps).toHaveLength(grouped.jumps.length);
		grouped.jumps.forEach((jump, i) => {
			const row = out.derived.jumps[i];
			expect(row).toMatchObject({
				takeoffMarkId: jump.takeoff.id,
				landingMarkId: jump.landing?.id ?? null,
				contactStartMarkId: jump.contact?.from.id ?? null,
				incomplete: !jump.flight,
				flightFrames: jump.flight?.frames ?? null,
				contactFrames: jump.contact?.frames ?? null
			});
			const index = rsi(jump);
			if (index === undefined) expect(row.rsi).toBeNull();
			else expect(row.rsi).toBeCloseTo(index, 2);
			if (jump.flight?.heightCm === undefined) expect(row.heightCm).toBeNull();
			else expect(row.heightCm).toBeCloseTo(jump.flight.heightCm, 1);
		});

		expect(out.derived.unpairedMarks).toEqual(
			grouped.unpairedMarks.map((mark) => ({
				markId: mark.id,
				reason: unpairedReason(marks, mark)
			}))
		);

		const heights = analysis.intervals.flatMap((interval) => interval.heightCm ?? []);
		expect(out.derived.summary.flightCount).toBe(heights.length);
		expect(out.derived.summary.bestHeightCm).toBeCloseTo(Math.max(...heights), 1);
		expect(out.derived.precisionMs).toBeCloseTo((1000 / fps) * source.timeScale, 2);
	});

	test('tables repeat the per-session numbers', () => {
		const intervals = exported.sessions.flatMap((s) => s.derived.intervals);
		expect(exported.tables.intervals.map((row) => [row.kind, row.frames, row.heightCm])).toEqual(
			intervals.map((row) => [row.kind, row.frames, row.heightCm ?? null])
		);
		const jumps = exported.sessions.flatMap((s) => s.derived.jumps);
		expect(exported.tables.jumps.map((row) => [row.heightCm, row.rsi])).toEqual(
			jumps.map((row) => [row.heightCm, row.rsi])
		);
	});

	test('hand-computed values for the slow-motion drop jump', () => {
		// 192 frames of contact and 480 of flight at 240 fps, slowed 4×: 0.2 s and 0.5 s.
		const [jump] = exported.sessions[1].derived.jumps;
		expect(jump.contactRealSeconds).toBe(0.2);
		expect(jump.flightRealSeconds).toBe(0.5);
		expect(jump.heightCm).toBe(30.7); // 9.81 × 0.5² / 8 = 30.656 cm
		expect(jump.rsi).toBe(1.53); // 0.30656 m / 0.2 s
		expect(exported.sessions[1].derived.precisionMs).toBe(1.04); // 1000 / 240 × 0.25
	});

	test('hand-computed values for the 59.94 fps rebounds', () => {
		const rebounds = exported.sessions[0].derived;
		// 30 frames of flight at 60000/1001 fps = 0.5005 s: 9.81 × 0.5005² / 8 = 30.72 cm.
		expect(rebounds.jumps[0]).toMatchObject({ flightFrames: 30, heightCm: 30.7 });
		expect(rebounds.jumps[0].flightRealSeconds).toBeCloseTo(0.5005, 4);
		// T3 follows a contact, so it's a jump that never landed rather than an unpaired mark.
		expect(rebounds.unpairedMarks).toEqual([]);
		expect(rebounds.jumps[2]).toMatchObject({
			takeoffMarkId: 'T3',
			incomplete: true,
			contactFrames: 113
		});
		expect(exported.sessions[1].derived.unpairedMarks).toEqual([
			{ markId: 'L9', reason: 'out-of-sequence' }
		]);
	});

	test('an exported file imports back to the same numbers', () => {
		const again = buildExport(parseImport(JSON.stringify(exported)));
		expect(again.tables).toEqual(exported.tables);
		expect(again.overview).toEqual(exported.overview);
	});
});
