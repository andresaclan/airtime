import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildExport, parseImport, sessionsToImport } from './exportFile';
import { migrateSession, NewerSchemaError } from './migrate';
import {
	backUp,
	backupAfterImport,
	backupMethod,
	backupStatus,
	importSummary,
	isShareCancel,
	lastBackupAt,
	needsBackup
} from './backup';
import { DEFAULT_JUMP_TYPE, JUMP_TYPES, SCHEMA_VERSION, type Session } from './schema';
import type { Mark, MarkType } from '$lib/video/marks';
// A real export from schema v1, frozen. Never regenerate it: it stands in for the backups
// users already have, which every future version must still import.
import exportV1 from './fixtures/export-v1.json';
// A real export from schema v3: three approach-jump sessions saved as countermovement, since
// v3 had no approach type. The athlete checked every mark frame by frame. Never regenerate it.
import exportV3 from './fixtures/export-v3.json';

const v1Text = JSON.stringify(exportV1);
const v3Text = JSON.stringify(exportV3);

/**
 * The old exports counted the takeoff frame as flight. It's contact now, since a toe is
 * still down, so every flight is one frame shorter and every contact one frame longer.
 * Moving each takeoff mark one frame earlier undoes exactly that, so it gives back the
 * numbers an old export recorded.
 */
function takeoffsOneFrameEarlier(sessions: Session[]): Session[] {
	return sessions.map((session) => ({
		...session,
		marks: session.marks.map((mark) =>
			mark.type === 'takeoff' ? { ...mark, time: mark.time - 1 / session.frameRate.value } : mark
		)
	}));
}

/**
 * An old export's row with its takeoff time moved one frame earlier, to match. The result
 * is unrounded, so compare it to within the export's 4 decimals.
 */
function withEarlierTakeoff<
	T extends { frameRate: number; kind?: string; startSeconds?: number; takeoffSeconds?: number }
>(row: T): T {
	const frame = 1 / row.frameRate;
	if (row.kind === 'flight' && row.startSeconds !== undefined)
		return { ...row, startSeconds: row.startSeconds - frame };
	if (row.takeoffSeconds !== undefined)
		return { ...row, takeoffSeconds: row.takeoffSeconds - frame };
	return row;
}

