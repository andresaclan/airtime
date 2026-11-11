<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import MarkGlyph from './MarkGlyph.svelte';
	import JumpResults from './JumpResults.svelte';
	import { frameOf, type Mark } from '$lib/video/marks';
	import {
		bestUnit,
		unitStep,
		unpairedMarks,
		type JumpUnit,
		type WorkspaceMode
	} from '$lib/video/jumpUnits';
	import { GUIDE_STEPS, STEP_MARK, stepLabel, type MarkStep } from '$lib/video/guide';
	import { frameLabel, type FrameTiming } from '$lib/video/frames';
	import { formatFrameClock } from '$lib/video/timecode';
	import type { JumpType } from '$lib/session/schema';

	// The workspace around one jump. The video and its controls stay where they are;
	// what changes is the jump's own part: marking it (capture), its flight time once it
	// lands (complete), correcting its marks (review), and the session's results.
	//
	// Four layouts, one set of parts:
	// - portrait: a phone upright. The jumps sit in a strip under the picture and the
	//   jump's actions take the Mark button's place, so the picture never resizes.
	// - rail: a phone on its side. The same parts in a column beside the picture.
	// - bottom: a tablet upright. The whole jump as a card under the controls.
	// - side: a desktop or a tablet on its side. The card as a panel beside the video.
	interface Props {
		/** The picture, with anything laid over it. */
		stage: Snippet;
		/** The marking hint line. */
		hint: Snippet;
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
		mode: WorkspaceMode;
		/** The jump in the workspace; null for a jump with no marks yet. */
		activeId: string | null;
		/** The mark being corrected. It stays selected while the playhead moves away. */
		selectedId: string | null;
		/** Review only: the active jump's missing mark chosen to be added. */
		emptySlot: MarkStep | null;
		/** The frame on screen. */
		frame: number;
		/** Whether the frame on screen can take the mark `emptySlot` names. */
		canPlace: boolean;
		jumpType: JumpType | null;
		timeScale: number;
		title: string;
		titlePlaceholder: string;
		notes: string;
		recordedAt: string;
		canUndo: boolean;
		canRedo: boolean;
		/** Opens a jump to be corrected; `fill` opens it on its missing plant step, if it has none. */
		onSelectUnit: (unit: JumpUnit, fill?: boolean) => void;
		onSelectMark: (mark: Mark) => void;
		onSelectSlot: (step: MarkStep) => void;
		onReview: () => void;
		onDone: () => void;
		onResults: (show: boolean) => void;
		onNext: () => void;
		onNudge: (id: string, frames: number) => void;
		onSetHere: () => void;
		onPlace: () => void;
		onUndo: () => void;
		onRedo: () => void;
		onRemove: (id: string) => void;
	}

	let {
		stage,
		hint,
		scrubber,
		readout,
		controls,
		mark,
		units,
		marks,
		timing,
		variableFrameRate,
		mode,
		activeId,
		selectedId,
		emptySlot,
		frame,
		canPlace,
		jumpType = $bindable(),
		timeScale = $bindable(),
		title = $bindable(),
		titlePlaceholder,
		notes = $bindable(),
		recordedAt = $bindable(),
		canUndo,
		canRedo,
		onSelectUnit,
		onSelectMark,
		onSelectSlot,
		onReview,
		onDone,
		onResults,
		onNext,
		onNudge,
		onSetHere,
		onPlace,
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
	let chipList: HTMLDivElement | null = $state(null);
	let chipsScrolled = $state(false);

	let active = $derived(units.find((unit) => unit.id === activeId));
	let number = $derived(active ? units.indexOf(active) + 1 : units.length + 1);
	let completed = $derived(units.filter((unit) => unit.flight));
	// "Best" only means something once there's a jump to beat.
	let best = $derived(completed.length > 1 ? bestUnit(units) : undefined);
	let unpaired = $derived(unpairedMarks(marks, units));
	let selected = $derived(marks.find((item) => item.id === selectedId));
	let selectedStep = $derived(
		emptySlot ?? (active && selected ? (unitStep(active, selected.id) ?? null) : null)
	);
	/** A mark that belongs to no jump is being corrected. */
	let orphan = $derived(mode === 'review' && !!selected && !selectedStep);
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
	let selectedLabel = $derived(
		selectedStep
			? stepLabel(selectedStep, jumpType)
			: selected?.type === 'takeoff'
				? 'Takeoff'
				: 'Landing'
	);
	let onOwnFrame = $derived(!!selected && frameOf(selected.time, timing) === frame);
	/** A new jump can start once the last one has landed. */
	let canStartJump = $derived(!units.length || !!units.at(-1)?.flight);
	let reviewTitle = $derived(orphan ? `Unpaired ${selectedLabel.toLowerCase()}` : `Jump ${number}`);

	const ms = (seconds: number) => Math.round(seconds * 1000);
	const clock = (item: Mark) =>
		formatFrameClock(frameLabel(frameOf(item.time, timing), timing), timing);

	// What a screen reader hears as the workspace moves between states.
	let status = $derived.by(() => {
		if (mode === 'results') return 'Session results';
		if (mode === 'complete' && active?.flight) {
			return `Jump ${number}: flight time ${ms(active.flight.realSeconds)} milliseconds`;
		}
		if (mode === 'review' && selected) {
			return `${reviewTitle}: ${orphan ? 'selected' : `${selectedLabel.toLowerCase()} selected`}, frame ${frameOf(selected.time, timing) + 1}`;
		}
		if (mode === 'review' && emptySlot) {
			return `Jump ${number}: ${selectedLabel.toLowerCase()} not marked`;
		}
		return `Jump ${number}: ready to mark`;
	});

	// Keeps the jump in the workspace in view among its neighbours.
	$effect(() => {
		void [activeId, mode, units.length, orphan];
		if (!chipList) return;
		void tick().then(() =>
			chipList
				?.querySelector<HTMLElement>('[aria-current="true"]')
				?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
		);
	});

	/**
	 * Runs a control that replaces itself (Review becomes the marks, Done the result).
	 * From the keyboard, focus follows to what took its place; a pointer leaves focus
	 * on the page, so Space still plays the video rather than pressing a button.
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

	const SELECTED = '.jw-seg [aria-pressed="true"], .jw-slot[aria-pressed="true"]';
	const AFTER_REVIEW = ['[data-focus="review"]', '.mark-primary', '[data-focus="results"]'];
</script>

{#snippet pips(unit: JumpUnit | undefined)}
	<span class="jw-pips" aria-hidden="true">
		{#each GUIDE_STEPS as step (step)}
			<span class="jw-pip" class:takeoff={step === 'takeoff'} class:set={!!unit?.[step]}></span>
		{/each}
	</span>
{/snippet}

{#snippet chips()}
	<div
		class="jw-chips"
		class:scrolled={chipsScrolled}
		bind:this={chipList}
		onscroll={(event) => (chipsScrolled = event.currentTarget.scrollLeft > 4)}
	>
		{#each units as unit, i (unit.id)}
			{@const current = mode !== 'results' && activeId === unit.id && !orphan}
			<button
				class="jw-chip"
				aria-current={current ? 'true' : undefined}
				aria-label={unit.flight
					? `Jump ${i + 1}, flight ${ms(unit.flight.realSeconds)} milliseconds${best?.id === unit.id ? ', best' : ''}`
					: `Jump ${i + 1}, not finished`}
				onclick={(event) => act(event, () => onSelectUnit(unit), SELECTED)}
			>
				<span class="jw-chip-name">J{i + 1}</span>
				{#if unit.flight}
					<span class="jw-chip-value">{ms(unit.flight.realSeconds)} ms</span>
					{#if best?.id === unit.id}<span class="jw-chip-best">Best</span>{/if}
				{:else}
					{@render pips(unit)}
				{/if}
			</button>
		{/each}
		{#if canStartJump}
			{@const current = mode === 'capture' && !activeId}
			<button
				class="jw-chip jw-chip-new"
				aria-current={current ? 'true' : undefined}
				aria-label="Jump {units.length + 1}, new jump"
				onclick={(event) => act(event, onNext, '.mark-primary')}
			>
				<span class="jw-chip-name">J{units.length + 1}</span>
				{@render pips(undefined)}
			</button>
		{/if}
		{#if unpaired.length}
			<button
				class="jw-chip jw-chip-unpaired"
				aria-current={orphan ? 'true' : undefined}
				aria-label="{unpaired.length} unpaired {unpaired.length === 1
					? 'mark'
					: 'marks'}. Review the first"
				onclick={(event) => act(event, () => onSelectMark(unpaired[0]), '[data-focus="done"]')}
			>
				<span class="jw-chip-dot" aria-hidden="true"></span>
				{unpaired.length} unpaired
			</button>
		{/if}
	</div>
{/snippet}

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

{#snippet doneButton()}
	<button class="jw-done" data-focus="done" onclick={(event) => act(event, onDone, ...AFTER_REVIEW)}
		>Done</button
	>
{/snippet}

<!-- The jump's three marks as one control: the selected one is being corrected. -->
{#snippet segments()}
	<div class="jw-seg" role="group" aria-label="Marks of jump {number}">
		{#each slots as slot (slot.step)}
			<button
				class="jw-seg-item"
				class:takeoff={slot.step === 'takeoff'}
				class:unset={!slot.mark}
				aria-pressed={selectedStep === slot.step}
				aria-label={slot.mark ? slot.label : `${slot.label}, not marked`}
				onclick={() => (slot.mark ? onSelectMark(slot.mark) : onSelectSlot(slot.step))}
			>
				{#if !slot.mark}<svg class="jw-plus" viewBox="0 0 12 12" aria-hidden="true"
						><path d="M6 2v8M2 6h8" /></svg
					>{/if}<span>{slot.label}</span>
			</button>
		{/each}
	</div>
{/snippet}

{#snippet hero()}
	<div class="jw-hero" class:pending={!active?.flight}>
		<span class="jw-hero-label"
			><span class="jw-hero-jump">Jump {number}</span><span class="jw-hero-what">Flight time</span
			></span
		>
		{#key active?.flight?.realSeconds}
			<span class="jw-hero-value jw-pop"
				>{active?.flight ? ms(active.flight.realSeconds) : '--'}<span class="jw-hero-unit">ms</span
				></span
			>
		{/key}
	</div>
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

<!-- On a phone Done sits in the strip, beside the marks; in the card it ends the row. -->
{#snippet panelDone()}
	{#if !compact}
		<button
			class="jw-btn jw-primary jw-end"
			data-focus="done"
			onclick={(event) => act(event, onDone, ...AFTER_REVIEW)}>Done</button
		>
	{/if}
{/snippet}

{#snippet actions()}
	{#if mode === 'complete'}
		<button
			class="jw-btn jw-quiet"
			data-focus="review"
			onclick={(event) => act(event, onReview, SELECTED)}>Review</button
		>
		<button class="jw-btn jw-primary" onclick={(event) => act(event, onNext, '.mark-primary')}
			>Next jump</button
		>
	{:else if mode === 'review'}
		{#if selected}
			<div class="jw-adjust">
				<div class="jw-stepper" role="group" aria-label="Move the {selectedLabel.toLowerCase()}">
					<button
						class="jw-btn jw-quiet"
						onclick={() => onNudge(selected.id, -1)}
						aria-label="Move the {selectedLabel.toLowerCase()} one frame earlier"
						>−1<span class="jw-wide">frame</span></button
					>
					<button
						class="jw-btn jw-quiet"
						onclick={() => onNudge(selected.id, 1)}
						aria-label="Move the {selectedLabel.toLowerCase()} one frame later"
						>+1<span class="jw-wide">frame</span></button
					>
				</div>
				<button
					class="jw-btn jw-mark"
					class:takeoff={selected.type === 'takeoff'}
					aria-disabled={onOwnFrame}
					onclick={onSetHere}
					title={onOwnFrame
						? `The ${selectedLabel.toLowerCase()} is on this frame`
						: `Move the ${selectedLabel.toLowerCase()} to this frame`}>Set here</button
				>
			</div>
			<div class="jw-edit">
				{@render history()}
				<button
					class="jw-btn jw-icon jw-remove"
					onclick={() => onRemove(selected.id)}
					aria-label="Remove the {selectedLabel.toLowerCase()}"
					title="Remove this mark"
				>
					<svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg
					><span class="jw-wide">Remove</span>
				</button>
				{@render panelDone()}
			</div>
		{:else if emptySlot}
			<div class="jw-adjust">
				<button
					class="jw-btn jw-mark"
					class:takeoff={emptySlot === 'takeoff'}
					aria-disabled={!canPlace}
					onclick={onPlace}
				>
					<MarkGlyph type={STEP_MARK[emptySlot]} size={17} />Mark {selectedLabel.toLowerCase()}
				</button>
			</div>
			<div class="jw-edit">
				{@render history()}
				{@render panelDone()}
			</div>
		{/if}
	{/if}
{/snippet}

<div class="jump-workspace" data-layout={layout} data-mode={mode} class:orphan bind:this={root}>
	<p class="sr-only" role="status">{status}</p>

	<div class="jw-main viewer-frame">
		<div class="jw-stage">{@render stage()}</div>
		<div class="jw-dock">
			{@render hint()}
			{#if compact}
				<nav class="jw-strip" aria-label="Jumps">
					{#if mode === 'review'}
						<div class="jw-strip-in jw-swap">
							<span class="jw-review-title"
								>{#if orphan}{reviewTitle}{:else}<span class="jw-short">J{number}</span><span
										class="jw-long">Jump {number}</span
									>{/if}</span
							>
							{#if layout === 'portrait' && !orphan}{@render segments()}{/if}
							{@render doneButton()}
						</div>
					{:else}
						<div class="jw-strip-in jw-swap">
							{@render chips()}
							{@render resultsButton()}
						</div>
					{/if}
				</nav>
				{#if layout === 'rail'}
					<div class="jw-middle">
						{#if mode === 'complete'}
							{@render hero()}
						{:else if mode === 'review' && !orphan}
							<div class="jw-swap">{@render segments()}</div>
						{/if}
					</div>
				{/if}
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
						{#if compact && (mode === 'complete' || mode === 'review')}
							<!-- The jump's actions take the Mark button's place, in the same box. -->
							{#key mode}
								<div class="jw-actions jw-swap">
									{#if layout === 'portrait' && mode === 'complete'}{@render hero()}{/if}
									{@render actions()}
								</div>
							{/key}
						{:else}
							{@render mark()}
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>

	{#if !compact}
		<aside class="jw-panel" aria-label="Jumps">
			<nav class="jw-strip" aria-label="Jumps">
				<h2 class="jw-panel-title">Jumps</h2>
				{@render chips()}
				{@render resultsButton()}
			</nav>
			<section class="jw-card" aria-label={reviewTitle}>
				<div class="jw-card-head">
					<h3 class="jw-card-title">{reviewTitle}</h3>
					{#if active && best?.id === active.id}<span class="jw-badge">Best</span>{/if}
				</div>
				{#if orphan}
					<p class="jw-note">
						This mark isn't part of a jump. Move it to the frame it belongs on, or remove it.
					</p>
				{:else}
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
								disabled={!slot.mark && !active}
								aria-pressed={mode === 'review' ? selectedStep === slot.step : undefined}
								onclick={(event) =>
									act(
										event,
										() => (slot.mark ? onSelectMark(slot.mark) : onSelectSlot(slot.step)),
										SELECTED
									)}
							>
								<span class="jw-slot-glyph"
									><MarkGlyph type={STEP_MARK[slot.step]} size={16} /></span
								>
								<span class="jw-slot-label">{slot.label}</span>
								<span class="jw-slot-time"
									>{slot.mark ? clock(slot.mark) : active ? 'Add' : 'Not marked'}</span
								>
							</button>
						{/each}
					</div>
				{/if}
				{#if mode === 'complete' || mode === 'review'}
					{#key mode}
						<div class="jw-actions jw-swap">{@render actions()}</div>
					{/key}
				{/if}
			</section>
		</aside>
	{/if}

	{#if mode === 'results'}
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
			onOpenUnit={(unit) => onSelectUnit(unit, true)}
			onOpenMark={onSelectMark}
		/>
	{/if}
</div>

<style>
	.jump-workspace {
		--mark-color: hsl(var(--at-landing));
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

	.jump-workspace[data-mode='results'] > .jw-main,
	.jump-workspace[data-mode='results'] > .jw-panel {
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
		overscroll-behavior: contain;
		scrollbar-width: none;
	}

	/* ---- The strip: the session's jumps, or the jump being corrected ---- */

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

	/* Scrolls sideways when there are many jumps, fading out under Results. */
	.jw-chips {
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 4px 16px 4px 0;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		scrollbar-width: none;
		touch-action: pan-x;
		mask-image: linear-gradient(to right, #000 calc(100% - 16px), transparent);
	}

	.jw-chips.scrolled {
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 20px,
			#000 calc(100% - 16px),
			transparent
		);
	}

	.jw-chips::-webkit-scrollbar {
		display: none;
	}

	.jw-chip {
		position: relative;
		display: inline-flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 7px;
		height: 36px;
		padding: 0 12px;
		border: 1px solid transparent;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.06);
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 140ms var(--at-ease),
			border-color 140ms var(--at-ease),
			color 140ms var(--at-ease);
	}

	.jw-chip-name {
		color: hsl(var(--at-fg-muted));
		font-weight: 600;
	}

	.jw-chip-value {
		font-weight: 500;
	}

	.jw-chip[aria-current='true'] {
		border-color: hsl(var(--at-fg) / 0.2);
		background: hsl(var(--at-fg) / 0.13);
		color: hsl(var(--at-fg));
	}

	.jw-chip[aria-current='true'] .jw-chip-name {
		color: hsl(var(--at-fg));
	}

	.jw-chip-best {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	/* A phone's strip keeps to the times; Results says which jump is best. */
	.jw-dock .jw-chip-best {
		display: none;
	}

	/* A jump being marked shows which of its three marks it has. */
	.jw-pips {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.jw-pip {
		width: 6px;
		height: 6px;
		border: 1.5px solid hsl(var(--at-fg) / 0.32);
		border-radius: 50%;
	}

	.jw-pip.set {
		border-color: var(--mark-color);
		background: var(--mark-color);
	}

	.jw-chip-new {
		background: transparent;
		border-color: hsl(var(--at-fg) / 0.12);
	}

	.jw-chip-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--at-warning));
	}

	.jw-results,
	.jw-done {
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

	.jw-done {
		padding: 0 14px;
		background: hsl(var(--at-accent) / 0.2);
		color: hsl(var(--at-accent-fg));
		font-weight: 600;
	}

	.jw-review-title {
		flex: 0 0 auto;
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.orphan .jw-review-title {
		flex: 1 1 auto;
	}

	.jw-long,
	[data-layout='rail'] .jw-short {
		display: none;
	}

	[data-layout='rail'] .jw-long {
		display: inline;
	}

	[data-layout='rail'] .jw-review-title {
		flex: 1 1 auto;
	}

	/* ---- The jump's three marks ---- */

	.jw-seg {
		display: flex;
		flex: 1 1 auto;
		gap: 2px;
		min-width: 0;
		height: 40px;
		padding: 2px;
		border-radius: 12px;
		background: hsl(var(--at-fg) / 0.06);
	}

	.jw-seg-item {
		position: relative;
		display: inline-flex;
		flex: 1 1 0;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 0;
		padding: 0 4px;
		border: none;
		border-radius: 10px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition:
			background 140ms var(--at-ease),
			color 140ms var(--at-ease);
	}

	.jw-seg-item span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.jw-seg-item.unset {
		color: hsl(var(--at-fg-muted));
	}

	/* Selected: raised, and underlined in the mark's colour. */
	.jw-seg-item[aria-pressed='true'] {
		background: hsl(var(--at-fg) / 0.14);
		box-shadow: inset 0 -2px 0 var(--mark-color);
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.jw-plus {
		flex: 0 0 auto;
		width: 11px;
		height: 11px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
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

	/* Not landed yet: dashes hold the number's place. */
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

	.jw-primary {
		border-color: hsl(var(--at-accent) / 0.55);
		background: hsl(var(--at-accent) / 0.24);
		color: hsl(var(--at-accent-fg));
	}

	/* Moves or adds a mark: filled in the mark's colour, as the Mark button is. */
	.jw-mark {
		background: var(--mark-color);
		color: hsl(var(--at-bg));
	}

	.jw-mark[aria-disabled='true'] {
		background: hsl(var(--at-fg) / 0.06);
		color: hsl(var(--at-fg-muted));
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

	.jw-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.jw-adjust,
	.jw-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	@media (hover: hover) {
		.jw-chip:hover:not([aria-current='true']) {
			background: hsl(var(--at-fg) / 0.1);
			color: hsl(var(--at-fg));
		}
		.jw-results:hover {
			background: hsl(var(--at-fg) / 0.08);
		}
		.jw-done:hover,
		.jw-primary:hover {
			background: hsl(var(--at-accent) / 0.34);
			color: hsl(var(--at-fg));
		}
		.jw-seg-item:hover:not([aria-pressed='true']) {
			background: hsl(var(--at-fg) / 0.07);
			color: hsl(var(--at-fg));
		}
		.jw-quiet:hover:not(:disabled),
		.jw-icon:hover:not(:disabled) {
			background: hsl(var(--at-fg) / 0.13);
		}
		.jw-mark:hover:not([aria-disabled='true']) {
			background: color-mix(in srgb, var(--mark-color) 86%, hsl(var(--at-fg)));
		}
		.jw-slot:hover:not(:disabled):not([aria-pressed='true']) {
			background: hsl(var(--at-fg) / 0.05);
		}
	}

	/* ---- Compact: a phone ---- */

	/* The actions sit in the Mark button's row and box (MarkButtons), so swapping
	   one for the other moves nothing. */
	.control-toolbar > .jw-actions {
		grid-area: marks;
		height: 52px;
		margin-top: 6px;
	}

	.control-toolbar > .jw-actions .jw-btn {
		--h: 52px;
		padding: 0 16px;
		border-radius: 14px;
		font-size: 16px;
	}

	.control-toolbar > .jw-actions .jw-adjust,
	.control-toolbar > .jw-actions .jw-edit {
		display: contents;
	}

	.control-toolbar > .jw-actions .jw-wide {
		display: none;
	}

	.control-toolbar > .jw-actions .jw-icon {
		width: 46px;
		padding: 0;
	}

	.control-toolbar > .jw-actions .jw-icon svg {
		width: 21px;
		height: 21px;
	}

	.control-toolbar > .jw-actions .jw-stepper .jw-btn {
		width: 48px;
		padding: 0;
	}

	.control-toolbar > .jw-actions .jw-stepper .jw-btn:first-child {
		border-radius: 14px 5px 5px 14px;
	}

	.control-toolbar > .jw-actions .jw-stepper .jw-btn:last-child {
		border-radius: 5px 14px 14px 5px;
	}

	.control-toolbar > .jw-actions .jw-mark {
		flex: 1 1 0;
		min-width: 0;
		padding: 0 8px;
	}

	.control-toolbar > .jw-actions .jw-edit .jw-btn:first-child {
		margin-left: 0;
	}

	/* Upright: flight time and its two actions share the row. */
	.control-toolbar > .jw-actions .jw-hero {
		flex: 1 1 auto;
		gap: 0;
	}

	.control-toolbar > .jw-actions .jw-hero-value {
		font-size: 34px;
		line-height: 36px;
	}

	.control-toolbar > .jw-actions .jw-hero-what {
		text-transform: lowercase;
	}

	[data-layout='portrait'][data-mode='complete'] .control-toolbar > .jw-actions .jw-btn {
		padding: 0 18px;
	}

	/* On its side: flight time has the middle of the rail to itself. */
	.jw-middle {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		justify-content: center;
		min-height: 0;
		padding: 0 16px;
	}

	.jw-middle .jw-hero {
		align-items: center;
		gap: 4px;
	}

	.jw-middle .jw-hero-value {
		font-size: clamp(34px, 12vh, 48px);
		transform-origin: center;
	}

	.jw-middle .jw-seg {
		height: 44px;
	}

	[data-layout='rail'] .control-toolbar > .jw-actions > .jw-quiet,
	[data-layout='rail'] .control-toolbar > .jw-actions > .jw-primary {
		flex: 1 1 0;
	}

	/* Small phones: the same row, a little tighter. */
	@container jump-dock (max-width: 380px) {
		.control-toolbar > .jw-actions {
			gap: 6px;
		}
		.control-toolbar > .jw-actions .jw-icon,
		.control-toolbar > .jw-actions .jw-stepper .jw-btn {
			width: 44px;
		}
		.control-toolbar > .jw-actions .jw-mark {
			padding: 0 4px;
		}
		[data-layout='portrait'][data-mode='complete'] .control-toolbar > .jw-actions .jw-btn {
			padding: 0 14px;
		}
	}

	@container jump-dock (max-width: 340px) {
		[data-layout='portrait'] .control-toolbar > .jw-actions .jw-redo,
		.control-toolbar > .jw-actions .jw-hero-jump {
			display: none;
		}
		.control-toolbar > .jw-actions .jw-hero-what {
			text-transform: none;
		}
		[data-layout='portrait'][data-mode='complete'] .control-toolbar > .jw-actions .jw-btn {
			padding: 0 12px;
		}
		.control-toolbar > .jw-actions .jw-hero-value {
			font-size: 28px;
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

	.jw-panel .jw-strip {
		gap: 10px;
		padding: 0 12px 0 20px;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.jw-panel-title {
		flex: 0 0 auto;
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 600;
	}

	/* Beside the video the jumps wrap onto as many rows as they need. */
	[data-layout='side'] .jw-panel .jw-strip {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		row-gap: 0;
		padding-block: 10px 14px;
	}

	[data-layout='side'] .jw-panel-title {
		height: 36px;
		line-height: 36px;
	}

	[data-layout='side'] .jw-chips {
		grid-column: 1 / -1;
		grid-row: 2;
		flex-wrap: wrap;
		padding: 4px 0 0;
		overflow: visible;
		mask-image: none;
	}

	[data-layout='bottom'] .jw-panel .jw-strip {
		height: 56px;
	}

	.jw-card {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: 20px;
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

	.jw-note {
		margin: 12px 0 0;
		color: hsl(var(--at-fg-secondary));
		font-size: 14px;
		line-height: 1.5;
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

	.jw-slot.unset:not(:disabled) .jw-slot-time {
		color: hsl(var(--at-accent-hover));
		font-weight: 500;
	}

	.jw-slot:disabled {
		cursor: default;
	}

	.jw-slot[aria-pressed='true'] {
		background: hsl(var(--at-fg) / 0.09);
		box-shadow: inset 2px 0 0 var(--mark-color);
	}

	.jw-slot[aria-pressed='true'] .jw-slot-label {
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.jw-slot:focus-visible {
		outline-offset: -2px;
	}

	.jw-card .jw-actions {
		flex-wrap: wrap;
		margin-top: 16px;
	}

	.jw-card .jw-adjust,
	.jw-card .jw-edit {
		flex: 1 1 100%;
	}

	.jw-card .jw-mark {
		flex: 1 1 auto;
	}

	.jw-card .jw-end {
		margin-left: auto;
	}

	.jw-card .jw-icon {
		padding: 0 12px 0 10px;
	}

	.jw-card .jw-stepper .jw-btn {
		gap: 5px;
		padding: 0 12px;
	}

	[data-layout='side'][data-mode='complete'] .jw-card .jw-btn {
		flex: 1 1 0;
	}

	/* Under the video the card lies flat: flight time, the marks, then the actions.
	   It keeps one height in every state, so the picture never resizes. */
	[data-layout='bottom'] .jw-card {
		display: grid;
		grid-template-columns: minmax(150px, 190px) minmax(200px, 1fr) minmax(0, 316px);
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

	[data-layout='bottom'] .jw-note {
		grid-area: 2 / 1 / 4 / 3;
		max-width: 420px;
	}

	[data-layout='bottom'] .jw-slots {
		grid-area: 1 / 2 / 4 / 3;
		align-self: center;
		margin-top: 0;
	}

	[data-layout='bottom'] .jw-card .jw-actions {
		grid-area: 1 / 3 / 4 / 4;
		align-self: center;
		align-content: center;
		justify-content: flex-end;
		margin-top: 0;
	}

	[data-layout='bottom'] .jw-card .jw-icon {
		padding: 0 12px 0 10px;
	}

	[data-layout='bottom'] .jw-card .jw-stepper .jw-btn {
		padding: 0 11px;
	}

	[data-layout='bottom'][data-mode='complete'] .jw-card .jw-actions {
		flex-wrap: nowrap;
	}

	[data-layout='bottom'] .jw-hero-value {
		font-size: 52px;
	}

	/* ---- Touch: 44px targets ---- */

	@media (pointer: coarse) {
		.jw-chip::after,
		.jw-results::after,
		.jw-done::after {
			content: '';
			position: absolute;
			inset: -4px 0;
		}
		.jw-seg {
			height: 44px;
		}
		.jw-seg-item::after {
			content: '';
			position: absolute;
			inset: -2px 0;
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

	.jw-swap {
		animation: jw-in 200ms var(--at-ease) both;
	}

	.jw-pop {
		display: inline-block;
		animation: jw-pop 320ms var(--at-ease) both;
	}

	@keyframes jw-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
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
		.jw-swap,
		.jw-pop {
			animation: none;
		}
		.jw-btn,
		.jw-chip,
		.jw-seg-item {
			transition: none;
		}
	}
</style>
