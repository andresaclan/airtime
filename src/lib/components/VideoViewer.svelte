<script lang="ts">
	import type { Snippet } from 'svelte';
	import { estimatePlaybackFrameRate } from '$lib/video/frameRate';
	import {
		frameAt,
		frameOfPresentedTime,
		frameSeekTime,
		type FrameTiming
	} from '$lib/video/frames';
	import { settledDisplayedFrame, trackPresentedFrames } from '$lib/video/presentedFrame';
	import { mediaTime, mediaTimelineKnown, MEDIA_TIMELINE_EVENT } from '$lib/video/mediaTime';
	import { ScrubCache } from '$lib/video/scrubCache';
	import {
		clearSeeks,
		isProbing,
		registerSeekPreview,
		seek,
		setProbing,
		SEEK_EVENT,
		seekPending,
		targetTime
	} from '$lib/video/seek';

	interface VideoElementWithFrameCallback extends HTMLVideoElement {
		requestVideoFrameCallback(
			callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
		): number;
	}

	interface Props {
		videoElement?: HTMLVideoElement | null;
		videoSrc: string | null;
		/** The file behind `videoSrc`, for the scrub preview. */
		videoFile?: File | null;
		isPlaying: boolean;
		currentTime: number;
		duration: number;
		sourceFrameRate?: number | null;
		/** Time of every frame, from the file; see frames.ts. */
		frameTimes?: readonly number[] | null;
		editGap?: number;
		frameRate: number;
		playbackFrameRate?: number | null;
		volume: number;
		isMuted: boolean;
		zoomLevel?: number;
		playbackRate?: number;
		onDurationChange?: (duration: number) => void;
		onFrameRateDetected?: (fps: number) => void;
		onError?: () => void;
		/** Drawn over the picture (not its letterbox bars), above the scrub preview. */
		overlay?: Snippet;
	}

	let {
		videoElement = $bindable(null),
		videoSrc,
		videoFile = null,
		isPlaying = $bindable(false),
		currentTime = $bindable(0),
		duration = $bindable(0),
		sourceFrameRate = null,
		frameTimes = null,
		editGap = 0,
		frameRate = $bindable(30),
		playbackFrameRate = $bindable(null),
		volume = $bindable(1),
		isMuted = $bindable(false),
		zoomLevel = $bindable(1),
		playbackRate = 1,
		onDurationChange,
		onFrameRateDetected,
		onError,
		overlay
	}: Props = $props();

	let detectionId = 0;

	// Zoom and pan state
	const MIN_ZOOM = 1;
	const MAX_ZOOM = 5;
	const WHEEL_ZOOM_SENSITIVITY = 0.001;
	const PINCH_ZOOM_SENSITIVITY = 0.7;

	let panX = $state(0);
	let panY = $state(0);
	let isPanning = $state(false);
	let lastPanPoint = $state({ x: 0, y: 0 });
	let containerRef: HTMLDivElement | null = $state(null);

	// Touch/pinch zoom state
	let initialPinchDistance = $state(0);
	let initialZoomOnPinch = $state(1);
	let lastTouchCenter = $state({ x: 0, y: 0 });

	// Sync volume and muted state to video element
	$effect(() => {
		if (videoElement) {
			videoElement.volume = volume;
		}
	});

	$effect(() => {
		if (videoElement) {
			videoElement.muted = isMuted;
		}
	});

	// defaultPlaybackRate too, so the rate survives loading a new video into the element.
	$effect(() => {
		if (videoElement) {
			videoElement.defaultPlaybackRate = playbackRate;
			videoElement.playbackRate = playbackRate;
		}
	});

	// Follows the latest seek target rather than the seek still landing, so the
	// playhead keeps up with the pointer.
	function handleTimeUpdate() {
		if (videoElement) {
			currentTime = targetTime(videoElement);
		}
	}

	// ---- Scrub preview: cached frames drawn over the video until its seek lands ----

	let previewCanvas: HTMLCanvasElement | null = $state(null);
	/** Frame on the preview canvas while it covers the video; null when hidden. */
	let previewFrame: number | null = $state(null);
	let videoBox = $state({ left: 0, top: 0, width: 0, height: 0 });
	let scrubCache: ScrubCache | null = null;

	function previewTiming(): FrameTiming | null {
		if (!frameTimes?.length || !scrubCache || frameTimes.length !== scrubCache.frameCount) {
			return null;
		}
		return { fps: frameRate, frameTimes, editGap };
	}

	/** Frame the video itself has on screen, once its seeks have landed. */
	let videoFrame: number | null = null;
	/** Frame the video last presented, landed or not: what it shows under the preview. */
	let videoPresented: number | null = null;
	/** Frame the latest seek is headed for, which the preview gets as close to as it can. */
	let previewTarget: number | null = null;

	function videoShows(frame: number): boolean {
		return !!videoElement && !seekPending(videoElement) && videoFrame === frame;
	}

	/** How far `frame` is from the seek target, in frames. */
	function offTarget(frame: number | null): number {
		return frame === null || previewTarget === null ? Infinity : Math.abs(frame - previewTarget);
	}

	function hidePreview() {
		previewFrame = null;
		scrubCache?.cancel();
	}

	// The cached frame nearest the target, when it's nearer than what's on screen: the
	// exact frame once it's built, and until then the nearest one (a group's keyframe at
	// worst), so a scrub ahead of the cache still moves instead of freezing. The video
	// takes over as soon as it lands on the target.
	function showPreview(frame: number) {
		if (!scrubCache || !previewTiming()) return;
		scrubCache.focus(frame);
		previewTarget = frame;
		if (videoShows(frame)) return hidePreview();
		const nearest = scrubCache.nearest(frame, offTarget(previewFrame ?? videoPresented));
		if (nearest === null) scrubCache.cancel();
		else scrubCache.request(nearest);
	}

	function drawPreview(frame: number, image: VideoFrame) {
		if (!previewCanvas || !videoElement || !videoElement.paused) return;
		if (previewTarget === null || videoShows(previewTarget)) return;
		if (offTarget(frame) > offTarget(previewFrame ?? videoPresented)) return;
		const context = previewCanvas.getContext('2d');
		if (!context) return;
		if (previewCanvas.width !== image.displayWidth) previewCanvas.width = image.displayWidth;
		if (previewCanvas.height !== image.displayHeight) previewCanvas.height = image.displayHeight;
		context.drawImage(image, 0, 0);
		previewFrame = frame;
	}

	$effect(() => {
		const file = videoFile;
		if (!file || !ScrubCache.supported()) return;
		const cache = new ScrubCache(
			file,
			(frame, image) => drawPreview(frame, image),
			() => {
				if (scrubCache === cache) scrubCache = null;
				hidePreview();
			},
			(frame) => {
				// Built while the picture is a nearby stand-in: swap in the nearest frame now
				// built, which may be one already asked for rather than this one.
				if (!videoElement?.paused || previewTarget === null || videoShows(previewTarget)) return;
				const onScreen = offTarget(previewFrame ?? videoPresented);
				if (offTarget(frame) >= onScreen) return;
				const nearest = cache.nearest(previewTarget, onScreen);
				if (nearest !== null) cache.request(nearest);
			}
		);
		scrubCache = cache;
		return () => {
			cache.dispose();
			if (scrubCache === cache) scrubCache = null;
			hidePreview();
		};
	});

	$effect(() => {
		const video = videoElement;
		if (!video) return;
		const unregister = registerSeekPreview(video, { show: showPreview });
		const sync = () => handleTimeUpdate();
		const emptied = () => {
			clearSeeks(video);
			videoFrame = null;
			videoPresented = null;
			previewTarget = null;
			hidePreview();
		};
		const seeking = () => (videoFrame = null);
		// The preview stays up until the video lands on the target, or presents a frame
		// at least as near it on the way (a seek landing while the pointer moves on).
		let handle = 0;
		const onFrame = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
			handle = video.requestVideoFrameCallback(onFrame);
			const timing = previewTiming();
			if (!timing) return;
			videoPresented = frameOfPresentedTime(mediaTime(video, metadata.mediaTime), timing);
			if (!video.seeking) videoFrame = videoPresented;
			if (previewFrame === null || previewTarget === null) return;
			if (videoShows(previewTarget)) hidePreview();
			else if (offTarget(videoPresented) <= offTarget(previewFrame)) previewFrame = null;
		};
		// A seek to the frame already on screen may present nothing new.
		let seekedTimer: ReturnType<typeof setTimeout> | undefined;
		const seeked = () => {
			clearTimeout(seekedTimer);
			seekedTimer = setTimeout(() => {
				const timing = previewTiming();
				if (!timing || previewFrame === null || previewTarget === null) return;
				if (seekPending(video)) return;
				if (frameAt(mediaTime(video), timing) === previewTarget) {
					videoFrame = videoPresented = previewTarget;
					hidePreview();
				}
			}, 150);
		};
		// The container centres the video, so its box follows from the two sizes. Computed
		// sizes keep the fractions that offsetLeft/offsetTop round away.
		const resize = new ResizeObserver(() => {
			const container = video.parentElement;
			if (!container) return;
			const style = getComputedStyle(video);
			const width = parseFloat(style.width);
			const height = parseFloat(style.height);
			videoBox = {
				left: (container.clientWidth - width) / 2,
				top: (container.clientHeight - height) / 2,
				width,
				height
			};
		});
		resize.observe(video);
		if (video.parentElement) resize.observe(video.parentElement);
		if ('requestVideoFrameCallback' in video) handle = video.requestVideoFrameCallback(onFrame);
		video.addEventListener(SEEK_EVENT, sync);
		const timelineChanged = () => {
			handleDurationChange();
			sync();
		};
		video.addEventListener(MEDIA_TIMELINE_EVENT, timelineChanged);
		video.addEventListener('emptied', emptied);
		video.addEventListener('seeking', seeking);
		video.addEventListener('seeked', seeked);
		video.addEventListener('play', hidePreview);
		return () => {
			unregister();
			resize.disconnect();
			clearTimeout(seekedTimer);
			if (handle) video.cancelVideoFrameCallback(handle);
			video.removeEventListener(SEEK_EVENT, sync);
			video.removeEventListener(MEDIA_TIMELINE_EVENT, timelineChanged);
			video.removeEventListener('emptied', emptied);
			video.removeEventListener('seeking', seeking);
			video.removeEventListener('seeked', seeked);
			video.removeEventListener('play', hidePreview);
		};
	});

	function handleDurationChange() {
		if (videoElement) {
			duration = mediaTime(videoElement, videoElement.duration);
			onDurationChange?.(duration);
		}
	}

	function handlePlay() {
		enforceInAppPlayback();
		isPlaying = true;
	}

	function handlePause() {
		isPlaying = false;
	}

	function handleVolumeChange() {
		if (videoElement) {
			volume = videoElement.volume;
			isMuted = videoElement.muted;
		}
	}

	function handleLoadedMetadata() {
		if (videoElement) {
			enforceInAppPlayback();
			duration = mediaTime(videoElement, videoElement.duration);
			currentTime = mediaTime(videoElement);
			onDurationChange?.(duration);
			detectFrameRate();
			// Reset zoom on new video
			resetZoom();
		}
	}

	function enforceInAppPlayback() {
		if (!videoElement) return;

		videoElement.disablePictureInPicture = true;
		videoElement.disableRemotePlayback = true;

		const webkitVideo = videoElement as HTMLVideoElement & {
			webkitSetPresentationMode?: (mode: 'inline' | 'fullscreen' | 'picture-in-picture') => void;
		};

		if (typeof webkitVideo.webkitSetPresentationMode === 'function') {
			try {
				webkitVideo.webkitSetPresentationMode('inline');
			} catch {
				// Ignore platform-specific presentation mode failures.
			}
		}

		if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
			navigator.mediaSession.metadata = null;
			navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'none';
		}
	}

	$effect(() => {
		if (sourceFrameRate && sourceFrameRate > 0) {
			frameRate = sourceFrameRate;
		}
	});

	$effect(() => {
		if (videoSrc === null) {
			playbackFrameRate = null;
		}
	});

	// Keeps a paused playhead on the frame actually shown. Off until the frame rate is
	// known, so an assumed rate can't drag the playhead onto its own frame grid.
	$effect(() => {
		if (!videoElement) return;
		return trackPresentedFrames(videoElement, () =>
			sourceFrameRate || playbackFrameRate ? { fps: frameRate, frameTimes, editGap } : null
		);
	});

	// Zoom helper functions
	function clampZoom(zoom: number): number {
		return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
	}

	function clampPan(x: number, y: number, zoom: number): { x: number; y: number } {
		if (zoom <= 1) return { x: 0, y: 0 };

		const maxPanPercent = ((zoom - 1) / zoom) * 50;
		return {
			x: Math.min(maxPanPercent, Math.max(-maxPanPercent, x)),
			y: Math.min(maxPanPercent, Math.max(-maxPanPercent, y))
		};
	}

	function setZoom(newZoom: number, centerX?: number, centerY?: number) {
		const clampedZoom = clampZoom(newZoom);
		const oldZoom = zoomLevel;

		if (clampedZoom === oldZoom) return;

		if (centerX !== undefined && centerY !== undefined && containerRef) {
			const rect = containerRef.getBoundingClientRect();
			const containerCenterX = rect.width / 2;
			const containerCenterY = rect.height / 2;

			const offsetX = ((centerX - containerCenterX) / rect.width) * 100;
			const offsetY = ((centerY - containerCenterY) / rect.height) * 100;

			const zoomRatio = clampedZoom / oldZoom;
			panX = panX * zoomRatio - offsetX * (zoomRatio - 1);
			panY = panY * zoomRatio - offsetY * (zoomRatio - 1);
		}

		zoomLevel = clampedZoom;

		const clampedPan = clampPan(panX, panY, zoomLevel);
		panX = clampedPan.x;
		panY = clampedPan.y;
	}

	function resetZoom() {
		zoomLevel = 1;
		panX = 0;
		panY = 0;
	}

	// Mouse wheel zoom handler
	function handleWheel(event: WheelEvent) {
		if (!event.ctrlKey && !event.metaKey && zoomLevel === 1) return;

		event.preventDefault();

		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;

		const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
		setZoom(zoomLevel * zoomFactor, event.clientX - rect.left, event.clientY - rect.top);
	}

	// Mouse pan handlers
	function handleMouseDown(event: MouseEvent) {
		if (zoomLevel <= 1) return;
		if (event.button !== 0) return;

		isPanning = true;
		lastPanPoint = { x: event.clientX, y: event.clientY };
		event.preventDefault();
	}

	function handleMouseMove(event: MouseEvent) {
		if (!isPanning || !containerRef) return;

		const rect = containerRef.getBoundingClientRect();
		const deltaX = ((event.clientX - lastPanPoint.x) / rect.width) * 100;
		const deltaY = ((event.clientY - lastPanPoint.y) / rect.height) * 100;

		const newPan = clampPan(panX + deltaX, panY + deltaY, zoomLevel);
		panX = newPan.x;
		panY = newPan.y;

		lastPanPoint = { x: event.clientX, y: event.clientY };
	}

	function handleMouseUp() {
		isPanning = false;
	}

	// Touch handlers for pinch-to-zoom and pan
	function getTouchDistance(touches: TouchList): number {
		if (touches.length < 2) return 0;
		const dx = touches[0].clientX - touches[1].clientX;
		const dy = touches[0].clientY - touches[1].clientY;
		return Math.sqrt(dx * dx + dy * dy);
	}

	function getTouchCenter(touches: TouchList): { x: number; y: number } {
		if (touches.length < 2) {
			return { x: touches[0].clientX, y: touches[0].clientY };
		}
		return {
			x: (touches[0].clientX + touches[1].clientX) / 2,
			y: (touches[0].clientY + touches[1].clientY) / 2
		};
	}

	function handleTouchStart(event: TouchEvent) {
		if (event.touches.length === 2) {
			initialPinchDistance = getTouchDistance(event.touches);
			initialZoomOnPinch = zoomLevel;
			lastTouchCenter = getTouchCenter(event.touches);
		} else if (event.touches.length === 1 && zoomLevel > 1) {
			isPanning = true;
			lastPanPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
		}
	}

	function handleTouchMove(event: TouchEvent) {
		if (event.touches.length === 2 && initialPinchDistance > 0) {
			const currentDistance = getTouchDistance(event.touches);
			const scale = currentDistance / initialPinchDistance;
			const newZoom = initialZoomOnPinch * Math.pow(scale, PINCH_ZOOM_SENSITIVITY);

			const center = getTouchCenter(event.touches);
			const rect = containerRef?.getBoundingClientRect();
			if (rect) {
				setZoom(newZoom, center.x - rect.left, center.y - rect.top);
			}

			const deltaX = ((center.x - lastTouchCenter.x) / (containerRef?.offsetWidth || 1)) * 100;
			const deltaY = ((center.y - lastTouchCenter.y) / (containerRef?.offsetHeight || 1)) * 100;
			const newPan = clampPan(panX + deltaX, panY + deltaY, zoomLevel);
			panX = newPan.x;
			panY = newPan.y;
			lastTouchCenter = center;
		} else if (event.touches.length === 1 && isPanning && containerRef) {
			const rect = containerRef.getBoundingClientRect();
			const deltaX = ((event.touches[0].clientX - lastPanPoint.x) / rect.width) * 100;
			const deltaY = ((event.touches[0].clientY - lastPanPoint.y) / rect.height) * 100;

			const newPan = clampPan(panX + deltaX, panY + deltaY, zoomLevel);
			panX = newPan.x;
			panY = newPan.y;

			lastPanPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY };
		}
	}

	/** Mouse events browsers synthesise after a touch arrive within this long of it. */
	const TOUCH_CLICK_MS = 800;
	let lastTouchEnd = -Infinity;

	function handleTouchEnd(event: TouchEvent) {
		lastTouchEnd = performance.now();
		if (event.touches.length < 2) {
			initialPinchDistance = 0;
		}
		if (event.touches.length === 0) {
			isPanning = false;
		}
	}

	// Double-tap to reset zoom
	let lastTapTime = 0;
	function handleDoubleTap(event: TouchEvent) {
		const now = Date.now();
		if (now - lastTapTime < 300 && event.touches.length === 1) {
			if (zoomLevel > 1) {
				resetZoom();
			} else {
				const rect = containerRef?.getBoundingClientRect();
				if (rect) {
					setZoom(2, event.touches[0].clientX - rect.left, event.touches[0].clientY - rect.top);
				}
			}
		}
		lastTapTime = now;
	}

	// Double-click to toggle zoom on desktop. A double-tap fires dblclick as well, after
	// handleDoubleTap has already toggled; acting on it too would undo that at once.
	function handleDoubleClick(event: MouseEvent) {
		if (performance.now() - lastTouchEnd < TOUCH_CLICK_MS) return;
		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;

		if (zoomLevel > 1) {
			resetZoom();
		} else {
			setZoom(2, event.clientX - rect.left, event.clientY - rect.top);
		}
	}

	function applyDetectedFrameRate(detectedRate: number | null) {
		playbackFrameRate = detectedRate;
		if (sourceFrameRate && sourceFrameRate > 0) {
			frameRate = sourceFrameRate;
			onFrameRateDetected?.(sourceFrameRate);
		} else {
			// 30 only keeps frame stepping usable; the page won't mark an unknown frame rate.
			frameRate = detectedRate ?? 30;
			onFrameRateDetected?.(detectedRate ?? 30);
		}
	}

	// Frame callbacks arrive at most once per display refresh, so a clip faster than the
	// display (240 fps on a 120 Hz screen) reads as the refresh rate. Fast clips are
	// sampled again at quarter speed, which tells rates up to 4× the refresh rate apart.
	const FAST_FRAME_RATE = 50;
	const SLOW_PROBE_RATE = 0.25;
	// The mute setting from before a probe muted the video. Kept outside the probe so one
	// cut short by the next video doesn't leave the video muted.
	let mutedBeforeProbe: boolean | null = null;

	function endProbeMute(video: HTMLVideoElement) {
		if (mutedBeforeProbe === null) return;
		video.muted = mutedBeforeProbe;
		mutedBeforeProbe = null;
	}

	/** Media times of up to 13 frames as they're presented, or fewer if `timeoutMs` passes. */
	function sampleFrameTimes(
		video: VideoElementWithFrameCallback,
		id: number,
		timeoutMs: number
	): Promise<number[]> {
		return new Promise((resolve) => {
			const times: number[] = [];
			let done = false;
			// Low frame-rate clips may not deliver every frame in time; settle with what came.
			const timeout = setTimeout(() => finish(), timeoutMs);
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				resolve(times);
			};
			const callback = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
				if (done) return;
				if (id !== detectionId) return finish();
				times.push(metadata.mediaTime);
				if (times.length < 13) video.requestVideoFrameCallback(callback);
				else finish();
			};
			video.requestVideoFrameCallback(callback);
		});
	}

	async function detectFrameRate() {
		detectionId += 1;
		const id = detectionId;

		const video = videoElement as VideoElementWithFrameCallback | null;
		if (!video || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
			applyDetectedFrameRate(null);
			return;
		}
		if (sourceFrameRate) {
			// Container timing is authoritative. Playback is only a fallback for
			// formats without it, and must not move a parsed video's opening picture.
			const timing = { fps: sourceFrameRate, frameTimes, editGap };
			if (mediaTimelineKnown(video, timing)) {
				// Safari's metadata preload need not decode the opening picture.
				seek(video, frameSeekTime(0, timing, mediaTime(video, video.duration)), timing);
			} else {
				setProbing(video, true);
				await calibrateTimeline(video, timing);
				if (id !== detectionId) return;
				if (isProbing(video))
					seek(video, frameSeekTime(0, timing, mediaTime(video, video.duration)), timing);
				setProbing(video, false);
			}
			applyDetectedFrameRate(null);
			return;
		}

		const wasPlaying = !video.paused;
		const originalTime = mediaTime(video);

		if (!wasPlaying) {
			mutedBeforeProbe ??= video.muted;
			video.muted = true;
			setProbing(video, true);
			try {
				await video.play();
			} catch {
				setProbing(video, false);
				if (id !== detectionId) return;
				endProbeMute(video);
				applyDetectedFrameRate(null);
				return;
			}
		}

		let rate = estimatePlaybackFrameRate(await sampleFrameTimes(video, id, 500));
		// Only while probing: slowing down a video the athlete is watching would be jarring.
		if (
			!wasPlaying &&
			isProbing(video) &&
			rate !== null &&
			rate >= FAST_FRAME_RATE &&
			id === detectionId
		) {
			video.playbackRate = SLOW_PROBE_RATE;
			const slowRate = estimatePlaybackFrameRate(await sampleFrameTimes(video, id, 1000));
			video.playbackRate = playbackRate;
			if (slowRate !== null && slowRate > rate) rate = slowRate;
		}

		if (id !== detectionId) return;
		if (!wasPlaying && isProbing(video)) {
			video.pause();
			const timing = {
				fps: sourceFrameRate ?? rate ?? frameRate,
				frameTimes: sourceFrameRate ? frameTimes : null,
				editGap
			};
			// WebKit may finish presenting probe playback after pause/seeked. Let
			// that picture settle before restoring, or it can overwrite the seek.
			await settledDisplayedFrame(video, timing);
			if (id !== detectionId) return;
			if (isProbing(video)) await calibrateTimeline(video, timing);
			if (id !== detectionId) return;
			// Probe playback can present a final frame after pause. Restore through
			// the same queue as user input so that callback cannot undo the reset.
			if (isProbing(video)) {
				seek(
					video,
					frameSeekTime(frameAt(originalTime, timing), timing, mediaTime(video, video.duration)),
					timing
				);
			}
		}
		setProbing(video, false);
		endProbeMute(video);
		applyDetectedFrameRate(rate);
	}

	/** A zero timestamp could be a clamped partial frame, so sample a later picture. */
	async function calibrateTimeline(video: HTMLVideoElement, timing: FrameTiming) {
		if (mediaTimelineKnown(video, timing)) return;
		await new Promise<void>((resolve) => {
			const finish = () => {
				clearTimeout(timeout);
				video.removeEventListener(MEDIA_TIMELINE_EVENT, finish);
				resolve();
			};
			const timeout = setTimeout(finish, 1000);
			video.addEventListener(MEDIA_TIMELINE_EVENT, finish, { once: true });
			const probing = isProbing(video);
			seek(video, frameSeekTime(1, timing, mediaTime(video, video.duration)), timing);
			setProbing(video, probing);
		});
	}

	// Computed transform style
	let transformStyle = $derived(
		zoomLevel > 1
			? `transform: scale(${zoomLevel}) translate(${panX / zoomLevel}%, ${panY / zoomLevel}%);`
			: ''
	);
