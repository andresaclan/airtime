<script lang="ts">
	import {
		clampFrame,
		frameAt,
		frameSeekTime,
		lastFrameIndex,
		type FrameTiming
	} from '$lib/video/frames';
	import { displayedFrame } from '$lib/video/presentedFrame';

	interface Props {
		isPlaying: boolean;
		currentTime: number;
		duration: number;
		timing: FrameTiming;
		volume: number;
		isMuted: boolean;
		videoElement: HTMLVideoElement | null;
		playbackRate?: number;
		onCyclePlaybackRate?: () => void;
		onPlay?: () => void;
		onPause?: () => void;
		onFrameForward?: (time: number) => void;
		onFrameBack?: (time: number) => void;
		onVolumeChange?: (volume: number) => void;
		onMutedChange?: (muted: boolean) => void;
	}

	let {
		isPlaying,
		currentTime,
		duration,
		timing,
		volume = $bindable(1),
		isMuted = $bindable(false),
		videoElement,
		playbackRate = 1,
		onCyclePlaybackRate,
		onPlay,
		onPause,
		onFrameForward,
		onFrameBack,
		onVolumeChange,
		onMutedChange
	}: Props = $props();

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

	function knownDuration(): number {
		return duration > 0 ? duration : (videoElement?.duration ?? 0);
	}

	// Steps from the frame on screen to the middle of the next one (see frames.ts).
	function getSteppedTime(direction: 1 | -1): number {
		if (!videoElement) return currentTime;
		const frame = clampFrame(
			displayedFrame(videoElement, timing) + direction,
			knownDuration(),
			timing
		);
		return frameSeekTime(frame, timing, knownDuration());
	}

	function canStep(direction: 1 | -1, time = currentTime): boolean {
		if (!videoElement) return false;
		const frame = frameAt(time, timing);
		return direction > 0 ? frame < lastFrameIndex(knownDuration(), timing) : frame > 0;
	}

	function step(direction: 1 | -1) {
		if (direction > 0) stepFrameForward();
		else stepFrameBack();
	}

	// Holding a step button repeats it, so walking through a jump on a touchscreen
	// doesn't take a tap per frame. A short press steps once, on click.
	const HOLD_DELAY_MS = 350;
	const HOLD_REPEAT_MS = 80;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let holdRepeat: ReturnType<typeof setInterval> | undefined;
	// Set once a press has turned into a hold, so the click on release doesn't step again.
	let heldDirection: 1 | -1 | null = null;

	function startHold(event: PointerEvent, direction: 1 | -1) {
		if (event.button !== 0) return;
		stopHold();
		heldDirection = null;
		holdTimer = setTimeout(() => {
			heldDirection = direction;
			repeatStep(direction);
			holdRepeat = setInterval(() => repeatStep(direction), HOLD_REPEAT_MS);
		}, HOLD_DELAY_MS);
	}

	// Reads the element's time: the prop only catches up on the next timeupdate.
	function repeatStep(direction: 1 | -1) {
		if (stepInFlight()) return;
		if (videoElement && canStep(direction, videoElement.currentTime)) {
			step(direction);
		} else {
			// The button is about to disable, so no click will follow to clear the hold.
			stopHold();
			heldDirection = null;
		}
	}

	function stopHold() {
		clearTimeout(holdTimer);
		clearInterval(holdRepeat);
	}

	// Clicks without a hold (a tap, the keyboard, assistive tech) step once. Keyboard
	// clicks (detail 0) never follow a press, so a hold released off the button can't eat them.
	function handleStepClick(event: MouseEvent, direction: 1 | -1) {
		if (event.detail !== 0 && heldDirection === direction) {
			heldDirection = null;
			return;
		}
		step(direction);
	}

	$effect(() => stopHold);

	// Repeated steps wait for the last seek to land. Seeking on a long-GOP clip can take
	// longer than a repeat, and a new seek before then restarts the decode: the picture
	// would freeze until the button is released.
	function stepInFlight(): boolean {
		return videoElement?.seeking ?? false;
	}

	function repeatKeyStep(event: KeyboardEvent, direction: 1 | -1) {
		event.preventDefault();
		if (event.repeat && stepInFlight()) return;
		if (canStep(direction, videoElement?.currentTime)) step(direction);
	}

	// Stepping while playing would be overtaken by playback, so a step always pauses first.
	function stepFrameForward() {
		if (!videoElement) return;
		videoElement.pause();
		const newTime = getSteppedTime(1);
		videoElement.currentTime = newTime;
		onFrameForward?.(newTime);
	}

	function stepFrameBack() {
		if (!videoElement) return;
		videoElement.pause();
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
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			(target.isContentEditable ||
				target.closest('input, textarea, select, [contenteditable="true"]'))
		) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
		if (key === ' ' || key === 'k') {
			event.preventDefault();
			togglePlayPause();
		} else if ((event.key === 'ArrowLeft' && event.shiftKey) || event.key === ',') {
			repeatKeyStep(event, -1);
		} else if ((event.key === 'ArrowRight' && event.shiftKey) || event.key === '.') {
			repeatKeyStep(event, 1);
		} else if (key === 'm') {
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

	<!-- Center: frame stepping and play -->
	<div class="playback-controls">
		<button
			onclick={(event) => handleStepClick(event, -1)}
			onpointerdown={(event) => startHold(event, -1)}
			onpointerup={stopHold}
			onpointerleave={stopHold}
			onpointercancel={stopHold}
			disabled={!canStep(-1)}
			class="frame-btn step-btn"
			aria-label="Previous frame"
			title="Previous frame (hold to repeat)"
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
			onclick={(event) => handleStepClick(event, 1)}
			onpointerdown={(event) => startHold(event, 1)}
			onpointerup={stopHold}
			onpointerleave={stopHold}
			onpointercancel={stopHold}
			disabled={!canStep(1)}
			class="frame-btn step-btn"
			aria-label="Next frame"
			title="Next frame (hold to repeat)"
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

	<button
		onclick={onCyclePlaybackRate}
		disabled={!videoElement}
		class="frame-btn rate-btn"
		class:slowed={playbackRate !== 1}
		aria-label="Playback speed {playbackRate}×"
		title="Playback speed (R)"
	>
		{playbackRate}×
	</button>
</div>

<style>
	.playback-section {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 0;
	}

	.volume-section {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.volume-slider {
		width: 64px;
		height: 3px;
		appearance: none;
		background: linear-gradient(
			to right,
			hsl(var(--at-fg) / 0.7) 0%,
			hsl(var(--at-fg) / 0.7) var(--volume-progress),
			hsl(var(--at-fg) / 0.16) var(--volume-progress),
			hsl(var(--at-fg) / 0.16) 100%
		);
		border-radius: 2px;
		cursor: pointer;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 11px;
		height: 11px;
		background: hsl(var(--at-fg));
		border-radius: 50%;
		box-shadow: 0 1px 3px hsl(var(--at-shadow) / 0.6);
		cursor: pointer;
		transition: transform 150ms ease;
	}

	.volume-slider::-webkit-slider-thumb:hover {
		transform: scale(1.2);
	}

	.volume-slider::-moz-range-thumb {
		width: 11px;
		height: 11px;
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
		gap: 4px;
	}

	.frame-btn {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: transparent;
		border: none;
		color: hsl(var(--at-fg-secondary));
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			background 140ms ease,
			color 140ms ease,
			transform 140ms ease;
	}

	.frame-btn :global(svg) {
		width: 18px;
		height: 18px;
	}

	.frame-btn:hover:not(:disabled) {
		background: hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg));
	}

	.frame-btn:active:not(:disabled) {
		transform: scale(0.94);
	}

	.frame-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	/* Long presses repeat the step, so keep them from selecting text or zooming. */
	.step-btn {
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.rate-btn {
		width: auto;
		min-width: 38px;
		height: 24px;
		padding: 0 7px;
		border: 1px solid hsl(var(--at-fg) / 0.12);
		border-radius: 6px;
		font-family: var(--at-font-mono);
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.rate-btn.slowed {
		border-color: hsl(var(--at-fg) / 0.3);
		color: hsl(var(--at-fg));
		background: hsl(var(--at-fg) / 0.1);
	}

	.play-btn {
		width: 40px;
		height: 40px;
		margin-inline: 2px;
		border-radius: 50%;
		background: hsl(var(--at-fg));
		border: none;
		color: hsl(var(--at-bg));
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		box-shadow: 0 4px 14px hsl(var(--at-shadow) / 0.5);
		transition:
			background 140ms ease,
			transform 140ms ease;
	}

	.play-btn :global(svg) {
		width: 20px;
		height: 20px;
	}

	.play-btn:hover:not(:disabled) {
		background: hsl(0 0% 100%);
		transform: scale(1.04);
	}

	.play-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.play-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* Keep the 20px glyph but give frame and mute buttons a 44px touch target. The
	   vertical margin cancels the extra height so the control bar doesn't grow. */
	@media (pointer: coarse) {
		.frame-btn {
			width: 44px;
			height: 44px;
			margin-block: -8px;
		}
		.rate-btn {
			width: auto;
			min-width: 44px;
			height: 32px;
			margin-block: 0;
		}
	}

	/* In a narrow control bar the groups dissolve so the host toolbar grid can place
	   the transport and speed buttons itself. Volume goes: phones ignore it (iOS
	   can't set it at all) and M still mutes. */
	@container control-bar (max-width: 700px) {
		.playback-section {
			display: contents;
		}
		.volume-section {
			display: none;
		}
		.playback-controls {
			gap: 6px;
		}
	}
</style>
