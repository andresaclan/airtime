<script lang="ts">
	interface Props {
		isPlaying: boolean;
		currentTime: number;
		duration: number;
		frameRate: number;
		volume: number;
		isMuted: boolean;
		videoElement: HTMLVideoElement | null;
		timingModeEnabled?: boolean;
		onPlay?: () => void;
		onPause?: () => void;
		onFrameForward?: (time: number) => void;
		onFrameBack?: (time: number) => void;
		onVolumeChange?: (volume: number) => void;
		onMutedChange?: (muted: boolean) => void;
		onToggleTiming?: () => void;
		onMarkIn?: () => void;
		onMarkOut?: () => void;
	}

	let {
		isPlaying,
		currentTime,
		duration,
		frameRate,
		volume = $bindable(1),
		isMuted = $bindable(false),
		videoElement,
		timingModeEnabled = false,
		onPlay,
		onPause,
		onFrameForward,
		onFrameBack,
		onVolumeChange,
		onMutedChange,
		onToggleTiming,
		onMarkIn,
		onMarkOut
	}: Props = $props();

	// Calculate frame duration
	let frameDuration = $derived(1 / frameRate);
	const FRAME_EPSILON = 0.0001;

	// Store volume before muting to restore later
	let volumeBeforeMute = $state(1);

	function togglePlayPause() {
		if (!videoElement) return;

		if (isPlaying) {
			videoElement.pause();
			onPause?.();
		} else {
			videoElement.play();
			onPlay?.();
		}
	}

	function getSteppedTime(direction: 1 | -1): number {
		if (!videoElement) return currentTime;

		const safeDuration =
			Number.isFinite(duration) && duration > 0 ? duration : videoElement.duration || 0;
		if (!Number.isFinite(safeDuration) || safeDuration <= 0) return 0;

		const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
		const step = 1 / safeFrameRate;

		let frameIndex = Math.round(videoElement.currentTime * safeFrameRate);
		frameIndex += direction;

		const maxFrameIndex = Math.floor(safeDuration * safeFrameRate);
		frameIndex = Math.max(0, Math.min(maxFrameIndex, frameIndex));

		const targetTime = frameIndex / safeFrameRate;
		return Math.min(safeDuration, Math.max(0, targetTime));
	}

	function stepFrameForward() {
		if (!videoElement) return;
		const newTime = getSteppedTime(1);
		videoElement.currentTime = newTime;
		onFrameForward?.(newTime);
	}

	function stepFrameBack() {
		if (!videoElement) return;
		const newTime = getSteppedTime(-1);
		videoElement.currentTime = newTime;
		onFrameBack?.(newTime);
	}

	function toggleMute() {
		if (!videoElement) return;

		if (isMuted) {
			// Unmute and restore previous volume
			isMuted = false;
			volume = volumeBeforeMute > 0 ? volumeBeforeMute : 1;
			videoElement.muted = false;
			videoElement.volume = volume;
		} else {
			// Mute and store current volume
			volumeBeforeMute = volume;
			isMuted = true;
			videoElement.muted = true;
		}
		onMutedChange?.(isMuted);
	}

	function handleVolumeInput(event: Event) {
		if (!videoElement) return;

		const target = event.target as HTMLInputElement;
		const newVolume = Number.parseFloat(target.value);
		const clampedVolume = Math.min(1, Math.max(0, newVolume));

		volume = clampedVolume;
		videoElement.volume = clampedVolume;

		const nextMuted = clampedVolume === 0;
		isMuted = nextMuted;
		videoElement.muted = nextMuted;

		if (clampedVolume > 0) {
			volumeBeforeMute = clampedVolume;
		}

		onVolumeChange?.(clampedVolume);
		onMutedChange?.(nextMuted);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === ' ' || event.key === 'k') {
			event.preventDefault();
			togglePlayPause();
		} else if (event.key === 'ArrowLeft' && event.shiftKey) {
			event.preventDefault();
			if (currentTime <= FRAME_EPSILON) return;
			stepFrameBack();
		} else if (event.key === 'ArrowRight' && event.shiftKey) {
			event.preventDefault();
			if (duration > 0 && currentTime >= duration - FRAME_EPSILON) return;
			stepFrameForward();
		} else if (event.key === ',') {
			event.preventDefault();
			if (currentTime <= FRAME_EPSILON) return;
			stepFrameBack();
		} else if (event.key === '.') {
			event.preventDefault();
			if (duration > 0 && currentTime >= duration - FRAME_EPSILON) return;
			stepFrameForward();
		} else if (event.key === 'm') {
			event.preventDefault();
			toggleMute();
		} else if (event.key === 'ArrowUp' && !event.shiftKey) {
			event.preventDefault();
			const newVolume = Math.min(1, volume + 0.1);
			if (videoElement) {
				volume = newVolume;
				videoElement.volume = newVolume;
				if (isMuted && newVolume > 0) {
					isMuted = false;
					videoElement.muted = false;
				}
				onVolumeChange?.(newVolume);
			}
		} else if (event.key === 'ArrowDown' && !event.shiftKey) {
			event.preventDefault();
			const newVolume = Math.max(0, volume - 0.1);
			if (videoElement) {
				volume = newVolume;
				videoElement.volume = newVolume;
				if (newVolume === 0) {
					isMuted = true;
					videoElement.muted = true;
				}
				onVolumeChange?.(newVolume);
			}
		} else if (event.key === 't' || event.key === 'T') {
			// Toggle timing mode
			event.preventDefault();
			onToggleTiming?.();
		} else if (event.key === 'i' || event.key === 'I') {
			// Mark in point (only when timing mode is enabled)
			if (timingModeEnabled) {
				event.preventDefault();
				onMarkIn?.();
			}
		} else if (event.key === 'o' || event.key === 'O') {
			// Mark out point (only when timing mode is enabled)
			if (timingModeEnabled) {
				event.preventDefault();
				onMarkOut?.();
			}
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="at-reveal px-4 py-3" style="--delay: 60ms">
	<!-- Main playback controls row -->
	<div class="controls-wrap">
		<div class="volume-wrap">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-4 w-4 shrink-0"
				viewBox="0 0 24 24"
				fill="currentColor"
				style="color: hsl(var(--at-fg-muted))"
			>
				<path d="M7 9v6h4l5 5V4l-5 5H7z" />
			</svg>
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={volume}
				oninput={handleVolumeInput}
				disabled={!videoElement}
				class="volume-slider h-1.5 appearance-none"
				style="--volume-progress: {volume * 100}%"
				aria-label="Volume"
				title="Volume"
			/>
			<span class="volume-label text-right text-xs tabular-nums" style="color: hsl(var(--at-fg-muted))">
				{Math.round(volume * 100)}%
			</span>
		</div>

		<!-- Centered playback controls -->
		<div class="playback-wrap">
			<!-- Frame Back Button -->
			<button
				onclick={stepFrameBack}
				disabled={!videoElement || currentTime <= FRAME_EPSILON}
				class="at-btn at-btn-icon at-btn-ghost touch-manipulation"
				aria-label="Previous frame"
				title="Previous frame (< or Shift+Left)"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
				</svg>
			</button>

			<!-- Play/Pause Button - Large and prominent -->
			<button
				onclick={togglePlayPause}
				disabled={!videoElement}
				class="at-btn at-btn-primary at-btn-icon-xl touch-manipulation"
				aria-label={isPlaying ? 'Pause' : 'Play'}
				title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
			>
				{#if isPlaying}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-7 w-7"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-7 w-7"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path d="M8 5v14l11-7z" />
					</svg>
				{/if}
			</button>

			<!-- Frame Forward Button -->
			<button
				onclick={stepFrameForward}
				disabled={!videoElement || (duration > 0 && currentTime >= duration - FRAME_EPSILON)}
				class="at-btn at-btn-icon at-btn-ghost touch-manipulation"
				aria-label="Next frame"
				title="Next frame (> or Shift+Right)"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
				</svg>
			</button>
		</div>
	</div>
</div>

<style>
	.volume-slider {
		width: clamp(72px, 18vw, 136px);
		flex: 1 1 auto;
		min-width: 72px;
		background: linear-gradient(
			to right,
			hsl(var(--at-accent)) 0%,
			hsl(var(--at-accent)) var(--volume-progress),
			hsl(var(--at-border)) var(--volume-progress),
			hsl(var(--at-border)) 100%
		);
		border-radius: 4px;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		border: 2px solid white;
		background: hsl(var(--at-accent));
		box-shadow: 0 2px 6px hsl(var(--at-shadow) / 0.35);
	}

	.volume-slider::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 9999px;
		border: 2px solid white;
		background: hsl(var(--at-accent));
		box-shadow: 0 2px 6px hsl(var(--at-shadow) / 0.35);
	}

	.volume-slider:disabled {
		opacity: 0.45;
	}

	.controls-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		width: 100%;
		flex-wrap: wrap;
	}

	.playback-wrap {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		flex: 0 0 auto;
	}

	.volume-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 0 1 260px;
	}

	.volume-label {
		width: 36px;
		flex: 0 0 auto;
	}

	@media (max-width: 700px) {
		.controls-wrap {
			gap: 10px;
		}

		.playback-wrap {
			order: 1;
			width: 100%;
		}

		.volume-wrap {
			order: 2;
			width: min(100%, 320px);
			flex: 1 1 auto;
		}
	}

	@media (max-width: 480px) {
		.playback-wrap {
			gap: 8px;
		}

		.volume-wrap {
			gap: 6px;
		}

		.volume-label {
			display: none;
		}
	}
</style>
