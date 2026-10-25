import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
	analyzeFrameTimestamps,
	buildFrameTimestamps,
	detectSourceFrameRateFromFile,
	detectSourceTimingFromFile,
	estimatePlaybackFrameRate,
	parseSampleTables,
	parseVideoTiming,
	snapFrameRate,
	type CttsEntry,
	type EditListEntry,
	type SampleTables,
	type SttsEntry
} from './frameRate';
// What ffprobe reports for each fixture; see fixtures/README.md.
import ffprobe from './fixtures/ffprobe.json';

// ---- Building ISO BMFF boxes ----

function bytes(size: number, write: (view: DataView) => void): Uint8Array {
	const out = new Uint8Array(size);
	write(new DataView(out.buffer));
	return out;
}
const u16 = (n: number) => bytes(2, (view) => view.setUint16(0, n));
const u32 = (n: number) => bytes(4, (view) => view.setUint32(0, n));
const i32 = (n: number) => bytes(4, (view) => view.setInt32(0, n));
const u64 = (n: number) => bytes(8, (view) => view.setBigUint64(0, BigInt(n)));
const i64 = (n: number) => bytes(8, (view) => view.setBigInt64(0, BigInt(n)));
const ascii = (text: string) => new TextEncoder().encode(text);

function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
	const body = concat(...payload);
	return concat(u32(8 + body.length), ascii(type), body);
}

function fullBox(type: string, version: number, ...payload: Uint8Array[]): Uint8Array {
	return box(type, new Uint8Array([version, 0, 0, 0]), ...payload);
}

/** `mvhd` and `mdhd` share their layout up to the timescale. */
function headerBox(type: 'mvhd' | 'mdhd', timescale: number, version = 0): Uint8Array {
	const time = version === 1 ? u64(0) : u32(0);
	return fullBox(type, version, time, time, u32(timescale), time, u16(0), u16(0));
}

const hdlr = (handler: string) => fullBox('hdlr', 0, u32(0), ascii(handler), new Uint8Array(13));

const stts = (entries: SttsEntry[]) =>
	fullBox('stts', 0, u32(entries.length), ...entries.flatMap((e) => [u32(e.count), u32(e.delta)]));

const ctts = (entries: CttsEntry[], version = 0) =>
	fullBox(
		'ctts',
		version,
		u32(entries.length),
		...entries.flatMap((e) => [u32(e.count), i32(e.offset)])
	);

const elst = (entries: EditListEntry[], version = 0) =>
	fullBox(
		'elst',
		version,
		u32(entries.length),
		...entries.flatMap((e) => [
			version === 1 ? u64(e.segmentDuration) : u32(e.segmentDuration),
			version === 1 ? i64(e.mediaTime) : i32(e.mediaTime),
			u16(e.mediaRate),
			u16(0)
		])
	);

type TrackSpec = {
	timescale: number;
	stts: SttsEntry[];
	ctts?: CttsEntry[];
	elst?: EditListEntry[];
	handler?: string;
	version?: number;
};

function trak({
	timescale,
	stts: samples,
	ctts: offsets,
	elst: edits,
	handler,
	version
}: TrackSpec) {
	return box(
		'trak',
		...(edits ? [box('edts', elst(edits, version))] : []),
		box(
			'mdia',
			headerBox('mdhd', timescale, version),
			hdlr(handler ?? 'vide'),
			box('minf', box('stbl', stts(samples), ...(offsets ? [ctts(offsets, version)] : [])))
		)
	);
}

function moov(tracks: TrackSpec[], movieTimescale = 1000): Uint8Array {
	return box('moov', headerBox('mvhd', movieTimescale), ...tracks.map(trak));
}

function mp4(...boxes: Uint8Array[]): ArrayBuffer {
	const file = concat(box('ftyp', ascii('isom'), u32(512), ascii('isomiso2')), ...boxes);
	return file.buffer as ArrayBuffer;
}

const videoFile = (track: TrackSpec) => mp4(moov([track]));