</script>

<svelte:window onmouseup={handleMouseUp} onmousemove={handleMouseMove} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={containerRef}
	class="relative flex h-full w-full items-center justify-center"
	style="background: hsl(var(--at-stage)); overflow: hidden; touch-action: none;"
	onwheel={handleWheel}
	onmousedown={handleMouseDown}
	ondblclick={handleDoubleClick}
	ontouchstart={(e) => {
		handleDoubleTap(e);
		handleTouchStart(e);
	}}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	ontouchcancel={handleTouchEnd}
	role="application"
	aria-label="Video viewer with zoom controls"
>
	{#if videoSrc}
		<video
			bind:this={videoElement}
			src={videoSrc}
			ontimeupdate={handleTimeUpdate}
			ondurationchange={handleDurationChange}
			onloadedmetadata={handleLoadedMetadata}
			onplay={handlePlay}
			onpause={handlePause}
			onvolumechange={handleVolumeChange}
			onerror={onError}
			class="max-h-full max-w-full object-contain"
			style="{transformStyle} transform-origin: center center; cursor: {zoomLevel > 1
				? isPanning
					? 'grabbing'
					: 'grab'
				: 'default'};"
			playsinline
			disableremoteplayback
			disablepictureinpicture
			controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"
			preload="metadata"
			draggable="false"
		>
			<track kind="captions" />
		</video>

		<canvas
			bind:this={previewCanvas}
			data-scrub-surface
			class="scrub-preview"
			class:visible={previewFrame !== null}
			aria-hidden="true"
			style="left: {videoBox.left}px; top: {videoBox.top}px; width: {videoBox.width}px; height: {videoBox.height}px; {transformStyle} transform-origin: center center;"
		></canvas>

		{#if overlay}
			<div
				class="picture-overlay"
				style="left: {videoBox.left}px; top: {videoBox.top}px; width: {videoBox.width}px; height: {videoBox.height}px;"
			>
				{@render overlay()}
			</div>
		{/if}

		<!-- Zoom indicator -->
		{#if zoomLevel > 1}
			<div class="zoom-pill">
				<span>{Math.round(zoomLevel * 100)}%</span>
				<button
					onclick={(e) => {
						e.stopPropagation();
						resetZoom();
					}}
					aria-label="Reset zoom"
					title="Reset zoom (double-click)"
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
						<path d="M3 3v5h5" />
					</svg>
					Reset
				</button>
			</div>
		{/if}
	{:else}
		<div class="at-text-muted flex h-full items-center justify-center">
			<p>Select a video to begin</p>
		</div>
	{/if}
</div>

<style>
	/* Covers the video exactly, and lets pointer events through to it. */
	.scrub-preview {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}

	.scrub-preview.visible {
		visibility: visible;
	}

	.picture-overlay {
		position: absolute;
		z-index: 5;
		pointer-events: none;
	}

	.zoom-pill {
		position: absolute;
		top: 12px;
		left: 12px;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 3px 0 10px;
		border: 1px solid hsl(var(--at-fg) / 0.08);
		border-radius: 999px;
		background: hsl(var(--at-stage) / 0.72);
		color: hsl(var(--at-fg));
		font-family: var(--at-font-mono);
		font-size: 11px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		backdrop-filter: blur(10px);
	}

	.zoom-pill button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 22px;
		padding: 0 8px;
		border: none;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-family: inherit;
		cursor: pointer;
	}

	/* A 44px hit area around the 22px chip, inside the viewer. */
	@media (pointer: coarse) {
		.zoom-pill button {
			position: relative;
		}
		.zoom-pill button::after {
			content: '';
			position: absolute;
			inset: -11px -6px;
		}
	}

	.zoom-pill button:hover {
		background: hsl(var(--at-fg) / 0.18);
		color: hsl(var(--at-fg));
	}

	.zoom-pill svg {
		width: 12px;
		height: 12px;
	}
</style>
