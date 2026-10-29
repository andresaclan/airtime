<script lang="ts">
	import {
		clampFrame,
		frameAt,
		frameLabel,
		frameSeekTime,
		frameStartTime,
		lastFrameIndex,
		type FrameTiming
	} from '$lib/video/frames';
	import {
		HOLD_MS,
		HOLD_SHOW_MS,
		PRECISE_ENTER_PX,
		PRECISE_LEAVE_PX,
		fingerSpeed,
		framesPerPx
	} from '$lib/video/fineScrub';
	import type { ScrubCue } from './HoldCue.svelte';
	import { frameOf, type Interval, type Mark, type MarkType } from '$lib/video/marks';
	import { isWatching, seek, targetTime } from '$lib/video/seek';
	import { formatFrameClock } from '$lib/video/timecode';

	interface Props {
		currentTime: number;
		duration: number;
		timing: FrameTiming;
		videoElement: HTMLVideoElement | null;
		marks?: Mark[];
		intervals?: Interval[];
		activeMarkId?: string | null;
		/** What each mark type is called in the flags' labels. */
		markLabels?: Record<MarkType, string>;
		/**
		 * Touch scrubs by how far the finger moves rather than where it is, and the bar
		 * opens into a capsule with the time while it's held (see `startTouch`).
		 */
		fineTouch?: boolean;
		/** The mark a fine-tuning touch that rests on a frame sets there; none when null. */
		holdMark?: MarkType | null;
		/** A touch fine-tuned to `frame` and rested there for `HOLD_MS`; false if nothing was set. */
		onHold?: (frame: number) => boolean;
		/** A mark's pin was dragged to `frame` and let go; false if it can't go there. */
		onMoveMark?: (mark: Mark, frame: number) => boolean;
		/** What the touch is doing, for HoldCue to show over the picture. */
		cue?: ScrubCue | null;
	}

	let {
		currentTime,
		duration,
		timing,
		videoElement,
		marks = [],
		intervals = [],
		activeMarkId = null,
		markLabels = { takeoff: 'takeoff', landing: 'landing' },
		fineTouch = false,
		holdMark = null,
		onHold,
		onMoveMark,
		cue = $bindable(null)
	}: Props = $props();

	let wasPlayingBeforeScrub = $state(false);
	let trackRef: HTMLDivElement | null = $state(null);
	let containerRef: HTMLDivElement | null = $state(null);
	let isDragging = $state(false);
	/** Where a press that landed on a mark started; null once it moves off into a drag. */
	let markPressX: number | null = null;

	// A press this close to a mark (horizontally) goes to the mark's exact frame. Wider
	// for a fingertip, which also covers the mark next to it, so the nearer one wins.
	const MARK_REACH_PX = { fine: 7, coarse: 22 };
	// How far a press on a mark moves before it scrubs instead.
	const DRAG_THRESHOLD_PX = 6;

	// Touch on the time tool, after iOS Photos: the playhead follows how far the finger
	// moves, never jumping to it, and one width of the bar is the whole clip. Slid up
	// from where it scrubbed, the finger fine-tunes (fineScrub.ts) and a pause there sets
	// `holdMark`. A touch that starts on a pin drags it, and it lands where it's let go.
	let touch: {
		x: number;
		y: number;
		/** Scrubbing the clip: the lowest the finger has been. Fine-tuning: where it rose from. */
		anchorY: number;
		at: number;
		speed: number;
		/** The playhead as a fractional frame, so small moves add up to a step. */
		position: number;
		frame: number;
		pin: Mark | null;
	} | null = null;
	let precise = $state(false);
	/** Where the dragged pin is, until it's let go. */
	let draggedPin: { id: string; type: MarkType; time: number } | null = $state(null);
	// The hold shows filling only after a short pause, so a glance at a frame doesn't mark it.
	let holdState: 'idle' | 'filling' = $state('idle');
	/** The mark just set or moved, while the capsule and its pin say so. */
	let justSet: MarkType | null = $state(null);
	/** A hold can mark once the finger fine-tunes, and again only after the frame changes. */
	let canHold = false;
	let markedThisTouch = false;
	let holdShowTimer: ReturnType<typeof setTimeout> | undefined;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let justSetTimer: ReturnType<typeof setTimeout> | undefined;
	/** The capsule is open while a touch holds the bar. */
	let fineOpen = $state(false);
	/** The pointer scrubbing; others (a second finger) are ignored. */
	let activePointer: number | null = null;

	function stopHoldTimers() {
		clearTimeout(holdShowTimer);
		clearTimeout(holdTimer);
		holdState = 'idle';
	}

	$effect(() => () => {
		stopHoldTimers();
		clearTimeout(justSetTimer);
	});

	function flashSet(type: MarkType) {
		justSet = type;
		clearTimeout(justSetTimer);
		justSetTimer = setTimeout(() => (justSet = null), 1100);
		navigator.vibrate?.(12);
	}

	// The hold starts over when the finger starts fine-tuning and each time the frame changes.
	function restartHold() {
		stopHoldTimers();
		if (!precise || touch?.pin || !holdMark || !onHold || !canHold) return;
		holdShowTimer = setTimeout(() => {
			holdState = 'filling';
			// Centre the finger on the frame so a fingertip's tremble can't tip it over.
			if (touch) touch.position = touch.frame + 0.5;
		}, HOLD_SHOW_MS);
		holdTimer = setTimeout(() => {
			if (!touch || !holdMark || !onHold) return;
			const type = holdMark;
			holdState = 'idle';
			canHold = false;
			if (!onHold(touch.frame)) return;
			markedThisTouch = true;
			flashSet(type);
		}, HOLD_MS);
	}

	function startTouch(event: PointerEvent) {
		const video = videoElement!;
		const pin = markNear(event.clientX, event.clientY, event.pointerType);
		const frame = pin
			? frameOf(pin.time, timing)
			: clampFrame(frameAt(targetTime(video), timing), duration, timing);
		touch = {
			x: event.clientX,
			y: event.clientY,
			anchorY: event.clientY,
			at: event.timeStamp,
			speed: 0,
			position: frame + 0.5,
			frame,
			pin
		};
		if (pin) {
			seek(video, frameSeek(frame), timing);
			draggedPin = { id: pin.id, type: pin.type, time: pin.time };
		}
		precise = false;
		canHold = false;
		markedThisTouch = false;
		justSet = null;
		fineOpen = true;
	}

	function moveTouch(event: PointerEvent) {
		if (!touch || !videoElement || !trackRef) return;
		const rect = trackRef.getBoundingClientRect();
		const wasPrecise = precise;
		if (!precise) {
			touch.anchorY = Math.max(touch.anchorY, event.clientY);
			precise = touch.anchorY - event.clientY > PRECISE_ENTER_PX;
		} else if (event.clientY > touch.anchorY - PRECISE_LEAVE_PX) {
			precise = false;
			touch.anchorY = event.clientY;
		}
		let dx = event.clientX - touch.x;
		// A move mostly up or down (into or out of fine-tuning) leaves the playhead be.
		if (Math.abs(event.clientY - touch.y) > 2 * Math.abs(dx)) dx = 0;
		touch.speed = fingerSpeed(touch.speed, dx, event.timeStamp - touch.at);
		touch.x = event.clientX;
		touch.y = event.clientY;
		touch.at = event.timeStamp;
		const last = lastFrameIndex(duration, timing);
		const rate = precise
			? framesPerPx(touch.speed, timing.fps, last + 1, rect.width)
			: (last + 1) / rect.width;
		touch.position = Math.max(0, Math.min(last + 0.999, touch.position + dx * rate));
		if (precise !== wasPrecise) {
			canHold = precise;
			restartHold();
		}
		const frame = Math.floor(touch.position);
		if (frame === touch.frame) return;
		touch.frame = frame;
		canHold = true;
		seek(videoElement, frameSeek(frame), timing);
		if (touch.pin) draggedPin = { ...draggedPin!, time: frameStartTime(frame, timing) };
		restartHold();
	}

	// A dragged pin lands where it's let go; a tap on one has already gone to its frame.
	function endTouch(event: PointerEvent) {
		stopHoldTimers();
		const ended = touch;
		touch = null;
		fineOpen = false;
		precise = false;
		draggedPin = null;
		const pin = ended?.pin;
		if (!pin || event.type !== 'pointerup' || frameOf(pin.time, timing) === ended.frame) return;
		if (onMoveMark?.(pin, ended.frame)) flashSet(pin.type);
	}

	function capitalize(text: string): string {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	let touchCue: ScrubCue | null = $derived.by(() => {
		if (justSet)
			return { text: `${capitalize(markLabels[justSet])} set`, type: justSet, state: 'set' };
		if (draggedPin) {
			const type = draggedPin.type;
			return { text: `Let go to place ${markLabels[type]}`, type, state: 'hint' };
		}
		if (precise && holdMark) {
			const state = holdState === 'filling' ? 'filling' : 'hint';
			return { text: `Pause to set ${markLabels[holdMark]}`, type: holdMark, state };
		}
		if (precise) return { text: 'Fine-tuning', type: null, state: 'hint' };
		if (!fineOpen) return null;
		if (holdMark) return { text: 'Slide up to mark', type: holdMark, state: 'up' };
		if (marks.length && onMoveMark)
			return { text: 'Drag a pin to move it', type: null, state: 'hint' };
		return null;
	});

	$effect(() => {
		cue = touchCue;
	});

	/** Where a mark's pin is drawn: where it's being dragged, else its own time. */
	function pinTime(mark: Mark): number {
		return draggedPin?.id === mark.id ? draggedPin.time : mark.time;
	}

	let durationLabel = $derived.by(() => {
		const last = lastFrameIndex(duration, timing);
		return Number.isFinite(last) ? formatFrameClock(frameLabel(last, timing) + 1, timing) : '';
	});

	let progressPercent = $derived(duration > 0 ? (currentTime / duration) * 100 : 0);

	// Faint ticks at a round interval, so the distance between marks can be judged.
	const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
	let ticks = $derived.by(() => {
		if (!(duration > 0)) return [];
		const step = TICK_STEPS.find((candidate) => duration / candidate <= 12) ?? 1200;
		const count = Math.floor(duration / step);
		return Array.from({ length: count }, (_, i) => (i + 1) * step).filter((t) => t < duration);
	});
	// Every other tick (or every tick when there are few) carries a seconds label.
	let labelEvery = $derived(ticks.length > 8 ? 2 : 1);

	function tickLabel(seconds: number): string {
		if (seconds >= 60)
			return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;
		return `${Number(seconds.toFixed(2))}s`;
	}

	function percentOf(time: number): number {
		return duration > 0 ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
	}

	// Seeks land on the middle of a frame, so the frame shown is the frame recorded.
	function frameSeek(frame: number): number {
		return frameSeekTime(clampFrame(frame, duration, timing), timing, duration);
	}

	function getTimeFromPosition(clientX: number): number {
		if (!trackRef || duration <= 0) return 0;
		const rect = trackRef.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return frameSeek(frameAt(percent * duration, timing));
	}

	/** The mark nearest the pointer, if the press is on the track or the flags above it. */
	function markNear(clientX: number, clientY: number, pointerType: string): Mark | null {
		if (!trackRef || duration <= 0) return null;
		const rect = trackRef.getBoundingClientRect();
		if (clientY > rect.bottom + 4) return null;
		const reach = pointerType === 'mouse' ? MARK_REACH_PX.fine : MARK_REACH_PX.coarse;
		let nearest: Mark | null = null;
		let nearestDistance = reach;
		for (const mark of marks) {
			const distance = Math.abs(rect.left + (percentOf(mark.time) / 100) * rect.width - clientX);
			if (distance <= nearestDistance) {
				nearest = mark;
				nearestDistance = distance;
			}
		}
		return nearest;
	}

	// The whole band around the track takes the press, not just the thin line: the
	// playhead knob, the flags and the space either side are what a thumb lands on.
	function handlePointerDown(event: PointerEvent) {
		if (!videoElement || !trackRef || !containerRef) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;

		// One finger scrubs; a second one is ignored.
		if (isDragging) return;
		event.preventDefault();
		containerRef.setPointerCapture(event.pointerId);
		activePointer = event.pointerId;

		isDragging = true;
		wasPlayingBeforeScrub = isWatching(videoElement);

		if (wasPlayingBeforeScrub) {
			videoElement.pause();
		}

		// Touch on the time tool: the playhead stays put until the finger moves.
		if (fineTouch && event.pointerType === 'touch' && duration > 0) {
			startTouch(event);
			return;
		}

		// On a mark: its exact frame, until the press moves off into a drag.
		const mark = markNear(event.clientX, event.clientY, event.pointerType);
		markPressX = mark ? event.clientX : null;
		const newTime = mark
			? frameSeek(frameOf(mark.time, timing))
			: getTimeFromPosition(event.clientX);
		seek(videoElement, newTime, timing);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!isDragging || !videoElement || event.pointerId !== activePointer) return;
		if (touch) {
			moveTouch(event);
			return;
		}
		if (markPressX !== null) {
			if (Math.abs(event.clientX - markPressX) < DRAG_THRESHOLD_PX) return;
			markPressX = null;
		}

		const newTime = getTimeFromPosition(event.clientX);
		seek(videoElement, newTime, timing);
	}

	function handlePointerUp(event: PointerEvent) {
		if (!isDragging || event.pointerId !== activePointer) return;

		if (containerRef?.hasPointerCapture(event.pointerId)) {
			containerRef.releasePointerCapture(event.pointerId);
		}
		activePointer = null;
		isDragging = false;
		markPressX = null;
		if (touch) endTouch(event);

		// A touch that set a point leaves the playhead on it.
		if (wasPlayingBeforeScrub && !markedThisTouch && videoElement) {
			void videoElement.play().catch(() => {
				console.warn('Unable to resume video playback after scrubbing');
			});
		}
	}

	function seekToFrame(frame: number) {
		if (!videoElement || duration <= 0) return;
		const nextTime = frameSeek(frame);
		seek(videoElement, nextTime, timing);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (duration <= 0) return;

		const frame = frameAt(videoElement ? targetTime(videoElement) : currentTime, timing);
		const last = lastFrameIndex(duration, timing);
		const step = Math.max(1, Math.round((last + 1) / 100));
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				seekToFrame(frame - step);
				break;
			case 'ArrowRight':
				event.preventDefault();
				seekToFrame(frame + step);
				break;
			case 'Home':
				event.preventDefault();
				seekToFrame(0);
				break;
			case 'End':
				event.preventDefault();
				seekToFrame(last);
				break;
		}
	}
