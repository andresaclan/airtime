/**
 * The portable export file: saved sessions plus timings recomputed at export time,
 * written so an agent can read it without any other context.
 */
import { analyzeMarks, frameOf, GRAVITY, sortMarks, type MarkType } from '$lib/video/marks';
import { migrateSession } from './migrate';
import { SCHEMA_VERSION, type FrameRateSource, type Session } from './schema';

export const EXPORT_FORMAT = 'airtime-export';

const ABOUT =
	'Jump timings marked by hand, frame by frame, on videos in Airtime. Each session is one video. ' +
	'Marks are the source data; everything under "derived", "tables" and "overview" is computed ' +
	'from them and can be recomputed. For analysis across sessions, start with "tables": flat rows ' +
	'that load directly into a dataframe or chart. Sessions are ordered by recordedAt, oldest first.';

const FIELDS = {
	'sessions[].marks[].seconds':
		'Media time of the mark in seconds (source of truth). Snapped to a frame boundary.',
	'sessions[].marks[].frame': 'Frame index, derived as round(seconds × frameRate.value).',
	'sessions[].marks[].type':
		'"takeoff" = first frame the feet leave the ground; "landing" = first frame they touch down.',
	'sessions[].frameRate':
		'Frames per second used for frame math. source: "container" = read from the file, ' +
		'"playback-estimate" = measured during playback, "default" = assumed 30 fps (low trust).',
	'sessions[].timeScale':
		'Real seconds per media second. 1 = real-time footage; 0.25 = 4× slow motion.',
	'sessions[].derived.intervals[]':
		'Consecutive takeoff→landing pairs are "flight", landing→takeoff pairs are "contact". ' +
		'seconds = media time; realSeconds = seconds × timeScale.',
	'sessions[].derived.intervals[].heightCm':
		`Jump height from flight time, h = g·t²/8 with g = ${GRAVITY} m/s² and t = realSeconds. ` +
		'Assumes takeoff and landing at the same height.',
	'sessions[].derived.precisionMs':
		'Real-time duration of one frame; each mark is accurate to about ±1 frame.',
	'sessions[].derived.warnings[]':
		'"out-of-sequence" = this mark repeats the previous mark\'s type, so no interval was computed.',
	'tables.intervals[]':
		'One row per flight or contact interval across every session, with session context repeated ' +
		'on each row. index = 1-based position among intervals of the same kind within its session.',
	'tables.sessions[]': 'One row per session with its summary statistics.',
	recordedAt:
		"The video file's last-modified time: usually when it was recorded, but changed by some edits " +
		'or copies.',
	overview: 'Totals and extremes across all exported sessions.'
};

export type ExportedMark = { id: string; type: MarkType; seconds: number; frame: number };

export type ExportedInterval = {
	kind: 'flight' | 'contact';
	fromMarkId: string;
	toMarkId: string;
	startSeconds: number;
	endSeconds: number;
	frames: number;
	seconds: number;
	realSeconds: number;
	heightCm?: number;
};

export type ExportedSession = Omit<Session, 'marks'> & {
	marks: ExportedMark[];
	derived: {
		intervals: ExportedInterval[];
		warnings: { markId: string; code: 'out-of-sequence' }[];
		precisionMs: number;
		summary: {
			flightCount: number;
			contactCount: number;
			bestHeightCm: number | null;
			meanHeightCm: number | null;
			meanFlightRealSeconds: number | null;
			meanContactRealSeconds: number | null;
		};
	};
};

export type IntervalRow = {
	sessionId: string;
	sessionTitle: string;
	recordedAt: string;
	fileName: string;
	kind: 'flight' | 'contact';
	index: number;
	startSeconds: number;
	frames: number;
	seconds: number;
	realSeconds: number;
	heightCm: number | null;
	frameRate: number;
	frameRateSource: FrameRateSource;
	timeScale: number;
	precisionMs: number;
};

export type SessionRow = {
	sessionId: string;
	title: string;
	notes: string;
	recordedAt: string;
	savedAt: string;
	fileName: string;
	frameRate: number;
	frameRateSource: FrameRateSource;
	timeScale: number;
	markCount: number;
	warningCount: number;
} & ExportedSession['derived']['summary'];

export type ExportOverview = {
	sessionCount: number;
	flightCount: number;
	contactCount: number;
	firstRecordedAt: string | null;
	lastRecordedAt: string | null;
	bestHeight: { heightCm: number; sessionId: string; sessionTitle: string } | null;
	meanHeightCm: number | null;
	meanFlightRealSeconds: number | null;
	meanContactRealSeconds: number | null;
	/** Sessions whose frame rate was assumed rather than read or measured. */
	lowTrustSessionIds: string[];
};

export type AirtimeExport = {
	format: typeof EXPORT_FORMAT;
	schemaVersion: typeof SCHEMA_VERSION;
	exportedAt: string;
	about: string;
	fields: typeof FIELDS;
	overview: ExportOverview;
	tables: { sessions: SessionRow[]; intervals: IntervalRow[] };
	sessions: ExportedSession[];
};

