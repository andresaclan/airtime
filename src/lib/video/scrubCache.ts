import type { WorkerRequest, WorkerResponse } from './scrubCache.worker';

/**
 * Every frame of the video, small and encoded as a keyframe on its own, so any one
 * can be drawn within a display refresh while scrubbing (see seek.ts). A worker
 * builds it in the background, starting near the playhead; until a frame is built
 * the video's own seek is all there is.
 *
 * Only MP4/MOV files with H.264 or HEVC, in browsers with WebCodecs; elsewhere
 * `onUnsupported` fires and seeking works as before.
 */

/** Memory the cached frames may take. Longer videos get smaller frames. */
const MAX_BYTES = 160 * 1024 * 1024;

export class ScrubCache {
	frameCount = 0;
	width = 0;
	height = 0;
	private frames: (ArrayBuffer | undefined)[] = [];
	private worker: Worker;
	private decoder: VideoDecoder | null = null;
	/** Frame being decoded, and the latest one asked for while it is. */
	private decoding: number | null = null;
	private wanted: number | null = null;
	/** Set by `cancel` while a decode is running, so its frame isn't drawn. */
	private dropDecoding = false;
	private disposed = false;

	constructor(
		file: Blob,
		private onDraw: (frame: number, image: VideoFrame) => void,
		private onUnsupported: () => void = () => {}
	) {
		this.worker = new Worker(new URL('./scrubCache.worker.ts', import.meta.url), {
			type: 'module'
		});
		this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
		this.worker.onerror = () => this.fail();
		this.post({ type: 'build', file, maxBytes: MAX_BYTES });
	}

	static supported(): boolean {
		return (
			typeof Worker !== 'undefined' &&
			typeof VideoDecoder !== 'undefined' &&
			typeof VideoEncoder !== 'undefined' &&
			typeof OffscreenCanvas !== 'undefined'
		);
	}

	private post(message: WorkerRequest) {
		this.worker.postMessage(message);
	}

	private receive(message: WorkerResponse) {
		if (this.disposed) return;
		switch (message.type) {
			case 'start':
				this.frameCount = message.frameCount;
				this.width = message.width;
				this.height = message.height;
				this.frames = new Array(message.frameCount);
				this.decoder = new VideoDecoder({
					output: (image) => this.drawn(image),
					error: () => this.fail()
				});
				this.decoder.configure(message.config);
				break;
			case 'frame':
				this.frames[message.frame] = message.data;
				if (this.wanted === message.frame && this.decoding === null) this.next();
				break;
			case 'done':
				this.worker.terminate();
				break;
			case 'unsupported':
				this.fail();
				break;
		}
	}

	private fail() {
		if (this.disposed) return;
		this.dispose();
		this.onUnsupported();
	}

	has(frame: number): boolean {
		return this.frames[frame] !== undefined;
	}

	/** Builds the frames around this one next. */
	focus(frame: number) {
		if (!this.disposed) this.post({ type: 'focus', frame });
	}

	/**
	 * Draws `frame` through `onDraw` as soon as it's decoded. While one frame is
	 * decoding, only the latest request waits; the ones in between are skipped.
	 */
	request(frame: number) {
		this.wanted = frame;
		if (this.decoding === null) this.next();
	}

	/** Drops a pending request, so a frame asked for earlier isn't drawn late. */
	cancel() {
		this.wanted = null;
		this.dropDecoding = this.decoding !== null;
	}

	private next() {
		const frame = this.wanted;
		const data = frame === null ? undefined : this.frames[frame];
		if (frame === null || !data || !this.decoder || this.decoder.state !== 'configured') return;
		this.wanted = null;
		this.decoding = frame;
		this.decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: frame, data }));
		// Without a flush some decoders hold the frame back until more input arrives.
		void this.decoder.flush().catch(() => {});
	}

	private drawn(image: VideoFrame) {
		const frame = image.timestamp;
		this.decoding = null;
		// Drawn even when a newer frame is wanted: it's still closer than what's on screen.
		if (!this.disposed && !this.dropDecoding) this.onDraw(frame, image);
		this.dropDecoding = false;
		image.close();
		if (this.wanted !== null) this.next();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker.terminate();
		if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
		this.frames = [];
	}
}
