import { describe, expect, test } from 'vitest';
import {
	DraftWriter,
	makeDraft,
	pickRestore,
	readDraft,
	sessionSignature,
	waitingDrafts,
	type Draft,
	type DraftStore
} from './draft';
import { SCHEMA_VERSION, type Session } from './schema';
import type { Mark } from '$lib/video/marks';

const FINGERPRINT = 'sha256:abc';

function session(overrides: Partial<Session> = {}): Session {
	return {
		schemaVersion: SCHEMA_VERSION,
		id: 's1',
		title: 'Approach set',
		notes: '',
		jumpType: 'approach',
		createdAt: '2026-11-01T10:00:00.000Z',
		updatedAt: '2026-11-01T10:00:00.000Z',
		recordedAt: '2026-11-01T09:00:00.000Z',
		media: {
			fileName: 'IMG_0001.MOV',
			mimeType: 'video/quicktime',
			sizeBytes: 1000,
			lastModified: '2026-11-01T09:00:00.000Z',
			durationSeconds: 10,
			width: 1920,
			height: 1080,
			fingerprint: FINGERPRINT
		},
		frameRate: { value: 240, source: 'container' },
		timeScale: 1,
		marks: [],
		...overrides
	};
}

const marks = (...times: number[]): Mark[] =>
	times.map((time, i) => ({ id: `m${i}`, type: i % 2 ? 'takeoff' : 'landing', time }));

/** A draft as it comes back from IndexedDB: a structured clone, not the same object. */
const stored = (draft: Draft): unknown => structuredClone(draft);

describe('reading drafts back', () => {
	test('a stored draft reads back as written', () => {
		const draft = makeDraft(session({ marks: marks(1, 1.2) }), true, '2026-11-04T12:00:00.000Z');
		expect(readDraft(stored(draft))).toEqual(draft);
	});

	test('a draft written by an older schema is upgraded', () => {
		const old = { ...session({ marks: marks(1) }), schemaVersion: 4, jumpType: 'drop' };
		const draft = readDraft({
			fingerprint: FINGERPRINT,
			updatedAt: '2026-11-04T12:00:00.000Z',
			isNew: false,
			session: old
		});
		expect(draft?.session.schemaVersion).toBe(SCHEMA_VERSION);
		expect(draft?.session.jumpType).toBe('drop-jump');
		expect(draft?.isNew).toBe(false);
	});

	test("a draft from a newer version or a damaged one isn't read", () => {
		const newer = { ...session(), schemaVersion: SCHEMA_VERSION + 1 };
		expect(readDraft({ fingerprint: FINGERPRINT, isNew: true, session: newer })).toBeNull();
		expect(readDraft({ fingerprint: FINGERPRINT })).toBeNull();
		expect(readDraft({ session: session() })).toBeNull();
		expect(readDraft(null)).toBeNull();
		expect(readDraft('draft')).toBeNull();
	});
});

describe('what reopening a video restores', () => {
	const saved = session({ marks: marks(1, 1.2) });

	test('nothing stored: nothing to restore', () => {
		expect(pickRestore(undefined, null)).toEqual({ kind: 'none', staleDraft: false });
	});

	test('only a saved session: the saved session', () => {
		expect(pickRestore(saved, null)).toEqual({ kind: 'saved', saved, staleDraft: false });
	});

	test('a never-saved video with a draft: the draft', () => {
		const draft = makeDraft(session({ marks: marks(2) }), true, '2026-11-04T12:00:00.000Z');
		expect(pickRestore(undefined, draft)).toMatchObject({ kind: 'draft', draft });
	});

	test('unsaved edits to a saved session win over the saved session', () => {
		const draft = makeDraft(
			session({ marks: marks(1, 1.2, 2) }),
			false,
			'2026-11-04T12:00:00.000Z'
		);
		expect(pickRestore(saved, draft)).toEqual({
			kind: 'draft',
			draft,
			saved,
			staleDraft: false
		});
	});

	test('a draft holding the same work as the saved session is stale', () => {
		const draft = makeDraft(
			session({ marks: marks(1, 1.2), updatedAt: '2026-11-04T12:00:00.000Z' }),
			false,
			'2026-11-04T12:00:00.000Z'
		);
		expect(pickRestore(saved, draft)).toEqual({ kind: 'saved', saved, staleDraft: true });
	});

	test('a change to any edited field counts, not only marks', () => {
		for (const change of [
			{ title: 'Renamed' },
			{ notes: 'Felt slow' },
			{ jumpType: 'drop-jump' as const },
			{ recordedAt: '2026-10-01T09:00:00.000Z' },
			{ timeScale: 0.25 }
		]) {
			const draft = makeDraft(session({ ...saved, ...change }), false, '2026-11-04T12:00:00.000Z');
			expect(pickRestore(saved, draft).kind).toBe('draft');
		}
	});

	test('the signature ignores everything the athlete does not edit', () => {
		expect(sessionSignature(saved)).toBe(
			sessionSignature(session({ ...saved, id: 'other', updatedAt: '2030-01-01T00:00:00Z' }))
		);
	});
});