/** `stts` for frames at `fps` whose timestamps were rounded to `timescale` ticks. */
function roundedStts(fps: number, timescale: number, frames: number): SttsEntry[] {
	const ticks = Array.from({ length: frames + 1 }, (_, k) => Math.round((k * timescale) / fps));
	return ticks.slice(1).map((tick, k) => ({ count: 1, delta: tick - ticks[k] }));
}

function fixture(name: string): ArrayBuffer {
	return Uint8Array.from(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
		.buffer as ArrayBuffer;
}

// ---- Container parsing ----

describe('frame rates read from the sample table', () => {
	// [rate, mdhd timescale, ticks per frame], as written by ffmpeg and cameras.
	test.each([
		[23.976, 24000, 1001],
		[24, 12288, 512],
		[25, 12800, 512],
		[29.97, 30000, 1001],
		[30, 15360, 512],
		[50, 12800, 256],
		[59.94, 60000, 1001],
		[60, 15360, 256],
		[60, 90000, 1500],
		[119.88, 120000, 1001],
		[120, 15360, 128],
		[240, 15360, 64],
		[240, 2400, 10]
	])('%d fps at %d ticks/s', (fps, timescale, delta) => {
		const timing = parseVideoTiming(videoFile({ timescale, stts: [{ count: 120, delta }] }));
		expect(timing).toMatchObject({ fps, variableFrameRate: false, frameCount: 120, startTime: 0 });
		expect(timing?.frameTimes[119]).toBeCloseTo((119 * delta) / timescale, 12);
	});

	// QuickTime's 600 ticks/s can't hold most frame durations exactly, so they alternate.
	// Before: 29.97 read as 30, 23.976 as 24, 59.94 as 60 and 240 as 200.
	test.each([
		[23.976, 24000 / 1001, 600],
		[29.97, 30000 / 1001, 600],
		[59.94, 60000 / 1001, 600],
		[240, 240, 600],
		[29.97, 30000 / 1001, 1001]
	])('%d fps rounded to %d ticks/s is still that rate, not variable', (fps, exact, timescale) => {
		const timing = parseVideoTiming(
			videoFile({ timescale, stts: roundedStts(exact, timescale, 240) })
		);
		expect(timing?.fps).toBe(fps);
		expect(timing?.variableFrameRate).toBe(false);
		expect(timing?.maxDriftFrames).toBeLessThan(0.5);
	});

	test('iPhone slow motion: the edit list hides a 30 fps pre-roll before 240 fps', () => {
		// Timescale 600: 22 pre-roll frames of 20 ticks, then 240 fps at 2 and 3 ticks.
		const timescale = 600;
		const preRoll = { count: 22, delta: 20 };
		const capture = roundedStts(240, timescale, 480);
		const timing = parseVideoTiming(
			videoFile({
				timescale,
				stts: [preRoll, ...capture],
				elst: [{ segmentDuration: 2000, mediaTime: 440, mediaRate: 1 }]
			})
		);
		expect(timing).toMatchObject({ fps: 240, variableFrameRate: false, frameCount: 480 });
		expect(timing?.startTime).toBe(0);
	});

	test('a visible low-rate pre-roll is ignored for the rate but makes the footage variable', () => {
		const timing = parseVideoTiming(
			videoFile({ timescale: 600, stts: [{ count: 22, delta: 20 }, ...roundedStts(240, 600, 480)] })
		);
		expect(timing?.fps).toBe(240);
		expect(timing?.variableFrameRate).toBe(true);
	});

	test('reads 64-bit mdhd and elst (version 1)', () => {
		const tables = parseSampleTables(
			videoFile({
				timescale: 90000,
				version: 1,
				stts: [{ count: 10, delta: 3000 }],
				elst: [{ segmentDuration: 2 ** 33, mediaTime: 6000, mediaRate: 1 }]
			})
		);
		expect(tables?.timescale).toBe(90000);
		expect(tables?.elst).toEqual([{ segmentDuration: 2 ** 33, mediaTime: 6000, mediaRate: 1 }]);
	});

	test('skips audio tracks and reads the video track', () => {
		const file = mp4(
			moov([
				{ timescale: 48000, handler: 'soun', stts: [{ count: 100, delta: 1024 }] },
				{ timescale: 30000, stts: [{ count: 100, delta: 1001 }] }
			])
		);
		expect(parseVideoTiming(file)?.fps).toBe(29.97);
	});

	test('finds moov after a 64-bit mdat', () => {
		const mdat = concat(u32(1), ascii('mdat'), u64(16 + 4), new Uint8Array(4));
		const file = mp4(mdat, moov([{ timescale: 15360, stts: [{ count: 60, delta: 256 }] }]));
		expect(parseVideoTiming(file)?.fps).toBe(60);
	});

	test('returns null when there is nothing to read', () => {
		// No video track.
		expect(
			parseVideoTiming(mp4(moov([{ timescale: 48000, handler: 'soun', stts: [] }])))
		).toBeNull();
		// Fragmented MP4: the samples are in moof boxes and stts is empty.
		expect(parseVideoTiming(videoFile({ timescale: 15360, stts: [] }))).toBeNull();
		// Not an MP4 at all (WebM's EBML header).
		expect(
			parseVideoTiming(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]).buffer)
		).toBeNull();
		// A single frame has no duration to measure.
		expect(
			parseVideoTiming(videoFile({ timescale: 600, stts: [{ count: 1, delta: 20 }] }))
		).toBeNull();
	});

	test('a truncated sample table is ignored rather than misread', () => {
		const file = new Uint8Array(videoFile({ timescale: 600, stts: [{ count: 60, delta: 20 }] }));
		// Claim one more stts entry than the box holds.
		const at = file.findIndex((_, i) => String.fromCharCode(...file.subarray(i, i + 4)) === 'stts');
		new DataView(file.buffer).setUint32(at + 8, 2);
		expect(parseVideoTiming(file.buffer)).toBeNull();
	});
});

