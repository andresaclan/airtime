<script lang="ts">
	import { frameOf, rsi, type Mark } from '$lib/video/marks';
	import { averageFlight, type JumpUnit } from '$lib/video/jumpUnits';
	import { plantLabel } from '$lib/video/guide';
	import { frameDurationRange, frameLabel, type FrameTiming } from '$lib/video/frames';
	import { formatFrameClock } from '$lib/video/timecode';
	import { JUMP_TYPES, TIME_SCALES, type JumpType } from '$lib/session/schema';
	import { MediaQuery } from 'svelte/reactivity';

	// The session's results, on their own: flight time first, then each jump's contact
	// and RSI. A jump opens back in the video to be corrected.
	interface Props {
		units: JumpUnit[];
		unpaired: Mark[];
		/** Set once there are two measured jumps to compare. */
		best: JumpUnit | undefined;
		timing: FrameTiming;
		variableFrameRate: boolean;
		jumpType: JumpType | null;
		timeScale: number;
		title: string;
		titlePlaceholder: string;
		notes: string;
		recordedAt: string;
		onBack: (event: MouseEvent) => void;
		onOpenUnit: (event: MouseEvent, unit: JumpUnit) => void;
		onOpenMark: (event: MouseEvent, mark: Mark) => void;
	}

	let {
		units,
		unpaired,
		best,
		timing,
		variableFrameRate,
		jumpType = $bindable(),
		timeScale = $bindable(),
		title = $bindable(),
		titlePlaceholder,
		notes = $bindable(),
		recordedAt = $bindable(),
		onBack,
		onOpenUnit,
		onOpenMark
	}: Props = $props();

	// On a phone the session's details wait behind one tap; with more room they're open.
	const phone = new MediaQuery('(max-width: 700px), (max-height: 500px)');
	let detailsOpen = $derived(!phone.current);

	let completed = $derived(units.filter((unit) => unit.flight));
	let lead = $derived(best ?? completed[0]);
	let average = $derived(averageFlight(units));
	let plantName = $derived(plantLabel(jumpType).toLowerCase());
	let typeLabel = $derived(
		JUMP_TYPES.find((type) => type.value === jumpType)?.label ?? 'Jump type not set'
	);
	let recordedLabel = $derived.by(() => {
		const date = new Date(recordedAt);
		return Number.isNaN(date.getTime())
			? ''
			: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	});

	// Real time per frame, so the precision is honest for slow-motion footage too.
	let frameMs = $derived(timing.fps > 0 ? (1000 / timing.fps) * timeScale : 0);
	// On variable-frame-rate footage the longest frame bounds it.
	let longestFrameMs = $derived.by(() => {
		const range = variableFrameRate ? frameDurationRange(timing) : null;
		return range ? range[1] * 1000 * timeScale : 0;
	});
	let precision = $derived(
		longestFrameMs > frameMs + 0.05
			? `${frameMs.toFixed(1)}–${longestFrameMs.toFixed(1)}`
			: frameMs.toFixed(1)
	);

	const ms = (seconds: number) => Math.round(seconds * 1000);
	const clock = (mark: Mark) =>
		formatFrameClock(frameLabel(frameOf(mark.time, timing), timing), timing);

	function index(unit: JumpUnit): string | undefined {
		if (!unit.takeoff) return undefined;
		return rsi({ takeoff: unit.takeoff, flight: unit.flight, contact: unit.contact })?.toFixed(2);
	}

	function describe(unit: JumpUnit, number: number): string {
		if (!unit.flight) return `Jump ${number}, not finished. Open it in the video`;
		const parts = [`Jump ${number}`, `flight ${ms(unit.flight.realSeconds)} milliseconds`];
		if (unit.contact) parts.push(`contact ${ms(unit.contact.realSeconds)} milliseconds`);
		else parts.push(`no ${plantName}, contact not measured`);
		const reactive = index(unit);
		if (reactive) parts.push(`RSI ${reactive}`);
		if (best?.id === unit.id) parts.push('best');
		return `${parts.join(', ')}. Review it in the video`;
	}

	// datetime-local works in local time without a zone, so convert to and from ISO.
	function toLocalInput(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}

	function fromLocalInput(value: string) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) recordedAt = date.toISOString();
	}
</script>

