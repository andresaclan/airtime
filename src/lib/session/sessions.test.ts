import { describe, expect, test } from 'vitest';
import { buildExport, parseImport, sessionsToImport } from './exportFile';
import { migrateSession, NewerSchemaError } from './migrate';
import { backupStatus } from './backup';
import { SCHEMA_VERSION, type Session } from './schema';
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
		expect(recomputed.overview).toEqual(exportV1.overview);
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

	// MIGRATIONS is empty until the first schema change, so exercise the chain with stand-ins.
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