describe('variable frame rate', () => {
	test('dropped frames are variable: frames after the gap drift from k / fps', () => {
		const timing = parseVideoTiming(
			videoFile({
				timescale: 15360,
				stts: [
					{ count: 4, delta: 512 },
					{ count: 1, delta: 2048 },
					{ count: 20, delta: 512 }
				]
			})
		);
		expect(timing?.fps).toBe(30);
		expect(timing?.variableFrameRate).toBe(true);
		expect(timing?.maxDriftFrames).toBeCloseTo(3, 9);
	});

	test('a rate change mid-clip is variable', () => {
		const timing = parseVideoTiming(
			videoFile({
				timescale: 90000,
				stts: [
					{ count: 30, delta: 3000 },
					{ count: 150, delta: 1500 }
				]
			})
		);
		expect(timing?.fps).toBe(60);
		expect(timing?.variableFrameRate).toBe(true);
	});

	test('jitter is variable once a duration strays more than a quarter frame', () => {
		const jittered = (amount: number) =>
			Array.from({ length: 90 }, (_, k) => (k + (k % 2 ? amount : 0)) / 30);
		expect(analyzeFrameTimestamps(jittered(0.1), 90000)?.variableFrameRate).toBe(false);
		expect(analyzeFrameTimestamps(jittered(0.3), 90000)?.variableFrameRate).toBe(true);
	});
});