<section class="jr" aria-labelledby="jr-title">
	<div class="jr-bar">
		<button class="jr-back" onclick={onBack}>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
			Video
		</button>
		<span class="jr-bar-title">Results</span>
	</div>

	<div class="jr-scroll">
		<div class="jr-page">
			<div class="jr-main">
				<header class="jr-head">
					<h1 id="jr-title" class="jr-title" tabindex="-1">{title.trim() || titlePlaceholder}</h1>
					<p class="jr-meta">
						{[
							`${completed.length} ${completed.length === 1 ? 'jump' : 'jumps'}`,
							typeLabel,
							recordedLabel
						]
							.filter(Boolean)
							.join(' · ')}
					</p>
				</header>

				{#if lead?.flight}
					<div class="jr-summary">
						<div class="jr-lead">
							<span class="jr-label">{best ? 'Best flight' : 'Flight time'}</span>
							<span class="jr-lead-value"
								>{ms(lead.flight.realSeconds)}<span class="jr-unit">ms</span></span
							>
						</div>
						{#if best && average !== undefined}
							<div class="jr-stat">
								<span class="jr-label">Average flight</span>
								<span class="jr-stat-value">{ms(average)}<span class="jr-unit">ms</span></span>
							</div>
						{/if}
					</div>
				{/if}

				{#if units.length}
					<div class="jr-section">
						<div class="jr-columns" aria-hidden="true">
							<span>Jump</span><span>Flight</span><span>Contact</span><span>RSI</span><span></span>
						</div>
						<ul class="jr-list">
							{#each units as unit, i (unit.id)}
								<li>
									<button
										class="jr-row"
										class:pending={!unit.flight}
										aria-label={describe(unit, i + 1)}
										onclick={(event) => onOpenUnit(event, unit)}
									>
										<span class="jr-name"
											>Jump {i + 1}{#if best?.id === unit.id}<span class="jr-badge">Best</span
												>{/if}</span
										>
										{#if unit.flight}
											<span class="jr-flight"
												>{ms(unit.flight.realSeconds)}<span class="jr-unit">ms</span></span
											>
											{#if unit.contact}
												<span class="jr-more">
													<span class="jr-contact"
														><span class="jr-inline-label">Contact</span>{ms(
															unit.contact.realSeconds
														)}<span class="jr-unit">ms</span></span
													>
													<span class="jr-rsi"
														><span class="jr-inline-label">RSI</span>{index(unit) ?? '–'}</span
													>
												</span>
											{:else}
												<span class="jr-missing">Add a {plantName} to measure contact and RSI</span>
											{/if}
										{:else}
											<span class="jr-flight jr-none">–</span>
											<span class="jr-missing"
												>{unit.takeoff ? 'Mark the landing' : 'Mark the takeoff and landing'} to finish
												this jump</span
											>
										{/if}
										<svg class="jr-chevron" viewBox="0 0 16 16" aria-hidden="true"
											><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
										>
									</button>
								</li>
							{/each}
						</ul>
						{#if frameMs > 0}
							<p class="jr-footnote">
								Times are read from frames: ±{precision} ms per frame{#if timeScale !== 1}, in real
									time{/if}.
							</p>
						{/if}
					</div>
				{:else}
					<div class="jr-empty">
						<p class="jr-empty-title">No jumps yet</p>
						<p class="jr-empty-text">
							Mark a {plantName}, a takeoff and a landing in the video. Each jump shows up here with
							its flight time.
						</p>
						<button class="jr-empty-action" onclick={onBack}>Back to the video</button>
					</div>
				{/if}

				{#if unpaired.length}
					<div class="jr-section">
						<h2 class="jr-heading">Unpaired marks</h2>
						<p class="jr-section-note">
							These marks aren't part of a jump, so they aren't timed. Open one to move or remove
							it.
						</p>
						<ul class="jr-list">
							{#each unpaired as mark (mark.id)}
								<li>
									<button class="jr-row jr-unpaired" onclick={(event) => onOpenMark(event, mark)}>
										<span class="jr-name">{mark.type === 'takeoff' ? 'Takeoff' : 'Landing'}</span>
										<span class="jr-time">{clock(mark)}</span>
										<svg class="jr-chevron" viewBox="0 0 16 16" aria-hidden="true"
											><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
										>
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<details class="jr-details" bind:open={detailsOpen}>
				<summary class="jr-toggle">
					Session details
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
				</summary>
				<div class="jr-fields">
					<label class="jr-field">
						<span>Title</span>
						<input bind:value={title} placeholder={titlePlaceholder} spellcheck="false" />
					</label>
					<label class="jr-field">
						<span>Jump type</span>
						<select bind:value={jumpType}>
							{#if jumpType === null}<option value={null}>Not set</option>{/if}
							{#each JUMP_TYPES as type (type.value)}<option value={type.value}>{type.label}</option
								>{/each}
						</select>
					</label>
					<label class="jr-field">
						<span>Footage</span>
						<select bind:value={timeScale}>
							{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
									>{scale.label}</option
								>{/each}
						</select>
					</label>
					<label class="jr-field">
						<span>Recorded</span>
						<input
							type="datetime-local"
							bind:value={() => toLocalInput(recordedAt), fromLocalInput}
						/>
					</label>
					<label class="jr-field jr-notes">
						<span>Notes</span>
						<textarea bind:value={notes} placeholder="Exercise, attempt, how it felt…" rows="4"
						></textarea>
					</label>
				</div>
			</details>
		</div>
	</div>
</section>

<style>
	.jr {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: hsl(var(--at-bg));
		animation: jr-in 240ms var(--at-ease) both;
	}

	@keyframes jr-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.jr-bar {
		position: relative;
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		height: 52px;
		padding: 0 12px;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.jr-back {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 36px;
		padding: 0 12px 0 6px;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: hsl(var(--at-accent-fg));
		font: inherit;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jr-back svg,
	.jr-chevron,
	.jr-details summary svg {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.jr-bar-title {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		pointer-events: none;
	}

	.jr-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--at-border-hover)) transparent;
	}

	.jr-page {
		display: flex;
		flex-direction: column;
		gap: 28px;
		width: min(640px, 100%);
		margin: 0 auto;
		padding: 24px 20px calc(40px + env(safe-area-inset-bottom));
	}

	.jr-main {
		display: flex;
		flex-direction: column;
		gap: 28px;
		min-width: 0;
	}

	.jr-title {
		margin: 0;
		overflow: hidden;
		color: hsl(var(--at-fg));
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.2;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.jr-title:focus {
		outline: none;
	}

	.jr-meta {
		margin: 6px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		line-height: 20px;
	}

	.jr-summary {
		display: flex;
		align-items: flex-end;
		gap: 40px;
	}

	.jr-lead,
	.jr-stat {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.jr-label {
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 16px;
	}

	.jr-lead-value,
	.jr-stat-value {
		color: hsl(var(--at-fg));
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1;
		white-space: nowrap;
	}

	.jr-lead-value {
		font-size: 64px;
	}

	.jr-stat-value {
		padding-bottom: 5px;
		color: hsl(var(--at-fg-secondary));
		font-size: 28px;
		letter-spacing: -0.02em;
	}

	.jr-unit {
		margin-left: 0.16em;
		color: hsl(var(--at-fg-muted));
		font-size: 0.6em;
		font-weight: 500;
		letter-spacing: 0;
	}

	.jr-lead-value .jr-unit {
		font-size: 0.36em;
		color: hsl(var(--at-fg-secondary));
	}

	.jr-section {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.jr-heading {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
	}

	.jr-section-note {
		margin: 4px 0 12px;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 1.5;
	}

	.jr-columns {
		display: none;
	}

	.jr-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
		list-style: none;
		overflow: hidden;
	}

	.jr-list li + li {
		border-top: 1px solid hsl(var(--at-border));
	}

	/* A phone: the jump and its flight on one line, contact and RSI under them. */
	.jr-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 18px;
		grid-template-areas:
			'name flight chevron'
			'more more chevron';
		align-items: center;
		column-gap: 10px;
		row-gap: 2px;
		width: 100%;
		min-height: 64px;
		padding: 10px 10px 10px 16px;
		border: none;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: left;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jr-row:focus-visible {
		outline-offset: -2px;
	}

	.jr-name {
		grid-area: name;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 15px;
		font-weight: 500;
	}

	.jr-badge {
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

	.jr-flight {
		grid-area: flight;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.jr-none {
		color: hsl(var(--at-fg-muted));
	}

	/* Contact and RSI share the second line. */
	.jr-more,
	.jr-missing {
		grid-area: more;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 18px;
	}

	.jr-more {
		display: flex;
		gap: 14px;
	}

	.jr-contact .jr-unit {
		font-size: 1em;
	}

	.jr-inline-label {
		margin-right: 0.3em;
	}

	.jr-missing {
		color: hsl(var(--at-accent-hover));
	}

	.jr-chevron {
		grid-area: chevron;
		color: hsl(var(--at-fg-muted));
	}

	.jr-unpaired {
		grid-template-areas: 'name flight chevron';
		min-height: 52px;
	}

	.jr-time {
		grid-area: flight;
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
		font-size: 13px;
	}

	.jr-footnote {
		margin: 10px 4px 0;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 1.5;
	}

	.jr-empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 24px 20px;
		border: 1px dashed hsl(var(--at-border-hover));
		border-radius: 14px;
	}

	.jr-empty-title {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 16px;
		font-weight: 600;
	}

	.jr-empty-text {
		max-width: 420px;
		margin: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		line-height: 1.5;
	}

	.jr-empty-action {
		height: 44px;
		margin-top: 10px;
		padding: 0 18px;
		border: 1px solid hsl(var(--at-accent) / 0.55);
		border-radius: 12px;
		background: hsl(var(--at-accent) / 0.24);
		color: hsl(var(--at-accent-fg));
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}

	/* ---- Session details ---- */

	.jr-details {
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
	}

	.jr-details summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 52px;
		padding: 0 14px 0 16px;
		border-radius: 14px;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		list-style: none;
		cursor: pointer;
	}

	.jr-details summary::-webkit-details-marker {
		display: none;
	}

	.jr-details summary svg {
		color: hsl(var(--at-fg-muted));
		transition: transform 180ms var(--at-ease);
	}

	.jr-details[open] summary svg {
		transform: rotate(180deg);
	}

	.jr-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 14px 12px;
		padding: 4px 16px 18px;
	}

	.jr-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
	}

	.jr-field:first-child,
	.jr-field:nth-child(4),
	.jr-notes {
		grid-column: 1 / -1;
	}

	.jr-field input,
	.jr-field select,
	.jr-field textarea {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 10px 12px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 10px;
		background: hsl(var(--at-bg));
		color: hsl(var(--at-fg));
		font: inherit;
		/* 16px keeps iOS from zooming the page when a field takes focus. */
		font-size: 16px;
	}

	.jr-field textarea {
		resize: vertical;
		line-height: 1.45;
	}

	.jr-field input:focus-visible,
	.jr-field select:focus-visible,
	.jr-field textarea:focus-visible {
		outline-offset: 0;
		border-color: transparent;
	}

	@media (hover: hover) {
		.jr-back:hover {
			background: hsl(var(--at-fg) / 0.08);
		}
		.jr-row:hover {
			background: hsl(var(--at-fg) / 0.04);
		}
		.jr-empty-action:hover {
			background: hsl(var(--at-accent) / 0.34);
			color: hsl(var(--at-fg));
		}
	}

	@media (pointer: coarse) {
		.jr-back::after {
			content: '';
			position: absolute;
			inset: -4px 0;
		}
	}

	/* ---- Wider: a table of jumps ---- */

	@media (min-width: 701px) and (min-height: 501px) {
		.jr-page {
			gap: 32px;
			padding: 40px 32px 56px;
		}

		.jr-title {
			font-size: 30px;
		}

		.jr-meta {
			font-size: 15px;
		}

		.jr-lead-value {
			font-size: 84px;
		}

		.jr-stat-value {
			padding-bottom: 8px;
			font-size: 34px;
		}

		.jr-summary {
			gap: 56px;
		}

		.jr-columns,
		.jr-row {
			display: grid;
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.7fr) 18px;
			grid-template-areas: 'name flight contact rsi chevron';
			column-gap: 16px;
		}

		.jr-columns {
			padding: 0 11px 8px 17px;
			color: hsl(var(--at-fg-muted));
			font-size: 13px;
		}

		.jr-row {
			min-height: 56px;
			padding-block: 8px;
		}

		.jr-more {
			display: contents;
		}

		.jr-contact {
			grid-area: contact;
		}

		.jr-rsi {
			grid-area: rsi;
		}

		.jr-contact,
		.jr-rsi {
			color: hsl(var(--at-fg));
			font-size: 16px;
		}

		.jr-contact .jr-unit {
			font-size: 0.75em;
		}

		.jr-inline-label {
			display: none;
		}

		.jr-missing {
			grid-row: 1;
			grid-column: contact-start / rsi-end;
			font-size: 14px;
		}

		.jr-unpaired {
			grid-template-areas: 'name flight . . chevron';
		}
	}

	/* Desktop: the session's details beside the results rather than under them. */
	@media (min-width: 1100px) and (min-height: 501px) {
		.jr-page {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 340px;
			align-items: start;
			gap: 56px;
			width: min(1120px, 100%);
			padding: 48px 40px 64px;
		}

		.jr-details {
			position: sticky;
			top: 48px;
		}

		.jr-details summary {
			pointer-events: none;
		}

		.jr-details summary svg {
			display: none;
		}

		.jr-field input,
		.jr-field select,
		.jr-field textarea {
			min-height: 38px;
			padding: 8px 10px;
			font-size: 14px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.jr {
			animation: none;
		}
		.jr-details summary svg {
			transition: none;
		}
	}
</style>
