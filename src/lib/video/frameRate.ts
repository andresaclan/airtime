const COMMON_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120];

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

const MAX_FILE_BYTES_FOR_PARSING = 512 * 1024 * 1024;

export type FrameRateConfidence = 'high' | 'medium' | 'low';

export interface PlaybackFrameRateResult {
	fps: number | null;
	confidence: FrameRateConfidence;
	sampleCount: number;
	jitter: number;
	snapped: boolean;
	displayRefreshRate: number | null;
}

interface Box {
	type: string;
	start: number;
	end: number;
	headerSize: number;
}

function readUint32(view: DataView, offset: number): number {
	return view.getUint32(offset, false);
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
			const high = readUint32(view, offset + 8);
			const low = readUint32(view, offset + 12);
			const size64 = high * 2 ** 32 + low;
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

function findChild(view: DataView, parent: Box, type: string): Box | null {
	const children = getChildren(view, parent);
	return children.find((box) => box.type === type) ?? null;
}

function parseMdhdTimescale(view: DataView, mdhd: Box): number | null {
	const offset = mdhd.start + mdhd.headerSize;
	if (offset + 12 > mdhd.end) return null;

	const version = view.getUint8(offset);
	const timescaleOffset = version === 1 ? offset + 20 : offset + 12;
	if (timescaleOffset + 4 > mdhd.end) return null;

	const timescale = readUint32(view, timescaleOffset);
	return timescale > 0 ? timescale : null;
}

function parseHdlrHandlerType(view: DataView, hdlr: Box): string | null {
	const payloadOffset = hdlr.start + hdlr.headerSize;
	const handlerOffset = payloadOffset + 8;
	if (handlerOffset + 4 > hdlr.end) return null;
	return readType(view, handlerOffset);
}

function parseSttsFrameRate(view: DataView, stts: Box, timescale: number): number | null {
	const payloadOffset = stts.start + stts.headerSize;
	if (payloadOffset + 8 > stts.end) return null;

	const entryCount = readUint32(view, payloadOffset + 4);
	if (entryCount === 0) return null;

	let cursor = payloadOffset + 8;
	let totalSamples = 0;
	let totalDelta = 0;

	for (let i = 0; i < entryCount; i++) {
		if (cursor + 8 > stts.end) return null;
		const sampleCount = readUint32(view, cursor);
		const sampleDelta = readUint32(view, cursor + 4);
		if (sampleCount === 0 || sampleDelta === 0) return null;

		totalSamples += sampleCount;
		totalDelta += sampleCount * sampleDelta;
		cursor += 8;
	}

	if (totalSamples <= 0 || totalDelta <= 0) return null;

	const fps = (timescale * totalSamples) / totalDelta;
	return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function snapToCommonFrameRate(
	fps: number,
	thresholdRatio = 0.01
): { fps: number; snapped: boolean } {
	const closest = COMMON_FRAME_RATES.reduce(
		(best, candidate) => {
			const ratioDiff = Math.abs(candidate - fps) / fps;
			if (ratioDiff < best.diff) {
				return { rate: candidate, diff: ratioDiff };
			}
			return best;
		},
		{ rate: fps, diff: Number.POSITIVE_INFINITY }
	);

	if (closest.diff <= thresholdRatio) {
		return { fps: closest.rate, snapped: true };
	}

	return { fps: Math.round(fps * 100) / 100, snapped: false };
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 0) {
		return (sorted[mid - 1] + sorted[mid]) / 2;
	}
	return sorted[mid];
}

function percentile(sortedValues: number[], ratio: number): number {
	const index = Math.min(
		sortedValues.length - 1,
		Math.max(0, Math.floor((sortedValues.length - 1) * ratio))
	);
	return sortedValues[index];
}

function stddev(values: number[]): number {
	if (values.length === 0) return 0;
	const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
	const variance =
		values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
	return Math.sqrt(variance);
}

function sanitizeFrameRate(fps: number): number | null {
	if (!Number.isFinite(fps)) return null;
	if (fps < 5 || fps > 300) return null;
	return fps;
}

function qualityFromJitter(jitter: number, sampleCount: number): FrameRateConfidence {
	if (sampleCount >= 90 && jitter <= 0.07) return 'high';
	if (sampleCount >= 45 && jitter <= 0.15) return 'medium';
	return 'low';
}

export async function detectSourceFrameRateFromFile(file: File): Promise<number | null> {
	const fileName = file.name.toLowerCase();
	if (!(fileName.endsWith('.mp4') || fileName.endsWith('.m4v') || fileName.endsWith('.mov'))) {
		return null;
	}

	if (file.size === 0 || file.size > MAX_FILE_BYTES_FOR_PARSING) {
		return null;
	}

	let buffer: ArrayBuffer;
	try {
		buffer = await file.arrayBuffer();
	} catch {
		return null;
	}

	const view = new DataView(buffer);
	const rootBoxes = parseBoxes(view, 0, view.byteLength);
	const moov = rootBoxes.find((box) => box.type === 'moov');
	if (!moov) return null;

	const tracks = getChildren(view, moov).filter((box) => box.type === 'trak');
	for (const trak of tracks) {
		const mdia = findChild(view, trak, 'mdia');
		if (!mdia) continue;

		const hdlr = findChild(view, mdia, 'hdlr');
		if (!hdlr) continue;

		const handlerType = parseHdlrHandlerType(view, hdlr);
		if (handlerType !== ISO_BMFF_VIDEO_HANDLER) continue;

		const mdhd = findChild(view, mdia, 'mdhd');
		if (!mdhd) continue;

		const timescale = parseMdhdTimescale(view, mdhd);
		if (!timescale) continue;

		const minf = findChild(view, mdia, 'minf');
		if (!minf) continue;

		const stbl = findChild(view, minf, 'stbl');
		if (!stbl) continue;

		const stts = findChild(view, stbl, 'stts');
		if (!stts) continue;

		const rawFps = parseSttsFrameRate(view, stts, timescale);
		if (!rawFps) continue;

		const valid = sanitizeFrameRate(rawFps);
		if (!valid) continue;

		return snapToCommonFrameRate(valid, 0.015).fps;
	}

	return null;
}

async function detectDisplayRefreshRate(sampleCount = 90): Promise<number | null> {
	if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
		return null;
	}

	return new Promise<number | null>((resolve) => {
		const intervals: number[] = [];
		let frames = 0;
		let lastTime: number | null = null;

		const callback = (now: number) => {
			if (lastTime !== null) {
				const delta = now - lastTime;
				if (delta > 0 && delta < 100) {
					intervals.push(delta);
				}
			}

			lastTime = now;
			frames++;

			if (frames < sampleCount) {
				window.requestAnimationFrame(callback);
			} else {
				if (intervals.length < 20) {
					resolve(null);
					return;
				}
				const medianMs = median(intervals);
				const hz = sanitizeFrameRate(1000 / medianMs);
				resolve(hz ? snapToCommonFrameRate(hz, 0.03).fps : null);
			}
		};

		window.requestAnimationFrame(callback);
	});
}