describe('buildFrameTimestamps', () => {
	const expectTimes = (actual: number[], expected: number[]) => {
		expect(actual).toHaveLength(expected.length);
		actual.forEach((time, i) => expect(time).toBeCloseTo(expected[i], 12));
	};

	const tables = (overrides: Partial<SampleTables>): SampleTables => ({
		timescale: 100,
		movieTimescale: 1000,
		stts: [{ count: 4, delta: 10 }],
		ctts: [],
		elst: [],
		...overrides
	});

	// Decode order I P B B, presented I B B P.
	const reordered = [
		{ count: 1, offset: 10 },
		{ count: 1, offset: 30 },
		{ count: 2, offset: 0 }
	];

	test('ctts puts frames in presentation order', () => {
		expectTimes(buildFrameTimestamps(tables({ ctts: reordered })), [0.1, 0.2, 0.3, 0.4]);
	});

	test('negative composition offsets (ctts version 1)', () => {
		const ctts = [
			{ count: 1, offset: 0 },
			{ count: 1, offset: 20 },
			{ count: 2, offset: -10 }
		];
		expectTimes(buildFrameTimestamps(tables({ ctts })), [0, 0.1, 0.2, 0.3]);
	});

	test('the edit list removes the B-frame decode delay', () => {
		const elst = [{ segmentDuration: 400, mediaTime: 10, mediaRate: 1 }];
		expectTimes(buildFrameTimestamps(tables({ ctts: reordered, elst })), [0, 0.1, 0.2, 0.3]);
	});

	test('an empty edit delays the first frame', () => {
		const elst = [
			{ segmentDuration: 500, mediaTime: -1, mediaRate: 1 },
			{ segmentDuration: 400, mediaTime: 0, mediaRate: 1 }
		];
		expectTimes(buildFrameTimestamps(tables({ elst })), [0.5, 0.6, 0.7, 0.8]);
	});

	test('frames outside every edit are hidden, and edits play one after another', () => {
		const elst = [
			{ segmentDuration: 200, mediaTime: 0, mediaRate: 1 },
			{ segmentDuration: 200, mediaTime: 50, mediaRate: 1 }
		];
		expectTimes(
			buildFrameTimestamps(tables({ stts: [{ count: 8, delta: 10 }], elst })),
			[0, 0.1, 0.2, 0.3]
		);
	});

	test('an edit starting partway through a frame starts at the next frame, as ffmpeg does', () => {
		const elst = [{ segmentDuration: 250, mediaTime: 15, mediaRate: 1 }];
		expectTimes(buildFrameTimestamps(tables({ elst })), [0, 0.1]);
	});

	test('a zero-length edit runs to the end', () => {
		const elst = [{ segmentDuration: 0, mediaTime: 10, mediaRate: 1 }];
		expectTimes(buildFrameTimestamps(tables({ elst })), [0, 0.1, 0.2]);
	});
});

describe('fixtures made with ffmpeg', () => {
	const truth = ffprobe as Record<string, { rFrameRate: string; frameTimes: number[] }>;

	test.each(Object.keys(truth))('%s: every frame time matches ffprobe', (name) => {
		const timing = parseVideoTiming(fixture(name));
		const expected = truth[name].frameTimes;
		expect(timing?.frameCount).toBe(expected.length);
		// ffprobe prints microseconds.
		timing?.frameTimes.forEach((time, i) => expect(time).toBeCloseTo(expected[i], 5));
	});

	test.each([
		['ntsc-ts600.mov', 29.97, false, 0],
		['slomo240-ts600.mov', 240, false, 0],
		['slomo240-preroll.mov', 240, false, 0],
		['vfr-dropped.mp4', 30, true, 0],
		['empty-edit.mp4', 30, false, 0.5],
		['bframes.mp4', 30, false, 0],
		['trim-mid-frame.mp4', 60, false, 0]
	])('%s: %d fps, variable %s, starts at %d s', (name, fps, variableFrameRate, startTime) => {
		const timing = parseVideoTiming(fixture(name));
		expect(timing).toMatchObject({ fps, variableFrameRate });
		expect(timing?.startTime).toBeCloseTo(startTime, 9);
	});
});

