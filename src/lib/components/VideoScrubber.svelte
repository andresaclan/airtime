<script lang="ts">
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

	let {
		currentTime,
		duration,
		videoElement,
		isScrubbing = $bindable(false),
		inPoint = null,
		outPoint = null,
		timingModeEnabled = false,
		onScrubStart,
		onScrubEnd,
		onSeek
	}: Props = $props();

	let wasPlayingBeforeScrub = $state(false);
	let scrubberRef: HTMLInputElement | null = $state(null);

	// Calculate progress percentage for styling
	let progressPercent = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	// Calculate in/out point positions as percentages
	let inPointPercent = $derived(
		inPoint !== null && duration > 0 ? (inPoint / duration) * 100 : null
	);
	let outPointPercent = $derived(
		outPoint !== null && duration > 0 ? (outPoint / duration) * 100 : null
	);

	function handleScrubStart() {
		if (!videoElement) return;

		isScrubbing = true;
		wasPlayingBeforeScrub = !videoElement.paused;

		if (wasPlayingBeforeScrub) {
			videoElement.pause();
		}

		onScrubStart?.();
	}

	function handleScrubbing(event: Event) {
		const target = event.target as HTMLInputElement;
		const newTime = parseFloat(target.value);

		if (videoElement) {
			videoElement.currentTime = newTime;
		}

		onSeek?.(newTime);
	}

	function handleScrubEnd() {
		if (!videoElement) return;

		isScrubbing = false;

		if (wasPlayingBeforeScrub) {
			videoElement.play();
		}

		onScrubEnd?.();
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!videoElement || !duration) return;

		const step = duration / 100; // 1% of video duration

		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			const newTime = Math.max(0, videoElement.currentTime - step);
			videoElement.currentTime = newTime;
			onSeek?.(newTime);
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			const newTime = Math.min(duration, videoElement.currentTime + step);
			videoElement.currentTime = newTime;
			onSeek?.(newTime);
		}
	}
</script>

<div class="w-full px-4 py-3">
	<div class="relative">
		<!-- Range highlight overlay (when timing mode is enabled with both points set) -->
		{#if timingModeEnabled && inPointPercent !== null && outPointPercent !== null}
			<div
				class="range-highlight pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2"
				style="left: {inPointPercent}%; width: {outPointPercent - inPointPercent}%;"
			></div>
		{/if}

		<input
			bind:this={scrubberRef}
			type="range"
			min="0"
			max={duration || 0}
			step="0.001"
			value={currentTime}
			oninput={handleScrubbing}
			onmousedown={handleScrubStart}
			ontouchstart={handleScrubStart}
			onmouseup={handleScrubEnd}
			ontouchend={handleScrubEnd}
			onkeydown={handleKeyDown}
			class="scrubber h-1.5 w-full cursor-pointer appearance-none"
			style="--progress: {progressPercent}%"
			aria-label="Video timeline"
			aria-valuemin={0}
			aria-valuemax={duration}
			aria-valuenow={currentTime}
		/>

		<!-- In point marker -->
		{#if timingModeEnabled && inPointPercent !== null}
			<div class="marker marker-in" style="left: {inPointPercent}%;">
				<div class="marker-line"></div>
				<div class="marker-label">In</div>
			</div>
		{/if}

		<!-- Out point marker -->
		{#if timingModeEnabled && outPointPercent !== null}
			<div class="marker marker-out" style="left: {outPointPercent}%;">
				<div class="marker-line"></div>
				<div class="marker-label">Out</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.scrubber {
		background: linear-gradient(
			to right,
			hsl(var(--at-accent)) 0%,
			hsl(var(--at-accent)) var(--progress),
			hsl(var(--at-border)) var(--progress),
			hsl(var(--at-border)) 100%
		);
		border-radius: 4px;
		transition: height 150ms ease;
	}

	.scrubber::-webkit-slider-thumb {
		appearance: none;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: hsl(var(--at-accent));
		cursor: pointer;
		border: 3px solid white;
		box-shadow: 0 2px 8px hsl(var(--at-shadow) / 0.3);
		transition:
			transform 150ms ease,
			box-shadow 150ms ease;
	}

	.scrubber::-webkit-slider-thumb:hover {
		transform: scale(1.15);
		box-shadow: 0 4px 12px hsl(var(--at-shadow) / 0.4);
	}

	.scrubber::-webkit-slider-thumb:active {
		transform: scale(1.05);
	}

	.scrubber::-moz-range-thumb {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: hsl(var(--at-accent));
		cursor: pointer;
		border: 3px solid white;
		box-shadow: 0 2px 8px hsl(var(--at-shadow) / 0.3);
		transition:
			transform 150ms ease,
			box-shadow 150ms ease;
	}

	.scrubber::-moz-range-thumb:hover {
		transform: scale(1.15);
		box-shadow: 0 4px 12px hsl(var(--at-shadow) / 0.4);
	}

	/* Increase touch target on mobile */
	@media (pointer: coarse) {
		.scrubber {
			height: 8px;
		}

		.scrubber::-webkit-slider-thumb {
			width: 28px;
			height: 28px;
		}

		.scrubber::-moz-range-thumb {
			width: 28px;
			height: 28px;
		}
	}

	/* Range highlight between in/out points */
	.range-highlight {
		background: hsl(var(--at-accent) / 0.25);
		border-radius: 4px;
		z-index: 1;
	}

	/* Marker styles */
	.marker {
		position: absolute;
		top: 50%;
		transform: translateX(-50%);
		z-index: 10;
		pointer-events: none;
	}

	.marker-line {
		position: absolute;
		top: -10px;
		left: 50%;
		transform: translateX(-50%);
		width: 3px;
		height: 28px;
		border-radius: 2px;
	}

	.marker-in .marker-line {
		background: hsl(var(--at-success));
	}

	.marker-out .marker-line {
		background: hsl(var(--at-error));
	}

	.marker-label {
		position: absolute;
		top: -26px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 10px;
		font-weight: 700;
		padding: 3px 8px;
		background: hsl(var(--at-surface));
		border: 1px solid;
		border-radius: 6px;
		white-space: nowrap;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.marker-in .marker-label {
		color: hsl(var(--at-success));
		border-color: hsl(var(--at-success));
	}

	.marker-out .marker-label {
		color: hsl(var(--at-error));
		border-color: hsl(var(--at-error));
	}
</style>
