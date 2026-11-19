<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import MarkGlyph from './MarkGlyph.svelte';
	import JumpResults from './JumpResults.svelte';
	import { frameOf, type Mark } from '$lib/video/marks';
	import { bestUnit, bestFlightLabel, unpairedMarks, type JumpUnit } from '$lib/video/jumpUnits';
	import { GUIDE_STEPS, STEP_MARK, stepLabel, type MarkStep } from '$lib/video/guide';
	import { frameLabel, type FrameTiming } from '$lib/video/frames';
	import { formatFrameClock } from '$lib/video/timecode';
	import type { JumpType } from '$lib/session/schema';

	// The video and its controls, with the jump at the playhead beside them: its flight
	// time, contact and marks. The mark on the frame on screen can be moved a frame or
	// removed. Results opens the whole session on its own page.
	//
	// Four layouts, one set of parts:
	// - portrait: a phone upright. The jump sits in one line under the picture.
	// - rail: a phone on its side. The same parts in a column beside the picture.
	// - bottom: a tablet upright. The jump as a card under the controls.
	// - side: a desktop or a tablet on its side. The card as a panel beside the video.
	interface Props {
		/** The picture, with anything laid over it. */
		stage: Snippet;
		/** The marking hint line. */
		hint: Snippet;
		nudgeBlocked: (mark: Mark, direction: number) => string;
		scrubber: Snippet;
		/** The time and frame-rate readout. */
		readout: Snippet;
		/** Play and the frame steppers. */
		controls: Snippet;
		/** The Mark buttons. */
		mark: Snippet;
		units: JumpUnit[];
		marks: Mark[];
		timing: FrameTiming;
		variableFrameRate: boolean;
		/** The session's results are open, in place of the video. */
		results: boolean;
		/** The jump at the playhead, or the last one it passed. */
		active: JumpUnit | undefined;
		/** The mark on the frame on screen. */
		onFrame: Mark | null;
		/** What a mark is called: its step, lower case. */
		markName: (mark: Mark) => string;
		jumpType: JumpType | null;
		timeScale: number;
		title: string;
		titlePlaceholder: string;
		notes: string;
		recordedAt: string;
		canUndo: boolean;
		canRedo: boolean;
		onSeek: (mark: Mark) => void;
		/** From results: back to the video on this jump. */
		onOpenUnit: (unit: JumpUnit) => void;
		/** From results: back to the video on this mark. */
		onOpenMark: (mark: Mark) => void;
		onResults: (show: boolean) => void;
		onNudge: (id: string, frames: number) => void;
		onUndo: () => void;
		onRedo: () => void;
		onRemove: (id: string) => void;
	}

	let {
		stage,
		hint,
		nudgeBlocked,
		scrubber,
		readout,
		controls,
		mark,
		units,
		marks,
		timing,
		variableFrameRate,
		results,
		active,
		onFrame,
		markName,
		jumpType = $bindable(),
		timeScale = $bindable(),
		title = $bindable(),
		titlePlaceholder,
		notes = $bindable(),
		recordedAt = $bindable(),
		canUndo,
		canRedo,
		onSeek,
		onOpenUnit,
		onOpenMark,
		onResults,
		onNudge,
		onUndo,
		onRedo,
		onRemove
	}: Props = $props();

	// Keep in step with the control bar's own container query (700px): the compact
	// layouts are the ones whose bar is a phone's.
	const short = new MediaQuery('(max-height: 500px)');
	const narrow = new MediaQuery('(max-width: 700px)');
	// Beside the video when there's the width, or when a wide window is too short to
	// stack the card under it.
	const wide = new MediaQuery('(min-width: 1100px), (min-width: 900px) and (max-height: 720px)');
	let layout: 'portrait' | 'rail' | 'bottom' | 'side' = $derived(
		short.current ? 'rail' : narrow.current ? 'portrait' : wide.current ? 'side' : 'bottom'
	);
	let compact = $derived(layout === 'portrait' || layout === 'rail');

	let root: HTMLDivElement | null = $state(null);

	let number = $derived(active ? units.indexOf(active) + 1 : 1);
	let completed = $derived(units.filter((unit) => unit.flight));
	// "Best" only means something once there's a jump to beat.
	let best = $derived(completed.length > 1 ? bestUnit(units) : undefined);
	let unpaired = $derived(unpairedMarks(marks, units));
	let slots = $derived(
		GUIDE_STEPS.map((step) => ({
			step,
			label: stepLabel(step, jumpType),
			mark: active?.[step]
		}))
	);
	/** The mark the jump is waiting for, as the Mark button would name it. */
	let nextStep: MarkStep | null = $derived(
		!active?.takeoff ? (active?.plant ? 'takeoff' : 'plant') : active.landing ? null : 'landing'
	);
	let onFrameName = $derived(onFrame ? markName(onFrame) : '');

	const ms = (seconds: number) => Math.round(seconds * 1000);
	const clock = (item: Mark) =>
		formatFrameClock(frameLabel(frameOf(item.time, timing), timing), timing);
	const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

	// What a screen reader hears as the playhead moves between jumps.
	let status = $derived(
		results
			? 'Session results'
			: active?.flight
				? `Jump ${number}: flight time ${ms(active.flight.realSeconds)} milliseconds`
				: ''
	);

	/**
	 * Runs a control that replaces the page (Results, and back). From the keyboard,
	 * focus follows to what took its place; a pointer leaves focus on the page, so Space
	 * still plays the video rather than pressing a button.
	 */
	function act(event: MouseEvent, run: () => void, ...focus: string[]) {
		const fromKeyboard = event.detail === 0;
		run();
		if (!fromKeyboard) return;
		void tick().then(() => {
			for (const selector of focus) {
				const target = root?.querySelector<HTMLElement>(selector);
				if (target) return target.focus();
			}
		});
	}
