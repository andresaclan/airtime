<script lang="ts">
	import type { Interval, Mark } from '$lib/video/marks';

	interface Props {
		currentTime: number;
		duration: number;
		videoElement: HTMLVideoElement | null;
		isScrubbing?: boolean;
		marks?: Mark[];
		intervals?: Interval[];
		activeMarkId?: string | null;
		onScrubStart?: () => void;
		onScrubEnd?: () => void;
		onSeek?: (time: number) => void;
	}

	let {
		currentTime,
		duration,
		videoElement,
		isScrubbing = $bindable(false),
		marks = [],
		intervals = [],
		activeMarkId = null,
		onScrubStart,
		onScrubEnd,
		onSeek
	}: Props = $props();

	let wasPlayingBeforeScrub = $state(false);
	let trackRef: HTMLDivElement | null = $state(null);
	let isDragging = $state(false);

	let progressPercent = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	function percentOf(time: number): number {
		return duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
	}

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
			void videoElement.play().catch(() => {
				console.warn('Unable to resume video playback after scrubbing');
			});
		}

		onScrubEnd?.();
	}

	function seekTo(time: number) {
		if (!videoElement || duration <= 0) return;
		const nextTime = Math.max(0, Math.min(duration, time));
		videoElement.currentTime = nextTime;
		onSeek?.(nextTime);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (duration <= 0) return;

		const step = Math.max(1 / 30, duration / 100);
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				seekTo(currentTime - step);
				break;
			case 'ArrowRight':
				event.preventDefault();
				seekTo(currentTime + step);
				break;
			case 'Home':
				event.preventDefault();
				seekTo(0);
				break;
			case 'End':
				event.preventDefault();
				seekTo(duration);
				break;
		}
	}

	function handleMarkPointerDown(event: PointerEvent, mark: Mark) {
		// Seek to the exact marked frame instead of the pixel under the pointer.
		event.stopPropagation();
		event.preventDefault();
		seekTo(mark.time);
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
		onkeydown={handleKeyDown}
		role="slider"
		aria-label="Video timeline"
		aria-valuemin={0}
		aria-valuemax={duration}
		aria-valuenow={Math.max(0, Math.min(duration, currentTime))}
		aria-valuetext={`${Math.round(currentTime * 10) / 10} seconds`}
		tabindex="0"
	>
		{#each intervals as interval (interval.from.id)}
			<div
				class="timeline-band timeline-band-{interval.kind}"
				style="left: {percentOf(interval.from.time)}%; width: {percentOf(interval.to.time) -
					percentOf(interval.from.time)}%;"
			></div>
		{/each}

		<!-- Progress fill -->
		<div class="timeline-progress" style="width: {progressPercent}%;"></div>

		<!-- Playhead thumb -->
		<div class="timeline-thumb" style="left: {progressPercent}%;"></div>
	</div>

	{#each marks as mark (mark.id)}
		<button
			type="button"
			class="timeline-mark timeline-mark-{mark.type}"
			class:active={mark.id === activeMarkId}
			style="left: {percentOf(mark.time)}%;"
			onpointerdown={(event) => handleMarkPointerDown(event, mark)}
			aria-label="Go to {mark.type}"
			title="Go to {mark.type}"
		></button>
	{/each}
</div>

<style>
	.timeline-container {
		position: relative;
		padding: 12px 0 4px;
		touch-action: none;
	}

	.timeline-track {
		position: relative;
		height: 3px;
		background: hsl(var(--at-fg) / 0.16);
		border-radius: 2px;
		cursor: pointer;
		transition: height 150ms ease;
	}

	.timeline-track:hover,
	.timeline-track.active {
		height: 4px;
	}

	.timeline-progress {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		background: hsl(var(--at-fg) / 0.45);
		border-radius: 3px;
		pointer-events: none;
	}

	.timeline-thumb {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 10px;
		background: hsl(var(--at-fg));
		border: 2px solid hsl(var(--at-bg));
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 1px 6px hsl(var(--at-shadow) / 0.5);
		pointer-events: none;
		transition: transform 150ms ease;
	}

	.timeline-track:hover .timeline-thumb,
	.timeline-track.active .timeline-thumb {
		transform: translate(-50%, -50%) scale(1.15);
	}

	.timeline-band {
		position: absolute;
		top: 0;
		height: 100%;
		z-index: 2;
		pointer-events: none;
	}

	.timeline-band-flight {
		background: hsl(var(--at-takeoff) / 0.85);
	}

	.timeline-band-contact {
		background: hsl(var(--at-landing) / 0.55);
	}

	.timeline-progress {
		z-index: 1;
	}

	.timeline-thumb {
		z-index: 3;
	}

	/* Marks sit above the track as small flags; the hit area is wider than the glyph. */
	.timeline-mark {
		position: absolute;
		top: 2px;
		z-index: 4;
		width: 14px;
		height: 14px;
		padding: 0;
		border: none;
		background: transparent;
		transform: translateX(-50%);
		cursor: pointer;
	}

	.timeline-mark::before {
		content: '';
		position: absolute;
		left: 50%;
		top: 3px;
		width: 2px;
		height: 12px;
		border-radius: 1px;
		background: var(--mark-color);
		box-shadow: 0 0 0 1px hsl(var(--at-shadow) / 0.6);
		transform: translateX(-50%);
	}

	.timeline-mark::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 0;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--mark-color);
		box-shadow: 0 0 0 1.5px hsl(var(--at-shadow) / 0.7);
		transform: translateX(-50%);
		transition: transform 120ms ease;
	}

	.timeline-mark:hover::after,
	.timeline-mark.active::after {
		transform: translateX(-50%) scale(1.45);
	}

	.timeline-mark-takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	.timeline-mark-landing {
		--mark-color: hsl(var(--at-landing));
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

		/* 44px hit box centred on the same spot the 14px box and glyph occupied. */
		.timeline-mark {
			top: -12.5px;
			width: 44px;
			height: 44px;
		}

		.timeline-mark::before {
			top: 17.5px;
		}

		.timeline-mark::after {
			top: 14.5px;
		}
	}
</style>
