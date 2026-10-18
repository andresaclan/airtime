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

	const FRAME_EPSILON = 0.0001;
	let volumeBeforeMute = $state(1);

	function togglePlayPause() {
		if (!videoElement) return;
		if (isPlaying) {
			videoElement.pause();
			onPause?.();
		} else {
			void videoElement
				.play()
				.then(() => onPlay?.())
				.catch(() => onPause?.());
		}
	}

	function getSteppedTime(direction: 1 | -1): number {
		if (!videoElement) return currentTime;
		const safeDuration =
			Number.isFinite(duration) && duration > 0 ? duration : videoElement.duration || 0;
		if (!Number.isFinite(safeDuration) || safeDuration <= 0) return 0;
		const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
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
			isMuted = false;
			volume = volumeBeforeMute > 0 ? volumeBeforeMute : 1;
			videoElement.muted = false;
			videoElement.volume = volume;
		} else {
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
			event.preventDefault();
			onToggleTiming?.();
		} else if ((event.key === 'i' || event.key === 'I') && timingModeEnabled) {
			event.preventDefault();
			onMarkIn?.();
		} else if ((event.key === 'o' || event.key === 'O') && timingModeEnabled) {
			event.preventDefault();
			onMarkOut?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="playback-section">
	<!-- Left: Volume -->
	<div class="volume-section">
		<button
			onclick={toggleMute}
			class="frame-btn"
			disabled={!videoElement}
			aria-label={isMuted ? 'Unmute' : 'Mute'}
		>
			{#if isMuted || volume === 0}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
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
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M7 9v6h4l5 5V4l-5 5H7z" />
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path
						d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
					/>
				</svg>
			{/if}
		</button>
		<input
			type="range"
			min="0"
			max="1"
			step="0.01"
			value={volume}
			oninput={handleVolumeInput}
			disabled={!videoElement}
			class="volume-slider"
			style="--volume-progress: {volume * 100}%"
			aria-label="Volume"
		/>
	</div>

	<!-- Center: Playback controls -->
	<div class="playback-controls">
		<button
			onclick={stepFrameBack}
			disabled={!videoElement || currentTime <= FRAME_EPSILON}
			class="frame-btn"
			aria-label="Previous frame"
			title="Previous frame"
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

		<button
			onclick={togglePlayPause}
			disabled={!videoElement}
			class="play-btn"
			aria-label={isPlaying ? 'Pause' : 'Play'}
		>
			{#if isPlaying}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6"
					viewBox="0 0 24 24"
					fill="currentColor"
				>
					<path d="M8 5v14l11-7z" />
				</svg>
			{/if}
		</button>

		<button
			onclick={stepFrameForward}
			disabled={!videoElement || (duration > 0 && currentTime >= duration - FRAME_EPSILON)}
			class="frame-btn"
			aria-label="Next frame"
			title="Next frame"
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

<style>
	.playback-section {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0;
	}

	.volume-section {
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
	}

	.volume-slider {
		width: 58px;
		height: 4px;
		appearance: none;
		background: linear-gradient(
			to right,
			hsl(var(--at-fg-secondary)) 0%,
			hsl(var(--at-fg-secondary)) var(--volume-progress),
			hsl(var(--at-border)) var(--volume-progress),
			hsl(var(--at-border)) 100%
		);
		border-radius: 2px;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		background: hsl(var(--at-fg));
		border-radius: 50%;
		cursor: pointer;
		transition: transform 150ms ease;
	}

	.volume-slider::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	.volume-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		background: hsl(var(--at-fg));
		border-radius: 50%;
		border: none;
		cursor: pointer;
	}

	.volume-slider:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.playback-controls {
		display: flex;
		align-items: center;
		gap: 3px;
	}

	.frame-btn {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: transparent;
		border: none;
		color: hsl(var(--at-fg-secondary));
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 150ms ease;
		filter: drop-shadow(0 1px 2px hsl(var(--at-shadow) / 0.9));
	}

	.frame-btn:hover:not(:disabled) {
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg));
	}

	.frame-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.frame-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.play-btn {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: hsl(var(--at-accent));
		border: none;
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
		box-shadow: 0 0 16px hsl(var(--at-accent) / 0.28);
	}

	.play-btn:hover:not(:disabled) {
		transform: scale(1.08);
		box-shadow: 0 0 32px hsl(var(--at-accent) / 0.5);
	}

	.play-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.play-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		box-shadow: none;
	}

	@media (max-width: 480px) {
		.volume-slider {
			display: none;
		}
		.play-btn {
			width: 34px;
			height: 34px;
		}
	}
</style>
