<script lang="ts">
	import { frameOf, rsi, type Mark } from '$lib/video/marks';
	import { averageFlight, bestFlightLabel, type JumpUnit } from '$lib/video/jumpUnits';
	import { plantLabel } from '$lib/video/guide';
	import { frameDurationRange, frameLabel, type FrameTiming } from '$lib/video/frames';
	import { formatFrameClock } from '$lib/video/timecode';
	import { JUMP_TYPES, TIME_SCALES, type JumpType } from '$lib/session/schema';

	// The session's results, on their own: flight time first, then each jump's contact
	// and RSI, then the session's own details. A jump opens back in the video to be
	// corrected.
	interface Props {
		originalName?: string;
		onOriginal?: () => void;
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
		originalName,
		onOriginal,
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
	let recordedValue = $derived.by(() => {
		const date = new Date(recordedAt);
		return Number.isNaN(date.getTime())
			? ''
			: date.toLocaleString(undefined, {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
					hour: 'numeric',
					minute: '2-digit'
				});
	});
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

	// The completed jumps side by side, on one scale from zero to the longest flight.
	let longestFlight = $derived(Math.max(...completed.map((unit) => unit.flight!.realSeconds)));

	const ms = (seconds: number) => Math.round(seconds * 1000);
	const clock = (mark: Mark) =>
		formatFrameClock(frameLabel(frameOf(mark.time, timing), timing), timing);

	function index(unit: JumpUnit): string | undefined {
		if (!unit.takeoff) return undefined;
		return rsi({ takeoff: unit.takeoff, flight: unit.flight, contact: unit.contact })?.toFixed(2);
	}

	// What a jump still needs, on the row's last line. Gaps stay out of the value columns.
	function gap(unit: JumpUnit): string {
		if (!unit.flight) return unit.takeoff ? 'Needs landing' : 'Needs takeoff and landing';
		return unit.contact ? '' : `Add a ${plantName} for contact and RSI`;
	}

	// The row's spoken name: what it shows, then where selecting it goes. Callers open a
	// jump at its takeoff, otherwise at its plant.
	function describe(unit: JumpUnit, number: number): string {
		const parts = [`Jump ${number}`];
		const label = bestFlightLabel(unit, completed, best);
		if (label) parts.push(label.toLowerCase());
		if (unit.flight) {
			parts.push(`flight ${ms(unit.flight.realSeconds)} milliseconds`);
			if (unit.contact) {
				parts.push(`contact ${ms(unit.contact.realSeconds)} milliseconds`);
				const reactive = index(unit);
				if (reactive) parts.push(`RSI ${reactive}`);
			} else parts.push(`no ${plantName}, contact and RSI not measured`);
		} else {
			parts.push(
				unit.takeoff ? 'in progress, needs landing' : 'in progress, needs takeoff and landing'
			);
		}
		const at = unit.takeoff ? 'takeoff' : `the ${plantName}`;
		const where = originalName
			? `Choose ${originalName} to open it at ${at}`
			: `Open the video at ${at}`;
		return `${parts.join(', ')}. ${where}`;
	}

	// Very long measurements, or triple-digit jump numbers, don't fit the shared columns.
	// Those lists drop the columns and let each labelled value take its own width.
	let wideValues = $derived(
		units.length >= 100 ||
			units.some(
				(unit) =>
					!!unit.flight &&
					(String(ms(unit.flight.realSeconds)).length > 4 ||
						(!!unit.contact &&
							(String(ms(unit.contact.realSeconds)).length > 4 || (index(unit)?.length ?? 0) > 7)))
			)
	);

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

	// The date field sits invisibly over its designed value. A tap on it opens the
	// platform's picker by itself on phones; desktop browsers open it on request.
	function openPicker(event: Event) {
		try {
			(event.currentTarget as HTMLInputElement).showPicker();
		} catch {
			// Already open, or the browser can't: the field still edits from the keyboard.
		}
	}

	function pickerKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openPicker(event);
		}
	}
</script>

