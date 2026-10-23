/**
 * Tracks how much saved work exists only in this browser, so the app can say whether
 * storage is protected and nudge for an "Export all" before anything can be lost.
 */
import type { Session } from './schema';

const LAST_BACKUP_KEY = 'airtime:lastBackupAt';
const DUE_AFTER_SESSIONS = 5;
const DUE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

export type StorageProtection = 'protected' | 'unprotected' | 'unknown';

export type BackupStatus = {
	lastBackupAt: string | null;
	/** Sessions saved or changed since the last full export. */
	notBackedUp: number;
	/** Stored sessions this version can't read or export (saved by a newer Airtime). */
	unreadable: number;
	/** True once enough work, or old enough work, exists only in this browser, or some is unreadable. */
	due: boolean;
};

// localStorage is cleared along with IndexedDB, so a missing value can't hide unsaved work.
export function lastBackupAt(): string | null {
	try {
		return localStorage.getItem(LAST_BACKUP_KEY);
	} catch {
		return null;
	}
}

export function recordBackup(at = new Date().toISOString()): void {
	try {
		localStorage.setItem(LAST_BACKUP_KEY, at);
	} catch {
		// Storage unavailable; the reminder will simply keep showing.
	}
}

export function backupStatus(
	sessions: Session[],
	lastBackup: string | null,
	{ unreadable = 0, now = Date.now() }: { unreadable?: number; now?: number } = {}
): BackupStatus {
	const pending = sessions.filter((session) => !lastBackup || session.updatedAt > lastBackup);
	const oldest = pending.reduce<string | null>(
		(min, session) => (!min || session.updatedAt < min ? session.updatedAt : min),
		null
	);
	const due =
		unreadable > 0 ||
		pending.length >= DUE_AFTER_SESSIONS ||
		(oldest !== null && now - Date.parse(oldest) >= DUE_AFTER_MS);
	return { lastBackupAt: lastBackup, notBackedUp: pending.length, unreadable, due };
}

export async function storageProtection(): Promise<StorageProtection> {
	try {
		if (!navigator.storage?.persisted) return 'unknown';
		return (await navigator.storage.persisted()) ? 'protected' : 'unprotected';
	} catch {
		return 'unknown';
	}
}

/** Asks the browser to exempt saved sessions from automatic clearing. May prompt (Firefox). */
export async function protectStorage(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) ?? false;
	} catch {
		return false;
	}
}