function round(value: number, digits: number): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

function mean(values: number[], digits: number): number | null {
	if (values.length === 0) return null;
	return round(values.reduce((sum, value) => sum + value, 0) / values.length, digits);
}

function exportSession(session: Session): ExportedSession {
	const fps = session.frameRate.value;
	const marks = sortMarks(session.marks);
	const analysis = analyzeMarks(marks, fps, session.timeScale);
	const intervals: ExportedInterval[] = analysis.intervals.map((interval) => ({
		kind: interval.kind,
		fromMarkId: interval.from.id,
		toMarkId: interval.to.id,
		startSeconds: round(interval.from.time, 4),
		endSeconds: round(interval.to.time, 4),
		frames: interval.frames,
		seconds: round(interval.seconds, 4),
		realSeconds: round(interval.realSeconds, 4),
		...(interval.heightCm !== undefined && { heightCm: round(interval.heightCm, 1) })
	}));
	const flights = analysis.intervals.filter((interval) => interval.kind === 'flight');
	const contacts = analysis.intervals.filter((interval) => interval.kind === 'contact');
	const heights = flights.map((flight) => flight.heightCm ?? 0);

	return {
		...session,
		marks: marks.map((mark) => ({
			id: mark.id,
			type: mark.type,
			seconds: round(mark.time, 6),
			frame: frameOf(mark.time, fps)
		})),
		derived: {
			intervals,
			warnings: [...analysis.outOfSequence].map((markId) => ({
				markId,
				code: 'out-of-sequence' as const
			})),
			precisionMs: round((1000 / fps) * session.timeScale, 2),
			summary: {
				flightCount: flights.length,
				contactCount: contacts.length,
				bestHeightCm: heights.length ? round(Math.max(...heights), 1) : null,
				meanHeightCm: mean(heights, 1),
				meanFlightRealSeconds: mean(
					flights.map((flight) => flight.realSeconds),
					4
				),
				meanContactRealSeconds: mean(
					contacts.map((contact) => contact.realSeconds),
					4
				)
			}
		}
	};
}

function sessionRow(session: ExportedSession): SessionRow {
	return {
		sessionId: session.id,
		title: session.title,
		notes: session.notes,
		recordedAt: session.media.lastModified,
		savedAt: session.updatedAt,
		fileName: session.media.fileName,
		frameRate: session.frameRate.value,
		frameRateSource: session.frameRate.source,
		timeScale: session.timeScale,
		markCount: session.marks.length,
		warningCount: session.derived.warnings.length,
		...session.derived.summary
	};
}

function intervalRows(session: ExportedSession): IntervalRow[] {
	const counts = { flight: 0, contact: 0 };
	return session.derived.intervals.map((interval) => ({
		sessionId: session.id,
		sessionTitle: session.title,
		recordedAt: session.media.lastModified,
		fileName: session.media.fileName,
		kind: interval.kind,
		index: ++counts[interval.kind],
		startSeconds: interval.startSeconds,
		frames: interval.frames,
		seconds: interval.seconds,
		realSeconds: interval.realSeconds,
		heightCm: interval.heightCm ?? null,
		frameRate: session.frameRate.value,
		frameRateSource: session.frameRate.source,
		timeScale: session.timeScale,
		precisionMs: session.derived.precisionMs
	}));
}

function overview(sessions: ExportedSession[], intervals: IntervalRow[]): ExportOverview {
	const flights = intervals.filter((row) => row.kind === 'flight');
	const contacts = intervals.filter((row) => row.kind === 'contact');
	const best = flights.reduce<IntervalRow | null>(
		(top, row) => (!top || (row.heightCm ?? 0) > (top.heightCm ?? 0) ? row : top),
		null
	);
	return {
		sessionCount: sessions.length,
		flightCount: flights.length,
		contactCount: contacts.length,
		firstRecordedAt: sessions[0]?.media.lastModified ?? null,
		lastRecordedAt: sessions.at(-1)?.media.lastModified ?? null,
		bestHeight: best
			? { heightCm: best.heightCm ?? 0, sessionId: best.sessionId, sessionTitle: best.sessionTitle }
			: null,
		meanHeightCm: mean(
			flights.map((row) => row.heightCm ?? 0),
			1
		),
		meanFlightRealSeconds: mean(
			flights.map((row) => row.realSeconds),
			4
		),
		meanContactRealSeconds: mean(
			contacts.map((row) => row.realSeconds),
			4
		),
		lowTrustSessionIds: sessions
			.filter((session) => session.frameRate.source === 'default')
			.map((session) => session.id)
	};
}

export function buildExport(sessions: Session[]): AirtimeExport {
	const exported = [...sessions]
		.sort((a, b) => a.media.lastModified.localeCompare(b.media.lastModified))
		.map(exportSession);
	const intervals = exported.flatMap(intervalRows);
	return {
		format: EXPORT_FORMAT,
		schemaVersion: SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		about: ABOUT,
		fields: FIELDS,
		overview: overview(exported, intervals),
		tables: { sessions: exported.map(sessionRow), intervals },
		sessions: exported
	};
}

