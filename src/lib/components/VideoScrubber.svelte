<script lang="ts">
	// @ts-nocheck
	interface Props {
		currentTime: number;
		duration: number;
		videoElement: HTMLVideoElement | null;
		isScrubbing?: boolean;
		inPoint?: number | null;
		outPoint?: number | null;
		timingModeEnabled?: boolean;
		onScrubStart?: () => void;
		onScrubEnd?: () => void;
		onSeek?: (time: number) => void;
	}

	/** @type {Props} */
	let {
		currentTime,
		duration,
		videoElement,
		isScrubbing = $bindable(false),
		inPoint = null,
		outPoint = null,
		timingModeEnabled = false,
		onScrubStart = () => {},
		onScrubEnd = () => {},
		onSeek = (_time: number) => {}
	} = $props();

	let wasPlayingBeforeScrub = $state(false);
	let trackRef: HTMLDivElement | null = $state(null);
	let isDragging = $state(false);

	let progressPercent = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);
	let inPointPercent = $derived(inPoint !== null && duration > 0 ? (inPoint / duration) * 100 : null);
	let outPointPercent = $derived(outPoint !== null && duration > 0 ? (outPoint / duration) * 100 : null);

	function getTimeFromPosition(clientX: number): number {
		if (!trackRef || duration <= 0) return 0;
		const rect = trackRef.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return percent * duration;
	}

	function handlePointerDown(event: PointerEvent) {
		if (!videoElement || !trackRef) return;
		
		event.preventDefault();
		trackRef.setPointerCapture(event.pointerId);
		
		isScrubbing = true;
		isDragging = true;
		wasPlayingBeforeScrub = !videoElement.paused;

		if (wasPlayingBeforeScrub) {
			videoElement.pause();
		}

		const newTime = getTimeFromPosition(event.clientX);
		videoElement.currentTime = newTime;
		onScrubStart?.();
		onSeek?.(newTime);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isDragging || !videoElement) return;
		
		const newTime = getTimeFromPosition(event.clientX);
		videoElement.currentTime = newTime;
		onSeek?.(newTime);
	}

	function handlePointerUp(event: PointerEvent) {
		if (!isDragging) return;
		
		trackRef?.releasePointerCapture(event.pointerId);
		isDragging = false;
		isScrubbing = false;

		if (wasPlayingBeforeScrub && videoElement) {
			videoElement.play();
		}

		onScrubEnd?.();
	}
</script>

<div class="timeline-container">
	<div 
		bind:this={trackRef}
		class="timeline-track"
		class:active={isDragging}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}
		role="slider"
		aria-label="Video timeline"
		aria-valuemin={0}
		aria-valuemax={duration}
		aria-valuenow={currentTime}
		tabindex="0"
	>
		<!-- Range highlight between in/out points -->
		{#if timingModeEnabled && inPointPercent !== null && outPointPercent !== null}
			<div 
				class="timeline-range"
				style="left: {inPointPercent}%; width: {outPointPercent - inPointPercent}%;"
			></div>
		{/if}

		<!-- Progress fill -->
		<div class="timeline-progress" style="width: {progressPercent}%;"></div>

		<!-- Playhead thumb -->
		<div class="timeline-thumb" style="left: {progressPercent}%;"></div>

		<!-- In point marker -->
		{#if timingModeEnabled && inPointPercent !== null}
			<div class="timeline-marker timeline-marker-in" style="left: {inPointPercent}%;">
				<div class="timeline-marker-line"></div>
				<span class="timeline-marker-label">I</span>
			</div>
		{/if}

		<!-- Out point marker -->
		{#if timingModeEnabled && outPointPercent !== null}
			<div class="timeline-marker timeline-marker-out" style="left: {outPointPercent}%;">
				<div class="timeline-marker-line"></div>
				<span class="timeline-marker-label">O</span>
			</div>
		{/if}
	</div>
</div>

<style>
	.timeline-container {
		padding: 16px 0 8px;
		touch-action: none;
	}

	.timeline-track {
		position: relative;
		height: 6px;
		background: hsl(var(--at-border));
		border-radius: 3px;
		cursor: pointer;
		transition: height 150ms ease;
	}

	.timeline-track:hover,
	.timeline-track.active {
		height: 8px;
	}

	.timeline-progress {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		background: hsl(var(--at-accent));
		border-radius: 3px;
		pointer-events: none;
	}

	.timeline-thumb {
		position: absolute;
		top: 50%;
		width: 18px;
		height: 18px;
		background: hsl(var(--at-accent));
		border: 3px solid white;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 2px 8px hsl(var(--at-shadow) / 0.5);
		pointer-events: none;
		transition: transform 150ms ease, box-shadow 150ms ease;
	}

	.timeline-track:hover .timeline-thumb,
	.timeline-track.active .timeline-thumb {
		transform: translate(-50%, -50%) scale(1.15);
		box-shadow: 0 0 16px hsl(var(--at-accent) / 0.5);
	}

	.timeline-range {
		position: absolute;
		top: 0;
		height: 100%;
		background: hsl(var(--at-accent) / 0.25);
		border-radius: 3px;
		pointer-events: none;
	}

	.timeline-marker {
		position: absolute;
		top: 50%;
		transform: translateX(-50%) translateY(-50%);
		z-index: 5;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.timeline-marker-line {
		width: 3px;
		height: 24px;
		border-radius: 2px;
	}

	.timeline-marker-in .timeline-marker-line {
		background: hsl(var(--at-in));
		box-shadow: 0 0 10px hsl(var(--at-in) / 0.6);
	}

	.timeline-marker-out .timeline-marker-line {
		background: hsl(var(--at-out));
		box-shadow: 0 0 10px hsl(var(--at-out) / 0.6);
	}

	.timeline-marker-label {
		position: absolute;
		top: -20px;
		font-size: 9px;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 4px;
		letter-spacing: 0.5px;
	}

	.timeline-marker-in .timeline-marker-label {
		background: hsl(var(--at-in));
		color: white;
	}

	.timeline-marker-out .timeline-marker-label {
		background: hsl(var(--at-out));
		color: white;
	}

	/* Touch-friendly sizing */
	@media (pointer: coarse) {
		.timeline-track {
			height: 8px;
		}

		.timeline-thumb {
			width: 24px;
			height: 24px;
		}
	}
</style>
