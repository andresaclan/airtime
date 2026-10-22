/**
 * The portable export file: saved sessions plus timings recomputed at export time,
 * written so an agent can read it without any other context.
 */
import { analyzeMarks, frameOf, GRAVITY, sortMarks, type MarkType } from '$lib/video/marks';
import { SCHEMA_VERSION, type FrameRateSource, type Session } from './schema';

export const EXPORT_FORMAT = 'airtime-export';

const ABOUT =
	'Jump timings marked by hand, frame by frame, on videos in Airtime. Each session is one video. ' +
	'Marks are the source data; everything under "derived" is computed from them and can be recomputed.';

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
		'"out-of-sequence" = this mark repeats the previous mark\'s type, so no interval was computed.'
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

export type AirtimeExport = {
	format: typeof EXPORT_FORMAT;
	schemaVersion: typeof SCHEMA_VERSION;
	exportedAt: string;
	about: string;
	fields: typeof FIELDS;
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

export function buildExport(sessions: Session[]): AirtimeExport {
	return {
		format: EXPORT_FORMAT,
		schemaVersion: SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		about: ABOUT,
		fields: FIELDS,
		sessions: sessions.map(exportSession)
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

export function downloadExport(sessions: Session[]): void {
	const json = JSON.stringify(buildExport(sessions), null, 2);
	const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
	const link = document.createElement('a');
	link.href = url;
	link.download = exportFileName(sessions);
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
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

/** Parses an Airtime export file. Derived values are ignored; they're recomputed from marks. */
export function parseImport(text: string): Session[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('Not a valid JSON file');
	}
	expect(isObject(data) && data.format === EXPORT_FORMAT, 'Not an Airtime export file');
	expect(
		data.schemaVersion === SCHEMA_VERSION,
		`Unsupported schema version ${String(data.schemaVersion)}`
	);
	expect(Array.isArray(data.sessions), 'sessions must be an array');
	return data.sessions.map(parseSession);
}

/** Imported sessions that are new or newer than what's stored; the rest are skipped. */
export function sessionsToImport(incoming: Session[], existing: Session[]): Session[] {
	const stored = new Map(existing.map((session) => [session.id, session]));
	return incoming.filter((session) => {
		const current = stored.get(session.id);
		return !current || session.updatedAt > current.updatedAt;
	});
}
