<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Analysis, Mark } from '$lib/video/marks';
	import { frameOf, rsi } from '$lib/video/marks';
	import { bestUnit, jumpUnits, unitMarks, type JumpUnit } from '$lib/video/jumpUnits';
	import { plantLabel } from '$lib/video/guide';
	import type { FrameTiming } from '$lib/video/frames';
	import { JUMP_TYPES, TIME_SCALES, type JumpType } from '$lib/session/schema';

	interface Props {
		children: Snippet;
		marks: Mark[];
		analysis: Analysis;
		timing: FrameTiming;
		mode: 'capture' | 'complete' | 'review' | 'results';
		activeId: string | null;
		selectedId: string | null;
		jumpType: JumpType | null;
		timeScale: number;
		title: string;
		notes: string;
		recordedAt: string;
		canUndo: boolean;
		canRedo: boolean;
		canSet: boolean;
		onSeek: (time: number) => void;
		onNudge: (id: string, frames: number) => void;
		onSetHere: () => void;
		onPlant: () => void;
		onUndo: () => void;
		onRedo: () => void;
		onRemove: (id: string) => void;
		onNext: () => void;
	}
	let {
		children,
		marks,
		analysis,
		timing,
		mode = $bindable(),
		activeId = $bindable(),
		selectedId = $bindable(),
		jumpType = $bindable(),
		timeScale = $bindable(),
		title = $bindable(),
		notes = $bindable(),
		recordedAt = $bindable(),
		canUndo,
		canRedo,
		canSet,
		onSeek,
		onNudge,
		onSetHere,
		onPlant,
		onUndo,
		onRedo,
		onRemove,
		onNext
	}: Props = $props();

	let units = $derived(jumpUnits(marks, analysis));
	let active = $derived(units.find((unit) => unit.id === activeId));
	let number = $derived(active ? units.indexOf(active) + 1 : units.length + 1);
	let selected = $derived(marks.find((mark) => mark.id === selectedId));
	let unpaired = $derived(
		marks.filter(
			(mark) => !units.some((unit) => unitMarks(unit).some((item) => item.id === mark.id))
		)
	);
	let orphan = $derived(selected && unpaired.some((mark) => mark.id === selected.id));
	let chips: HTMLDivElement | null = $state(null);
	$effect(() => {
		const currentId = activeId ?? selectedId ?? `new-${units.length}`;
		if (currentId && mode !== 'results' && chips) {
			queueMicrotask(() =>
				chips?.querySelector<HTMLElement>('.active')?.scrollIntoView({
					block: 'nearest',
					inline: 'nearest'
				})
			);
		}
	});
	let best = $derived(bestUnit(units));
	let completed = $derived(units.filter((unit) => unit.flight));
	let average = $derived(
		completed.length
			? completed.reduce((sum, unit) => sum + unit.flight!.realSeconds, 0) / completed.length
			: undefined
	);
	const ms = (seconds: number | undefined) =>
		seconds === undefined ? '—' : `${Math.round(seconds * 1000)} ms`;

	function selectUnit(unit: JumpUnit) {
		activeId = unit.id;
		mode = 'review';
		selectMark(unit.takeoff ?? unit.plant!);
	}
	function selectMark(mark: Mark) {
		selectedId = mark.id;
		onSeek(mark.time);
	}
	function label(mark: Mark, unit?: JumpUnit) {
		return mark.id === unit?.plant?.id
			? plantLabel(jumpType)
			: mark.type === 'takeoff'
				? 'Takeoff'
				: 'Landing';
	}
	function review() {
		mode = 'review';
		if (active) selectMark(active.takeoff ?? active.plant!);
	}
	function done() {
		selectedId = null;
		mode = active?.flight ? 'complete' : 'capture';
	}
	function index(unit: JumpUnit) {
		return unit.takeoff
			? (rsi({ takeoff: unit.takeoff, flight: unit.flight, contact: unit.contact })?.toFixed(2) ??
					'—')
			: '—';
	}
</script>

<div
	class="jump-workspace"
	class:results={mode === 'results'}
	class:reviewing={mode === 'review'}
	class:finished={mode === 'complete'}
