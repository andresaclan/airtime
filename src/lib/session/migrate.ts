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
const MIGRATIONS: Record<number, (session: RawSession) => RawSession> = {};

export class NewerSchemaError extends Error {
	constructor(version: number) {
		super(
			`Saved by a newer version of Airtime (schema ${version}). Reload the page to update the app.`
		);
	}
}

export function migrateSession(raw: RawSession): RawSession {
	let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
	if (!Number.isInteger(version) || version < 1) {
		throw new Error(`Unrecognised schema version ${String(raw.schemaVersion)}`);
	}
	if (version > SCHEMA_VERSION) throw new NewerSchemaError(version);
	let session = raw;
	while (version < SCHEMA_VERSION) {
		const step = MIGRATIONS[version];
		if (!step) throw new Error(`No migration from schema version ${version}`);
		version += 1;
		session = { ...step(session), schemaVersion: version };
	}
	return session;
}
