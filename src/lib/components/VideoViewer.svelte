<script lang="ts">
	interface VideoElementWithFrameCallback extends HTMLVideoElement {
		requestVideoFrameCallback(
			callback: (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => void
		): number;
	}

	interface Props {
		videoElement?: HTMLVideoElement | null;
		videoSrc: string | null;
		isPlaying: boolean;
		currentTime: number;
		duration: number;
		sourceFrameRate?: number | null;
		frameRate: number;
		playbackFrameRate?: number | null;
		volume: number;
		isMuted: boolean;
		zoomLevel?: number;
		onTimeUpdate?: (time: number) => void;
		onDurationChange?: (duration: number) => void;
		onPlayStateChange?: (playing: boolean) => void;
		onFrameRateDetected?: (fps: number) => void;
		onVolumeChange?: (volume: number) => void;
		onMutedChange?: (muted: boolean) => void;
		onZoomChange?: (zoom: number) => void;
	}

	let {
		videoElement = $bindable(null),
		videoSrc,
		isPlaying = $bindable(false),
		currentTime = $bindable(0),
		duration = $bindable(0),
		sourceFrameRate = null,
		frameRate = $bindable(30),
		playbackFrameRate = $bindable(null),
		volume = $bindable(1),
		isMuted = $bindable(false),
		zoomLevel = $bindable(1),
		onTimeUpdate,
		onDurationChange,
		onPlayStateChange,
		onFrameRateDetected,
		onVolumeChange,
		onMutedChange,
		onZoomChange
	}: Props = $props();

	let frameCount = $state(0);
	let lastFrameTime = $state(0);
	let framesForDetection: number[] = $state([]);

	// Zoom and pan state
	const MIN_ZOOM = 1;
	const MAX_ZOOM = 5;
	const ZOOM_STEP = 0.25;

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

	function handleTimeUpdate() {
		if (videoElement) {
			currentTime = videoElement.currentTime;
			onTimeUpdate?.(currentTime);
		}
	}

	function handleDurationChange() {
		if (videoElement) {
			duration = videoElement.duration;
			onDurationChange?.(duration);
		}
	}

	function handlePlay() {
		enforceInAppPlayback();
		isPlaying = true;
		onPlayStateChange?.(true);
	}

	function handlePause() {
		isPlaying = false;
		onPlayStateChange?.(false);
	}

	function handleVolumeChange() {
		if (videoElement) {
			volume = videoElement.volume;
			isMuted = videoElement.muted;
			onVolumeChange?.(volume);
			onMutedChange?.(isMuted);
		}
	}

	function handleLoadedMetadata() {
		if (videoElement) {
			enforceInAppPlayback();
			duration = videoElement.duration;
			currentTime = videoElement.currentTime;
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

		onZoomChange?.(zoomLevel);
	}

	export function resetZoom() {
		zoomLevel = 1;
		panX = 0;
		panY = 0;
		onZoomChange?.(1);
	}

	export function zoomIn() {
		setZoom(zoomLevel + ZOOM_STEP);
	}

	export function zoomOut() {
		setZoom(zoomLevel - ZOOM_STEP);
	}

	// Mouse wheel zoom handler
	function handleWheel(event: WheelEvent) {
		if (!event.ctrlKey && !event.metaKey && zoomLevel === 1) return;

		event.preventDefault();

		const rect = containerRef?.getBoundingClientRect();
		if (!rect) return;

		const zoomDelta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
		setZoom(zoomLevel + zoomDelta, event.clientX - rect.left, event.clientY - rect.top);
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
			const newZoom = initialZoomOnPinch * scale;

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

	function handleTouchEnd(event: TouchEvent) {
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

	// Double-click to toggle zoom on desktop
	function handleDoubleClick(event: MouseEvent) {
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
			frameRate = detectedRate ?? 30;
			onFrameRateDetected?.(detectedRate ?? 30);
		}
	}

	function detectFrameRate() {
		if (!videoElement || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
			applyDetectedFrameRate(null);
			return;
		}

		frameCount = 0;
		lastFrameTime = 0;
		framesForDetection = [];

		const detectCallback = (now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
			if (frameCount === 0) {
				lastFrameTime = metadata.mediaTime;
			} else {
				const delta = metadata.mediaTime - lastFrameTime;
				if (delta > 0) {
					framesForDetection.push(1 / delta);
				}
				lastFrameTime = metadata.mediaTime;
			}

			frameCount++;

			if (frameCount < 12 && videoElement) {
				(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(detectCallback);
			} else if (framesForDetection.length > 0) {
				const sorted = [...framesForDetection].sort((a, b) => a - b);
				const median = sorted[Math.floor(sorted.length / 2)];

				const commonRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 90, 100, 120, 144, 240];
				const threshold = 0.01;
				const closestCommon = commonRates.find(
					(rate) => Math.abs(rate - median) / median < threshold
				);

				const detectedRate = closestCommon ?? Math.round(median * 100) / 100;
				applyDetectedFrameRate(detectedRate);
			}
		};

		const wasPlaying = !videoElement.paused;
		const originalTime = videoElement.currentTime;
		const originalMuted = videoElement.muted;

		if (!wasPlaying) {
			videoElement.muted = true;
			const playPromise = videoElement.play();
			if (playPromise) {
				playPromise
					.then(() => {
						(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(detectCallback);
						setTimeout(() => {
							if (videoElement && !wasPlaying) {
								videoElement.pause();
								videoElement.currentTime = originalTime;
								videoElement.muted = originalMuted;
							}
						}, 500);
					})
					.catch(() => {
						applyDetectedFrameRate(null);
						if (videoElement) {
							videoElement.muted = originalMuted;
						}
					});
			}
		} else {
			(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(detectCallback);
		}
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
	style="background: hsl(220 20% 4%); overflow: hidden; touch-action: none;"
	onwheel={handleWheel}
	onmousedown={handleMouseDown}
	ondblclick={handleDoubleClick}
	ontouchstart={(e) => {
		e.preventDefault();
		handleDoubleTap(e);
		handleTouchStart(e);
	}}
	ontouchmove={(e) => {
		e.preventDefault();
		handleTouchMove(e);
	}}
	ontouchend={handleTouchEnd}
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
			class="max-h-full max-w-full object-contain"
			style="{transformStyle} transform-origin: center center; cursor: {zoomLevel > 1
				? isPanning
					? 'grabbing'
					: 'grab'
				: 'default'};"
			playsinline
			x-webkit-airplay="deny"
			disableremoteplayback
			disablepictureinpicture
			controlslist="nodownload noplaybackrate noremoteplayback nofullscreen"
			preload="metadata"
			draggable="false"
		>
			<track kind="captions" />
		</video>

		<!-- Zoom indicator -->
		{#if zoomLevel > 1}
			<div
				class="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
				style="background: hsl(var(--at-bg-elevated) / 0.9); backdrop-filter: blur(8px); color: hsl(var(--at-fg)); border: 1px solid hsl(var(--at-border));"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					style="color: hsl(var(--at-accent));"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="11" cy="11" r="8" />
					<path d="m21 21-4.35-4.35" />
					<path d="M11 8v6" />
					<path d="M8 11h6" />
				</svg>
				<span class="font-mono">{Math.round(zoomLevel * 100)}%</span>
				<button
					onclick={(e) => {
						e.stopPropagation();
						resetZoom();
					}}
					class="ml-1 rounded-md p-1.5 transition-colors"
					style="background: hsl(var(--at-fg) / 0.1);"
					aria-label="Reset zoom"
					title="Reset zoom"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-3.5 w-3.5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
						<path d="M3 3v5h5" />
					</svg>
				</button>
			</div>
		{/if}
	{:else}
		<div class="at-text-muted flex h-full items-center justify-center">
			<p>Select a video to begin</p>
		</div>
	{/if}
</div>