>
	<nav class="jump-navigation" aria-label="Jumps">
		<div class="jump-chips" bind:this={chips}>
			{#each units as unit, i (unit.id)}
				<button
					class="jump-chip"
					class:active={activeId === unit.id}
					aria-pressed={activeId === unit.id}
					onclick={() => selectUnit(unit)}
				>
					<strong>J{i + 1}</strong>
					{unit.flight ? ms(unit.flight.realSeconds) : '…'}
					{#if best?.id === unit.id}<small>Best</small>{/if}
				</button>
			{/each}
			{#if !active && mode !== 'results'}
				<span class="jump-chip active">
					{#if orphan}Unpaired mark{:else}<strong>J{number}</strong> New jump{/if}
				</span>
			{/if}
		</div>
		<button
			class="btn btn-secondary results-toggle"
			onclick={() => {
				if (mode === 'results') done();
				else {
					mode = 'results';
					selectedId = null;
				}
			}}>{mode === 'results' ? 'Back to video' : 'Results'}</button
		>
	</nav>

	<div class="jump-player">{@render children()}</div>

	{#if mode === 'results'}
		<section class="jump-results" aria-label="Session results">
			<div class="results-heading">
				<span>Session results</span>
				<h1>{title || 'Your jumps'}</h1>
				<p>
					{completed.length} measured {completed.length === 1 ? 'jump' : 'jumps'} · Flight time first
				</p>
			</div>
			<div class="session-totals">
				<div><span>Best flight</span><strong>{ms(best?.flight?.realSeconds)}</strong></div>
				<div><span>Average flight</span><strong>{ms(average)}</strong></div>
			</div>
			{#if units.length}
				<div class="results-list">
					{#each units as unit, i (unit.id)}
						<article class="jump-result">
							<div class="result-title">
								<strong>Jump {i + 1}</strong>{#if best?.id === unit.id}<small>Best flight</small
									>{/if}<button class="btn btn-secondary" onclick={() => selectUnit(unit)}
									>Review J{i + 1}</button
								>
							</div>
							<dl>
								<div>
									<dt>Flight</dt>
									<dd>{ms(unit.flight?.realSeconds)}</dd>
								</div>
								<div>
									<dt>Contact</dt>
									<dd>{ms(unit.contact?.realSeconds)}</dd>
								</div>
								<div>
									<dt>RSI</dt>
									<dd>{index(unit)}</dd>
								</div>
							</dl>
							{#if !unit.contact}<button
									class="missing-plant"
									onclick={() => {
										selectUnit(unit);
										onSeek(Math.max(0, (unit.takeoff?.time ?? 0) - 0.2));
									}}
									>Mark {plantLabel(jumpType).toLowerCase()} for J{i + 1} to measure contact and RSI →</button
								>{/if}
							{#if !unit.flight}<p class="muted">
									{unit.takeoff
										? 'Mark landing to finish this jump.'
										: 'Mark takeoff, then landing.'}
								</p>{/if}
						</article>
					{/each}
				</div>
			{:else}<p>No jumps yet. Mark a plant step, takeoff and landing in the video.</p>{/if}
			{#if unpaired.length}
				<details>
					<summary>Unpaired marks</summary>
					<div class="unpaired">
						{#each unpaired as mark (mark.id)}<button
								class="btn btn-secondary"
								onclick={() => {
									mode = 'review';
									activeId = null;
									selectedId = mark.id;
									onSeek(mark.time);
								}}>{label(mark)} · frame {frameOf(mark.time, timing) + 1}</button
							>{/each}
					</div>
				</details>
			{/if}
			<details class="session-setup">
				<summary>Session details & video timing</summary>
				<div class="setup-fields">
					<label
						>Jump type<select bind:value={jumpType}
							><option value={null}>Not set</option>{#each JUMP_TYPES as type (type.value)}<option
									value={type.value}>{type.label}</option
								>{/each}</select
						></label
					>
					<label
						>Video timing<select bind:value={timeScale}
							>{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
									>{scale.label}</option
								>{/each}</select
						></label
					>
					<label>Title<input bind:value={title} /></label>
					<label
						>Recorded date<input
							type="date"
							value={recordedAt.slice(0, 10)}
							onchange={(event) => {
								if (event.currentTarget.value)
									recordedAt = new Date(`${event.currentTarget.value}T12:00:00`).toISOString();
							}}
						/></label
					>
					<label class="notes">Notes<textarea bind:value={notes}></textarea></label>
				</div>
			</details>
			<div class="history">
				<button class="btn btn-secondary" disabled={!canUndo} onclick={onUndo}>Undo</button><button
					class="btn btn-secondary"
					disabled={!canRedo}
					onclick={onRedo}>Redo</button
				><button class="btn btn-primary" onclick={onNext}>Next jump</button>
			</div>
		</section>
	{:else if mode === 'complete' && active?.flight}
		<section class="jump-complete" aria-label="Jump complete">
			<div><span>Jump {number} · Flight</span><strong>{ms(active.flight.realSeconds)}</strong></div>
			<button class="btn btn-secondary" onclick={review}>Review</button><button
				class="btn btn-primary"
				onclick={onNext}>Next jump</button
			>
		</section>
	{:else if mode === 'review'}
		<section class="jump-review" aria-label="Jump correction">
			<div class="review-marks">
				<strong>{orphan ? 'Unpaired' : `J${number}`}</strong>
				{#if active?.takeoff && !active.contact}<button
						class="mark-tab missing-plant-tab"
						onclick={onPlant}>+ {plantLabel(jumpType)}</button
					>{/if}{#if active}{#each unitMarks(active) as mark (mark.id)}<button
							class="mark-tab"
							class:selected={selectedId === mark.id}
							aria-pressed={selectedId === mark.id}
							onclick={() => selectMark(mark)}>{label(mark, active)}</button
						>{/each}{/if}<button class="btn btn-secondary done" onclick={done}>Done</button>
			</div>
			{#if active?.takeoff && !active.contact}<p class="missing-hint">
					Contact & RSI missing. Find and mark this jump’s {plantLabel(jumpType).toLowerCase()} before
					takeoff.
				</p>{/if}
			{#if selected}<div class="correction-bar">
					<span>{label(selected, active)} <small>f{frameOf(selected.time, timing) + 1}</small></span
					><button
						class="btn btn-secondary"
						aria-label="Move selected mark back one frame"
						onclick={() => onNudge(selected.id, -1)}>−1 frame</button
					><button
						class="btn btn-secondary"
						aria-label="Move selected mark forward one frame"
						onclick={() => onNudge(selected.id, 1)}>+1 frame</button
					><button class="btn btn-primary" disabled={!canSet} onclick={onSetHere}>Set here</button
					><button class="btn btn-secondary" disabled={!canUndo} onclick={onUndo}>Undo</button
					><button class="btn btn-secondary remove" onclick={() => onRemove(selected.id)}
						>Remove</button
					>
				</div>{:else}<p class="muted">
					Select a mark to correct it. Frame stepping keeps your selection.
				</p>{/if}
		</section>
	{/if}
</div>

<style>
	.jump-workspace {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
	}
	.jump-navigation {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 8px 16px;
		border-bottom: 1px solid hsl(var(--at-border));
		flex-shrink: 0;
	}
	.jump-chips {
		display: flex;
		gap: 6px;
		flex: 1;
		min-width: 0;
		overflow-x: auto;
	}
	.jump-chip {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
		min-height: 44px;
		padding: 8px 12px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 8px;
		font-size: 13px;
		white-space: nowrap;
		color: hsl(var(--at-fg-muted));
	}
	.jump-chip.active,
	.mark-tab.selected {
		color: hsl(var(--at-fg));
		border-color: hsl(var(--at-accent));
		background: hsl(var(--at-accent) / 0.1);
	}
	small {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 400;
	}
	.jump-player {
		display: flex;
		flex: 1;
		min-height: 0;
		min-width: 0;
	}
	.results .jump-player {
		display: none;
	}
	.jump-complete {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 20px;
		border-top: 1px solid hsl(var(--at-border));
	}
	.jump-complete > div {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: 14px;
	}
	.jump-complete span,
	.muted {
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
	}
	.jump-complete strong {
		font-size: 26px;
		font-variant-numeric: tabular-nums;
	}
	.jump-review {
		flex-shrink: 0;
		border-top: 1px solid hsl(var(--at-border));
		padding: 8px 16px;
	}
	.review-marks,
	.correction-bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mark-tab {
		padding: 8px 10px;
		min-height: 44px;
		border: 1px solid transparent;
		border-radius: 6px;
		font-size: 13px;
	}
	.done {
		margin-left: auto;
	}
	.correction-bar {
		padding-top: 6px;
		flex-wrap: wrap;
	}
	.correction-bar > span {
		font-size: 13px;
		min-width: 110px;
	}
	.missing-hint {
		margin: 4px 0;
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}
	.jump-results {
		overflow-y: auto;
		flex: 1;
		padding: 32px max(20px, calc((100% - 820px) / 2));
	}
	.results-heading > span {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: hsl(var(--at-fg-muted));
	}
	h1 {
		margin: 8px 0;
		font-size: 28px;
		font-weight: 600;
	}
	.results-heading p {
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
	}
	.session-totals {
		display: flex;
		gap: 48px;
		padding: 28px 0;
	}
	.session-totals div {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.session-totals span,
	dt {
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}
	.session-totals strong {
		font-size: 30px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.jump-result {
		padding: 18px 0;
		border-top: 1px solid hsl(var(--at-border));
	}
	.result-title {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.result-title button {
		margin-left: auto;
	}
	dl {
		display: flex;
		gap: 40px;
		margin: 14px 0;
	}
	dd {
		margin: 4px 0 0;
		font-size: 19px;
		font-variant-numeric: tabular-nums;
	}
	.missing-plant {
		text-align: left;
		font-size: 13px;
		color: hsl(var(--at-accent));
		min-height: 44px;
	}
	details {
		border-top: 1px solid hsl(var(--at-border));
		padding: 18px 0;
	}
	summary {
		cursor: pointer;
		font-size: 14px;
		min-height: 32px;
	}
	.setup-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}
	input,
	select,
	textarea {
		padding: 10px;
		min-height: 44px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 6px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
	}
	.notes {
		grid-column: 1 / -1;
	}
	.history,
	.unpaired {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	:global(.jump-workspace .btn) {
		min-height: 44px;
	}
	@media (max-width: 640px) {
		.jump-navigation {
			padding: 6px 10px;
			gap: 8px;
		}
		.jump-chip {
			padding-inline: 10px;
		}
		.jump-chip small {
			display: none;
		}
		.jump-complete {
			padding: 10px;
			gap: 8px;
		}
		.jump-complete > div {
			flex-direction: column;
			gap: 0;
		}
		.jump-complete strong {
			font-size: 24px;
		}
		.jump-review {
			padding: 6px 10px;
		}
		.review-marks {
			gap: 2px;
		}
		.mark-tab {
			padding-inline: 8px;
			font-size: 12px;
		}
		.correction-bar {
			gap: 6px;
		}
		.correction-bar > span {
			width: 100%;
		}
		.correction-bar .btn {
			padding-inline: 10px;
			font-size: 12px;
		}
		.remove {
			margin-left: auto;
		}
		.jump-results {
			padding-top: 22px;
		}
		.session-totals {
			gap: 24px;
		}
	}
	@media (max-height: 500px) {
		.jump-navigation {
			padding-block: 2px;
		}
		.jump-chip {
			min-height: 36px;
			padding-block: 4px;
		}
		.jump-complete {
			padding: 4px 16px;
		}
		.jump-complete strong {
			font-size: 22px;
		}
		.jump-review {
			padding-block: 2px;
		}
		.review-marks {
			flex-wrap: wrap;
			gap: 4px;
		}

		.correction-bar {
			padding: 2px 0;
		}
		.missing-hint {
			display: none;
		}
	}
</style>
