/**
 * Frame timing read from the sample tables of MP4/M4V/MOV files, and snapping of
 * measured rates to standard ones.
 */

// NTSC rates are written as the app displays them. The 1-in-a-million difference from
// n·1000/1001 is far less than a frame over any realistic clip.
const STANDARD_FRAME_RATES = [
	15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240
];

const ISO_BMFF_VIDEO_HANDLER = 'vide';
const ISO_BMFF_CONTAINER_TYPES = new Set([
	'moov',
	'trak',
	'mdia',
	'minf',
	'stbl',
	'edts',
	'udta',
	'meta'
]);

// The sample tables live in `moov`, which is read on its own, so the size of the file
// doesn't matter. Even hour-long recordings have a `moov` of a few MB.
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/** `count` consecutive samples that each last `delta` media ticks (`stts`). */
export type SttsEntry = { count: number; delta: number };
/** `count` consecutive samples presented `offset` ticks after they're decoded (`ctts`). */
export type CttsEntry = { count: number; offset: number };
/**
 * One edit (`elst`): `segmentDuration` movie ticks of the presentation show media from
 * `mediaTime` (media ticks) on. A `mediaTime` of -1 is an empty edit, which delays
 * everything after it.
 */
export type EditListEntry = { segmentDuration: number; mediaTime: number; mediaRate: number };

export type SampleTables = {
	/** Media ticks per second (`mdhd`); `stts`, `ctts` and `elst` media times use it. */
	timescale: number;
	/** Movie ticks per second (`mvhd`); edit segment durations use it. */
	movieTimescale: number;
	stts: SttsEntry[];
	ctts: CttsEntry[];
	elst: EditListEntry[];
};

export type FrameTimingAnalysis = {
	/** The rate frame math should use: the measured rate snapped to a standard one. */
	fps: number;
	/** Mean rate of the regularly spaced frames, before snapping. */
	measuredFps: number;
	/**
	 * True when one fps value can't map frame numbers to times: frame durations vary
	 * beyond timestamp rounding, or frames drift more than half a frame from k / fps.
	 */
	variableFrameRate: boolean;
	/** Largest distance, in frames, between a frame's timestamp and start + k / fps. */
	maxDriftFrames: number;
};

export type VideoTiming = FrameTimingAnalysis & {
	/** Presentation time in seconds of every frame that plays, ascending. */
	frameTimes: number[];
	/** Presentation time of the first frame. Non-zero when an edit list delays it. */
	startTime: number;
	frameCount: number;
	timescale: number;
};

interface Box {
	type: string;
	start: number;
	end: number;
	headerSize: number;
}

function readUint32(view: DataView, offset: number): number {
	return view.getUint32(offset, false);
}

function readUint64(view: DataView, offset: number): number {
	return readUint32(view, offset) * 2 ** 32 + readUint32(view, offset + 4);
}

function readType(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3)
	);
}

function parseBoxes(view: DataView, start: number, end: number): Box[] {
	const boxes: Box[] = [];
	let offset = start;

	while (offset + 8 <= end) {
		const size32 = readUint32(view, offset);
		const type = readType(view, offset + 4);

		let boxSize = size32;
		let headerSize = 8;

		if (size32 === 1) {
			if (offset + 16 > end) break;
			const size64 = readUint64(view, offset + 8);
			if (!Number.isFinite(size64) || size64 <= 16) break;
			boxSize = size64;
			headerSize = 16;
		} else if (size32 === 0) {
			boxSize = end - offset;
		}

		if (boxSize < headerSize) break;
		const boxEnd = offset + boxSize;
		if (boxEnd > end) break;

		boxes.push({
			type,
			start: offset,
			end: boxEnd,
			headerSize
		});

		offset = boxEnd;
	}

	return boxes;
}

function getChildren(view: DataView, box: Box): Box[] {
	if (!ISO_BMFF_CONTAINER_TYPES.has(box.type)) return [];
	let payloadStart = box.start + box.headerSize;

	if (box.type === 'meta') {
		if (payloadStart + 4 > box.end) return [];
		payloadStart += 4;
	}

	return parseBoxes(view, payloadStart, box.end);
}

