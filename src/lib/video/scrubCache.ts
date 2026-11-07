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

const MB = 1024 * 1024;

export type ScrubBudget = {
	/** Memory the cached frames may take. Longer videos get smaller frames. */
	maxBytes: number;
	/** Build with fewer frames in flight: one encoder and shorter queues. */
	lowMemory: boolean;
};

/**
 * How much memory the cache may use on this device. iOS Safari kills a tab's web
 * process once it passes a per-device memory limit far below a desktop's, and reloads
 * the page; a backgrounded tab is killed sooner, largest first. So phones and tablets
 * get a third of the desktop budget, built with fewer full-size frames in flight.
 */
export function scrubBudget(device: {
	/** The primary pointer is a finger: phones and most tablets. */
	coarsePointer: boolean;
	/** iPadOS reports itself as a Mac; touch points give it away. */
	touchMac: boolean;
	/** `navigator.deviceMemory` in GB, where the browser reports it (not Safari). */
	deviceMemory?: number;
}): ScrubBudget {
	const lowMemory =
		device.coarsePointer ||
		device.touchMac ||
		(device.deviceMemory !== undefined && device.deviceMemory <= 4);
	return { maxBytes: (lowMemory ? 48 : 160) * MB, lowMemory };
}

function deviceBudget(): ScrubBudget {
	const nav = navigator as Navigator & { deviceMemory?: number };
	return scrubBudget({
		coarsePointer: matchMedia('(pointer: coarse)').matches,
		touchMac: /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1,
		deviceMemory: nav.deviceMemory
	});
}

/**
 * The index nearest `frame` that holds a frame, fewer than `within` away (of two equally
 * near, the earlier); null if none does.
 */
export function nearestBuilt(
	frames: readonly unknown[],
	frame: number,
	within = Infinity
): number | null {
	const limit = Math.min(within, frames.length + Math.abs(frame));
	for (let distance = 0; distance < limit; distance += 1) {
		if (frames[frame - distance] !== undefined) return frame - distance;
		if (frames[frame + distance] !== undefined) return frame + distance;
	}
	return null;
}

type DecoderSlot = {
	decoder: VideoDecoder;
	/** Frame being decoded; null while idle. */
	frame: number | null;
	/** Set by `cancel` while it decodes, so its frame isn't drawn. */
	drop: boolean;
};

export class ScrubCache {
	frameCount = 0;
	private frames: (ArrayBuffer | undefined)[] = [];
	private worker: Worker;
	/**
	 * Decoders for drawing frames, each with the frame it's decoding. Two on desktops, so
	 * at a high refresh rate one frame decodes while the other is drawn.
	 */
	private decoders: DecoderSlot[] = [];
	private decoderCount: number;
	/** The latest frame asked for while every decoder was busy. */
	private wanted: number | null = null;
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
		const budget = deviceBudget();
		this.decoderCount = budget.lowMemory ? 1 : 2;
		this.post({ type: 'build', file, ...budget });
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
				this.frames = new Array(message.frameCount);
				for (let i = 0; i < this.decoderCount; i += 1) {
					const slot: DecoderSlot = {
						decoder: new VideoDecoder({
							output: (image) => this.drawn(slot, image),
							error: () => this.fail()
						}),
						frame: null,
						drop: false
					};
					slot.decoder.configure(message.config);
					this.decoders.push(slot);
				}
				break;
			case 'frame':
				this.frames[message.frame] = message.data;
				if (this.wanted === message.frame) this.next();
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

	/** The built frame nearest `frame`, fewer than `within` frames away; see `nearestBuilt`. */
	nearest(frame: number, within = Infinity): number | null {
		return nearestBuilt(this.frames, frame, within);
	}

	/** Builds the frames around this one next. */
	focus(frame: number) {
		if (!this.disposed) this.post({ type: 'focus', frame });
	}

	/**
	 * Draws `frame` through `onDraw` as soon as it's decoded. While every decoder is
	 * busy, only the latest request waits; the ones in between are skipped. Frames can
	 * come back out of order, so `onDraw` decides whether one is still worth drawing.
	 */
	request(frame: number) {
		this.wanted = frame;
		this.next();
	}

	/** Drops a pending request, so a frame asked for earlier isn't drawn late. */
	cancel() {
		this.wanted = null;
		for (const slot of this.decoders) slot.drop = slot.frame !== null;
	}

	private next() {
		const frame = this.wanted;
		const data = frame === null ? undefined : this.frames[frame];
		if (frame === null || !data) return;
		// Already on its way.
		if (this.decoders.some((slot) => slot.frame === frame && !slot.drop)) {
			this.wanted = null;
			return;
		}
		const slot = this.decoders.find(
			(slot) => slot.frame === null && slot.decoder.state === 'configured'
		);
		if (!slot) return;
		this.wanted = null;
		slot.frame = frame;
		slot.decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: frame, data }));
		// Without a flush some decoders hold the frame back until more input arrives.
		void slot.decoder.flush().catch(() => {});
	}

	private drawn(slot: DecoderSlot, image: VideoFrame) {
		slot.frame = null;
		// Drawn even when a newer frame is wanted: it may still be closer than what's on screen.
		if (!this.disposed && !slot.drop) this.onDraw(image.timestamp, image);
		slot.drop = false;
		image.close();
		this.next();
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.worker.terminate();
		for (const { decoder } of this.decoders) if (decoder.state !== 'closed') decoder.close();
		this.frames = [];
	}
}