export async function detectPlaybackFrameRate(
	videoElement: HTMLVideoElement,
	options: { maxMs?: number; minSamples?: number } = {}
): Promise<PlaybackFrameRateResult> {
	const maxMs = options.maxMs ?? 2500;
	const minSamples = options.minSamples ?? 45;

	const displayRefreshRate = await detectDisplayRefreshRate();

	if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
		return {
			fps: null,
			confidence: 'low',
			sampleCount: 0,
			jitter: 1,
			snapped: false,
			displayRefreshRate
		};
	}

	const deltas: number[] = [];
	const warmupSamples = 8;
	let sampleCount = 0;
	let lastMediaTime: number | null = null;

	const start = performance.now();

	await new Promise<void>((resolve) => {
		const callback = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
			const mediaTime = metadata.mediaTime;

			if (lastMediaTime !== null) {
				const delta = mediaTime - lastMediaTime;
				if (sampleCount >= warmupSamples && delta > 1 / 300 && delta < 1) {
					deltas.push(delta);
				}
			}

			lastMediaTime = mediaTime;
			sampleCount++;

			const elapsed = performance.now() - start;
			if (elapsed >= maxMs || deltas.length >= 150) {
				resolve();
				return;
			}

			videoElement.requestVideoFrameCallback(callback);
		};

		videoElement.requestVideoFrameCallback(callback);
	});

	if (deltas.length < minSamples) {
		return {
			fps: null,
			confidence: 'low',
			sampleCount: deltas.length,
			jitter: 1,
			snapped: false,
			displayRefreshRate
		};
	}

	const fpsSamples = deltas.map((delta) => 1 / delta).filter((fps) => Number.isFinite(fps));
	const sorted = [...fpsSamples].sort((a, b) => a - b);

	const q1 = percentile(sorted, 0.25);
	const q3 = percentile(sorted, 0.75);
	const iqr = q3 - q1;
	const low = q1 - 1.5 * iqr;
	const high = q3 + 1.5 * iqr;
	const filtered = sorted.filter((value) => value >= low && value <= high);

	if (filtered.length < Math.max(20, Math.floor(minSamples * 0.5))) {
		return {
			fps: null,
			confidence: 'low',
			sampleCount: filtered.length,
			jitter: 1,
			snapped: false,
			displayRefreshRate
		};
	}

	const medianFps = sanitizeFrameRate(median(filtered));
	if (!medianFps) {
		return {
			fps: null,
			confidence: 'low',
			sampleCount: filtered.length,
			jitter: 1,
			snapped: false,
			displayRefreshRate
		};
	}

	const mean = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
	const jitter = mean > 0 ? stddev(filtered) / mean : 1;
	const confidence = qualityFromJitter(jitter, filtered.length);

	const snapped = snapToCommonFrameRate(medianFps, 0.015);

	return {
		fps: snapped.fps,
		confidence,
		sampleCount: filtered.length,
		jitter,
		snapped: snapped.snapped,
		displayRefreshRate
	};
}
