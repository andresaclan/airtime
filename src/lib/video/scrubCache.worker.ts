/// <reference lib="webworker" />
/**
 * Builds the scrub cache (scrubCache.ts) off the main thread: decodes every frame
 * of the video once with WebCodecs, shrinks it, and re-encodes it as a keyframe on
 * its own. Any one of those frames then decodes in a few milliseconds, where a seek
 * in the original decodes from the last keyframe, up to hundreds of frames back.
 */
import { readVideoTrack, type VideoSample, type VideoTrack } from './demux';

export type WorkerRequest =
	| { type: 'build'; file: Blob; maxBytes: number }
	/** Builds the frames around this one first. */
	| { type: 'focus'; frame: number };

export type WorkerResponse =
	| {
			type: 'start';
			frameCount: number;
			config: VideoDecoderConfig;
	  }
	| { type: 'frame'; frame: number; data: ArrayBuffer }
	| { type: 'done' }
	| { type: 'unsupported'; reason: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse, transfer: Transferable[] = []) =>
	scope.postMessage(message, transfer);

/** Proxy frame sizes, longest side first, and the bytes per frame each needs to look right. */
const SIZES = [
	{ longSide: 1280, bytes: 48_000 },
	{ longSide: 960, bytes: 28_000 },
	{ longSide: 640, bytes: 0 }
];
const MAX_BYTES_PER_FRAME = 64_000;
/** Past this (10 minutes at 60 fps) the frames would be too small to be worth it. */
const MAX_FRAMES = 36_000;
/** Bytes read from the file at a time. */
const READ_WINDOW = 8 * 1024 * 1024;
const QUEUE_LIMIT = 12;
/** The encoder's nominal frame rate; frame timestamps are spaced to match. */
const PROXY_FPS = 30;
/** Encoders sharing the work; past two the build stops getting faster. */
const ENCODERS = 2;

let focus = 0;

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const message = event.data;
	if (message.type === 'focus') focus = message.frame;
	else
		void build(message.file, message.maxBytes).catch((error: unknown) => {
			post({ type: 'unsupported', reason: String(error) });
		});
};

/** Runs of samples that decode on their own: a keyframe and everything up to the next. */
type Gop = { start: number; end: number; frames: number[] };

function groups(track: VideoTrack): Gop[] {
	const gops: Gop[] = [];
	track.samples.forEach((sample, i) => {
		if (sample.key || gops.length === 0) gops.push({ start: i, end: i + 1, frames: [] });
		const gop = gops[gops.length - 1];
		gop.end = i + 1;
		if (sample.frame >= 0) gop.frames.push(sample.frame);
	});
	return gops;
}

function waitForQueue(codec: VideoDecoder | VideoEncoder, size: () => number): Promise<void> {
	if (size() <= QUEUE_LIMIT) return Promise.resolve();
	return new Promise((resolve) => {
		const check = () => {
			if (size() > QUEUE_LIMIT) return;
			codec.removeEventListener('dequeue', check);
			resolve();
		};
		codec.addEventListener('dequeue', check);
	});
}

/** Reads samples from the file a window at a time. */
function sampleReader(file: Blob) {
	let windowStart = 0;
	let windowBytes = new Uint8Array(0);
	return async (sample: VideoSample): Promise<Uint8Array> => {
		const end = sample.offset + sample.size;
		if (sample.offset < windowStart || end > windowStart + windowBytes.length) {
			windowStart = sample.offset;
			const windowEnd = Math.min(file.size, Math.max(end, sample.offset + READ_WINDOW));
			windowBytes = new Uint8Array(await file.slice(windowStart, windowEnd).arrayBuffer());
		}
		return windowBytes.subarray(sample.offset - windowStart, end - windowStart);
	};
}

function proxySize(track: VideoTrack, maxBytes: number) {
	const frameBytes = Math.min(MAX_BYTES_PER_FRAME, maxBytes / Math.max(1, track.frameCount));
	const { longSide } = SIZES.find((size) => frameBytes >= size.bytes) ?? SIZES[SIZES.length - 1];
	const quarterTurn = track.rotation === 90 || track.rotation === 270;
	const width = quarterTurn ? track.codedHeight : track.codedWidth;
	const height = quarterTurn ? track.codedWidth : track.codedHeight;
	const scale = Math.min(1, longSide / Math.max(width, height));
	// Even dimensions: H.264 encoders want them.
	const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
	return { width: even(width), height: even(height), frameBytes };
}

