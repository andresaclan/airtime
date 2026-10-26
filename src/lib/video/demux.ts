/**
 * Where each video frame's compressed data sits in an MP4/M4V/MOV, and what WebCodecs
 * needs to decode it. Only the `moov` box is read; samples are fetched from the file
 * as they're needed. Scrub previews (scrubCache.ts) decode the clip with this.
 */
import {
	buildCompositionTimes,
	buildPresentedFrames,
	findChild,
	getChildren,
	parseBoxes,
	parseCtts,
	parseElst,
	parseEntries,
	parseHdlrHandlerType,
	parseStts,
	parseTimescale,
	readMoov,
	readType,
	readUint32,
	readUint64,
	type Box,
	type SampleTables
} from './frameRate';

export type VideoSample = {
	/** Byte offset of the sample in the file. */
	offset: number;
	size: number;
	/** A sync sample: decoding can start here. */
	key: boolean;
	/** Decode time in media ticks. */
	dts: number;
	/** Composition (presentation) time in media ticks. */
	cts: number;
	/** The frame this sample shows (an index into the frame table), or -1 when it doesn't play. */
	frame: number;
};

export type VideoTrack = {
	/** WebCodecs codec string, such as `avc1.64002a` or `hvc1.2.4.L153.b0`. */
	codec: string;
	/** The `avcC`/`hvcC` record, which WebCodecs takes as `description`. */
	description: Uint8Array;
	codedWidth: number;
	codedHeight: number;
	/** Clockwise rotation the track header asks players to apply, in degrees. */
	rotation: 0 | 90 | 180 | 270;
	timescale: number;
	/** Every sample, in decode order. */
	samples: VideoSample[];
	/** Number of frames that play (the length of the frame table). */
	frameCount: number;
};

const VISUAL_SAMPLE_ENTRY_SIZE = 78;

function hex(n: number): string {
	return n.toString(16).padStart(2, '0');
}

function avcCodec(bytes: Uint8Array): string {
	return `avc1.${hex(bytes[1])}${hex(bytes[2])}${hex(bytes[3])}`;
}

/** RFC 6381 codec string from an `hvcC` record (ISO/IEC 14496-15 annex E). */
function hevcCodec(entry: string, bytes: Uint8Array): string {
	const space = bytes[1] >> 6;
	const tier = (bytes[1] >> 5) & 1;
	const profile = bytes[1] & 0x1f;
	let compat = ((bytes[2] << 24) | (bytes[3] << 16) | (bytes[4] << 8) | bytes[5]) >>> 0;
	let reversed = 0;
	for (let i = 0; i < 32; i += 1) {
		reversed = ((reversed << 1) | (compat & 1)) >>> 0;
		compat >>>= 1;
	}
	const constraints = Array.from(bytes.subarray(6, 12));
	while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
	const parts = [
		entry,
		`${['', 'A', 'B', 'C'][space]}${profile}`,
		reversed.toString(16),
		`${tier ? 'H' : 'L'}${bytes[12]}`,
		...constraints.map((byte) => byte.toString(16))
	];
	return parts.join('.');
}

function parseSampleEntry(
	view: DataView,
	stsd: Box
): { codec: string; description: Uint8Array; width: number; height: number } | null {
	const entryStart = stsd.start + stsd.headerSize + 8;
	const [entry] = parseBoxes(view, entryStart, stsd.end);
	if (!entry) return null;
	const body = entry.start + entry.headerSize;
	if (body + VISUAL_SAMPLE_ENTRY_SIZE > entry.end) return null;
	const width = view.getUint16(body + 24);
	const height = view.getUint16(body + 26);
	const children = parseBoxes(view, body + VISUAL_SAMPLE_ENTRY_SIZE, entry.end);
	const config = children.find((box) => box.type === 'avcC' || box.type === 'hvcC');
	if (!config) return null;
	const description = new Uint8Array(
		view.buffer.slice(
			view.byteOffset + config.start + config.headerSize,
			view.byteOffset + config.end
		)
	);
	if (description.length < 13 && config.type === 'hvcC') return null;
	if (description.length < 4) return null;
	const codec = config.type === 'avcC' ? avcCodec(description) : hevcCodec(entry.type, description);
	return { codec, description, width, height };
}