describe('importing old exports', () => {
	test('a v1 export imports into the current schema', () => {
		const sessions = parseImport(v1Text);
		expect(sessions).toHaveLength(2);
		for (const session of sessions) expect(session.schemaVersion).toBe(SCHEMA_VERSION);
		const [cmj, drop] = sessions;
		expect(cmj.title).toBe('CMJ set 1');
		expect(cmj.marks.map((mark) => mark.type)).toEqual([
			'landing',
			'takeoff',
			'landing',
			'takeoff',
			'landing'
		]);
		expect(drop.timeScale).toBe(0.25);
		expect(drop.frameRate).toEqual({ value: 240, source: 'playback-estimate' });
	});

	test('legacy marks export unchanged', () => {
		const recomputed = buildExport(parseImport(v1Text));
		expect(recomputed.sessions.map((session) => session.marks)).toEqual(
			exportV1.sessions.map((session) => session.marks)
		);
	});

	test('legacy flight timings survive, one takeoff frame apart, while borrowed contact is removed', () => {
		const recomputed = buildExport(takeoffsOneFrameEarlier(parseImport(v1Text)));
		// Unknown legacy types no longer borrow the landing of a previous flight.
		// The old export's second contact in cmj-set1.mov spanned two separate jumps.
		expect(recomputed.tables.intervals.map((row) => ({ ...row, jumpType: undefined }))).toEqual(
			exportV1.tables.intervals
				.filter(
					(row) => !(row.fileName === 'cmj-set1.mov' && row.kind === 'contact' && row.index === 2)
				)
				.map((row) => {
					const moved = withEarlierTakeoff(row);
					return {
						...moved,
						startSeconds: expect.closeTo(moved.startSeconds, 4),
						jumpType: undefined
					};
				})
		);
		// Renamed in v2; contact aggregates now exclude the borrowed contact.
		const { lowTrustSessionIds, ...overview } = exportV1.overview;
		expect(recomputed.overview).toEqual({
			...overview,
			contactCount: 1,
			meanContactRealSeconds: 0.25,
			assumedFrameRateSessionIds: lowTrustSessionIds
		});
	});

	test("a v1 session's recorded date starts as the file's date", () => {
		for (const session of parseImport(v1Text)) {
			expect(session.recordedAt).toBe(session.media.lastModified);
		}
	});

	test('a v1 session has no jump type rather than a guessed one', () => {
		for (const session of parseImport(v1Text)) expect(session.jumpType).toBeNull();
		const exported = buildExport(parseImport(v1Text));
		for (const row of [
			...exported.tables.sessions,
			...exported.tables.jumps,
			...exported.tables.intervals
		]) {
			expect(row.jumpType).toBeNull();
		}
	});

	test('marks from a real v3 export export unchanged', () => {
		const recomputed = buildExport(parseImport(v3Text));
		expect(recomputed.sessions.map((session) => session.marks)).toEqual(
			exportV3.sessions.map((session) => session.marks)
		);
	});

	test('timings recomputed from a real v3 export match what it recorded, one takeoff frame apart', () => {
		const sessions = parseImport(v3Text);
		for (const session of sessions) expect(session.schemaVersion).toBe(SCHEMA_VERSION);
		const recomputed = buildExport(takeoffsOneFrameEarlier(sessions));
		// Marks are exported to the microsecond, so a duration on an exact tie can round the
		// other way: 51 frames at 59.94 fps is 0.85085 s, recorded 0.8508 and recomputed 0.8509.
		// The retired countermovement type comes back unset.
		const durationKeys = /Seconds$|^seconds$/;
		const nearDurations = (value: unknown, key = ''): unknown =>
			key === 'jumpType'
				? null
				: Array.isArray(value)
					? value.map((item) => nearDurations(item))
					: value && typeof value === 'object'
						? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, nearDurations(v, k)]))
						: typeof value === 'number' && durationKeys.test(key)
							? expect.closeTo(value, 3)
							: value;
		// Each session's derived numbers are the ones its table rows repeat.
		expect(recomputed.tables).toEqual({
			intervals: nearDurations(exportV3.tables.intervals.map(withEarlierTakeoff)),
			jumps: nearDurations(exportV3.tables.jumps.map(withEarlierTakeoff)),
			sessions: nearDurations(exportV3.tables.sessions)
		});
		expect(recomputed.overview).toEqual(nearDurations(exportV3.overview));
	});

	test('the checked marks give the flights, heights and RSI the athlete verified', () => {
		const jumps = buildExport(parseImport(v3Text)).tables.jumps;
		// The file names count frames from the takeoff mark to the landing mark (199, 52, 51).
		// The takeoff frame still has a toe down, so it's contact: flights are one frame
		// shorter than those counts, and contacts one frame longer than the marks' gap.
		expect(
			jumps.map((jump) => [jump.frameRate, jump.flightFrames, jump.contactFrames, jump.heightCm])
		).toEqual([
			[240, 198, 80, 83.2],
			[60, 51, 20, 88.8],
			[59.94, 50, 19, 85.3],
			[59.94, 49, 19, 81.9],
			[59.94, 50, 20, 85.3],
			[59.94, 50, 19, 85.3],
			[59.94, 50, 19, 85.3]
		]);
		// Durations come from the marks' stored times, which are the frames' real timestamps,
		// not frame counts: the 240 fps flight runs from the end of the takeoff frame,
		// 2.616667 + 1 / 240, to the landing at 3.444583: 0.82375 s, so 9.81 × 0.82375² / 8 =
		// 83.21 cm, where 198 / 240 would give 83.5.
		expect(jumps[0].flightRealSeconds).toBe(0.8237);
		expect(jumps[0].rsi).toBe(2.5); // 0.8321 m / 0.3325 s of plant contact
	});

	test('sessions without their own version use the file version', () => {
		const data = structuredClone(exportV1) as Record<string, unknown>;
		const sessions = data.sessions as Record<string, unknown>[];
		for (const session of sessions) delete session.schemaVersion;
		expect(parseImport(JSON.stringify(data))).toHaveLength(2);
	});

	test('an export from a newer app says to update rather than failing obscurely', () => {
		const data = structuredClone(exportV1) as Record<string, unknown>;
		data.schemaVersion = SCHEMA_VERSION + 1;
		for (const session of data.sessions as Record<string, unknown>[]) {
			session.schemaVersion = SCHEMA_VERSION + 1;
		}
		expect(() => parseImport(JSON.stringify(data))).toThrow(/newer version of Airtime/);
	});
});

