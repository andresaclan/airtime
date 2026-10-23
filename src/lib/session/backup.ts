/**
 * Tracks how much saved work exists only in this browser, so the app can say whether
 * storage is protected and nudge for an "Export all" before anything can be lost.
 * A backup is a full export; restoring one is an import.
 */
import { downloadFile, exportFile, parseImport, sessionsToImport } from './exportFile';
import type { Session } from './schema';
import { putSessions, readSessions } from './store';

const LAST_BACKUP_KEY = 'airtime:lastBackupAt';
// The only backup thresholds; everything that reminds reads `BackupStatus.due`.
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

/** Due, and a backup would actually help: unreadable sessions alone can't be exported. */
export function needsBackup(status: BackupStatus | null): boolean {
	return !!status?.due && status.notBackedUp > 0;
}

export type BackupMethod = 'share' | 'download';

/**
 * Touch-first devices get the share sheet, so the file can go to Files, iCloud, Drive or
 * email, off the device. Elsewhere a download already lands somewhere the user manages,
 * and desktop share sheets can't save to a folder.
 */
export function backupMethod({
	canShareFiles,
	touchFirst
}: {
	canShareFiles: boolean;
	touchFirst: boolean;
}): BackupMethod {
	return canShareFiles && touchFirst ? 'share' : 'download';
}

/** The share sheet rejects with AbortError when the user dismisses it. */
export function isShareCancel(error: unknown): boolean {
	return (error as { name?: unknown } | null)?.name === 'AbortError';
}

function canShareFile(file: File): boolean {
	try {
		return !!navigator.canShare?.({ files: [file] });
	} catch {
		return false;
	}
}

export type BackupOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Exports every session and records the backup. Call it straight from a tap, with sessions
 * already loaded: Safari only opens the share sheet if nothing is awaited first. A share
 * counts as a backup even though we can't know where it went.
 *
 * `readAt` is when `sessions` were read from storage. Anything saved after that (in another
 * tab, or by a save still in flight) isn't in the file, so the backup only counts up to then.
 */
export async function backUp(sessions: Session[], readAt: string): Promise<BackupOutcome> {
	const file = exportFile(sessions);
	const touchFirst = window.matchMedia?.('(pointer: coarse)').matches ?? false;
	if (backupMethod({ canShareFiles: canShareFile(file), touchFirst }) === 'share') {
		try {
			await navigator.share({ files: [file] });
			recordBackup(readAt);
			return 'shared';
		} catch (error) {
			if (isShareCancel(error)) return 'cancelled';
			// The share sheet failed rather than being dismissed; download instead.
		}
	}
	downloadFile(file);
	recordBackup(readAt);
	return 'downloaded';
}

/**
 * When a backup is restored into an empty browser, everything stored came from that file,
 * so it's backed up as of its newest session. Returns the time to record, if any.
 */
export function backupAfterRestore(
	existing: Session[],
	imported: Session[],
	lastBackup: string | null
): string | null {
	if (existing.length > 0 || imported.length === 0) return null;
	const newest = imported.reduce(
		(max, session) => (session.updatedAt > max ? session.updatedAt : max),
		''
	);
	return !lastBackup || newest > lastBackup ? newest : null;
}

export type ImportResult = { imported: number; skipped: number };

/** Merges an export file into storage; the newer copy of each session wins. */
export async function importBackup(file: File): Promise<ImportResult> {
	const incoming = parseImport(await file.text());
	const stored = await readSessions();
	const toImport = sessionsToImport(incoming, stored.sessions, stored.unreadableIds);
	await putSessions(toImport);
	const backedUpAt = backupAfterRestore(stored.sessions, toImport, lastBackupAt());
	if (backedUpAt) recordBackup(backedUpAt);
	return { imported: toImport.length, skipped: incoming.length - toImport.length };
}

export function importSummary({ imported, skipped }: ImportResult): string {
	return (
		`Imported ${imported} session${imported === 1 ? '' : 's'}` +
		(skipped ? ` · skipped ${skipped} already up to date` : '')
	);
}

export function importFailure(error: unknown): string {
	return `Import failed: ${error instanceof Error ? error.message : 'unknown error'}`;
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