/** Rotation from the `tkhd` matrix, rounded to a quarter turn. */
function parseRotation(view: DataView, tkhd: Box | null): 0 | 90 | 180 | 270 {
	if (!tkhd) return 0;
	const payload = tkhd.start + tkhd.headerSize;
	const version = view.getUint8(payload);
	const matrix = payload + (version === 1 ? 52 : 40);
	if (matrix + 36 > tkhd.end) return 0;
	const a = view.getInt32(matrix) / 65536;
	const b = view.getInt32(matrix + 4) / 65536;
	const degrees = Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90;
	return (((degrees % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

function parseStsz(view: DataView, stsz: Box): number[] | null {
	const payload = stsz.start + stsz.headerSize;
	if (payload + 12 > stsz.end) return null;
	const fixed = readUint32(view, payload + 4);
	const count = readUint32(view, payload + 8);
	if (fixed !== 0) return new Array<number>(count).fill(fixed);
	if (payload + 12 + count * 4 > stsz.end) return null;
	const sizes: number[] = [];
	for (let i = 0; i < count; i += 1) sizes.push(readUint32(view, payload + 12 + i * 4));
	return sizes;
}

/** Byte offset of every sample, from the chunk offsets and samples per chunk. */
function sampleOffsets(
	chunkOffsets: number[],
	stsc: { firstChunk: number; perChunk: number }[],
	sizes: number[]
): number[] | null {
	const offsets: number[] = [];
	let sample = 0;
	for (let run = 0; run < stsc.length; run += 1) {
		const first = stsc[run].firstChunk - 1;
		const last = run + 1 < stsc.length ? stsc[run + 1].firstChunk - 1 : chunkOffsets.length;
		for (let chunk = first; chunk < last && sample < sizes.length; chunk += 1) {
			let offset = chunkOffsets[chunk];
			if (offset === undefined) return null;
			for (let i = 0; i < stsc[run].perChunk && sample < sizes.length; i += 1) {
				offsets.push(offset);
				offset += sizes[sample];
				sample += 1;
			}
		}
	}
	return offsets.length === sizes.length ? offsets : null;
}

/** The first video track of a `moov` box (or a whole file), or null when it can't be decoded with WebCodecs. */
export function parseVideoTrack(bytes: ArrayBuffer): VideoTrack | null {
	const view = new DataView(bytes);
	const moov = parseBoxes(view, 0, view.byteLength).find((box) => box.type === 'moov');
	if (!moov) return null;
	const mvhd = findChild(view, moov, 'mvhd');
	const movieTimescale = mvhd ? parseTimescale(view, mvhd) : null;

	for (const trak of getChildren(view, moov).filter((box) => box.type === 'trak')) {
		const mdia = findChild(view, trak, 'mdia');
		const hdlr = findChild(view, mdia, 'hdlr');
		if (!hdlr || parseHdlrHandlerType(view, hdlr) !== 'vide') continue;
		const mdhd = findChild(view, mdia, 'mdhd');
		const timescale = mdhd ? parseTimescale(view, mdhd) : null;
		const stbl = findChild(view, findChild(view, mdia, 'minf'), 'stbl');
		const sttsBox = findChild(view, stbl, 'stts');
		const stsdBox = findChild(view, stbl, 'stsd');
		const stszBox = findChild(view, stbl, 'stsz');
		const stscBox = findChild(view, stbl, 'stsc');
		const stcoBox = findChild(view, stbl, 'stco') ?? findChild(view, stbl, 'co64');
		if (!timescale || !sttsBox || !stsdBox || !stszBox || !stscBox || !stcoBox) return null;

		const stts = parseStts(view, sttsBox);
		if (!stts || stts.length === 0) return null;
		const entry = parseSampleEntry(view, stsdBox);
		const sizes = parseStsz(view, stszBox);
		const stsc = parseEntries(
			view,
			stscBox,
			() => 12,
			(offset) => ({
				firstChunk: readUint32(view, offset),
				perChunk: readUint32(view, offset + 4)
			})
		);
		const wide = readType(view, stcoBox.start + 4) === 'co64';
		const chunkOffsets = parseEntries(
			view,
			stcoBox,
			() => (wide ? 8 : 4),
			(offset) => (wide ? readUint64(view, offset) : readUint32(view, offset))
		);
		if (!entry || !sizes || !stsc || !chunkOffsets) return null;
		const offsets = sampleOffsets(chunkOffsets, stsc, sizes);
		if (!offsets) return null;

		const stssBox = findChild(view, stbl, 'stss');
		const sync = stssBox
			? new Set(
					parseEntries(
						view,
						stssBox,
						() => 4,
						(offset) => readUint32(view, offset)
					) ?? []
				)
			: null;
		const cttsBox = findChild(view, stbl, 'ctts');
		const elstBox = findChild(view, findChild(view, trak, 'edts'), 'elst');
		const tables: SampleTables = {
			timescale,
			movieTimescale: movieTimescale ?? timescale,
			stts,
			ctts: (cttsBox && parseCtts(view, cttsBox)) || [],
			elst: (elstBox && parseElst(view, elstBox)) || []
		};
		const cts = buildCompositionTimes(tables);
		if (cts.length !== sizes.length) return null;
		const { ticks } = buildPresentedFrames(tables);
		const frameOfTicks = new Map<number, number>();
		ticks.forEach((tick, frame) => frameOfTicks.set(tick, frame));

		const samples: VideoSample[] = [];
		let dts = 0;
		let sttsRun = 0;
		let sttsLeft = stts[0].count;
		for (let i = 0; i < sizes.length; i += 1) {
			samples.push({
				offset: offsets[i],
				size: sizes[i],
				key: sync ? sync.has(i + 1) : true,
				dts,
				cts: cts[i],
				frame: frameOfTicks.get(cts[i]) ?? -1
			});
			while (sttsLeft === 0 && sttsRun < stts.length - 1) {
				sttsRun += 1;
				sttsLeft = stts[sttsRun].count;
			}
			dts += stts[sttsRun].delta;
			sttsLeft -= 1;
		}
		return {
			codec: entry.codec,
			description: entry.description,
			codedWidth: entry.width,
			codedHeight: entry.height,
			rotation: parseRotation(view, findChild(view, trak, 'tkhd')),
			timescale,
			samples,
			frameCount: ticks.length
		};
	}
	return null;
}

export async function readVideoTrack(file: Blob): Promise<VideoTrack | null> {
	try {
		const moov = await readMoov(file);
		return moov ? parseVideoTrack(moov) : null;
	} catch {
		return null;
	}
}
