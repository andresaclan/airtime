/**
 * Unsaved work on one video, kept as it changes so it survives the page reloading.
 * iOS Safari can kill a tab under memory pressure and reload it, and it ignores the
 * `beforeunload` prompt when it does. A draft is not a saved session: it never shows
 * in Sessions, and saving or discarding the edits deletes it.
 *
 * One draft per video, keyed by the file's fingerprint (see fingerprint.ts).
 */
import { migrateSession } from './migrate';
import type { Session } from './schema';

export type Draft = {
	fingerprint: string;
	/** ISO timestamp of the last edit. */
	updatedAt: string;
	/**
	 * True while the edits have never been saved: `session.id` and `createdAt` are then
	 * placeholders. False when they edit a saved session (which may since have been
	 * deleted), so saving updates that session.
	 */
	isNew: boolean;
	/** The session as saving it now would write it. */
	session: Session;
};

/** The parts of a session the athlete edits. Two sessions with equal signatures hold the same work. */
export function sessionSignature(fields: {
	marks: Session['marks'];
	title: string;
	notes: string;
	jumpType: Session['jumpType'];
	recordedAt: string;
	timeScale: number;
}): string {
	return JSON.stringify({
		marks: fields.marks,
		title: fields.title,
		notes: fields.notes,
		jumpType: fields.jumpType,
		recordedAt: fields.recordedAt,
		timeScale: fields.timeScale
	});
}

export function makeDraft(session: Session, isNew: boolean, now: string): Draft {
	return { fingerprint: session.media.fingerprint, updatedAt: now, isNew, session };
}

/**
 * A stored draft upgraded to the current schema, or null when it can't be read (a
 * newer version of Airtime wrote it, or it's damaged). Unreadable drafts are left in
 * storage for the version that can read them.
 */
export function readDraft(raw: unknown): Draft | null {
	if (!raw || typeof raw !== 'object') return null;
	const record = raw as Record<string, unknown>;
	if (typeof record.fingerprint !== 'string' || !record.session) return null;
	try {
		const session = migrateSession(record.session as Record<string, unknown>) as Session;
		if (!Array.isArray(session.marks)) return null;
		return {
			fingerprint: record.fingerprint,
			updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : session.updatedAt,
			isNew: record.isNew !== false,
			session
		};
	} catch {
		return null;
	}
}

export type Restore =
	| { kind: 'none' }
	| { kind: 'saved'; saved: Session }
	/** `saved` is the session the draft's edits are measured against, if there is one. */
	| { kind: 'draft'; draft: Draft; saved?: Session };

/**
 * What reopening a video brings back. Unsaved edits win over the saved session, since
 * they were made after it. A draft holding nothing the saved session doesn't is stale
 * (`staleDraft`) and should be deleted.
 */
export function pickRestore(
	saved: Session | undefined,
	draft: Draft | null
): Restore & { staleDraft: boolean } {
	if (draft && (!saved || sessionSignature(draft.session) !== sessionSignature(saved))) {
		return { kind: 'draft', draft, saved, staleDraft: false };
	}
	if (saved) return { kind: 'saved', saved, staleDraft: Boolean(draft) };
	return { kind: 'none', staleDraft: false };
}

/** Drafts worth offering back on the start screen, newest first. */
export function waitingDrafts(drafts: Draft[]): Draft[] {
	return drafts
		.filter((draft) => draft.session.marks.length > 0 || !draft.isNew)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type DraftStore = {
	put(draft: Draft): Promise<unknown>;
	delete(fingerprint: string): Promise<unknown>;
};

/**
 * Writes drafts one at a time, in the order they're asked for, so a delete after saving
 * can't be overtaken by a put from just before it. Only the latest request per video
 * waits while a write runs; the ones in between are skipped. Failed writes are dropped
 * (storage may be unavailable, as in some private windows): the edits are still on screen.
 */
export class DraftWriter {
	private pending = new Map<string, Draft | null>();
	private running: Promise<void> | null = null;

	constructor(private store: DraftStore) {}

	/** Queues `draft` for its video, or deletes the video's draft when null. */
	set(fingerprint: string, draft: Draft | null): Promise<void> {
		this.pending.set(fingerprint, draft);
		return this.kick();
	}

	private kick(): Promise<void> {
		this.running ??= this.drain().then(() => {
			this.running = null;
			// Asked for after the last check in `drain`, before this ran.
			if (this.pending.size > 0) return this.kick();
		});
		return this.running;
	}

	/** Resolves once everything queued so far is written. */
	flush(): Promise<void> {
		return this.running ?? Promise.resolve();
	}

	private async drain() {
		while (this.pending.size > 0) {
			const [fingerprint, draft] = this.pending.entries().next().value!;
			this.pending.delete(fingerprint);
			try {
				if (draft) await this.store.put(draft);
				else await this.store.delete(fingerprint);
			} catch {
				// Nothing to do: see the class comment.
			}
		}
	}
}
