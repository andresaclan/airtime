<script lang="ts">
	import { TIME_SCALES } from '$lib/session/schema';
	import { frameLabel, type FrameTiming } from '$lib/video/frames';
	import { frameOf, type Mark } from '$lib/video/marks';
	import { formatClock, formatFrameClock } from '$lib/video/timecode';
	import { elapsed, findPoint, type TimerPoint } from '$lib/video/timer';

	interface Props {
		marks: Mark[];
		timing: FrameTiming;
		/** Points wait for the frame rate; `failed` means they never can be set. */
		frameRate: 'detecting' | 'known' | 'failed';
		timeScale: number;
		/** Points are set by a hold on the timeline (a touchscreen), so say that instead. */
		holdToMark?: boolean;
		onSeek: (time: number) => void;
		onClear: () => void;
	}

	let {
		marks,
		timing,
		frameRate,
		timeScale = $bindable(),
		holdToMark = false,
		onSeek,
		onClear
	}: Props = $props();

	let inMark = $derived(findPoint(marks, 'in'));
	let outMark = $derived(findPoint(marks, 'out'));
	let result = $derived(elapsed(marks, timing, timeScale));

	function pointClock(mark: Mark): string {
		return formatFrameClock(frameLabel(frameOf(mark.time, timing), timing), timing);
	}

	// Phones lay the band out with display: contents, so the live region is its own text.
	let announcement = $derived(
		result
			? `${formatElapsed(result.seconds).value} seconds, ${result.frames} frames`
			: inMark
				? 'In point set'
				: outMark
					? 'Out point set'
					: ''
	);

	// Under a minute reads as seconds to the millisecond; longer spans as a clock.
	function formatElapsed(seconds: number): { value: string; unit: string } {
		return seconds < 60
			? { value: seconds.toFixed(3), unit: 's' }
			: { value: formatClock(seconds), unit: '' };
	}
</script>

