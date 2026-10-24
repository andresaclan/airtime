/**
 * Upgrades sessions written by older versions of Airtime, whether read back from
 * IndexedDB or imported from an export file, so old data keeps working after updates.
 */
import { SCHEMA_VERSION } from './schema';

type RawSession = Record<string, unknown>;

/**
 * `MIGRATIONS[n]` turns a version-n session into a version-(n + 1) session. When the
 * schema changes, bump SCHEMA_VERSION and add one step here. Never edit a released step:
 * exports made by that version still depend on it.
 */
const MIGRATIONS: Record<number, (session: RawSession) => RawSession> = {
	// v2 makes the recorded date editable, starting from the file's last-modified time.
	1: (session) => ({
		...session,
		recordedAt: (session.media as RawSession | undefined)?.lastModified
	}),
	// v3 adds the jump type. Earlier sessions get none rather than a guess from their marks.
	2: (session) => ({ ...session, jumpType: null })
};

export class NewerSchemaError extends Error {
	constructor(version: number) {
		super(
			`Saved by a newer version of Airtime (schema ${version}). Reload the page to update the app.`
		);
	}
}

/** `migrations` and `target` are overridable so tests can exercise the chain. */
export function migrateSession(
	raw: RawSession,
	migrations: Record<number, (session: RawSession) => RawSession> = MIGRATIONS,
	target: number = SCHEMA_VERSION
): RawSession {
	let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
	if (!Number.isInteger(version) || version < 1) {
		throw new Error(`Unrecognised schema version ${String(raw.schemaVersion)}`);
	}
	if (version > target) throw new NewerSchemaError(version);
	let session = raw;
	while (version < target) {
		const step = migrations[version];
		if (!step) throw new Error(`No migration from schema version ${version}`);
		version += 1;
		session = { ...step(session), schemaVersion: version };
	}
	return session;
}