function findChild(view: DataView, parent: Box | null, type: string): Box | null {
	if (!parent) return null;
	const children = getChildren(view, parent);
	return children.find((box) => box.type === type) ?? null;
}

/** Timescale from `mvhd` or `mdhd`, which share their layout up to it. */
function parseTimescale(view: DataView, box: Box): number | null {
	const offset = box.start + box.headerSize;
	if (offset + 12 > box.end) return null;

	const version = view.getUint8(offset);
	const timescaleOffset = version === 1 ? offset + 20 : offset + 12;
	if (timescaleOffset + 4 > box.end) return null;

	const timescale = readUint32(view, timescaleOffset);
	return timescale > 0 ? timescale : null;
}

function parseHdlrHandlerType(view: DataView, hdlr: Box): string | null {
	const payloadOffset = hdlr.start + hdlr.headerSize;
	const handlerOffset = payloadOffset + 8;
	if (handlerOffset + 4 > hdlr.end) return null;
	return readType(view, handlerOffset);
}

/** Reads a full box's entry table, or null when it's truncated. */
function parseEntries<T>(
	view: DataView,
	box: Box,
	entrySize: (version: number) => number,
	read: (offset: number, version: number) => T
): T[] | null {
	const payloadOffset = box.start + box.headerSize;
	if (payloadOffset + 8 > box.end) return null;
	const version = view.getUint8(payloadOffset);
	const entryCount = readUint32(view, payloadOffset + 4);
	const size = entrySize(version);
	if (payloadOffset + 8 + entryCount * size > box.end) return null;
	const entries: T[] = [];
	for (let i = 0; i < entryCount; i += 1) {
		entries.push(read(payloadOffset + 8 + i * size, version));
	}
	return entries;
}

function parseStts(view: DataView, stts: Box): SttsEntry[] | null {
	return parseEntries(
		view,
		stts,
		() => 8,
		(offset) => ({ count: readUint32(view, offset), delta: readUint32(view, offset + 4) })
	);
}

// Offsets are read as signed in both versions: writers such as ffmpeg put negative
// offsets in version 0 boxes.
function parseCtts(view: DataView, ctts: Box): CttsEntry[] | null {
	return parseEntries(
		view,
		ctts,
		() => 8,
		(offset) => ({ count: readUint32(view, offset), offset: view.getInt32(offset + 4, false) })
	);
}

function parseElst(view: DataView, elst: Box): EditListEntry[] | null {
	return parseEntries(
		view,
		elst,
		(version) => (version === 1 ? 20 : 12),
		(offset, version) => {
			const wide = version === 1;
			const segmentDuration = wide ? readUint64(view, offset) : readUint32(view, offset);
			const mediaTime = wide
				? Number(view.getBigInt64(offset + 8, false))
				: view.getInt32(offset + 4, false);
			const rateOffset = offset + (wide ? 16 : 8);
			const mediaRate = view.getInt16(rateOffset, false) + view.getUint16(rateOffset + 2) / 65536;
			return { segmentDuration, mediaTime, mediaRate };
		}
	);
}

/**
 * The timing tables of the first video track in an MP4/M4V/MOV, or null when there's
 * none. `bytes` can be the whole file or just its `moov` box.
 */
export function parseSampleTables(bytes: ArrayBuffer): SampleTables | null {
	const view = new DataView(bytes);
	const moov = parseBoxes(view, 0, view.byteLength).find((box) => box.type === 'moov');
	if (!moov) return null;

	const mvhd = findChild(view, moov, 'mvhd');
	const movieTimescale = mvhd ? parseTimescale(view, mvhd) : null;

	for (const trak of getChildren(view, moov).filter((box) => box.type === 'trak')) {
		const mdia = findChild(view, trak, 'mdia');
		const hdlr = findChild(view, mdia, 'hdlr');
		if (!hdlr || parseHdlrHandlerType(view, hdlr) !== ISO_BMFF_VIDEO_HANDLER) continue;

		const mdhd = findChild(view, mdia, 'mdhd');
		const timescale = mdhd ? parseTimescale(view, mdhd) : null;
		const stbl = findChild(view, findChild(view, mdia, 'minf'), 'stbl');
		const sttsBox = findChild(view, stbl, 'stts');
		if (!timescale || !sttsBox) continue;

		const stts = parseStts(view, sttsBox);
		// Fragmented files keep their samples in `moof` boxes and leave `stts` empty.
		if (!stts || stts.length === 0) continue;

		const cttsBox = findChild(view, stbl, 'ctts');
		const elstBox = findChild(view, findChild(view, trak, 'edts'), 'elst');
		return {
			timescale,
			movieTimescale: movieTimescale ?? timescale,
			stts,
			ctts: (cttsBox && parseCtts(view, cttsBox)) || [],
			elst: (elstBox && parseElst(view, elstBox)) || []
		};
	}

	return null;
}

