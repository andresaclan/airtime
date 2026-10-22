/** IndexedDB persistence for saved sessions. */
import type { Session } from './schema';

const DB_NAME = 'airtime';
const DB_VERSION = 1;
const STORE = 'sessions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
			store.createIndex('fingerprint', 'media.fingerprint');
		};
		request.onsuccess = () => resolve(request.result);
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

export async function listSessions(): Promise<Session[]> {
	const sessions = await run<Session[]>('readonly', (store) => store.getAll());
	return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Most recently updated session for a file, if any. */
export async function findSessionByFingerprint(fingerprint: string): Promise<Session | undefined> {
	const matches = await run<Session[]>('readonly', (store) =>
		store.index('fingerprint').getAll(fingerprint)
	);
	return matches.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

let persistRequested = false;

/** Asks the browser not to evict saved sessions under storage pressure. Best effort. */
export function requestPersistentStorage(): void {
	if (persistRequested) return;
	persistRequested = true;
	void navigator.storage?.persist?.().catch(() => {});
}