describe('migrateSession', () => {
	test('current sessions pass through unchanged', () => {
		const raw = { schemaVersion: SCHEMA_VERSION, id: 'x' };
		expect(migrateSession(raw)).toEqual(raw);
	});

	// Stand-in steps exercise the chain independently of the real migrations.
	test('runs each step in order, from the stored version up to the target', () => {
		const steps = {
			1: (session: Record<string, unknown>) => ({ ...session, notes: session.notes ?? '' }),
			2: ({ timeScale, ...session }: Record<string, unknown>) => ({
				...session,
				playback: { timeScale }
			})
		};
		const v1 = { schemaVersion: 1, id: 'x', timeScale: 0.25 };
		expect(migrateSession(v1, steps, 3)).toEqual({
			schemaVersion: 3,
			id: 'x',
			notes: '',
			playback: { timeScale: 0.25 }
		});
		expect(migrateSession({ schemaVersion: 2, id: 'y', timeScale: 1 }, steps, 3)).toEqual({
			schemaVersion: 3,
			id: 'y',
			playback: { timeScale: 1 }
		});
		expect(v1).toEqual({ schemaVersion: 1, id: 'x', timeScale: 0.25 });
	});

	test('v2 sessions gain a null jump type and keep everything else', () => {
		const v2 = { schemaVersion: 2, id: 'x', title: 'Set 1', marks: [] };
		expect(migrateSession(v2)).toEqual({ ...v2, schemaVersion: SCHEMA_VERSION, jumpType: null });
	});

	test('v3 sessions only change version on the way to v4', () => {
		const v3 = { schemaVersion: 3, id: 'x', jumpType: 'drop', marks: [] };
		expect(migrateSession(v3, undefined, 4)).toEqual({ ...v3, schemaVersion: 4 });
	});

	test('v4 jump types are renamed to their menu names, and retired ones are unset', () => {
		const types = ['approach', 'drop', 'rebound', 'countermovement', 'squat', null];
		const migrated = types.map(
			(jumpType) => migrateSession({ schemaVersion: 4, id: 'x', jumpType }).jumpType
		);
		expect(migrated).toEqual(['approach', 'drop-jump', 'repeat-hops', null, null, null]);
	});

	test('v1 sessions pass through every real step', () => {
		const v1 = { schemaVersion: 1, id: 'x', media: { lastModified: '2026-01-01T00:00:00.000Z' } };
		expect(migrateSession(v1)).toMatchObject({
			schemaVersion: SCHEMA_VERSION,
			recordedAt: '2026-01-01T00:00:00.000Z',
			jumpType: null
		});
	});

	test('a session that already has a jump type is not overwritten by the v2 step', () => {
		const current = { schemaVersion: SCHEMA_VERSION, id: 'x', jumpType: 'drop-jump' };
		expect(migrateSession(current)).toEqual(current);
	});

	test('fails loudly when a step is missing', () => {
		expect(() => migrateSession({ schemaVersion: 1 }, {}, 2)).toThrow(/No migration from/);
	});

	test('rejects newer and nonsense versions', () => {
		expect(() => migrateSession({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(NewerSchemaError);
		expect(() => migrateSession({ schemaVersion: 0 })).toThrow();
		expect(() => migrateSession({ schemaVersion: 1.5 })).toThrow();
	});
});

describe('exported jumps and unpaired marks', () => {
	const [base] = parseImport(v1Text);
	const at = (id: string, type: MarkType, time: number): Mark => ({ id, type, time });
	const session = (marks: Mark[]): Session => ({
		...base,
		frameRate: { value: 30, source: 'container' },
		timeScale: 1,
		marks
	});

	test('lists every jump, including incomplete ones, with RSI only after a contact', () => {
		const [cmj] = buildExport(parseImport(v1Text)).sessions;
		expect(cmj.derived.jumps).toHaveLength(2);
		for (const jump of cmj.derived.jumps) {
			expect(jump.incomplete).toBe(false);
			if (jump.contactRealSeconds === null) expect(jump.rsi).toBeNull();
			else expect(jump.rsi).toBeCloseTo(jump.heightCm! / 100 / jump.contactRealSeconds, 2);
		}

		const [exported] = buildExport([
			session([
				at('t1', 'takeoff', 1),
				at('t2', 'takeoff', 1.5),
				at('l1', 'landing', 2),
				at('l2', 'landing', 2.5),
				at('t3', 'takeoff', 5)
			])
		]).sessions;
		expect(exported.derived.jumps).toMatchObject([
			{ index: 1, takeoffMarkId: 't2', landingMarkId: 'l1', incomplete: false, rsi: null },
			{ index: 2, takeoffMarkId: 't3', contactStartMarkId: 'l2', incomplete: true, rsi: null }
		]);
		expect(exported.derived.unpairedMarks).toEqual([{ markId: 't1', reason: 'out-of-sequence' }]);
	});

	test('a lone landing is unpaired because it has nothing to pair with', () => {
		const exported = buildExport([session([at('l', 'landing', 1)])]);
		expect(exported.sessions[0].derived.unpairedMarks).toEqual([{ markId: 'l', reason: 'alone' }]);
		expect(exported.tables.jumps).toEqual([]);
	});

	test('the jumps table repeats session context on every row', () => {
		const exported = buildExport(parseImport(v1Text));
		expect(exported.tables.jumps).toHaveLength(
			exported.sessions.reduce((sum, s) => sum + s.derived.jumps.length, 0)
		);
		for (const row of exported.tables.jumps) {
			const owner = exported.sessions.find((s) => s.id === row.sessionId)!;
			expect(row.recordedAt).toBe(owner.recordedAt);
			expect(row).not.toHaveProperty('takeoffMarkId');
		}
	});

	test('sessions are ordered by their corrected recorded date', () => {
		const [cmj, drop] = parseImport(v1Text);
		const exported = buildExport([{ ...cmj, recordedAt: '2027-01-01T00:00:00.000Z' }, drop]);
		expect(exported.sessions.map((s) => s.id)).toEqual([drop.id, cmj.id]);
		expect(exported.overview.lastRecordedAt).toBe('2027-01-01T00:00:00.000Z');
	});
});

describe('jump type', () => {
	const [base] = parseImport(v1Text);
	const typed = { ...base, jumpType: 'drop-jump' as const };

	test('is exported on sessions and on every table row', () => {
		const exported = buildExport([typed]);
		expect(exported.sessions[0].jumpType).toBe('drop-jump');
		const rows = [
			...exported.tables.sessions,
			...exported.tables.jumps,
			...exported.tables.intervals
		];
		expect(rows.length).toBeGreaterThan(1);
		for (const row of rows) expect(row.jumpType).toBe('drop-jump');
		expect(exported.fields).toHaveProperty(['sessions[].jumpType']);
	});

	test('survives an export and import', () => {
		const text = JSON.stringify(buildExport([typed, { ...base, id: 'unset' }]));
		const types = parseImport(text).map((session) => session.jumpType);
		expect(types).toEqual(expect.arrayContaining(['drop-jump', null]));
	});

	test('an unrecognised type is rejected', () => {
		const data = JSON.parse(JSON.stringify(buildExport([typed])));
		data.sessions[0].jumpType = 'box';
		expect(() => parseImport(JSON.stringify(data))).toThrow(/jumpType is not recognised/);
	});

	test('the menu offers approach, drop jump and repeat hops, in that order', () => {
		expect(JUMP_TYPES.map((type) => type.label)).toEqual(['Approach', 'Drop jump', 'Repeat hops']);
		expect(DEFAULT_JUMP_TYPE).toBe('approach');
	});

	test('sessions saved with a retired type import with the type unset', () => {
		const types = parseImport(v3Text).map((session) => session.jumpType);
		expect(types).toEqual([null, null, null]);
	});

	test('a v4 export imports under the new names', () => {
		const data = JSON.parse(JSON.stringify(buildExport([typed, { ...typed, id: 'hops' }])));
		data.schemaVersion = 4;
		data.sessions[0].schemaVersion = 4;
		data.sessions[0].jumpType = 'drop';
		data.sessions[1].schemaVersion = 4;
		data.sessions[1].jumpType = 'rebound';
		const types = parseImport(JSON.stringify(data)).map((session) => session.jumpType);
		expect(types).toEqual(['drop-jump', 'repeat-hops']);
	});

	test('a v3 session set to approach survives an export and import', () => {
		const approach = parseImport(v3Text).map((session) => ({
			...session,
			jumpType: 'approach' as const
		}));
		const again = parseImport(JSON.stringify(buildExport(approach)));
		expect(again.map((session) => session.jumpType)).toEqual(['approach', 'approach', 'approach']);
	});
});

describe('sessionsToImport', () => {
	const sessions = parseImport(v1Text);

	test('never overwrites a stored session this version cannot read', () => {
		const [cmj, drop] = sessions;
		expect(sessionsToImport(sessions, [], [cmj.id])).toEqual([drop]);
	});

	test('keeps only new or newer sessions', () => {
		const older = { ...sessions[0], updatedAt: '2026-09-01T00:00:00.000Z' };
		expect(sessionsToImport(sessions, [older, sessions[1]])).toEqual([sessions[0]]);
	});
});

describe('backupStatus', () => {
	const sessions = parseImport(v1Text);
	const day = 24 * 60 * 60 * 1000;
	const at = (iso: string) => Date.parse(iso);

	test('counts sessions changed since the last backup', () => {
		const status = backupStatus(sessions, '2026-10-02T00:00:00.000Z', {
			now: at('2026-10-05T00:00:00Z')
		});
		expect(status.notBackedUp).toBe(1);
		expect(status.due).toBe(false);
	});

	test('is due once unexported work is two weeks old', () => {
		const status = backupStatus(sessions, null, { now: at('2026-10-01T17:10:00Z') + 14 * day });
		expect(status).toMatchObject({ notBackedUp: 2, due: true });
	});

	test('is due after five unexported sessions', () => {
		const many: Session[] = Array.from({ length: 5 }, (_, i) => ({
			...sessions[0],
			id: `s${i}`
		}));
		expect(backupStatus(many, null, { now: at('2026-10-02T00:00:00Z') }).due).toBe(true);
	});

	test('is due while sessions are unreadable, even with everything exported', () => {
		const status = backupStatus(sessions, '2026-10-04T12:00:00.000Z', {
			unreadable: 1,
			now: at('2026-10-05T00:00:00Z')
		});
		expect(status).toMatchObject({ notBackedUp: 0, unreadable: 1, due: true });
	});

	test('is not due when everything is backed up', () => {
		const status = backupStatus(sessions, '2026-10-04T12:00:00.000Z', {
			now: at('2027-01-01T00:00:00Z')
		});
		expect(status).toMatchObject({ notBackedUp: 0, due: false });
	});
});

describe('needsBackup', () => {
	const status = { lastBackupAt: null, notBackedUp: 6, unreadable: 0, due: true };

	test('reminds while due work is unexported', () => {
		expect(needsBackup(status)).toBe(true);
	});

	test('stays quiet when nothing is at risk or a backup would not help', () => {
		expect(needsBackup(null)).toBe(false);
		expect(needsBackup({ ...status, due: false })).toBe(false);
		expect(needsBackup({ ...status, notBackedUp: 0, unreadable: 1 })).toBe(false);
	});
});

describe('backupMethod', () => {
	test('shares on touch-first devices that can share files', () => {
		expect(backupMethod({ canShareFiles: true, touchFirst: true })).toBe('share');
	});

	test('downloads otherwise', () => {
		expect(backupMethod({ canShareFiles: true, touchFirst: false })).toBe('download');
		expect(backupMethod({ canShareFiles: false, touchFirst: true })).toBe('download');
	});
});

describe('isShareCancel', () => {
	test('only a dismissed share sheet counts as cancelled', () => {
		expect(isShareCancel(new DOMException('cancelled', 'AbortError'))).toBe(true);
		expect(isShareCancel(new DOMException('no gesture', 'NotAllowedError'))).toBe(false);
		expect(isShareCancel(new Error('boom'))).toBe(false);
		expect(isShareCancel(null)).toBe(false);
	});
});

describe('backUp', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test('only counts sessions read before the backup as backed up', async () => {
		const stored = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value)
		});
		vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
		vi.stubGlobal('navigator', { canShare: () => true, share: async () => {} });

		const [base] = parseImport(v1Text);
		const read = { ...base, id: 'read', updatedAt: '2026-10-10T00:00:00.000Z' };
		// Saved in another tab after this one read its sessions, so it isn't in the file.
		const later = { ...base, id: 'later', updatedAt: '2026-10-10T00:05:00.000Z' };
		const readAt = '2026-10-10T00:01:00.000Z';

		expect(await backUp([read], readAt)).toBe('shared');
		expect(lastBackupAt()).toBe(readAt);
		expect(backupStatus([read, later], lastBackupAt()).notBackedUp).toBe(1);
	});
});

describe('backupAfterImport', () => {
	const sessions = parseImport(v1Text);
	const newest = sessions.map((session) => session.updatedAt).sort()[1];

	test('an import into an empty browser is backed up as of its newest session', () => {
		expect(backupAfterImport([], sessions, null)).toBe(newest);
	});

	test('never marks local work as backed up', () => {
		expect(backupAfterImport([sessions[0]], [sessions[1]], null)).toBeNull();
		expect(backupAfterImport([], [], null)).toBeNull();
	});

	test('never moves the last backup backwards', () => {
		expect(backupAfterImport([], sessions, '2027-01-01T00:00:00.000Z')).toBeNull();
	});
});

describe('importSummary', () => {
	test('counts imported and skipped sessions', () => {
		expect(importSummary({ imported: 1, skipped: 0 })).toBe('Imported 1 session');
		expect(importSummary({ imported: 3, skipped: 2 })).toBe(
			'Imported 3 sessions · skipped 2 already up to date'
		);
	});
});