describe('reading files', () => {
	/** A Blob of `size` bytes that only holds `parts`, and records what was read. */
	function sparseBlob(size: number, parts: [offset: number, bytes: Uint8Array][]) {
		const reads: number[] = [];
		const blob = {
			size,
			slice(start = 0, end = size) {
				const from = Math.min(start, size);
				const to = Math.min(end, size);
				const out = new Uint8Array(to - from);
				for (const [offset, part] of parts) {
					for (let i = Math.max(from, offset); i < Math.min(to, offset + part.length); i += 1) {
						out[i - from] = part[i - offset];
					}
				}
				reads.push(to - from);
				return new Blob([out]);
			}
		};
		return { blob: blob as unknown as Blob, reads };
	}

	test('reads a fixture file', async () => {
		const file = new File([fixture('ntsc-ts600.mov')], 'ntsc.MOV');
		expect((await detectSourceTimingFromFile(file))?.fps).toBe(29.97);
		expect(await detectSourceFrameRateFromFile(file)).toBe(29.97);
	});

	// Before: files over 512 MB weren't parsed at all, and smaller ones were read whole.
	test('reads only the moov of a large file', async () => {
		const size = 2 * 1024 ** 3;
		const head = new Uint8Array(mp4());
		const tail = moov([{ timescale: 15360, stts: [{ count: 600, delta: 128 }] }]);
		const mdat = concat(u32(1), ascii('mdat'), u64(size - head.length - tail.length));
		const { blob, reads } = sparseBlob(size, [
			[0, head],
			[head.length, mdat],
			[size - tail.length, tail]
		]);
		expect(await detectSourceFrameRateFromFile(blob)).toBe(120);
		expect(reads.reduce((sum, read) => sum + read, 0)).toBeLessThan(64 * 1024);
	});

	test('gives up quickly on files that are not ISO BMFF', async () => {
		const webm = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])]);
		expect(await detectSourceTimingFromFile(webm)).toBeNull();
		expect(await detectSourceTimingFromFile(new Blob([]))).toBeNull();
	});
});

// ---- Snapping and playback estimates ----

describe('snapFrameRate', () => {
	test('standard rates snap to themselves', () => {
		for (const fps of [
			15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240
		]) {
			expect(snapFrameRate(fps)).toBe(fps);
		}
	});

	test('NTSC rates stay apart from whole ones', () => {
		expect(snapFrameRate(30000 / 1001)).toBe(29.97);
		expect(snapFrameRate(29.975)).toBe(29.97);
		expect(snapFrameRate(29.995)).toBe(30);
		expect(snapFrameRate(24000 / 1001)).toBe(23.976);
		expect(snapFrameRate(60000 / 1001)).toBe(59.94);
	});

	test('rates near a standard one snap; others round to two decimals', () => {
		expect(snapFrameRate(239.5)).toBe(240);
		expect(snapFrameRate(30.3)).toBe(30);
		expect(snapFrameRate(31)).toBe(31);
		expect(snapFrameRate(37.504)).toBe(37.5);
		expect(snapFrameRate(31, 0.04)).toBe(30);
	});
});

describe('estimatePlaybackFrameRate', () => {
	/** Media times of `count` consecutive frames, rounded to the millisecond like WebM. */
	const presented = (fps: number, frames: number[]) =>
		frames.map((frame) => Math.round((frame / fps) * 1000) / 1000);
	const run = (count: number) => Array.from({ length: count }, (_, k) => k);

	test.each([24, 25, 30, 50, 60, 120, 240])('%d fps from 13 frames', (fps) => {
		expect(estimatePlaybackFrameRate(presented(fps, run(13)))).toBe(fps);
	});

	test('a frame the display skipped does not halve the estimate', () => {
		expect(estimatePlaybackFrameRate(presented(30, [0, 1, 2, 4, 5, 6, 7, 8, 9]))).toBe(30);
	});

	test('repeated media times are ignored', () => {
		expect(estimatePlaybackFrameRate(presented(60, [0, 1, 1, 2, 3, 3, 4, 5, 6]))).toBe(60);
	});

	test('a clip faster than the display reads as the display rate', () => {
		// 240 fps on a 120 Hz display presents every other frame. This is why the viewer
		// samples fast clips again at quarter speed.
		const everyOther = run(13).map((k) => k * 2);
		expect(estimatePlaybackFrameRate(presented(240, everyOther))).toBe(120);
	});

	test('too few frames give no estimate', () => {
		expect(estimatePlaybackFrameRate([])).toBeNull();
		expect(estimatePlaybackFrameRate(presented(30, [0, 1, 2]))).toBeNull();
	});
});