</script>

{#snippet resultsButton()}
	<button
		class="jw-results"
		data-focus="results"
		onclick={(event) => act(event, () => onResults(true), '.jr-title')}
	>
		Results
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
	</button>
{/snippet}

{#snippet hero()}
	<div class="jw-hero" class:pending={!active?.flight}>
		<span class="jw-hero-label"
			><span class="jw-hero-jump">Jump {number}</span><span class="jw-hero-what">Flight time</span
			></span
		>
		{#key active?.flight?.realSeconds}
			<span class="jw-hero-value jw-pop"
				>{active?.flight ? ms(active.flight.realSeconds) : '–'}<span class="jw-hero-unit"
					>{active?.flight ? 'ms' : ''}</span
				></span
			>
		{/key}
	</div>
{/snippet}

<!-- One line for a phone: the jump's number and flight time. -->
{#snippet summary()}
	<span class="jw-sum" class:pending={!active?.flight}>
		<span class="jw-sum-name">J{number}</span>
		<span class="jw-sum-value"
			>{active?.flight ? ms(active.flight.realSeconds) : '—'}<span class="jw-sum-unit"
				>{active?.flight ? 'ms' : ''}</span
			></span
		>
		{#if active && bestFlightLabel(active, completed, best)}<span class="jw-sum-best"
				>{bestFlightLabel(active, completed, best)}</span
			>{/if}
	</span>
{/snippet}

{#snippet history()}
	<button
		class="jw-btn jw-icon"
		disabled={!canUndo}
		onclick={onUndo}
		aria-label="Undo"
		title="Undo the last mark change"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"
			><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" /></svg
		><span class="jw-wide">Undo</span>
	</button>
	{#if canRedo}
		<button
			class="jw-btn jw-icon jw-redo"
			onclick={onRedo}
			aria-label="Redo"
			title="Redo the mark change"
		>
			<svg viewBox="0 0 24 24" aria-hidden="true"
				><path d="M15 7l4.5 4.5L15 16" /><path d="M19 11.5H9.5a5 5 0 0 0 0 10H12" /></svg
			><span class="jw-wide">Redo</span>
		</button>
	{/if}
{/snippet}

<!-- The mark on the frame on screen: a frame either way, or off. -->
{#snippet markControls(item: Mark)}
	<div class="jw-stepper" role="group" aria-label="Move the {onFrameName}">
		<button
			class="jw-btn jw-quiet"
			data-focus="mark"
			onclick={() => onNudge(item.id, -1)}
			aria-label="Move the {onFrameName} one frame earlier"
			disabled={!!nudgeBlocked(item, -1)}
			title={nudgeBlocked(item, -1) || 'One frame earlier'}>−1</button
		>
		<button
			class="jw-btn jw-quiet"
			onclick={() => onNudge(item.id, 1)}
			aria-label="Move the {onFrameName} one frame later"
			disabled={!!nudgeBlocked(item, 1)}
			title={nudgeBlocked(item, 1) || 'One frame later'}>+1</button
		>
	</div>
	<button
		class="jw-btn jw-icon jw-remove"
		onclick={() => onRemove(item.id)}
		aria-label="Remove the {onFrameName}"
		title="Remove this mark (Backspace)"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg
		><span class="jw-wide">Remove</span>
	</button>
{/snippet}

<div class="jump-workspace" data-layout={layout} data-results={results} bind:this={root}>
	<p class="sr-only" role="status">{status}</p>

	<div class="jw-main viewer-frame">
		<div class="jw-stage">{@render stage()}</div>
		<div class="jw-dock">
			{#if layout !== 'side'}{@render hint()}{/if}
			{#if compact}
				<nav class="jw-strip" aria-label="Jump {number}">
					<div class="jw-strip-in">
						{@render summary()}
						{#if onFrame}
							<span class="jw-strip-edit jw-nudge" class:takeoff={onFrame.type === 'takeoff'}
								>{@render markControls(onFrame)}</span
							>
						{/if}
						<span class="jw-strip-edit">{@render history()}</span>
						{@render resultsButton()}
					</div>
				</nav>
			{/if}
			<div class="control-bar">
				<div class="control-bar-inner">
					{@render scrubber()}
					<div class="control-toolbar">
						<!-- One segmented group behind the frame controls and the Mark buttons. -->
						<span class="transport-dock" aria-hidden="true"></span>
						<!-- The context strip under the controls: where, how fast, how loud. -->
						<span class="context-strip" aria-hidden="true"></span>
						{@render readout()}
						{@render controls()}
						{@render mark()}
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if !compact}
		<aside class="jw-panel" aria-label="Jump {number}">
			<section class="jw-card">
				<div class="jw-card-head">
					<h2 class="jw-card-title">Jump {number}</h2>
					{#if active && bestFlightLabel(active, completed, best)}<span class="jw-badge"
							>{bestFlightLabel(active, completed, best)}</span
						>{/if}
				</div>
				<div class="jw-card-results">{@render resultsButton()}</div>
				{@render hero()}
				<p class="jw-secondary">
					{#if active?.contact}
						<span>Contact <strong>{ms(active.contact.realSeconds)} ms</strong></span>
					{:else if active?.flight}
						<span>No {slots[0].label.toLowerCase()} · contact not measured</span>
					{:else}
						<span>{nextStep ? `Next: ${stepLabel(nextStep, jumpType).toLowerCase()}` : ''}</span>
					{/if}
				</p>
				<div class="jw-slots" role="group" aria-label="Marks of jump {number}">
					{#each slots as slot (slot.step)}
						<button
							class="jw-slot"
							class:takeoff={slot.step === 'takeoff'}
							class:unset={!slot.mark}
							disabled={!slot.mark}
							aria-current={slot.mark && slot.mark.id === onFrame?.id ? 'true' : undefined}
							title={slot.mark ? 'Go to this frame' : undefined}
							onclick={() => slot.mark && onSeek(slot.mark)}
						>
							<span class="jw-slot-glyph"><MarkGlyph type={STEP_MARK[slot.step]} size={16} /></span>
							<span class="jw-slot-label">{slot.label}</span>
							<span class="jw-slot-time">{slot.mark ? clock(slot.mark) : 'Not marked'}</span>
						</button>
					{/each}
				</div>
				<div class="jw-edit">
					{#if onFrame}
						<!-- A mark of this jump is lit in the list above; any other says what it is. -->
						{#if !slots.some((slot) => slot.mark?.id === onFrame.id)}
							<span class="jw-edit-name" class:takeoff={onFrame.type === 'takeoff'}
								>{capital(onFrameName)}</span
							>
						{/if}
						{@render markControls(onFrame)}
					{/if}
					<span class="jw-end">{@render history()}</span>
				</div>
			</section>
			{#if layout === 'side' && units.length > 1}
				<section class="jw-jumps" aria-labelledby="jw-jumps-title">
					<h2 id="jw-jumps-title" class="jw-jumps-title">This video</h2>
					<ol>
						{#each units as unit, i (unit.id)}
							<li>
								<button
									class="jw-jump"
									aria-current={unit.id === active?.id ? 'true' : undefined}
									title="Go to jump {i + 1}"
									onclick={() => onOpenUnit(unit)}
								>
									<span class="jw-jump-name">Jump {i + 1}</span>
									{#if bestFlightLabel(unit, completed, best)}<span class="jw-badge"
											>{bestFlightLabel(unit, completed, best)}</span
										>{/if}
									<span class="jw-jump-value" class:pending={!unit.flight}
										>{#if unit.flight}{ms(unit.flight.realSeconds)}<small>ms</small
											>{:else}—{/if}</span
									>
								</button>
							</li>
						{/each}
					</ol>
				</section>
			{/if}
			{#if layout === 'side'}
				<!-- Beside the controls, so the picture keeps the line the hint took under it. -->
				<div class="jw-panel-hint">{@render hint()}</div>
			{/if}
		</aside>
	{/if}

	{#if results}
		<JumpResults
			{units}
			{unpaired}
			{best}
			{timing}
			{variableFrameRate}
			bind:jumpType
			bind:timeScale
			bind:title
			{titlePlaceholder}
			bind:notes
			bind:recordedAt
			onBack={(event) => act(event, () => onResults(false), '[data-focus="results"]')}
			onOpenUnit={(event, unit) =>
				act(
					event,
					() => onOpenUnit(unit),
					'.jw-stepper button:enabled',
					'.jw-remove:enabled',
					'.mark-primary'
				)}
			onOpenMark={(event, item) =>
				act(
					event,
					() => onOpenMark(item),
					'.jw-stepper button:enabled',
					'.jw-remove:enabled',
					'.mark-primary'
				)}
		/>
	{/if}
</div>

<style>
	.jump-workspace {
		--mark-color: hsl(var(--at-landing));
		/* The width of the Mark buttons' slot in a wide control bar. */
		--mark-slot: 372px;
		display: flex;
		flex: 1 1 auto;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
	}

	.jump-workspace[data-layout='portrait'],
	.jump-workspace[data-layout='bottom'] {
		flex-direction: column;
	}

	.jump-workspace[data-results='true'] > .jw-main,
	.jump-workspace[data-results='true'] > .jw-panel {
		display: none;
	}

	.takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	/* ---- The video and its dock ---- */

	.jw-main {
		display: flex;
		flex: 1 1 0;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}

	.jw-stage {
		position: relative;
		display: flex;
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
		background: hsl(var(--at-stage));
	}

	.jw-stage > :global(:first-child) {
		flex: 1 1 0;
		min-width: 0;
		min-height: 0;
	}

	.jw-dock {
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		min-width: 0;
		background: hsl(var(--at-bg));
		container: jump-dock / inline-size;
	}

	[data-layout='rail'] .jw-main {
		flex-direction: row;
	}

	[data-layout='rail'] .jw-dock {
		flex: 0 0 clamp(300px, 38vw, 340px);
		border-left: 1px solid hsl(var(--at-border));
		overflow-y: auto;
		justify-content: safe space-between;
		overscroll-behavior: contain;
		scrollbar-width: none;
	}

	/* ---- A phone's strip: the jump at the playhead ---- */

	.jw-strip {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		min-width: 0;
	}

	.jw-dock .jw-strip {
		height: 52px;
		border-top: 1px solid hsl(var(--at-border));
	}

	[data-layout='rail'] .jw-dock .jw-strip {
		border-top: none;
	}

	.jw-strip-in {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 8px;
		min-width: 0;
		height: 100%;
		padding: 0 12px 0 16px;
	}

	/* The jump's number and flight time, then the mark's controls and Results. */
	.jw-sum {
		display: inline-flex;
		flex: 1 1 auto;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
		overflow: hidden;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.jw-sum-name {
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		font-weight: 600;
	}

	.jw-sum-value {
		color: hsl(var(--at-fg));
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.jw-sum-unit {
		margin-left: 2px;
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0;
	}

	.jw-sum.pending .jw-sum-value,
	.jw-sum.pending .jw-sum-unit {
		color: hsl(var(--at-fg) / 0.3);
		font-weight: 400;
	}

	.jw-sum-best {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.jw-strip-edit {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 6px;
	}

	.jw-strip-edit .jw-wide {
		display: none;
	}

	.jw-strip-edit .jw-icon,
	.jw-strip-edit .jw-stepper .jw-btn {
		width: 40px;
		padding: 0;
	}

	@media (pointer: coarse) {
		.jw-strip-edit .jw-btn {
			--h: 44px;
		}
		.jw-strip-edit .jw-icon,
		.jw-strip-edit .jw-stepper .jw-btn {
			width: 44px;
		}
	}

	/* Small phones: the jump's number and Best give way to the controls. */
	@container jump-dock (max-width: 380px) {
		.jw-sum-best {
			display: none;
		}
	}

	@container jump-dock (max-width: 340px) {
		.jw-strip-edit .jw-icon,
		.jw-strip-edit .jw-stepper .jw-btn {
			width: 40px;
		}
	}

	@container jump-dock (max-width:420px) {
		.jw-dock .jw-strip {
			height: auto;
			min-height: 44px;
		}
		.jw-strip-in {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			gap: 2px 8px;
			height: auto;
			padding: 3px 10px;
		}
		.jw-strip-in .jw-nudge {
			grid-row: 2;
			grid-column: 1 / -1;
			justify-self: center;
		}
	}
	.jw-results {
		position: relative;
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 4px;
		height: 36px;
		padding: 0 6px 0 12px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jw-results svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: hsl(var(--at-fg-muted));
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* ---- Flight time ---- */

	.jw-hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.jw-hero-label {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 16px;
		white-space: nowrap;
	}

	.jw-hero-value {
		color: hsl(var(--at-fg));
		font-size: 56px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
		white-space: nowrap;
		transform-origin: left center;
	}

	.jw-hero-unit {
		margin-left: 0.14em;
		color: hsl(var(--at-fg-secondary));
		font-size: 0.42em;
		font-weight: 500;
		letter-spacing: 0;
	}

	.jw-hero-jump::after {
		content: ' · ';
		white-space: pre;
	}

	/* Not landed yet: a dash holds the number's place. */
	.jw-hero.pending .jw-hero-value,
	.jw-hero.pending .jw-hero-unit {
		color: hsl(var(--at-fg) / 0.3);
		font-weight: 400;
	}

	/* ---- Buttons: one family, sized by the layout ---- */

	.jw-btn {
		--h: 36px;
		position: relative;
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: var(--h);
		padding: 0 14px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 140ms var(--at-ease),
			border-color 140ms var(--at-ease),
			color 140ms var(--at-ease),
			transform 140ms var(--at-ease);
	}

	.jw-btn svg:not(:global(.mark-glyph)) {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.jw-btn:active:not(:disabled) {
		transform: translateY(1px);
	}

	.jw-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.jw-quiet,
	.jw-icon {
		background: hsl(var(--at-fg) / 0.07);
	}

	.jw-remove {
		color: hsl(var(--at-error));
	}

	.jw-icon {
		font-weight: 500;
	}

	.jw-stepper {
		display: flex;
		flex: 0 0 auto;
		gap: 1px;
	}

	.jw-stepper .jw-btn:first-child {
		border-radius: 10px 4px 4px 10px;
	}

	.jw-stepper .jw-btn:last-child {
		border-radius: 4px 10px 10px 4px;
	}

	.jw-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	@media (hover: hover) {
		.jw-results:hover {
			background: hsl(var(--at-fg) / 0.08);
		}
		.jw-quiet:hover:not(:disabled),
		.jw-icon:hover:not(:disabled) {
			background: hsl(var(--at-fg) / 0.13);
		}
		.jw-slot:hover:not(:disabled):not([aria-current='true']) {
			background: hsl(var(--at-fg) / 0.05);
		}
	}

	/* ---- Regular: the jump as a card, beside or under the video ---- */

	.jw-panel {
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: hsl(var(--at-bg-elevated));
	}

	[data-layout='side'] .jw-panel {
		flex: 0 0 372px;
		border-left: 1px solid hsl(var(--at-border));
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--at-border-hover)) transparent;
	}

	[data-layout='bottom'] .jw-panel {
		flex: 0 0 auto;
		border-top: 1px solid hsl(var(--at-border));
	}

	/* The jump's head with Results beside it, then everything else at full width. */
	.jw-card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		min-width: 0;
		padding: 14px 20px 20px;
	}

	.jw-card > :not(.jw-card-head, .jw-card-results) {
		grid-column: 1 / -1;
	}

	.jw-card-results {
		display: flex;
		justify-content: flex-end;
		margin-right: -8px;
	}

	.jw-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 22px;
	}

	.jw-card-title {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.jw-badge {
		display: inline-flex;
		align-items: center;
		height: 20px;
		padding: 0 8px;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.09);
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
		font-weight: 600;
	}

	.jw-card .jw-hero {
		margin-top: 18px;
		gap: 6px;
	}

	.jw-card .jw-hero-jump {
		display: none;
	}

	.jw-card .jw-hero-label {
		font-size: 13px;
	}

	.jw-secondary {
		min-height: 20px;
		margin: 10px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 20px;
		font-variant-numeric: tabular-nums;
	}

	.jw-secondary strong {
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.jw-slots {
		display: flex;
		flex-direction: column;
		margin-top: 18px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 12px;
		overflow: hidden;
	}

	.jw-slot {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
		height: 44px;
		padding: 0 14px 0 12px;
		border: none;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jw-slot + .jw-slot {
		border-top: 1px solid hsl(var(--at-border));
	}

	.jw-slot-glyph {
		display: grid;
		place-items: center;
		color: var(--mark-color);
	}

	.jw-slot-label {
		font-weight: 500;
	}

	.jw-slot-time {
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.jw-slot.unset .jw-slot-glyph,
	.jw-slot.unset .jw-slot-label {
		color: hsl(var(--at-fg-muted));
	}

	.jw-slot.unset .jw-slot-time {
		color: hsl(var(--at-fg-muted));
		font-family: inherit;
		font-size: 13px;
	}

	.jw-slot:disabled {
		cursor: default;
	}

	/* The mark on the frame on screen. */
	.jw-slot[aria-current='true'] {
		background: hsl(var(--at-fg) / 0.09);
		box-shadow: inset 2px 0 0 var(--mark-color);
	}

	.jw-slot[aria-current='true'] .jw-slot-label {
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.jw-slot:focus-visible {
		outline-offset: -2px;
	}

	.jw-card .jw-edit {
		flex-wrap: wrap;
		min-height: 36px;
		margin-top: 16px;
	}

	.jw-edit-name {
		color: var(--mark-color);
		font-size: 13px;
		font-weight: 600;
	}

	.jw-card .jw-end {
		margin-left: auto;
	}

	.jw-card .jw-icon {
		padding: 0 12px 0 10px;
	}

	/* Every jump in the video, to compare and go to. */
	.jw-jumps {
		padding: 4px 20px 20px;
	}

	.jw-jumps-title {
		margin: 0 0 8px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
	}

	.jw-jumps ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.jw-jump {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		height: 36px;
		padding: 0 12px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	@media (hover: hover) {
		.jw-jump:hover {
			background: hsl(var(--at-fg) / 0.05);
		}
	}

	.jw-jump[aria-current='true'] {
		background: hsl(var(--at-fg) / 0.09);
		color: hsl(var(--at-fg));
		font-weight: 500;
	}

	.jw-jump-value {
		margin-left: auto;
		color: hsl(var(--at-fg));
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.jw-jump-value small {
		margin-left: 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.jw-jump-value.pending {
		color: hsl(var(--at-fg-muted));
		font-weight: 400;
	}

	/* The marking hint at the foot of the panel, level with the controls. It wraps here
	   rather than cutting off. */
	.jw-panel-hint {
		margin-top: auto;
	}

	.jw-panel-hint :global(.marking-hint) {
		align-items: flex-start;
		height: auto;
		min-height: 0;
		padding: 14px 12px 16px 20px;
		border-top: none;
		background: none;
	}

	.jw-panel-hint :global(.hint-text) {
		padding-top: 3px;
		white-space: normal;
	}

	/* Under the video the card lies flat: flight time, the marks, then Results and the
	   mark's controls. It keeps one height, so the picture never resizes. */
	[data-layout='bottom'] .jw-card {
		display: grid;
		grid-template-columns: minmax(150px, 190px) minmax(200px, 1fr) minmax(0, 300px);
		grid-template-rows: 22px auto minmax(0, 1fr);
		column-gap: 24px;
		height: 196px;
		padding: 18px 20px;
	}

	[data-layout='bottom'] .jw-card-head {
		grid-area: 1 / 1;
	}

	[data-layout='bottom'] .jw-card .jw-hero {
		grid-area: 2 / 1;
		margin-top: 14px;
	}

	[data-layout='bottom'] .jw-secondary {
		grid-area: 3 / 1;
	}

	[data-layout='bottom'] .jw-card-results {
		grid-area: 1 / 3;
	}

	[data-layout='bottom'] .jw-slots {
		grid-area: 1 / 2 / 4 / 3;
		align-self: center;
		margin-top: 0;
	}

	[data-layout='bottom'] .jw-card .jw-edit {
		grid-area: 2 / 3 / 4 / 4;
		align-self: center;
		align-content: center;
		justify-content: flex-end;
		margin-top: 0;
	}

	[data-layout='bottom'] .jw-hero-value {
		font-size: 52px;
	}

	/* ---- Touch: 44px targets ---- */

	@media (pointer: coarse) {
		.jw-results::after {
			content: '';
			position: absolute;
			inset: -4px 0;
		}
		.jw-panel .jw-btn {
			--h: 44px;
			padding: 0 16px;
			border-radius: 12px;
			font-size: 15px;
		}
		[data-layout='side'] .jw-slot {
			height: 48px;
		}
	}

	/* ---- Motion ---- */

	.jw-pop {
		display: inline-block;
		animation: jw-pop 320ms var(--at-ease) both;
	}

	@keyframes jw-pop {
		from {
			opacity: 0;
			transform: scale(0.94);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.jw-pop {
			animation: none;
		}
		.jw-btn {
			transition: none;
		}
	}
</style>
