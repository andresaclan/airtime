<script lang="ts">
	import { frameOf, rsi, type Mark } from '$lib/video/marks';
	import { averageFlight, type JumpUnit } from '$lib/video/jumpUnits';
	import { plantLabel } from '$lib/video/guide';
	import { frameDurationRange, frameLabel, type FrameTiming } from '$lib/video/frames';
	import { formatFrameClock } from '$lib/video/timecode';
	import { JUMP_TYPES, TIME_SCALES, type JumpType } from '$lib/session/schema';

	// The session's results, on their own: flight time first, then each jump's contact
	// and RSI, then the session's own details. A jump opens back in the video to be
	// corrected.
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

	let completed = $derived(units.filter((unit) => unit.flight));
	let lead = $derived(best ?? completed[0]);
	let leadNumber = $derived(lead ? units.indexOf(lead) + 1 : 0);
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
		<div class="jr-bar-in">
			<button class="jr-back" onclick={onBack}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
				Video
			</button>
			<span class="jr-bar-title">Results</span>
		</div>
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
						<div class="jr-stat jr-lead">
							<span class="jr-label"
								>{best ? `Best flight · Jump ${leadNumber}` : 'Flight time'}</span
							>
							<span class="jr-value"
								>{ms(lead.flight.realSeconds)}<span class="jr-unit">ms</span></span
							>
						</div>
						{#if best && average !== undefined}
							<div class="jr-stat">
								<span class="jr-label">Average flight</span>
								<span class="jr-value">{ms(average)}<span class="jr-unit">ms</span></span>
							</div>
						{/if}
					</div>
				{/if}

				<section class="jr-section" aria-labelledby="jr-jumps">
					<h2 id="jr-jumps" class="jr-heading">Jumps</h2>
					{#if units.length}
						<div class="jr-table">
							<div class="jr-columns" aria-hidden="true">
								<span>Jump</span><span>Flight</span><span>Contact</span><span>RSI</span>
							</div>
							<ul class="jr-list">
								{#each units as unit, i (unit.id)}
									<li>
										<button
											class="jr-row"
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
													<span class="jr-missing">Add a {plantName} for contact and RSI</span>
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
						</div>
						{#if frameMs > 0}
							<p class="jr-footnote">
								Times are read from frames: ±{precision} ms per frame{#if timeScale !== 1}, in real
									time{/if}.
							</p>
						{/if}
					{:else}
						<div class="jr-empty">
							<p class="jr-empty-title">No jumps yet</p>
							<p class="jr-empty-text">
								Mark a {plantName}, a takeoff and a landing in the video. Each jump shows up here
								with its flight time.
							</p>
							<button class="jr-empty-action" onclick={onBack}>Back to the video</button>
						</div>
					{/if}
				</section>

				{#if unpaired.length}
					<section class="jr-section" aria-labelledby="jr-unpaired">
						<h2 id="jr-unpaired" class="jr-heading">Unpaired marks</h2>
						<p class="jr-section-note">
							These marks aren't part of a jump, so they aren't timed. Open one to move or remove
							it.
						</p>
						<div class="jr-table">
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
					</section>
				{/if}
			</div>

			<!-- The session's own details: one row each, the label on the left and its value
			     on the right, edited in place. -->
			<section class="jr-section jr-session" aria-labelledby="jr-session">
				<h2 id="jr-session" class="jr-heading">Session</h2>
				<div class="jr-group">
					<label class="jr-prop">
						<span class="jr-prop-name">Title</span>
						<input bind:value={title} placeholder={titlePlaceholder} spellcheck="false" />
					</label>
					<label class="jr-prop">
						<span class="jr-prop-name">Jump type</span>
						<span class="jr-select">
							<select bind:value={jumpType}>
								{#if jumpType === null}<option value={null}>Not set</option>{/if}
								{#each JUMP_TYPES as type (type.value)}<option value={type.value}
										>{type.label}</option
									>{/each}
							</select>
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><path d="m5 6.5 3-3 3 3M5 9.5l3 3 3-3" /></svg
							>
						</span>
					</label>
					<label class="jr-prop">
						<span class="jr-prop-name">Footage</span>
						<span class="jr-select">
							<select bind:value={timeScale}>
								{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
										>{scale.label}</option
									>{/each}
							</select>
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><path d="m5 6.5 3-3 3 3M5 9.5l3 3 3-3" /></svg
							>
						</span>
					</label>
					<label class="jr-prop">
						<span class="jr-prop-name">Recorded</span>
						<input
							type="datetime-local"
							bind:value={() => toLocalInput(recordedAt), fromLocalInput}
						/>
					</label>
				</div>
				<label class="jr-group jr-notes">
					<span class="jr-prop-name">Notes</span>
					<textarea bind:value={notes} placeholder="Exercise, attempt, how it felt…" rows="3"
					></textarea>
				</label>
			</section>
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

	/* ---- The bar: back to the video ---- */

	.jr-bar {
		flex: 0 0 auto;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.jr-bar-in {
		position: relative;
		display: flex;
		align-items: center;
		height: 52px;
		padding: 0 12px;
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
		color: hsl(var(--at-emphasis-fg));
		font: inherit;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jr-back svg,
	.jr-chevron,
	.jr-select svg {
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

	/* ---- The page ---- */

	.jr-scroll {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--at-border-hover)) transparent;
	}

	.jr-page {
		--gutter: 20px;
		display: flex;
		flex-direction: column;
		gap: 32px;
		width: min(680px, 100%);
		margin: 0 auto;
		padding: 24px var(--gutter) calc(40px + env(safe-area-inset-bottom));
	}

	.jr-main {
		display: flex;
		flex-direction: column;
		gap: 32px;
		min-width: 0;
	}

	.jr-title {
		margin: 0;
		overflow: hidden;
		color: hsl(var(--at-fg));
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 32px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.jr-title:focus {
		outline: none;
	}

	.jr-meta {
		margin: 4px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		line-height: 20px;
	}

	/* ---- Flight time first ---- */

	/* The numbers share a baseline, each under its own label. */
	.jr-summary {
		display: flex;
		align-items: flex-end;
		align-items: last baseline;
		gap: 36px;
	}

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
		white-space: nowrap;
	}

	.jr-value {
		color: hsl(var(--at-fg-secondary));
		font-size: 28px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		line-height: 1;
		white-space: nowrap;
	}

	.jr-lead .jr-value {
		color: hsl(var(--at-fg));
		font-size: 64px;
		letter-spacing: -0.035em;
	}

	.jr-unit {
		margin-left: 0.16em;
		color: hsl(var(--at-fg-muted));
		font-size: 0.6em;
		font-weight: 500;
		letter-spacing: 0;
	}

	.jr-lead .jr-unit {
		color: hsl(var(--at-fg-secondary));
		font-size: 0.34em;
	}

	/* ---- Sections: a heading over one grouped card ---- */

	.jr-section {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.jr-heading {
		margin: 0 0 10px;
		padding: 0 2px;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		line-height: 20px;
	}

	.jr-section-note {
		margin: -4px 2px 12px;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 1.5;
	}

	.jr-table,
	.jr-group {
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
		overflow: hidden;
	}

	.jr-columns {
		display: none;
	}

	.jr-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
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
		color: hsl(var(--at-emphasis-strong));
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
		margin: 10px 2px 0;
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
		border: 1px solid hsl(var(--at-emphasis) / 0.55);
		border-radius: 12px;
		background: hsl(var(--at-emphasis) / 0.24);
		color: hsl(var(--at-emphasis-fg));
		font: inherit;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}

	/* ---- The session's details ---- */

	.jr-session {
		gap: 0;
	}

	.jr-prop {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 48px;
		padding: 0 16px;
		color: hsl(var(--at-fg));
		transition: background 140ms var(--at-ease);
	}

	.jr-prop + .jr-prop {
		border-top: 1px solid hsl(var(--at-border));
	}

	.jr-prop-name {
		flex: 0 0 auto;
		color: hsl(var(--at-fg-secondary));
		font-size: 15px;
	}

	/* The value fills the rest of the row and reads from the right edge. Its own box is
	   invisible: the row is the field, and takes the focus ring. */
	.jr-prop input,
	.jr-prop select,
	.jr-notes textarea {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
		border-radius: 0;
		outline: none;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		/* 16px keeps iOS from zooming the page when a field takes focus. */
		font-size: 16px;
		appearance: none;
	}

	.jr-prop input,
	.jr-prop select {
		height: 46px;
	}

	.jr-prop input:not([type='datetime-local']) {
		flex: 1 1 auto;
		text-align: right;
		text-overflow: ellipsis;
	}

	/* The date keeps the width of its own text, so it sits against the right edge too. */
	.jr-prop input[type='datetime-local'] {
		flex: 0 1 auto;
		margin-left: auto;
		font-variant-numeric: tabular-nums;
	}

	.jr-prop input::placeholder,
	.jr-notes textarea::placeholder {
		color: hsl(var(--at-fg-muted));
	}

	.jr-prop input[type='datetime-local']::-webkit-calendar-picker-indicator {
		margin-left: 6px;
		opacity: 0.55;
		cursor: pointer;
	}

	.jr-select {
		position: relative;
		display: flex;
		flex: 1 1 auto;
		justify-content: flex-end;
		min-width: 0;
	}

	.jr-select select {
		max-width: 100%;
		padding-right: 22px;
		text-align: right;
		text-align-last: right;
		text-overflow: ellipsis;
		cursor: pointer;
	}

	.jr-select svg {
		position: absolute;
		top: 50%;
		right: -2px;
		width: 16px;
		height: 16px;
		color: hsl(var(--at-fg-muted));
		transform: translateY(-50%);
		pointer-events: none;
	}

	.jr-prop:focus-within,
	.jr-notes:focus-within {
		background: hsl(var(--at-fg) / 0.03);
		box-shadow: inset 0 0 0 2px hsl(var(--at-emphasis));
	}

	.jr-group:has(.jr-prop:first-child:focus-within) .jr-prop:first-child {
		border-radius: 13px 13px 0 0;
	}

	.jr-group:has(.jr-prop:last-child:focus-within) .jr-prop:last-child {
		border-radius: 0 0 13px 13px;
	}

	.jr-notes {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 12px;
		padding: 12px 16px 14px;
		cursor: text;
	}

	.jr-notes textarea {
		width: 100%;
		min-height: 3lh;
		max-height: 14lh;
		line-height: 1.45;
		resize: none;
		field-sizing: content;
	}

	@media (hover: hover) {
		.jr-back:hover {
			background: hsl(var(--at-fg) / 0.08);
		}
		.jr-row:hover,
		.jr-prop:hover:not(:focus-within) {
			background: hsl(var(--at-fg) / 0.04);
		}
		.jr-row:hover .jr-chevron {
			color: hsl(var(--at-fg-secondary));
		}
		.jr-empty-action:hover {
			background: hsl(var(--at-emphasis) / 0.34);
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

	/* ---- Wider: the jumps as a table ---- */

	@media (min-width: 701px) and (min-height: 501px) {
		.jr-page {
			--gutter: 32px;
			gap: 40px;
			padding-top: 40px;
			padding-bottom: 56px;
		}

		.jr-bar-in {
			width: min(680px, 100%);
			margin: 0 auto;
			padding: 0 calc(var(--gutter, 32px) - 8px);
		}

		.jr-main {
			gap: 40px;
		}

		.jr-title {
			font-size: 30px;
			line-height: 36px;
		}

		.jr-meta {
			margin-top: 6px;
			font-size: 15px;
		}

		.jr-summary {
			gap: 56px;
		}

		.jr-value {
			font-size: 34px;
		}

		.jr-lead .jr-value {
			font-size: 84px;
		}

		.jr-columns,
		.jr-row {
			display: grid;
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.7fr) 18px;
			grid-template-areas: 'name flight contact rsi chevron';
			column-gap: 16px;
		}

		/* The column names are the table's first row. */
		.jr-columns {
			align-items: center;
			height: 40px;
			padding: 0 10px 0 16px;
			border-bottom: 1px solid hsl(var(--at-border));
			background: hsl(var(--at-fg) / 0.025);
			color: hsl(var(--at-fg-muted));
			font-size: 13px;
		}

		.jr-row {
			min-height: 52px;
			padding-block: 6px;
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

	/* Desktop: the session's details beside the results, staying in view. */
	@media (min-width: 1100px) and (min-height: 501px) {
		.jr-page {
			--gutter: 40px;
			display: grid;
			grid-template-columns: minmax(0, 1fr) 344px;
			align-items: start;
			gap: 64px;
			width: min(1160px, 100%);
			padding-top: 48px;
			padding-bottom: 64px;
		}

		.jr-bar-in {
			width: min(1160px, 100%);
		}

		/* Its heading sits on the title's baseline. */
		.jr-session {
			position: sticky;
			top: 48px;
			padding-top: 10px;
		}

		.jr-prop {
			min-height: 44px;
		}

		.jr-prop-name {
			font-size: 14px;
		}

		.jr-prop input,
		.jr-prop select,
		.jr-notes textarea {
			font-size: 14px;
		}

		.jr-prop input,
		.jr-prop select {
			height: 42px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.jr {
			animation: none;
		}
		.jr-row,
		.jr-prop,
		.jr-back {
			transition: none;
		}
	}
</style>
