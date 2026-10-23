/** IndexedDB persistence for saved sessions. */
import { migrateSession } from './migrate';
import type { Session } from './schema';

const DB_NAME = 'airtime';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		// Runs once per version the database is behind, so returning users are upgraded in
		// place. When bumping DB_VERSION, append a step; never change an existing one.
		request.onupgradeneeded = (event) => {
			const db = request.result;
			if (event.oldVersion < 1) {
				const store = db.createObjectStore(STORE, { keyPath: 'id' });
				store.createIndex('fingerprint', 'media.fingerprint');
			}
		};
		request.onsuccess = () => {
			const db = request.result;
			// Another tab running a newer version needs this connection closed to upgrade.
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};
		request.onerror = () => {
			dbPromise = null;
			reject(request.error);
		};
	});
	return dbPromise;
}

async function run<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, mode);
		const request = work(tx.objectStore(STORE));
		tx.oncomplete = () => resolve(request?.result as T);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/** Sessions must be plain objects: pass `$state.snapshot(...)`, not reactive proxies. */
export function saveSession(session: Session): Promise<IDBValidKey> {
	return run('readwrite', (store) => store.put(session));
}

export function putSessions(sessions: Session[]): Promise<void> {
	return run('readwrite', (store) => {
		for (const session of sessions) store.put(session);
	});
}

export function deleteSession(id: string): Promise<undefined> {
	return run('readwrite', (store) => store.delete(id));
}

export type StoredSessions = {
	/** Newest first. */
	sessions: Session[];
	/**
	 * Records this version can't read, usually because a newer version of Airtime saved
	 * them. They're left in storage untouched, and callers must not overwrite them.
	 */
	unreadableIds: string[];
};

/**
 * Records are upgraded to the current schema as they're read; the next save writes the
 * new shape.
 */
function readable(records: Record<string, unknown>[]): StoredSessions {
	const result: StoredSessions = { sessions: [], unreadableIds: [] };
	for (const record of records) {
		try {
			result.sessions.push(migrateSession(record) as Session);
		} catch {
			result.unreadableIds.push(String(record.id));
		}
	}
	result.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return result;
}

export async function readSessions(): Promise<StoredSessions> {
	return readable(await run('readonly', (store) => store.getAll()));
}

/** Most recently updated session for a file, if any. */
export async function findSessionByFingerprint(fingerprint: string): Promise<Session | undefined> {
	const matches = readable(
		await run('readonly', (store) => store.index('fingerprint').getAll(fingerprint))
	);
	return matches.sessions[0];
}

let persistRequested = false;

/** Asks the browser not to evict saved sessions under storage pressure. Best effort. */
export function requestPersistentStorage(): void {
	if (persistRequested) return;
	persistRequested = true;
	void navigator.storage?.persist?.().catch(() => {});
}