export function exportFileName(sessions: Session[]): string {
	const date = new Date().toISOString().slice(0, 10);
	if (sessions.length !== 1) return `airtime-all-${date}.json`;
	const slug = sessions[0].title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
	return `airtime-${slug || 'session'}-${date}.json`;
}

/** Built synchronously, so it can be handed to `navigator.share` inside the tap that asked. */
export function exportFile(sessions: Session[]): File {
	const json = JSON.stringify(buildExport(sessions), null, 2);
	return new File([json], exportFileName(sessions), { type: 'application/json' });
}

export function downloadFile(file: File): void {
	const url = URL.createObjectURL(file);
	const link = document.createElement('a');
	link.href = url;
	link.download = file.name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadExport(sessions: Session[]): void {
	downloadFile(exportFile(sessions));
}

// ---- Import ----

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expect(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function str(object: Json, key: string, where: string): string {
	expect(typeof object[key] === 'string', `${where}.${key} must be a string`);
	return object[key] as string;
}

function num(object: Json, key: string, where: string): number {
	const value = object[key];
	expect(
		typeof value === 'number' && Number.isFinite(value),
		`${where}.${key} must be a finite number`
	);
	return value;
}

const FRAME_RATE_SOURCES: FrameRateSource[] = ['container', 'playback-estimate', 'default'];

function parseSession(raw: unknown, index: number): Session {
	const where = `sessions[${index}]`;
	expect(isObject(raw), `${where} must be an object`);
	expect(isObject(raw.media), `${where}.media must be an object`);
	expect(isObject(raw.frameRate), `${where}.frameRate must be an object`);
	expect(Array.isArray(raw.marks), `${where}.marks must be an array`);

	const media = raw.media;
	const frameRate = raw.frameRate;
	const fps = num(frameRate, 'value', `${where}.frameRate`);
	expect(fps > 0 && fps <= 1000, `${where}.frameRate.value is out of range`);
	const source = str(frameRate, 'source', `${where}.frameRate`) as FrameRateSource;
	expect(FRAME_RATE_SOURCES.includes(source), `${where}.frameRate.source is not recognised`);
	const timeScale = num(raw, 'timeScale', where);
	expect(timeScale > 0 && timeScale <= 1, `${where}.timeScale must be between 0 and 1`);

	const marks = raw.marks.map((mark, markIndex) => {
		const markWhere = `${where}.marks[${markIndex}]`;
		expect(isObject(mark), `${markWhere} must be an object`);
		const type = str(mark, 'type', markWhere);
		expect(type === 'takeoff' || type === 'landing', `${markWhere}.type is not recognised`);
		const seconds = num(mark, 'seconds', markWhere);
		expect(seconds >= 0, `${markWhere}.seconds must not be negative`);
		return { id: str(mark, 'id', markWhere), type: type as MarkType, time: seconds };
	});

	return {
		schemaVersion: SCHEMA_VERSION,
		id: str(raw, 'id', where),
		title: str(raw, 'title', where),
		notes: str(raw, 'notes', where),
		createdAt: str(raw, 'createdAt', where),
		updatedAt: str(raw, 'updatedAt', where),
		media: {
			fileName: str(media, 'fileName', `${where}.media`),
			mimeType: str(media, 'mimeType', `${where}.media`),
			sizeBytes: num(media, 'sizeBytes', `${where}.media`),
			lastModified: str(media, 'lastModified', `${where}.media`),
			durationSeconds: num(media, 'durationSeconds', `${where}.media`),
			width: num(media, 'width', `${where}.media`),
			height: num(media, 'height', `${where}.media`),
			fingerprint: str(media, 'fingerprint', `${where}.media`)
		},
		frameRate: { value: fps, source },
		timeScale,
		marks: sortMarks(marks)
	};
}

/**
 * Parses an Airtime export file from this or any earlier version. Derived values are
 * ignored; they're recomputed from marks.
 */
export function parseImport(text: string): Session[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('Not a valid JSON file');
	}
	expect(isObject(data) && data.format === EXPORT_FORMAT, 'Not an Airtime export file');
	expect(Array.isArray(data.sessions), 'sessions must be an array');
	const fileVersion = data.schemaVersion;
	return data.sessions.map((raw, index) => {
		expect(isObject(raw), `sessions[${index}] must be an object`);
		// Sessions carry their own version; the file's covers any that don't.
		return parseSession(migrateSession({ schemaVersion: fileVersion, ...raw }), index);
	});
}

/**
 * Imported sessions that are new or newer than what's stored; the rest are skipped.
 * `unreadableIds` are stored records this version can't read, so they're never overwritten.
 */
export function sessionsToImport(
	incoming: Session[],
	existing: Session[],
	unreadableIds: string[] = []
): Session[] {
	const stored = new Map(existing.map((session) => [session.id, session]));
	const untouchable = new Set(unreadableIds);
	return incoming.filter((session) => {
		if (untouchable.has(session.id)) return false;
		const current = stored.get(session.id);
		return !current || session.updatedAt > current.updatedAt;
	});
}
