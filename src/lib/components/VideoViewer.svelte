<script lang="ts">
	// Extend HTMLVideoElement to include requestVideoFrameCallback
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
		frameRate: number;
		volume: number;
		isMuted: boolean;
		onTimeUpdate?: (time: number) => void;
		onDurationChange?: (duration: number) => void;
		onPlayStateChange?: (playing: boolean) => void;
		onFrameRateDetected?: (fps: number) => void;
		onVolumeChange?: (volume: number) => void;
		onMutedChange?: (muted: boolean) => void;
	}

	let {
		videoElement = $bindable(null),
		videoSrc,
		isPlaying = $bindable(false),
		currentTime = $bindable(0),
		duration = $bindable(0),
		frameRate = $bindable(30),
		volume = $bindable(1),
		isMuted = $bindable(false),
		onTimeUpdate,
		onDurationChange,
		onPlayStateChange,
		onFrameRateDetected,
		onVolumeChange,
		onMutedChange
	}: Props = $props();

	let frameCount = $state(0);
	let lastFrameTime = $state(0);
	let framesForDetection: number[] = $state([]);
	let volumeBeforeMute = $state(1);

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
			duration = videoElement.duration;
			onDurationChange?.(duration);
			// Start frame rate detection
			detectFrameRate();
		}
	}

	function detectFrameRate() {
		if (!videoElement || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
			// Fallback to 30fps if API not supported
			frameRate = 30;
			onFrameRateDetected?.(30);
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

			// Collect 10 frames to calculate average
			if (frameCount < 12 && videoElement) {
				(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(detectCallback);
			} else if (framesForDetection.length > 0) {
				// Calculate median frame rate
				const sorted = [...framesForDetection].sort((a, b) => a - b);
				const median = sorted[Math.floor(sorted.length / 2)];

				// Common frame rates including high fps options
				const commonRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 90, 100, 120, 144, 240];

				// Only snap to a common rate if within 1% threshold, otherwise use raw detected value
				const threshold = 0.01;
				const closestCommon = commonRates.find(
					(rate) => Math.abs(rate - median) / median < threshold
				);

				// Use the common rate if close enough, otherwise round to 2 decimal places
				const detectedRate = closestCommon ?? Math.round(median * 100) / 100;

				frameRate = detectedRate;
				onFrameRateDetected?.(detectedRate);
			}
		};

		// Play briefly to detect frame rate
		const wasPlaying = !videoElement.paused;
		const originalTime = videoElement.currentTime;
		const originalMuted = videoElement.muted;

		if (!wasPlaying) {
			videoElement.muted = true;
			const playPromise = videoElement.play();
			if (playPromise) {
				playPromise
					.then(() => {
						(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(
							detectCallback
						);
						// Stop after a short time
						setTimeout(() => {
							if (videoElement && !wasPlaying) {
								videoElement.pause();
								videoElement.currentTime = originalTime;
								// Restore muted state
								videoElement.muted = originalMuted;
							}
						}, 500);
					})
					.catch(() => {
						// Autoplay blocked, use fallback
						frameRate = 30;
						onFrameRateDetected?.(30);
						// Restore muted state
						if (videoElement) {
							videoElement.muted = originalMuted;
						}
					});
			}
		} else {
			(videoElement as VideoElementWithFrameCallback).requestVideoFrameCallback(detectCallback);
		}
	}
</script>

<div class="relative flex w-full items-center justify-center" style="background: hsl(0 0% 5%);">
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
			class="max-h-full max-w-full"
			playsinline
			preload="metadata"
		>
			<track kind="captions" />
		</video>
	{:else}
		<div class="at-text-muted flex h-full items-center justify-center">
			<p>Select a video to begin</p>
		</div>
	{/if}
</div>