/**
 * Presentation time in seconds of every frame that plays, ascending. Frames are put in
 * presentation order with `ctts`, then the edit list hides frames outside its edits
 * (such as the pre-roll of iPhone slow motion) and shifts the rest, as ffmpeg does.
 */
export function buildFrameTimestamps(tables: SampleTables): number[] {
	const { timescale, movieTimescale, stts, ctts, elst } = tables;

	const compositionTimes: number[] = [];
	let decodeTime = 0;
	let cttsIndex = 0;
	let cttsLeft = ctts[0]?.count ?? 0;
	for (const { count, delta } of stts) {
		for (let i = 0; i < count; i += 1) {
			while (cttsLeft === 0 && cttsIndex < ctts.length - 1) {
				cttsIndex += 1;
				cttsLeft = ctts[cttsIndex].count;
			}
			let offset = 0;
			if (cttsLeft > 0) {
				offset = ctts[cttsIndex].offset;
				cttsLeft -= 1;
			}
			compositionTimes.push(decodeTime + offset);
			decodeTime += delta;
		}
	}
	compositionTimes.sort((a, b) => a - b);

	if (elst.length === 0) return compositionTimes.map((ticks) => ticks / timescale);

	const times: number[] = [];
	let editStart = 0;
	let leadingEmpty: number | null = null;
	for (const edit of elst) {
		const seconds = edit.segmentDuration / movieTimescale;
		if (edit.mediaTime >= 0 && edit.mediaRate !== 0) {
			leadingEmpty ??= editStart;
			// A zero duration means the edit runs to the end of the media.
			const end = edit.segmentDuration > 0 ? edit.mediaTime + seconds * timescale : Infinity;
			for (const ticks of compositionTimes) {
				if (ticks >= edit.mediaTime && ticks < end) {
					times.push(editStart + (ticks - edit.mediaTime) / timescale);
				}
			}
		}
		editStart += seconds;
	}
	// An edit that starts partway through a frame hides that frame, and ffmpeg moves the
	// next one back to the start of the edit rather than leave a gap.
	const gap = times.length > 0 && leadingEmpty !== null ? times[0] - leadingEmpty : 0;
	return gap > 0 ? times.map((time) => time - gap) : times;
}

// Longer gaps (a pause in recording) say nothing about the frame rate.
const MAX_FRAMES_PER_GAP = 8;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[mid];
}

/** The nearest standard rate within `tolerance` (a ratio), else `fps` to two decimals. */
export function snapFrameRate(fps: number, tolerance = 0.015): number {
	const nearest = STANDARD_FRAME_RATES.reduce((best, rate) =>
		Math.abs(rate - fps) < Math.abs(best - fps) ? rate : best
	);
	if (Math.abs(nearest - fps) / nearest <= tolerance) return nearest;
	return Math.round(fps * 100) / 100;
}

/**
 * Fits one frame rate to frame timestamps and checks whether it describes them. A frame
 * duration comes from the durations within half of the median, so durations that
 * alternate because timestamps were rounded (2 and 3 ticks for 240 fps at 600 ticks/s)
 * average out. The rate then counts how many frames each gap spans, so dropped frames
 * and a low-rate pre-roll don't drag it down and rounding only matters at the ends of
 * the run. `timescale` is the ticks per second the timestamps were rounded to.
 */