{#snippet press(point: TimerPoint)}
	<span class="tr-key tr-key-{point}"
		><span class="tr-dot"></span>{point === 'in' ? 'In' : 'Out'}<kbd
			>{point === 'in' ? 'I' : 'O'}</kbd
		></span
	>
{/snippet}

{#snippet chip(point: TimerPoint, mark: Mark)}
	<button
		class="tr-point tr-point-{point}"
		onclick={() => onSeek(mark.time)}
		title="Go to the {point} point"
	>
		<span class="tr-dot"></span><span class="tr-point-name">{point === 'in' ? 'In' : 'Out'}</span
		><span class="tr-point-clock">{pointClock(mark)}</span>
	</button>
{/snippet}

<section class="timer-readout" class:failed={frameRate === 'failed'} aria-label="Elapsed time">
	{#if frameRate === 'failed'}
		<p class="tr-text" role="status">
			<strong>This video can't be timed.</strong> Its frame rate couldn't be read or measured. Try the
			original file from your camera.
		</p>
	{:else}
		<p class="sr-only" aria-live="polite">{announcement}</p>
		<div class="tr-main">
			{#if frameRate === 'detecting'}
				<p class="tr-text tr-wait">Reading the video's frame rate — points unlock in a moment.</p>
			{:else if result}
				{@const shown = formatElapsed(result.seconds)}
				<p class="tr-result">
					<span class="tr-stat tr-stat-primary">
						<span class="tr-label">Time</span>
						<span class="tr-value"
							>{shown.value}{#if shown.unit}<small>{shown.unit}</small>{/if}</span
						>
					</span>
					<span class="tr-stat">
						<span class="tr-label">Frames</span>
						<span class="tr-value">{result.frames}</span>
					</span>
				</p>
				<div class="tr-points">
					{#if inMark}{@render chip('in', inMark)}{/if}
					<span class="tr-arrow" aria-hidden="true">{result.reversed ? '←' : '→'}</span>
					{#if outMark}{@render chip('out', outMark)}{/if}
				</div>
			{:else if holdToMark}
				<!-- The bar sets the points: scrub to a frame and pause there. -->
				{#if inMark}<div class="tr-points">{@render chip('in', inMark)}</div>{/if}
				{#if outMark}<div class="tr-points">{@render chip('out', outMark)}</div>{/if}
				<p class="tr-text">
					{#if inMark}
						<strong>Slide on to the end frame</strong> and pause there to set {@render press(
							'out'
						)}.
					{:else if outMark}
						<strong>Slide to the start frame</strong> and pause there to set {@render press('in')}.
					{:else}
						<strong>Hold the bar and slide to the start frame.</strong> Pause there to set
						{@render press('in')}, then do the same at the end.
					{/if}
				</p>
			{:else if inMark}
				<div class="tr-points">{@render chip('in', inMark)}</div>
				<p class="tr-text">
					<strong>Step to the end frame</strong>, then {@render press('out')}.
				</p>
			{:else if outMark}
				<div class="tr-points">{@render chip('out', outMark)}</div>
				<p class="tr-text">
					<strong>Step to the start frame</strong>, then {@render press('in')}.
				</p>
			{:else}
				<p class="tr-text">
					<strong>Step to the start frame</strong> and {@render press('in')}, then the end frame and
					{@render press('out')}.
				</p>
			{/if}
		</div>
		<div class="tr-tools">
			<select class="tr-select" bind:value={timeScale} aria-label="Footage">
				{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}>{scale.label}</option
					>{/each}
			</select>
			{#if marks.length}
				<button class="tr-clear" onclick={onClear} title="Clear both points">Clear</button>
			{/if}
		</div>
	{/if}
</section>

<style>
	/* A band between the picture and its controls, where the time reads out. */
	.timer-readout {
		position: relative;
		z-index: 31;
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 8px 14px;
		min-height: 56px;
		padding: 8px 14px;
		border-top: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg-secondary));
		font-size: 14px;
		line-height: 22px;
		font-variant-numeric: tabular-nums;
	}

	.timer-readout.failed {
		background: hsl(var(--at-warning) / 0.07);
	}

	.tr-main {
		display: flex;
		flex: 1 1 auto;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 14px;
		min-width: 0;
	}

	.tr-text {
		margin: 0;
	}

	.tr-text strong {
		color: hsl(var(--at-fg));
		font-weight: 500;
	}

	.tr-wait {
		color: hsl(var(--at-fg-muted));
	}

	/* Label over value, as in the full app's results summary: labels share the first
	   row and values the second, so they line up. */
	.tr-result {
		display: grid;
		grid-template-rows: auto auto;
		grid-auto-flow: column;
		column-gap: 24px;
		row-gap: 2px;
		margin: 0;
	}

	.tr-stat {
		display: contents;
	}

	.tr-label {
		align-self: end;
	}

	.tr-stat .tr-value {
		align-self: last baseline;
	}

	.tr-label {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
		line-height: 14px;
	}

	.tr-value {
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		line-height: 20px;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.tr-stat-primary .tr-value {
		font-size: 22px;
		line-height: 26px;
	}

	.tr-value small {
		margin-left: 3px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
	}

	.tr-points {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.tr-arrow {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.tr-point-in,
	.tr-key-in {
		--mark-color: hsl(var(--at-takeoff));
	}

	.tr-point-out,
	.tr-key-out {
		--mark-color: hsl(var(--at-landing));
	}

	.tr-point {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 8px;
		border: 1px solid hsl(var(--at-fg) / 0.08);
		border-radius: 6px;
		background: hsl(var(--at-fg) / 0.035);
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}

	.tr-point-name {
		color: hsl(var(--at-fg));
		font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
	}

	@media (hover: hover) {
		.tr-point:hover {
			border-color: color-mix(in srgb, var(--mark-color) 45%, transparent);
			color: hsl(var(--at-fg));
		}
	}

	.tr-dot {
		flex: 0 0 auto;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--mark-color);
	}

	/* The button to press, drawn as it looks in the dock below. */
	.tr-key {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		margin: 0 1px;
		padding: 0 4px 0 8px;
		border: 1px solid color-mix(in srgb, var(--mark-color) 45%, transparent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--mark-color) 10%, transparent);
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 500;
		line-height: 1;
		vertical-align: middle;
		white-space: nowrap;
	}

	.tr-key kbd {
		display: inline-grid;
		place-items: center;
		min-width: 16px;
		height: 16px;
		color: hsl(var(--at-fg-muted));
		font:
			500 11px/1 var(--at-font-mono),
			monospace;
	}

	.tr-tools {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 6px;
		margin-left: auto;
	}

	.tr-select {
		field-sizing: content;
		appearance: none;
		height: 28px;
		padding: 0 26px 0 10px;
		border: 1px solid hsl(var(--at-fg) / 0.08);
		border-radius: var(--at-radius);
		background: hsl(var(--at-fg) / 0.035)
			url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa0aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E")
			right 7px center / 13px no-repeat;
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.tr-select:focus-visible {
		border-color: hsl(var(--at-accent));
		box-shadow: 0 0 0 3px hsl(var(--at-accent) / 0.2);
	}

	.tr-clear {
		height: 28px;
		padding: 0 10px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: hsl(var(--at-fg-muted));
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}

	@media (hover: hover) {
		.tr-select:hover {
			border-color: hsl(var(--at-fg) / 0.16);
		}

		.tr-clear:hover {
			background: hsl(var(--at-fg) / 0.06);
			color: hsl(var(--at-fg));
		}
	}

	/* Touch screens have no keys to show, as on the dock's buttons. */
	@media (hover: none) and (pointer: coarse) {
		.tr-key kbd {
			display: none;
		}
	}

	/* Touch: 44px hit areas on the small buttons. */
	@media (pointer: coarse) {
		.tr-point,
		.tr-clear,
		.tr-select {
			position: relative;
			height: 32px;
		}

		.tr-clear {
			border: 1px solid hsl(var(--at-border-hover));
			border-radius: var(--at-radius);
			color: hsl(var(--at-fg-secondary));
			font-weight: 500;
		}

		.tr-point::after,
		.tr-clear::after {
			content: '';
			position: absolute;
			inset: -7px -1px;
		}
	}

	/* Phones held upright: the band becomes a sheet resting on the bottom edge under
	   the In and Out buttons, as the full app's results sheet does. What to do next,
	   or the time, with the footage and Clear beside it. The point chips step aside:
	   a tap on a point's flag on the timeline goes to its frame. */
	@media (max-width: 900px) and (min-height: 501px) {
		/* The frame runs to the bottom so the sheet can rest there, under a landscape
		   video too. */
		:global(.viewer-column > .viewer-frame:has(> .timer-readout)) {
			flex: 1 1 auto;
		}

		.timer-readout {
			order: 1;
			flex-wrap: wrap;
			gap: 10px 8px;
			min-height: 64px;
			margin-top: auto;
			padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
			border: 1px solid hsl(var(--at-border));
			border-width: 1px 0 0;
			border-radius: 14px 14px 0 0;
			font-size: 13px;
			line-height: 20px;
		}

		.tr-main {
			display: contents;
		}

		.tr-text {
			flex: 1 1 0;
			min-width: 0;
			color: hsl(var(--at-fg-secondary));
		}

		.tr-text strong {
			color: inherit;
			font-weight: inherit;
		}

		/* The buttons to press are right below; here they are just their names. */
		.tr-key {
			gap: 5px;
			height: auto;
			margin: 0;
			padding: 0;
			border: none;
			background: none;
			font-size: inherit;
			vertical-align: baseline;
		}

		.tr-key .tr-dot {
			align-self: center;
		}

		.tr-key kbd,
		.tr-points {
			display: none;
		}

		.tr-result {
			flex: 1 1 auto;
		}
	}
</style>
