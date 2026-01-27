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
		onFrameForward?: () => void;
		onFrameBack?: () => void;
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

	// Store volume before muting to restore later
	let volumeBeforeMute = $state(1);

	// Volume percentage for display
	let volumePercent = $derived(Math.round((isMuted ? 0 : volume) * 100));

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

	function stepFrameForward() {
		if (!videoElement) return;

		// Pause if playing
		if (!videoElement.paused) {
			videoElement.pause();
		}

		const newTime = Math.min(duration, videoElement.currentTime + frameDuration);
		videoElement.currentTime = newTime;
		onFrameForward?.();
	}

	function stepFrameBack() {
		if (!videoElement) return;

		// Pause if playing
		if (!videoElement.paused) {
			videoElement.pause();
		}

		const newTime = Math.max(0, videoElement.currentTime - frameDuration);
		videoElement.currentTime = newTime;
		onFrameBack?.();
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
		const newVolume = parseFloat(target.value);

		volume = newVolume;
		videoElement.volume = newVolume;

		// If adjusting volume while muted, unmute
		if (isMuted && newVolume > 0) {
			isMuted = false;
			videoElement.muted = false;
			onMutedChange?.(false);
		}

		// If volume is set to 0, treat as muted
		if (newVolume === 0) {
			isMuted = true;
			videoElement.muted = true;
			onMutedChange?.(true);
		}

		onVolumeChange?.(newVolume);
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '00:00';

		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hrs > 0) {
			return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
		}
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === ' ' || event.key === 'k') {
			event.preventDefault();
			togglePlayPause();
		} else if (event.key === 'ArrowLeft' && event.shiftKey) {
			event.preventDefault();
			stepFrameBack();
		} else if (event.key === 'ArrowRight' && event.shiftKey) {
			event.preventDefault();
			stepFrameForward();
		} else if (event.key === ',') {
			event.preventDefault();
			stepFrameBack();
		} else if (event.key === '.') {
			event.preventDefault();
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

<div class="at-reveal flex items-center justify-center gap-4 px-4 py-2" style="--delay: 60ms">
	<!-- Frame Back Button -->
	<button
		onclick={stepFrameBack}
		disabled={!videoElement || currentTime <= 0}
		class="at-btn at-btn-icon-sm touch-manipulation"
		aria-label="Previous frame"
		title="Previous frame (< or Shift+Left)"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
			<path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
		</svg>
	</button>

	<!-- Play/Pause Button -->
	<button
		onclick={togglePlayPause}
		disabled={!videoElement}
		class="at-btn at-btn-primary at-btn-icon touch-manipulation"
		aria-label={isPlaying ? 'Pause' : 'Play'}
		title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
	>
		{#if isPlaying}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
				viewBox="0 0 24 24"
				fill="currentColor"
			>
				<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
			</svg>
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-5 w-5"
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
		disabled={!videoElement || currentTime >= duration}
		class="at-btn at-btn-icon-sm touch-manipulation"
		aria-label="Next frame"
		title="Next frame (> or Shift+Right)"
	>
		<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
			<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
		</svg>
	</button>

	<!-- Divider -->
	<div class="h-6 w-px" style="background: hsl(var(--at-border))"></div>

	<!-- Volume Controls -->
	<div class="flex items-center gap-1">
		<!-- Mute Button -->
		<button
			onclick={toggleMute}
			disabled={!videoElement}
			class="at-btn at-btn-icon-sm touch-manipulation"
			aria-label={isMuted ? 'Unmute' : 'Mute'}
			title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
		>
			{#if isMuted || volume === 0}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path
						d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"
					/>
				</svg>
			{:else if volume < 0.5}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M7 9v6h4l5 5V4l-5 5H7z" />
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path
						d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
					/>
				</svg>
			{/if}
		</button>

		<!-- Volume Slider -->
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={isMuted ? 0 : volume}
			oninput={handleVolumeInput}
			disabled={!videoElement}
			class="volume-slider h-1 w-16 cursor-pointer appearance-none disabled:cursor-not-allowed disabled:opacity-50"
			style="--volume: {volumePercent}%"
			aria-label="Volume"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={volumePercent}
		/>
	</div>
</div>

<style>
	.volume-slider {
		background: linear-gradient(
			to right,
			hsl(var(--at-accent)) 0%,
			hsl(var(--at-accent)) var(--volume),
			hsl(var(--at-border)) var(--volume),
			hsl(var(--at-border)) 100%
		);
		border-radius: 0;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 0;
		background: hsl(var(--at-accent));
		cursor: pointer;
		border: 1px solid hsl(var(--at-fg));
		transition:
			transform 120ms ease,
			background 120ms ease;
	}

	.volume-slider::-webkit-slider-thumb:hover {
		background: hsl(var(--at-accent-2));
		transform: scale(1.1);
	}

	.volume-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 0;
		background: hsl(var(--at-accent));
		cursor: pointer;
		border: 1px solid hsl(var(--at-fg));
		transition:
			transform 120ms ease,
			background 120ms ease;
	}

	.volume-slider::-moz-range-thumb:hover {
		background: hsl(var(--at-accent-2));
		transform: scale(1.1);
	}
</style>