export function analyzeFrameTimestamps(
	frameTimes: number[],
	timescale: number
): FrameTimingAnalysis | null {
	const deltas = frameTimes.slice(1).map((time, i) => time - frameTimes[i]);
	const typical = median(deltas.filter((delta) => delta > 0));
	if (!(typical > 0)) return null;

	const regular = deltas.filter((delta) => Math.abs(delta - typical) <= 0.5 * typical);
	const duration = regular.reduce((sum, delta) => sum + delta, 0) / regular.length;
	let frames = 0;
	let span = 0;
	for (const delta of deltas) {
		const spanned = Math.round(delta / duration);
		if (spanned < 1 || spanned > MAX_FRAMES_PER_GAP) continue;
		frames += spanned;
		span += delta;
	}
	const measuredFps = frames / span;
	if (!Number.isFinite(measuredFps) || measuredFps < 1 || measuredFps > 1000) return null;

	const fps = snapFrameRate(measuredFps);
	const frameDuration = 1 / fps;
	// Rounding timestamps to the tick moves a duration by up to one tick; a quarter frame
	// allows for that when ticks are coarse and for jitter that never adds up to a frame.
	const allowed = Math.max(1 / timescale, 0.25 * frameDuration) + 1e-9;
	const uneven = deltas.some((delta) => Math.abs(delta - frameDuration) > allowed);
	const start = frameTimes[0];
	const maxDriftFrames = frameTimes.reduce(
		(worst, time, k) => Math.max(worst, Math.abs((time - start) * fps - k)),
		0
	);

	return {
		fps,
		measuredFps,
		variableFrameRate: uneven || maxDriftFrames > 0.5,
		maxDriftFrames
	};
}

/**
 * Frame rate from the media times of frames presented during playback, snapped more
 * loosely than container rates. Skipped frames are left out of the fit, and WebM's
 * millisecond timestamps average out across the run.
 */
export function estimatePlaybackFrameRate(mediaTimes: number[]): number | null {
	const times = mediaTimes.filter((time, i) => i === 0 || time > mediaTimes[i - 1]);
	if (times.length < 4) return null;
	const analysis = analyzeFrameTimestamps(times, 1000);
	return analysis ? snapFrameRate(analysis.measuredFps, 0.04) : null;
}

/** Frame timing of the first video track, or null when it can't be read. */
export function parseVideoTiming(bytes: ArrayBuffer): VideoTiming | null {
	const tables = parseSampleTables(bytes);
	if (!tables) return null;
	const frameTimes = buildFrameTimestamps(tables);
	const analysis = analyzeFrameTimestamps(frameTimes, tables.timescale);
	if (!analysis) return null;
	return {
		...analysis,
		frameTimes,
		startTime: frameTimes[0],
		frameCount: frameTimes.length,
		timescale: tables.timescale
	};
}

/** Walks the top-level boxes by their headers and reads only `moov`. */
async function readMoov(file: Blob): Promise<ArrayBuffer | null> {
	let offset = 0;
	while (offset + 8 <= file.size) {
		const header = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
		const type = readType(header, 4);
		// Not an ISO BMFF file (WebM, AVI, …): box types are printable ASCII.
		if (!/^[\x20-\x7e]{4}$/.test(type)) return null;
		let size = readUint32(header, 0);
		if (size === 1) {
			if (header.byteLength < 16) return null;
			size = readUint64(header, 8);
		} else if (size === 0) {
			size = file.size - offset;
		}
		if (size < 8) return null;
		if (type === 'moov') {
			if (size > MAX_MOOV_BYTES || offset + size > file.size) return null;
			return file.slice(offset, offset + size).arrayBuffer();
		}
		offset += size;
	}
	return null;
}

export async function detectSourceTimingFromFile(file: Blob): Promise<VideoTiming | null> {
	try {
		const moov = await readMoov(file);
		return moov ? parseVideoTiming(moov) : null;
	} catch {
		return null;
	}
}

export async function detectSourceFrameRateFromFile(file: Blob): Promise<number | null> {
	return (await detectSourceTimingFromFile(file))?.fps ?? null;
}