<section class="jr" aria-labelledby="jr-title">
	<div class="jr-bar">
		<div class="jr-bar-in">
			<button class="jr-back" onclick={onBack}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
				{originalName ? 'Home' : 'Video'}
			</button>
			<span class="jr-bar-title">Results</span>
			{#if originalName}<button
					class="jr-back jr-original"
					title={originalName}
					onclick={onOriginal}>Open original video</button
				>{/if}
		</div>
	</div>

	<div class="jr-scroll">
		<div class="jr-page">
			<div class="jr-main">
				<header class="jr-head">
					<h1 id="jr-title" class="jr-title" tabindex="-1">{title.trim() || titlePlaceholder}</h1>
					<p class="jr-meta">
						{[
							`${completed.length} completed ${completed.length === 1 ? 'jump' : 'jumps'}`,
							units.length > completed.length
								? `${units.length - completed.length} in progress`
								: null,
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
								>{best
									? bestFlightLabel(lead, completed, best) === 'Joint best'
										? 'Joint best flight'
										: `Best flight · Jump ${leadNumber}`
									: 'Flight time'}</span
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

				{#if originalName}<p class="jr-footnote">
						Open {originalName} to inspect frames. Contact time and RSI use the saved average frame rate
						and are estimates for variable-frame-rate video.
					</p>{/if}
				<section class="jr-section" aria-labelledby="jr-jumps">
					<!-- The heading says where a jump opens: the video, or the original's chooser. -->
					<div class="jl-head">
						<h2 id="jr-jumps" class="jr-heading">Jumps</h2>
						{#if units.length}<span class="jl-dest"
								>{originalName
									? 'Select a jump to choose the original video'
									: 'Select a jump to open it in the video'}</span
							>{/if}
					</div>
					{#if units.length}
						<!-- The card is a container: rows follow its width, not the window's. -->
						<div class="jl-card" class:jl-wide-values={wideValues}>
							<div class="jl-cols" aria-hidden="true">
								<span class="jl-col-name">Jump</span><span class="jl-col-flight">Flight</span><span
									class="jl-col-contact">Contact</span
								><span class="jl-col-rsi">RSI</span>
							</div>
							<!-- role="list" keeps the list in WebKit's accessibility tree without its bullets. -->
							<ul class="jl-list" role="list">
								{#each units as unit, i (unit.id)}
									{@const label = bestFlightLabel(unit, completed, best)}
									{@const reactive = unit.contact ? index(unit) : undefined}
									{@const missing = gap(unit)}
									<li>
										<button
											class="jl-row"
											aria-label={describe(unit, i + 1)}
											onclick={(event) => onOpenUnit(event, unit)}
										>
											<span class="jl-id"
												><span class="jl-name">Jump {i + 1}</span>{#if label}<span class="jl-badge"
														>{label}</span
													>{/if}</span
											>
											<span class="jl-measures">
												<span class="jl-v jl-flight"
													><span class="jl-local">Flight</span>{#if unit.flight}{ms(
															unit.flight.realSeconds
														)}<span class="jl-u">ms</span>{:else}<span class="jl-none">—</span
														>{/if}</span
												>
												<span class="jl-v jl-contact"
													><span class="jl-local">Contact</span
													>{#if unit.flight && unit.contact}{ms(unit.contact.realSeconds)}<span
															class="jl-u">ms</span
														>{:else}<span class="jl-none">—</span>{/if}</span
												>
												<span class="jl-v jl-rsi"
													><span class="jl-local">RSI</span
													>{#if unit.flight && reactive}{reactive}{:else}<span class="jl-none"
															>—</span
														>{/if}</span
												>
											</span>
											{#if missing}<span class="jl-note">{missing}</span>{/if}
											{#if originalName}
												<svg class="jl-go" viewBox="0 0 16 16" aria-hidden="true"
													><path
														d="M1.5 5V4a1 1 0 0 1 1-1h3l1.5 2h6.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
													/></svg
												>
											{:else}
												<svg class="jl-go" viewBox="0 0 16 16" aria-hidden="true"
													><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
												>
											{/if}
										</button>
									</li>
								{/each}
							</ul>
						</div>
						{#if frameMs > 0}
							<p class="jl-foot">
								RSI (reactive strength index) is estimated jump height in metres divided by contact
								time in seconds. {originalName
									? 'Nominal precision'
									: 'Times are read from frames'}: ±{precision} ms per frame{#if timeScale !== 1},
									in real time{/if}.
							</p>
						{/if}
					{:else}
						<div class="jl-empty">
							<p class="jl-empty-title">No jumps yet</p>
							<p class="jl-empty-text">
								Mark takeoff and landing for flight time. Add a {plantName} for contact time and RSI.
							</p>
							<button class="jl-empty-action" onclick={originalName ? onOriginal : onBack}
								>{originalName ? 'Open original video' : 'Back to the video'}</button
							>
						</div>
					{/if}
				</section>

				{#if best}
					<section class="jr-section jr-compare" aria-labelledby="jr-compare">
						<h2 id="jr-compare" class="jr-heading">Flight by jump</h2>
						<ol class="jr-bars">
							{#each completed as unit (unit.id)}
								{@const flight = unit.flight!.realSeconds}
								<li class="jr-bar-row" class:jr-bar-best={!!bestFlightLabel(unit, completed, best)}>
									<span class="jr-bar-name">Jump {units.indexOf(unit) + 1}</span>
									<span class="jr-bar-track" aria-hidden="true"
										><span class="jr-bar-fill" style:width="{(flight / longestFlight) * 100}%"
										></span></span
									>
									<span class="jr-bar-value">{ms(flight)}<span class="jr-unit">ms</span></span>
								</li>
							{/each}
						</ol>
					</section>
				{/if}

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
						<input
							readonly={!!originalName}
							bind:value={title}
							placeholder={titlePlaceholder}
							spellcheck="false"
						/>
					</label>
					<label class="jr-prop">
						<span class="jr-prop-name">Jump type</span>
						<span class="jr-select">
							<select disabled={!!originalName} bind:value={jumpType}>
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
							<select disabled={!!originalName} bind:value={timeScale}>
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
						<span class="jr-select jr-date">
							<span class="jr-date-value" class:jr-date-empty={!recordedValue} aria-hidden="true"
								>{recordedValue || 'Not set'}</span
							>
							<input
								disabled={!!originalName}
								type="datetime-local"
								bind:value={() => toLocalInput(recordedAt), fromLocalInput}
								onclick={openPicker}
								onkeydown={pickerKey}
							/>
							<svg viewBox="0 0 16 16" aria-hidden="true"
								><path d="m5 6.5 3-3 3 3M5 9.5l3 3 3-3" /></svg
							>
						</span>
					</label>
				</div>
				<p class="jr-footnote">Recorded initially uses the video file’s last modified date.</p>
				<label class="jr-group jr-notes">
					<span class="jr-prop-name">Notes</span>
					<textarea
						readonly={!!originalName}
						bind:value={notes}
						placeholder="Exercise, attempt, how it felt…"
						rows="3"
					></textarea>
				</label>
			</section>
		</div>
	</div>
</section>

<style>
	.jr-original {
		margin-left: auto;
	}
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

	/* Unpaired marks: the mark and its time on one line. */
	.jr-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 18px;
		align-items: center;
		column-gap: 10px;
		row-gap: 2px;
		width: 100%;
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

	/* ---- Jumps: the heading, then one card of rows ---- */

	.jl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 20px;
		margin: 0 0 8px;
	}

	.jl-head .jr-heading {
		flex: 0 0 auto;
		margin: 0;
		padding: 0;
	}

	.jl-dest {
		min-width: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 16px;
		text-align: right;
	}

	.jl-card {
		container: jl / inline-size;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: var(--at-radius-lg);
		background: hsl(var(--at-bg-elevated));
		overflow: hidden;
	}

	/* One grid serves the column names and every row, so the values line up. RSI keeps
	   68px so a four-digit index stays on one line. */
	.jl-cols,
	.jl-row {
		display: grid;
		grid-template-columns:
			minmax(64px, 1fr) minmax(0, 1.12fr) minmax(0, 1.08fr) minmax(68px, 1fr)
			16px;
		column-gap: 8px;
		padding-right: 12px;
		padding-left: 16px;
	}

	.jl-cols {
		grid-template-areas: 'name flight contact rsi .';
		align-items: center;
		height: 32px;
		border-bottom: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-fg) / 0.025);
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
	}

	.jl-col-name {
		grid-area: name;
	}

	.jl-col-flight {
		grid-area: flight;
	}

	.jl-col-contact {
		grid-area: contact;
	}

	.jl-col-rsi {
		grid-area: rsi;
	}

	.jl-col-flight,
	.jl-col-contact,
	.jl-col-rsi {
		text-align: right;
	}

	.jl-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.jl-list li + li {
		border-top: 1px solid hsl(var(--at-border));
	}

	/* Corners follow the card, so the focus ring does too. */
	.jl-list li:last-child .jl-row {
		border-radius: 0 0 11px 11px;
	}

	.jl-row {
		grid-template-areas:
			'name  flight contact rsi  go'
			'badge badge  badge   badge go'
			'note  note   note    note go';
		align-items: baseline;
		width: 100%;
		min-height: 56px;
		padding-top: 16px;
		padding-bottom: 16px;
		border: none;
		border-radius: 0;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: left;
		cursor: pointer;
		transition: background 140ms var(--at-ease);
	}

	.jl-row:focus-visible {
		outline: 2px solid hsl(var(--at-emphasis));
		outline-offset: -2px;
	}

	/* The name and badge share the name's cell; the badge drops under it until wide. */
	.jl-id {
		display: contents;
	}

	.jl-name {
		grid-area: name;
		font-size: 15px;
		font-weight: 500;
		line-height: 20px;
		white-space: nowrap;
	}

	.jl-badge {
		grid-area: badge;
		justify-self: start;
		display: inline-flex;
		align-items: center;
		height: 20px;
		margin-top: 4px;
		padding: 0 8px;
		border-radius: 4px;
		background: hsl(var(--at-fg) / 0.09);
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
		white-space: nowrap;
	}

	.jl-measures {
		display: contents;
	}

	.jl-v {
		min-width: 0;
		color: hsl(var(--at-fg-secondary));
		font-size: 15px;
		line-height: 20px;
		text-align: right;
		white-space: nowrap;
	}

	.jl-flight {
		grid-area: flight;
		color: hsl(var(--at-fg));
		font-size: 16px;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.jl-contact {
		grid-area: contact;
	}

	.jl-rsi {
		grid-area: rsi;
	}

	/* Each value's own name, shown only where the column names aren't. */
	.jl-local {
		display: none;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
		line-height: 16px;
	}

	.jl-u {
		display: inline-block;
		margin-left: 4px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0;
	}

	.jl-none {
		color: hsl(var(--at-fg-muted));
		font-weight: 400;
	}

	.jl-note {
		grid-area: note;
		margin-top: 4px;
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		line-height: 16px;
	}

	.jl-go {
		grid-area: go;
		align-self: center;
		width: 16px;
		height: 16px;
		color: hsl(var(--at-fg-muted));
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* A wide card: the badge joins the name, and the columns spread. */
	@container jl (min-width: 32.5em) {
		.jl-cols,
		.jl-row {
			grid-template-columns: minmax(0, 1.4fr) repeat(3, minmax(0, 1fr)) 16px;
			column-gap: 16px;
		}

		.jl-row {
			grid-template-areas:
				'name flight contact rsi go'
				'note note   note    note go';
		}

		.jl-id {
			grid-area: name;
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 8px;
			min-width: 0;
		}

		.jl-badge {
			margin-top: 0;
		}

		.jl-v {
			font-size: 16px;
		}
	}

	/* A narrow card (a 320px phone): the name over three values, each named. */
	@container jl (width < 21.75em) {
		.jl-cols {
			display: none;
		}

		.jl-row {
			grid-template-columns: repeat(3, minmax(0, 1fr)) 16px;
			grid-template-areas:
				'name   name    name go'
				'flight contact rsi  go'
				'note   note    note go';
			row-gap: 4px;
		}

		.jl-list li:first-child .jl-row {
			border-radius: 11px 11px 0 0;
		}

		.jl-list li:only-child .jl-row {
			border-radius: 11px;
		}

		.jl-v {
			margin-top: 4px;
			text-align: left;
		}

		.jl-local {
			display: block;
		}

		.jl-id {
			grid-area: name;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
		}

		.jl-badge {
			margin-top: 0;
		}
	}

	/* Long measurements take their own width: each named value moves to a new line whole,
	   with its unit, rather than being cut or shrunk. */
	.jl-wide-values .jl-cols {
		display: none;
	}

	.jl-wide-values .jl-row {
		grid-template-columns: minmax(0, 1fr) 16px;
		grid-template-areas:
			'name     go'
			'measures go'
			'note     go';
		row-gap: 4px;
	}

	.jl-wide-values li:first-child .jl-row {
		border-top-left-radius: 11px;
		border-top-right-radius: 11px;
	}

	.jl-wide-values .jl-id {
		grid-area: name;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.jl-wide-values .jl-badge {
		margin: 0;
	}

	.jl-wide-values .jl-measures {
		grid-area: measures;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 8px 12px;
		margin-top: 4px;
	}

	.jl-wide-values .jl-v {
		flex: 1 0 max-content;
		margin: 0;
		text-align: left;
	}

	.jl-wide-values .jl-local {
		display: block;
	}

	.jl-foot {
		margin: 8px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 16px;
	}

	/* Empty: one way back to the marks. */
	.jl-empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 24px 20px;
		border: 1px dashed hsl(var(--at-border-hover));
		border-radius: var(--at-radius-lg);
	}

	.jl-empty-title {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 16px;
		font-weight: 600;
		line-height: 24px;
	}

	.jl-empty-text {
		max-width: 420px;
		margin: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		line-height: 20px;
	}

	.jl-empty-action {
		height: 44px;
		margin-top: 12px;
		padding: 0 16px;
		border: 1px solid hsl(var(--at-emphasis) / 0.55);
		border-radius: var(--at-radius-lg);
		background: hsl(var(--at-emphasis) / 0.24);
		color: hsl(var(--at-emphasis-fg));
		font: inherit;
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
	}

	/* A 320px phone: the destination goes under the heading. */
	@media (max-width: 359px) {
		.jl-head {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}

		.jl-dest {
			text-align: left;
		}
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

	.jr-prop input::placeholder,
	.jr-notes textarea::placeholder {
		color: hsl(var(--at-fg-muted));
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

	/* The date shows as written words; the platform's own field lies invisibly over them
	   and takes the tap, the click or the keys. */
	.jr-date {
		align-items: center;
		height: 46px;
	}

	.jr-date-value {
		overflow: hidden;
		padding-right: 22px;
		color: hsl(var(--at-fg));
		font-size: 16px;
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.jr-date-empty {
		color: hsl(var(--at-fg-muted));
	}

	.jr-prop .jr-date input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}

	/* Editing from the keyboard shows the platform's field itself, so the part the arrow
	   keys change and a half-typed value can be seen. */
	.jr-prop .jr-date input:focus-visible {
		padding: 0 22px 0 0;
		border: none;
		background: none;
		color: hsl(var(--at-fg));
		color-scheme: dark;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: right;
		opacity: 1;
		outline: none;
	}

	.jr-prop .jr-date input:focus-visible::-webkit-calendar-picker-indicator {
		display: none;
	}

	.jr-date:has(input:focus-visible) .jr-date-value {
		visibility: hidden;
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

	/* ---- Flight by jump: each finished jump's flight on one scale from zero ---- */

	/* A phone already has every flight in the list above it; the bars wait for room. */
	.jr-compare {
		display: none;
	}

	.jr-bars {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding: 12px 16px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
		list-style: none;
	}

	.jr-bar-row {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr) 64px;
		align-items: center;
		column-gap: 16px;
		height: 32px;
		color: hsl(var(--at-fg-muted));
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}

	.jr-bar-track {
		height: 6px;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.06);
	}

	.jr-bar-fill {
		display: block;
		height: 100%;
		min-width: 6px;
		border-radius: inherit;
		background: hsl(var(--at-fg) / 0.3);
	}

	.jr-bar-value {
		color: hsl(var(--at-fg-secondary));
		font-weight: 500;
		text-align: right;
	}

	.jr-bar-value .jr-unit {
		font-size: 0.8em;
	}

	.jr-bar-best .jr-bar-name,
	.jr-bar-best .jr-bar-value {
		color: hsl(var(--at-fg));
	}

	.jr-bar-best .jr-bar-value {
		font-weight: 600;
	}

	.jr-bar-best .jr-bar-fill {
		background: hsl(var(--at-fg) / 0.88);
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
		.jl-row:hover {
			background: hsl(var(--at-fg) / 0.04);
		}
		.jl-row:hover .jl-go {
			color: hsl(var(--at-fg-secondary));
		}
		.jl-empty-action:hover {
			background: hsl(var(--at-emphasis) / 0.34);
			color: hsl(var(--at-fg));
		}
	}

	/* Pressed, after hover so it shows under a mouse too. */
	.jl-row:active {
		background: hsl(var(--at-fg) / 0.08);
	}

	.jl-row:active .jl-go {
		color: hsl(var(--at-fg));
	}

	@media (pointer: coarse) {
		.jr-back::after {
			content: '';
			position: absolute;
			inset: -4px 0;
		}
	}

	/* ---- Wider ---- */

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

		.jr-unpaired {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.7fr) 18px;
			grid-template-areas: 'name flight . . chevron';
			column-gap: 16px;
			padding-block: 6px;
		}

		.jr-compare {
			display: flex;
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
		.jr-prop select,
		.jr-date {
			height: 42px;
		}

		.jr-date-value {
			font-size: 14px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.jr {
			animation: none;
		}
		.jr-row,
		.jl-row,
		.jr-prop,
		.jr-back {
			transition: none;
		}
	}
</style>
