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
import { SCHEMA_VERSION, type Session } from './schema';
import type { Mark, MarkType } from '$lib/video/marks';
// A real export from schema v1, frozen. Never regenerate it: it stands in for the backups
// users already have, which every future version must still import.
import exportV1 from './fixtures/export-v1.json';

const v1Text = JSON.stringify(exportV1);

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

	test('timings recomputed from a v1 export match what it recorded', () => {
		const recomputed = buildExport(parseImport(v1Text));
		expect(recomputed.tables.intervals).toEqual(exportV1.tables.intervals);
		// Renamed in v2; the values are unchanged.
		const { lowTrustSessionIds, ...overview } = exportV1.overview;
		expect(recomputed.overview).toEqual({
			...overview,
			assumedFrameRateSessionIds: lowTrustSessionIds
		});
	});

	test("a v1 session's recorded date starts as the file's date", () => {
		for (const session of parseImport(v1Text)) {
			expect(session.recordedAt).toBe(session.media.lastModified);
		}
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
			expect(jump.rsi).toBeCloseTo(jump.heightCm! / 100 / jump.contactRealSeconds!, 2);
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