async function build(file: Blob, maxBytes: number) {
	if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') {
		return post({ type: 'unsupported', reason: 'WebCodecs unavailable' });
	}
	const track = await readVideoTrack(file);
	if (!track) return post({ type: 'unsupported', reason: 'Not an MP4/MOV with H.264 or HEVC' });
	if (track.frameCount > MAX_FRAMES) return post({ type: 'unsupported', reason: 'Too long' });

	const decoderConfig: VideoDecoderConfig = {
		codec: track.codec,
		description: track.description,
		codedWidth: track.codedWidth,
		codedHeight: track.codedHeight,
		hardwareAcceleration: 'prefer-hardware'
	};
	if (!(await VideoDecoder.isConfigSupported(decoderConfig)).supported) {
		return post({ type: 'unsupported', reason: `Can't decode ${track.codec}` });
	}
	const { width, height, frameBytes } = proxySize(track, maxBytes);
	const encoderConfig: VideoEncoderConfig = {
		// Constrained baseline: no reordering, so each frame decodes and shows at once.
		codec: 'avc1.42e02a',
		width,
		height,
		bitrate: Math.round(frameBytes * 8 * PROXY_FPS),
		framerate: PROXY_FPS,
		avc: { format: 'avc' }
	};
	if (!(await VideoEncoder.isConfigSupported(encoderConfig)).supported) {
		return post({ type: 'unsupported', reason: "Can't encode H.264" });
	}

	const built = new Uint8Array(track.frameCount);
	const frameOfTimestamp = new Map<number, number>();
	const timestampOf = (sample: VideoSample) =>
		Math.round((sample.cts * 1_000_000) / track.timescale);
	for (const sample of track.samples) {
		if (sample.frame >= 0) frameOfTimestamp.set(timestampOf(sample), sample.frame);
	}

	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d', { alpha: false })!;
	let started = false;

	const output = (chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) => {
		if (!started) {
			started = true;
			post({
				type: 'start',
				frameCount: track.frameCount,
				config: { ...metadata!.decoderConfig!, optimizeForLatency: true }
			});
		}
		const frame = Math.round((chunk.timestamp * PROXY_FPS) / 1_000_000);
		const data = new ArrayBuffer(chunk.byteLength);
		chunk.copyTo(data);
		post({ type: 'frame', frame, data }, [data]);
	};
	// Each frame encodes on its own, so encoders can share the work.
	const encoders = Array.from({ length: ENCODERS }, () => {
		const encoder = new VideoEncoder({
			output,
			error: (error) => post({ type: 'unsupported', reason: String(error) })
		});
		encoder.configure(encoderConfig);
		return encoder;
	});
	let encoded = 0;

	const decoder = new VideoDecoder({
		output: (decoded) => {
			const frame = frameOfTimestamp.get(decoded.timestamp);
			if (frame === undefined || built[frame]) {
				decoded.close();
				return;
			}
			built[frame] = 1;
			context.save();
			context.translate(width / 2, height / 2);
			context.rotate((track.rotation * Math.PI) / 180);
			const quarterTurn = track.rotation === 90 || track.rotation === 270;
			const w = quarterTurn ? height : width;
			const h = quarterTurn ? width : height;
			context.drawImage(decoded, -w / 2, -h / 2, w, h);
			context.restore();
			decoded.close();
			const proxy = new VideoFrame(canvas, { timestamp: (frame * 1_000_000) / PROXY_FPS });
			encoders[encoded++ % ENCODERS].encode(proxy, { keyFrame: true });
			proxy.close();
		},
		error: (error) => post({ type: 'unsupported', reason: String(error) })
	});
	decoder.configure(decoderConfig);

	const read = sampleReader(file);
	const gops = groups(track);
	const fed = new Set<number>();
	let previous = -2;

	const feed = async (index: number) => {
		if (index !== previous + 1) {
			// Jumping: decoding has to start again from a keyframe.
			await decoder.flush();
		}
		const gop = gops[index];
		for (let i = gop.start; i < gop.end; i += 1) {
			const sample = track.samples[i];
			const data = await read(sample);
			await waitForQueue(decoder, () => decoder.decodeQueueSize);
			for (const encoder of encoders) {
				await waitForQueue(encoder, () => encoder.encodeQueueSize);
			}
			decoder.decode(
				new EncodedVideoChunk({
					type: i === gop.start ? 'key' : 'delta',
					timestamp: timestampOf(sample),
					data
				})
			);
		}
		fed.add(index);
		previous = index;
	};

	const firstFrames = gops.map((gop) => (gop.frames.length ? Math.min(...gop.frames) : -1));
	const lastFrames = gops.map((gop) => (gop.frames.length ? Math.max(...gop.frames) : -1));
	const wanted = (i: number) => !fed.has(i) && firstFrames[i] >= 0;
	// The unfed group nearest the focus frame, searching outwards from the group that
	// holds it. Behind counts double, since scrubbing usually carries on forwards.
	const nextGroup = (): number => {
		let home = gops.findIndex((_, i) => lastFrames[i] >= focus);
		if (home < 0) home = gops.length - 1;
		let ahead = home;
		while (ahead < gops.length && !wanted(ahead)) ahead += 1;
		let behind = home - 1;
		while (behind >= 0 && !wanted(behind)) behind -= 1;
		const aheadDistance = ahead < gops.length ? Math.max(0, firstFrames[ahead] - focus) : Infinity;
		const behindDistance = behind >= 0 ? 2 * (focus - lastFrames[behind]) : Infinity;
		if (aheadDistance === Infinity && behindDistance === Infinity) return -1;
		return aheadDistance <= behindDistance ? ahead : behind;
	};

	for (let index = nextGroup(); index >= 0; index = nextGroup()) await feed(index);
	await decoder.flush();
	// Leading frames of an open GOP reference the group before, so a group decoded on
	// its own can come out short. Decode those again after their predecessor.
	for (let index = 1; index < gops.length; index += 1) {
		if (!gops[index].frames.some((frame) => !built[frame])) continue;
		if (previous !== index - 1) await feed(index - 1);
		await feed(index);
	}
	await decoder.flush();
	await Promise.all(encoders.map((encoder) => encoder.flush()));
	decoder.close();
	for (const encoder of encoders) encoder.close();
	post({ type: 'done' });
}