</script>

<!-- Pointer input lands on the whole band (see handlePointerDown); the track is the
     slider for keyboards and assistive tech, and the flags are buttons for the same. -->
<div
	bind:this={containerRef}
	class="timeline-container"
	class:dragging={isDragging}
	class:fine={fineTouch}
	class:open={fineOpen}
	class:precise
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
	onlostpointercapture={handlePointerUp}
	role="presentation"
>
	{#if fineTouch}
		<!-- Held, the bar opens into a capsule with the time, as iOS Photos' does. What
		     the finger can do shows over the picture (HoldCue), where the thumb can't hide it. -->
		<div class="capsule" aria-hidden="true">
			<span class="capsule-time"
				>{formatFrameClock(frameLabel(frameAt(currentTime, timing), timing), timing)}</span
			>
			<span class="capsule-time capsule-duration">{durationLabel}</span>
		</div>
	{/if}

	<div
		bind:this={trackRef}
		class="timeline-track"
		class:active={isDragging}
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
				style="left: {Math.min(
					percentOf(pinTime(interval.from)),
					percentOf(pinTime(interval.to))
				)}%; width: {Math.abs(
					percentOf(pinTime(interval.to)) - percentOf(pinTime(interval.from))
				)}%;"
			></div>
		{/each}

		<!-- Progress fill -->
		<div class="timeline-progress" style="width: {progressPercent}%;"></div>

		<!-- Playhead thumb -->
		<div class="timeline-thumb" style="left: {progressPercent}%;"></div>
	</div>

	<div class="timeline-ticks" aria-hidden="true">
		{#each ticks as tick, i (tick)}<span class="tick" style="left: {percentOf(tick)}%;"
				>{#if (i + 1) % labelEvery === 0}<span class="tick-label">{tickLabel(tick)}</span
					>{/if}</span
			>{/each}
	</div>

	{#each marks as mark (mark.id)}
		<button
			type="button"
			class="timeline-mark timeline-mark-{mark.type}"
			class:active={mark.id === activeMarkId}
			class:just-set={justSet === mark.type}
			class:dragged={draggedPin?.id === mark.id}
			style="left: {percentOf(pinTime(mark))}%;"
			onclick={() => seekToFrame(frameOf(mark.time, timing))}
			aria-label="Go to {markLabels[mark.type]}"
			title="Go to {markLabels[mark.type]}"
		></button>
	{/each}
</div>

<style>
	.timeline-container {
		position: relative;
		padding: 12px 0 18px;
		cursor: pointer;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.timeline-ticks {
		position: absolute;
		right: 0;
		bottom: 2px;
		left: 0;
		height: 14px;
		pointer-events: none;
	}

	.tick {
		position: absolute;
		top: 0;
		width: 1px;
		height: 4px;
		background: hsl(var(--at-fg) / 0.2);
	}

	.tick-label {
		position: absolute;
		top: 4px;
		left: 50%;
		color: hsl(var(--at-fg-muted));
		font-family: var(--at-font-mono);
		font-size: 9px;
		line-height: 1;
		white-space: nowrap;
		transform: translateX(-50%);
	}

	.timeline-track {
		position: relative;
		height: 6px;
		background: hsl(var(--at-fg) / 0.14);
		border-radius: 2px;
		cursor: pointer;
		transition: height 150ms ease;
	}

	.timeline-container:hover .timeline-track,
	.timeline-track.active {
		height: 8px;
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

	/* A tall playhead bar reads as a precise position, not a volume knob. */
	.timeline-thumb {
		position: absolute;
		top: 50%;
		width: 3px;
		height: 20px;
		background: hsl(var(--at-fg));
		border-radius: 2px;
		transform: translate(-50%, -50%);
		box-shadow: 0 1px 6px hsl(var(--at-shadow) / 0.5);
		pointer-events: none;
		transition: transform 150ms ease;
	}

	.timeline-thumb::before {
		content: '';
		position: absolute;
		top: -4px;
		left: 50%;
		width: 11px;
		height: 11px;
		border: 2px solid hsl(var(--at-bg));
		border-radius: 50%;
		background: hsl(var(--at-fg));
		transform: translateX(-50%);
	}

	.timeline-container:hover .timeline-thumb,
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
	/* The band picks the nearest flag (markNear), so overlapping flags can't steal
	   each other's taps; the buttons are there for keyboards and screen readers. */
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
		pointer-events: none;
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

	.timeline-mark:focus-visible::after,
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
			width: 4px;
			height: 24px;
		}

		.timeline-thumb::before {
			width: 16px;
			height: 16px;
			top: -6px;
		}

		/* A 44px band for a thumb, and clear of the screen edge, where Safari's
		   back swipe starts. Flags move down with the track. */
		.timeline-container {
			margin-inline: 8px;
			padding: 16px 0 20px;
		}

		.timeline-mark {
			top: 6px;
		}

		.tick-label {
			font-size: 11px;
		}
	}

	/* Fine touch (the time tool on a touchscreen): a plain pill at rest, as iOS
	   Photos' bar is, that opens into a capsule with the time while it's held. The
	   track keeps the same box open or closed, so nothing under it moves. */
	.fine .timeline-track {
		height: 8px;
		margin-block: 3px;
		border-radius: 4px;
		background: hsl(var(--at-fg) / 0.16);
		transition:
			height 200ms var(--at-ease),
			margin 200ms var(--at-ease),
			border-radius 200ms var(--at-ease);
	}

	.fine.open .timeline-track {
		height: 14px;
		margin-block: 0;
		border-radius: 7px;
	}

	.fine .timeline-progress {
		border-radius: inherit;
		background: hsl(var(--at-fg) / 0.88);
	}

	.fine .timeline-band {
		border-radius: 2px;
	}

	/* The fill's edge is the playhead, as in iOS. */
	.fine .timeline-thumb {
		display: none;
	}

	.capsule {
		position: absolute;
		z-index: 0;
		inset: -30px -10px 2px;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
		padding: 10px 14px 0;
		border: 1px solid hsl(var(--at-fg) / 0.08);
		border-radius: 24px;
		background: hsl(var(--at-surface) / 0.94);
		box-shadow: 0 8px 28px hsl(var(--at-shadow) / 0.5);
		opacity: 0;
		transform: scale(0.97, 0.9);
		transform-origin: 50% 70%;
		pointer-events: none;
		backdrop-filter: blur(14px);
		transition:
			opacity 160ms var(--at-ease),
			transform 220ms var(--at-ease);
	}

	.open .capsule {
		opacity: 1;
		transform: none;
	}

	.fine .timeline-track,
	.fine .timeline-mark {
		z-index: 1;
	}

	.capsule-time {
		flex: 1 1 0;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		line-height: 24px;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}

	.capsule-duration {
		color: hsl(var(--at-fg-muted));
		text-align: right;
	}

	/* Points are pins through the track, so they read on the thick bar. */
	.fine .timeline-mark {
		top: 13px;
		height: 20px;
	}

	.fine .timeline-mark::before {
		top: 0;
		width: 4px;
		height: 20px;
		border-radius: 2px;
		box-shadow: 0 0 0 1.5px hsl(var(--at-bg));
	}

	.fine .timeline-mark::after {
		top: 50%;
		width: 12px;
		height: 12px;
		background: transparent;
		box-shadow: 0 0 0 2px var(--mark-color);
		opacity: 0;
		transform: translate(-50%, -50%);
	}

	/* A pin in the hand stands taller, with a ring around it. */
	.fine .timeline-mark.dragged::before {
		transform: translateX(-50%) scaleY(1.35);
	}

	.fine .timeline-mark.dragged::after {
		opacity: 0.7;
		transform: translate(-50%, -50%) scale(1.6);
	}

	/* Fine-tuning: the capsule rises a little, as if lifted by the finger. */
	.precise .capsule {
		border-color: hsl(var(--at-fg) / 0.22);
		transform: translateY(-4px);
	}

	/* A point just set drops in, and a ring goes out from it. */
	.fine .timeline-mark.just-set::before {
		animation: pin-drop 320ms var(--at-ease);
	}

	.fine .timeline-mark.just-set::after {
		animation: pin-ring 650ms var(--at-ease);
	}

	@keyframes pin-drop {
		0% {
			transform: translateX(-50%) scaleY(0.2);
		}
		60% {
			transform: translateX(-50%) scaleY(1.25);
		}
		100% {
			transform: translateX(-50%) scaleY(1);
		}
	}

	@keyframes pin-ring {
		0% {
			opacity: 0.9;
			transform: translate(-50%, -50%) scale(0.6);
		}
		100% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(3.2);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.capsule,
		.fine .timeline-track {
			transition: none;
		}
		.fine .timeline-mark.just-set::before,
		.fine .timeline-mark.just-set::after {
			animation: none;
		}
	}
</style>