describe('drafts waiting on the start screen', () => {
	test('newest first, without new videos that have no marks yet', () => {
		const older = makeDraft(session({ marks: marks(1) }), true, '2026-11-03T12:00:00.000Z');
		const newer = makeDraft(
			session({ marks: marks(1), media: { ...session().media, fingerprint: 'b' } }),
			true,
			'2026-11-04T12:00:00.000Z'
		);
		const empty = makeDraft(
			session({ title: 'Renamed', media: { ...session().media, fingerprint: 'c' } }),
			true,
			'2026-11-05T12:00:00.000Z'
		);
		// Clearing every mark of a saved session is still work to save.
		const cleared = makeDraft(
			session({ media: { ...session().media, fingerprint: 'd' } }),
			false,
			'2026-11-02T12:00:00.000Z'
		);
		expect(waitingDrafts([older, empty, cleared, newer])).toEqual([newer, older, cleared]);
	});
});

/** A store whose writes finish only when the test says so. */
function slowStore() {
	const log: string[] = [];
	const waiting: (() => void)[] = [];
	const contents = new Map<string, Draft>();
	const store: DraftStore = {
		put: (draft) =>
			new Promise<void>((resolve) => {
				log.push(`put ${draft.fingerprint} ${draft.session.marks.length}`);
				waiting.push(() => {
					contents.set(draft.fingerprint, draft);
					resolve();
				});
			}),
		delete: (fingerprint) =>
			new Promise<void>((resolve) => {
				log.push(`delete ${fingerprint}`);
				waiting.push(() => {
					contents.delete(fingerprint);
					resolve();
				});
			})
	};
	const finishAll = async () => {
		while (waiting.length) {
			waiting.shift()!();
			await new Promise((resolve) => setTimeout(resolve));
		}
	};
	return { store, log, contents, finishAll };
}

const draftWith = (count: number) =>
	makeDraft(session({ marks: marks(...Array.from({ length: count }, (_, i) => i)) }), true, 'now');

describe('writing drafts', () => {
	test('only the latest edit waits while a write runs', async () => {
		const { store, log, contents, finishAll } = slowStore();
		const writer = new DraftWriter(store);
		void writer.set(FINGERPRINT, draftWith(1));
		void writer.set(FINGERPRINT, draftWith(2));
		void writer.set(FINGERPRINT, draftWith(3));
		await finishAll();
		await writer.flush();
		expect(log).toEqual([`put ${FINGERPRINT} 1`, `put ${FINGERPRINT} 3`]);
		expect(contents.get(FINGERPRINT)?.session.marks).toHaveLength(3);
	});

	test('a delete after saving is not overtaken by the put before it', async () => {
		const { store, log, contents, finishAll } = slowStore();
		const writer = new DraftWriter(store);
		void writer.set(FINGERPRINT, draftWith(2));
		void writer.set(FINGERPRINT, null);
		await finishAll();
		await writer.flush();
		expect(log).toEqual([`put ${FINGERPRINT} 2`, `delete ${FINGERPRINT}`]);
		expect(contents.has(FINGERPRINT)).toBe(false);
	});

	test('drafts for different videos are all written', async () => {
		const { store, contents, finishAll } = slowStore();
		const writer = new DraftWriter(store);
		const other = makeDraft(
			session({ marks: marks(1), media: { ...session().media, fingerprint: 'other' } }),
			true,
			'now'
		);
		void writer.set(FINGERPRINT, draftWith(1));
		void writer.set('other', other);
		await finishAll();
		await writer.flush();
		expect([...contents.keys()].sort()).toEqual(['other', FINGERPRINT]);
	});

	test('a failed write does not stop later ones', async () => {
		let fail = true;
		const contents = new Map<string, Draft>();
		const writer = new DraftWriter({
			put: async (draft) => {
				if (fail) {
					fail = false;
					throw new Error('QuotaExceededError');
				}
				contents.set(draft.fingerprint, draft);
			},
			delete: async () => {}
		});
		await writer.set(FINGERPRINT, draftWith(1));
		await writer.set(FINGERPRINT, draftWith(2));
		expect(contents.get(FINGERPRINT)?.session.marks).toHaveLength(2);
	});

	test('an edit made as a write finishes is still written', async () => {
		// Each delay queues the second edit a few microtasks later, so one of them lands
		// after the writer's last look at its queue but before it has finished.
		for (let ticks = 0; ticks < 12; ticks += 1) {
			const contents = new Map<string, Draft>();
			const writer = new DraftWriter({
				put: async (draft) => {
					contents.set(draft.fingerprint, draft);
				},
				delete: async () => {}
			});
			const first = writer.set(FINGERPRINT, draftWith(1));
			for (let i = 0; i < ticks; i += 1) await Promise.resolve();
			void writer.set(FINGERPRINT, draftWith(2));
			await first;
			await writer.flush();
			expect(contents.get(FINGERPRINT)?.session.marks, `after ${ticks} ticks`).toHaveLength(2);
		}
	});
});
