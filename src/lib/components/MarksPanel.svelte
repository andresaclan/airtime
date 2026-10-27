<script lang="ts">
	import { formatFrameClock } from '$lib/video/timecode';
	import { frameDurationRange, frameLabel, type FrameTiming } from '$lib/video/frames';
	import {
		frameOf,
		groupJumps,
		rsi,
		type Analysis,
		type Interval,
		type Jump,
		type Mark
	} from '$lib/video/marks';
	import {
		hasMeaningfulContact,
		JUMP_TYPES,
		TIME_SCALES,
		type JumpType
	} from '$lib/session/schema';

	interface Props {
		marks: Mark[];
		analysis: Analysis;
		timing: FrameTiming;
		/** The frames aren't evenly spaced, so a frame's length depends on where it is. */
		variableFrameRate?: boolean;
		title: string;
		notes: string;
		timeScale: number;
		/** `null` = not set, for sessions saved before jump types existed. */
		jumpType: JumpType | null;
		titlePlaceholder: string;
		/** ISO timestamp of when the video was filmed. */
		recordedAt: string;
		activeMarkId: string | null;
		canUndo: boolean;
		onSeek: (time: number) => void;
		onNudge: (id: string, frames: number) => void;
		onRemove: (id: string) => void;
		onUndo: () => void;
		onClear: () => void;
		/** Stacked under the video (narrow screens) instead of a sidebar. */
		sheet?: boolean;
		/** Sheet only: take all the height left under the video. */
		fill?: boolean;
		/** Sheet only: show everything rather than the one-line summary. */
		expanded?: boolean;
		/** Hides the sidebar, or expands/collapses the sheet. */
		onToggle: () => void;
	}

	let {
		marks,
		analysis,
		timing,
		variableFrameRate = false,
		title = $bindable(),
		notes = $bindable(),
		recordedAt = $bindable(),
		timeScale = $bindable(),
		jumpType = $bindable(),
		titlePlaceholder,
		activeMarkId,
		canUndo,
		onSeek,
		onNudge,
		onRemove,
		onUndo,
		onClear,
		sheet = false,
		fill = false,
		expanded = true,
		onToggle
	}: Props = $props();

	let showDetails = $derived(!sheet || expanded);

	let grouped = $derived(groupJumps(marks, analysis));
	let bestJump = $derived(
		grouped.jumps.reduce<(typeof grouped.jumps)[number] | null>(
			(best, jump) =>
				jump.flight && (!best?.flight || jump.flight.realSeconds > best.flight.realSeconds)
					? jump
					: best,
			null
		)
	);
	let frameRate = $derived(timing.fps);
	// Real time per frame, so precision is honest for slow-motion footage too.
	let frameMs = $derived(frameRate > 0 ? (1000 / frameRate) * timeScale : 0);
	// On variable-frame-rate footage the longest frame bounds the precision.
	let longestFrameMs = $derived.by(() => {
		const range = variableFrameRate ? frameDurationRange(timing) : null;
		return range ? range[1] * 1000 * timeScale : 0;
	});
	let slowMotion = $derived(
		TIME_SCALES.find((scale) => scale.value === timeScale && scale.value !== 1)
	);
	// A landing followed by the next attempt's touchdown is normal; only warn about
	// repeated marks that no jump could use.
	let outOfSequenceMarks = $derived(
		grouped.unpairedMarks.filter((mark) => analysis.outOfSequence.has(mark.id))
	);
	// Contact and RSI are only meaningful for approach, drop and rebound jumps. An unset type says nothing.
	let contactApplies = $derived(jumpType === null || hasMeaningfulContact(jumpType));
	let jumpTypeLabel = $derived(JUMP_TYPES.find((type) => type.value === jumpType)?.label);
	let completedJumps = $derived(grouped.jumps.filter((jump) => jump.flight).length);

	let bestRsi = $derived(bestJump && contactApplies ? rsi(bestJump) : undefined);
	// Contact only means something for approach, drop and rebound jumps; there it gets a summary slot.
	let contactMatters = $derived(jumpType !== null && hasMeaningfulContact(jumpType));
	function mean(values: (number | undefined)[]): number | null {
		const present = values.filter((value) => value !== undefined);
		return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
	}
	// With several jumps the summary describes the session; the rows below hold each jump.
	let averageHeight = $derived(
		completedJumps > 1 ? mean(grouped.jumps.map((jump) => jump.flight?.heightCm)) : null
	);
	let averageFlight = $derived(mean(grouped.jumps.map((jump) => jump.flight?.realSeconds)));
	let averageContact = $derived(mean(grouped.jumps.map((jump) => jump.contact?.realSeconds)));

	function jumpStats(jump: Jump): string {
		if (jump.flight?.heightCm === undefined) return '';
		const parts = [`${jump.flight.heightCm.toFixed(1)} cm`];
		const index = contactApplies ? rsi(jump) : undefined;
		if (index !== undefined) parts.push(`RSI ${index.toFixed(2)}`);
		return parts.join(' · ');
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

	// Whole milliseconds: one frame is several ms, so tenths would be false precision.
	function formatMs(seconds: number): string {
		return `${Math.round(seconds * 1000)}`;
	}

	function intervalDescription(interval: Interval): string {
		return `${interval.kind === 'flight' ? 'Flight' : 'Contact'} ${formatMs(interval.realSeconds)} ms · ${interval.frames} fr`;
	}
</script>

{#snippet markRow(mark: Mark, label: string)}
	<div class="mp-mark mp-mark-{mark.type}" class:active={mark.id === activeMarkId}>
		<button class="mp-mark-main" onclick={() => onSeek(mark.time)} title="Go to this frame">
			<span class="mp-dot"></span>
			<span class="mp-mark-type">{label}</span>
			<span class="mp-mark-time"
				>{formatFrameClock(frameLabel(frameOf(mark.time, timing), timing), timing)}</span
			>
		</button>
		{#if mark.id === activeMarkId}
			<div class="mp-mark-actions">
				<button
					class="mp-icon-btn"
					onclick={() => onNudge(mark.id, -1)}
					aria-label="Move {label.toLowerCase()} one frame earlier"
					title="1 frame earlier">−1 fr</button
				>
				<button
					class="mp-icon-btn"
					onclick={() => onNudge(mark.id, 1)}
					aria-label="Move {label.toLowerCase()} one frame later"
					title="1 frame later">+1 fr</button
				>
				<button
					class="mp-icon-btn mp-remove"
					onclick={() => onRemove(mark.id)}
					aria-label="Remove {label.toLowerCase()}"
					title="Remove (Backspace)"
					><svg viewBox="0 0 24 24" aria-hidden="true"
						><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg
					>Remove</button
				>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet interval(span: Interval)}
	<div class="mp-interval mp-interval-{span.kind}" title={intervalDescription(span)}>
		<span class="mp-interval-label"
			>{span.kind === 'flight' ? 'Flight' : 'Contact'}<span class="mp-interval-frames"
				>{span.frames} fr</span
			></span
		>
		<span class="mp-interval-value">{formatMs(span.realSeconds)} ms</span>
	</div>
{/snippet}

<aside
	class="marks-panel"
	class:sheet
	class:fill={sheet && fill && expanded}
	class:collapsed={!showDetails}
	aria-label="Jump analysis"
>
	{#if sheet}
		<!-- One button for both states, so focus stays put when the sheet expands or collapses. -->
		<h2 class="mp-sheet-heading">
			<button class="mp-sheet-toggle" onclick={onToggle} aria-expanded={expanded}>
				<!-- The summary stays in the header, open or closed, so the body starts at the jumps. -->
				<span class="sr-only">Analysis:</span>
				{#if bestJump?.flight}
					<span class="mp-peek-stat mp-peek-primary">
						<span class="mp-peek-label">{completedJumps > 1 ? 'Best height' : 'Height'}</span>
						<span class="mp-peek-value"
							>{bestJump.flight.heightCm?.toFixed(1)}<small>cm</small></span
						>
					</span>
					<span class="mp-peek-stat">
						<span class="mp-peek-label">Best flight</span>
						<span class="mp-peek-value"
							>{formatMs(bestJump.flight.realSeconds)}<small>ms</small></span
						>
					</span>
					{#if !contactMatters && averageHeight !== null}
						<span class="mp-peek-stat">
							<span class="mp-peek-label">Average</span>
							<span class="mp-peek-value">{averageHeight.toFixed(1)}<small>cm</small></span>
						</span>
					{:else}
						<span class="mp-peek-stat">
							<span class="mp-peek-label">Contact</span>
							<span class="mp-peek-value"
								>{#if bestJump.contact}{formatMs(bestJump.contact.realSeconds)}<small>ms</small
									>{:else}–{/if}</span
							>
						</span>
					{/if}
				{:else}
					<span class="mp-peek-hint"
						>{marks.length > 0
							? 'Mark a landing to measure the jump'
							: 'Mark takeoff and landing to measure a jump'}</span
					>
				{/if}
				<svg
					class="mp-sheet-chevron"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg
				>
			</button>
		</h2>
	{:else}
		<div class="mp-head">
			<h2 class="mp-head-title">Analysis</h2>
			{#if completedJumps > 0}<span class="mp-head-meta"
					>{completedJumps} jump{completedJumps === 1 ? '' : 's'}</span
				>{/if}
		</div>
	{/if}

	{#if showDetails}
		<div class="mp-body">
			{#if bestJump?.flight}
				<div class="mp-summary">
					<span class="mp-label">{completedJumps > 1 ? 'Best jump' : 'Jump height'}</span>
					<p class="mp-hero-value">
						{bestJump.flight.heightCm?.toFixed(1)}<span class="mp-unit">cm</span><span
							class="mp-hero-alt">{((bestJump.flight.heightCm ?? 0) / 2.54).toFixed(1)} in</span
						>
					</p>
					<dl class="mp-stats">
						{#if averageHeight !== null}
							<div>
								<dt>Average height</dt>
								<dd>{averageHeight.toFixed(1)}<span class="mp-unit">cm</span></dd>
							</div>
							<div>
								<dt>Average flight</dt>
								<dd>{formatMs(averageFlight ?? 0)}<span class="mp-unit">ms</span></dd>
							</div>
							{#if contactMatters}
								<div class:muted={averageContact === null}>
									<dt>Average contact</dt>
									<dd>
										{#if averageContact !== null}{formatMs(averageContact)}<span class="mp-unit"
												>ms</span
											>{:else}–{/if}
									</dd>
								</div>
							{/if}
						{:else}
							<div>
								<dt>Flight time</dt>
								<dd>
									{formatMs(bestJump.flight.realSeconds)}<span class="mp-unit">ms</span><small
										>{bestJump.flight.frames} fr</small
									>
								</dd>
							</div>
							{#if contactMatters || bestJump.contact}
								<div class:muted={!bestJump.contact}>
									<dt>Contact time</dt>
									<dd>
										{#if bestJump.contact}{formatMs(bestJump.contact.realSeconds)}<span
												class="mp-unit">ms</span
											><small
												>{bestJump.contact.frames} fr{#if bestRsi !== undefined}
													· RSI {bestRsi.toFixed(2)}{/if}</small
											>{:else}–<small>not marked</small>{/if}
									</dd>
								</div>
							{/if}
						{/if}
					</dl>
					{#if contactMatters && !bestJump.contact}
						<p class="mp-caption">Mark the landing before the takeoff to get contact time.</p>
					{/if}
				</div>
			{:else}
				<div class="mp-hero is-empty">
					<span class="mp-label">Jump height</span>
					<span class="mp-hero-empty">Not measured yet</span>
					<span class="mp-sub">Appears once a takeoff and its landing are marked.</span>
				</div>
			{/if}

			<section class="mp-section" aria-labelledby="mp-jumps-heading">
				<div class="mp-section-head">
					<h3 id="mp-jumps-heading" class="mp-section-title">
						Jumps{#if marks.length > 0}<span class="mp-count">{marks.length} marks</span>{/if}
					</h3>
					<div class="mp-section-actions">
						{#if canUndo}<button class="mp-text-btn" onclick={onUndo} title="Undo (⌘Z)"
								><svg viewBox="0 0 24 24" aria-hidden="true"
									><path d="M9 7 4.5 11.5 9 16" /><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12" /></svg
								>Undo</button
							>{/if}
						{#if marks.length > 0}<button
								class="mp-text-btn mp-danger"
								onclick={onClear}
								title="Remove every mark (undoable)">Clear all</button
							>{/if}
					</div>
				</div>
				{#if marks.length === 0}
					<div class="mp-empty">
						<ol>
							<li>
								<span class="mp-empty-num">1</span>
								<span
									>Pause on the first frame where the feet leave the ground, then <span
										class="pointer-only">press <kbd>T</kbd></span
									><span class="touch-only">tap Takeoff</span>.</span
								>
							</li>
							<li>
								<span class="mp-empty-num">2</span>
								<span
									>Step to the first frame they touch down, then <span class="pointer-only"
										>press <kbd>L</kbd></span
									><span class="touch-only">tap Landing</span>.</span
								>
							</li>
						</ol>
						<p class="mp-empty-hint">
							<span class="pointer-only"
								>Step frames with <kbd>,</kbd> <kbd>.</kbd>&nbsp;·&nbsp;</span
							>A landing before the takeoff adds contact time.
						</p>
					</div>
				{:else}
					<div class="mp-results">
						{#each grouped.jumps as jump, index (jump.takeoff.id)}
							<section
								class="mp-jump"
								class:mp-best={completedJumps >= 2 && jump === bestJump}
								aria-label="Jump {index + 1}"
							>
								<h4 class="mp-jump-head">
									<span class="mp-jump-name">Jump {index + 1}</span>
									{#if completedJumps >= 2 && jump === bestJump}<span class="mp-badge">Best</span
										>{/if}
									<span class="mp-jump-stats">{jumpStats(jump)}</span>
								</h4>
								{#if jump.contact}
									{#if grouped.jumps[index - 1]?.flight?.to.id === jump.contact.from.id}
										<!-- The touchdown is the previous jump's landing; don't list it twice. -->
										{@render interval(jump.contact)}
									{:else}
										{@render markRow(jump.contact.from, 'Touchdown')}
										{@render interval(jump.contact)}
									{/if}
								{/if}
								{@render markRow(jump.takeoff, 'Takeoff')}
								{#if jump.flight}
									{@render interval(jump.flight)}
									{@render markRow(jump.flight.to, 'Landing')}
								{:else}
									<p class="mp-incomplete">Mark a landing to complete this jump.</p>
								{/if}
							</section>
						{/each}
						{#if outOfSequenceMarks.length > 0}
							<div class="mp-warning">
								Repeated marks have no timing interval: {outOfSequenceMarks
									.map((mark) => (mark.type === 'landing' ? 'Landing' : 'Takeoff'))
									.join(', ')}
							</div>
						{/if}
						{#if grouped.unpairedMarks.length > 0}
							<section class="mp-jump mp-unpaired" aria-label="Unpaired marks">
								<h4 class="mp-jump-head"><span class="mp-jump-name">Unpaired marks</span></h4>
								{#each grouped.unpairedMarks as mark (mark.id)}{@render markRow(
										mark,
										mark.type === 'landing' ? 'Landing' : 'Takeoff'
									)}{/each}
							</section>
						{/if}
					</div>
				{/if}
			</section>

			<details class="mp-details" open={jumpType === null}>
				<summary>
					<span class="mp-section-title">Setup</span>
					<span class="mp-details-value"
						>{TIME_SCALES.find((scale) => scale.value === timeScale)?.label} · {jumpTypeLabel ??
							'Jump type not set'}</span
					>
					<svg class="mp-details-chevron" viewBox="0 0 24 24" aria-hidden="true"
						><path d="m9 6 6 6-6 6" /></svg
					>
				</summary>
				<div class="mp-details-body">
					<label class="mp-stack">
						<span>Footage</span>
						<select class="mp-field mp-select" bind:value={timeScale}>
							{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
									>{scale.label}</option
								>{/each}
						</select>
					</label>
					<label class="mp-stack">
						<span>Jump type</span>
						<select
							class="mp-field mp-select"
							bind:value={jumpType}
							aria-describedby={jumpType === null ? 'mp-jump-type-hint' : undefined}
						>
							{#if jumpType === null}<option value={null}>Not set</option>{/if}
							{#each JUMP_TYPES as type (type.value)}<option value={type.value}>{type.label}</option
								>{/each}
						</select>
					</label>
					<p class="mp-caption">
						{#if longestFrameMs > frameMs + 0.05}
							Precision: ±1 frame = ±{frameMs.toFixed(1)}–{longestFrameMs.toFixed(1)} ms (variable frame
							rate)
						{:else}
							Precision: ±1 frame = ±{frameMs.toFixed(1)} ms at {frameRate.toFixed(2)} fps
						{/if}{#if slowMotion}
							· real time ({slowMotion.label.toLowerCase()}){/if}
					</p>
					{#if jumpType === null}
						<p id="mp-jump-type-hint" class="mp-caption warn">
							Set the jump type to compare like with like.
						</p>
					{/if}
				</div>
			</details>

			<details class="mp-details">
				<summary>
					<span class="mp-section-title">Session</span>
					<span class="mp-details-value"
						>{title.trim() || titlePlaceholder}{notes.trim() ? ' · notes' : ''}</span
					>
					<svg class="mp-details-chevron" viewBox="0 0 24 24" aria-hidden="true"
						><path d="m9 6 6 6-6 6" /></svg
					>
				</summary>
				<div class="mp-details-body">
					<label class="mp-stack">
						<span>Title</span>
						<input
							class="mp-field mp-title"
							bind:value={title}
							placeholder={titlePlaceholder}
							spellcheck="false"
						/>
					</label>
					<label class="mp-stack">
						<span>Recorded</span>
						<input
							class="mp-field"
							type="datetime-local"
							bind:value={() => toLocalInput(recordedAt), fromLocalInput}
						/>
					</label>
					<label class="mp-stack">
						<span>Notes</span>
						<textarea
							class="mp-field mp-notes"
							bind:value={notes}
							placeholder="Exercise, attempt, how it felt…"
							rows="2"
						></textarea>
					</label>
				</div>
			</details>
		</div>
	{/if}
</aside>

<style>
	.marks-panel {
		display: flex;
		flex: 0 0 336px;
		flex-direction: column;
		width: 336px;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		border: 1px solid hsl(var(--at-border));
		border-radius: var(--at-radius-lg);
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg));
		font-size: 13px;
	}

	/* The panel's own header, in the same 52px band as the app header. */
	.mp-head {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 8px;
		height: 52px;
		padding: 0 16px;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.mp-head-title {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 500;
	}

	.mp-head-meta {
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
	}

	/* Fades out at the bottom so it's clear the panel scrolls; the padding lets the
	   last field scroll clear of the fade. */
	.mp-body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		padding-bottom: 20px;
		mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--at-border-hover)) transparent;
	}

	/* Headline numbers */

	.mp-label {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
	}

	.mp-sub {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.mp-unit {
		margin-left: 4px;
		color: hsl(var(--at-fg-muted));
		font-size: 0.42em;
		font-weight: 500;
		letter-spacing: 0;
	}

	/* Best jump: the height leads; flight and contact sit in one row beneath it. */
	.mp-summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px 4px;
	}

	.sheet .mp-hero-value {
		font-size: 26px;
	}

	.mp-hero-alt {
		margin-left: 10px;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0;
	}

	.mp-stats {
		display: grid;
		grid-auto-columns: minmax(0, 1fr);
		grid-auto-flow: column;
		margin: 10px 0 6px;
		padding: 10px 0;
		border-block: 1px solid hsl(var(--at-border));
	}

	.mp-stats > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.mp-stats > div + div {
		padding-left: 12px;
		border-left: 1px solid hsl(var(--at-border));
	}

	.mp-stats dt {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.mp-stats dd {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.015em;
	}

	.mp-stats dd small {
		display: block;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
	}

	.mp-stats .mp-unit {
		font-size: 12px;
	}

	.mp-stats .muted dd {
		color: hsl(var(--at-fg-muted));
	}

	.mp-hero-value {
		color: hsl(var(--at-fg));
		margin: 0;
		font-size: 24px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.mp-hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px 10px;
	}

	.mp-hero.is-empty {
		gap: 4px;
	}

	.mp-hero-empty {
		margin-top: 2px;
		color: hsl(var(--at-fg-secondary));
		font-size: 17px;
		font-weight: 600;
	}

	/* Setup and Session collapse to one line showing their current values. */
	.mp-details {
		margin: 0 16px;
		border-top: 1px solid hsl(var(--at-border));
	}

	.mp-details summary {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		cursor: pointer;
		list-style: none;
	}

	.mp-details summary::-webkit-details-marker {
		display: none;
	}

	.mp-details summary .mp-section-title {
		flex: 0 0 auto;
		margin: 0;
	}

	.mp-details-value {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		text-align: right;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mp-details-chevron {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
		fill: none;
		stroke: hsl(var(--at-fg-muted));
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 160ms ease;
	}

	.mp-details[open] .mp-details-chevron {
		transform: rotate(90deg);
	}

	.mp-details summary:hover .mp-details-value {
		color: hsl(var(--at-fg));
	}

	.mp-details-body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 2px 0 14px;
	}

	/* Sections */

	.mp-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 16px 10px;
	}

	.mp-summary + .mp-section {
		margin-top: 12px;
	}

	.mp-section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: -6px 0 0;
	}

	.mp-section-actions {
		display: flex;
		gap: 2px;
		margin-right: -8px;
	}

	.mp-section-title {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 2px;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		font-weight: 500;
	}

	.mp-count {
		color: hsl(var(--at-fg-muted));
		font-weight: 400;
	}

	.mp-caption {
		margin: 2px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		line-height: 1.45;
	}

	.mp-caption.warn {
		color: hsl(var(--at-warning));
	}

	/* Fields */

	.mp-field {
		width: 100%;
		height: 32px;
		padding: 0 10px;
		border: 1px solid hsl(var(--at-border-hover) / 0.8);
		border-radius: var(--at-radius);
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 13px;
		outline: none;
		transition:
			border-color 140ms ease,
			box-shadow 140ms ease;
	}

	.mp-field:hover {
		border-color: hsl(var(--at-fg) / 0.22);
	}

	.mp-field:focus {
		border-color: hsl(var(--at-accent));
		box-shadow: 0 0 0 3px hsl(var(--at-accent) / 0.2);
	}

	.mp-field::placeholder {
		color: hsl(var(--at-fg-muted));
	}

	.mp-select {
		appearance: none;
		padding-right: 28px;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%239aa0aa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E");
		background-position: right 8px center;
		background-repeat: no-repeat;
		background-size: 14px;
		cursor: pointer;
	}

	.mp-field[type='datetime-local'] {
		font-variant-numeric: tabular-nums;
	}

	.mp-field[type='datetime-local']::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
	}

	.mp-title {
		font-weight: 600;
	}

	.mp-notes {
		height: auto;
		min-height: 64px;
		padding: 8px 10px;
		resize: vertical;
		line-height: 1.45;
	}

	/* Empty guide */

	.mp-empty {
		padding: 4px 0 0;
		color: hsl(var(--at-fg-secondary));
		line-height: 1.5;
	}

	.mp-empty ol {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.mp-empty li {
		display: flex;
		gap: 10px;
	}

	.mp-empty-num {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 20px;
		height: 20px;
		margin-top: 1px;
		border-radius: 50%;
		background: hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg));
		font-size: 11px;
		font-weight: 600;
	}

	.mp-empty-hint {
		margin: 10px 0 0;
		padding-top: 10px;
		border-top: 1px solid hsl(var(--at-border));
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.mp-stack {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 4px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font:
			600 11px/1 var(--at-font-mono),
			monospace;
		vertical-align: 1px;
	}

	/* Jumps */

	.mp-results {
		display: flex;
		flex-direction: column;
		margin: 0 -8px;
	}

	.mp-jump {
		padding: 4px 0 6px;
	}

	.mp-jump + .mp-jump {
		padding-top: 8px;
		border-top: 1px solid hsl(var(--at-border));
	}

	.mp-jump-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 6px 8px 4px;
		font-size: 13px;
		font-weight: 600;
	}

	.mp-jump-stats {
		margin-left: auto;
		color: hsl(var(--at-fg));
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.mp-badge {
		padding: 2px 7px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 6px;
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
		font-weight: 500;
	}

	.mp-incomplete {
		margin: 2px 8px 6px 30px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.mp-mark {
		--mark-color: hsl(var(--at-takeoff));
		display: flex;
		align-items: center;
		border-radius: 7px;
		transition: background 120ms ease;
	}

	.mp-mark-landing {
		--mark-color: hsl(var(--at-landing));
	}

	@media (hover: hover) {
		.mp-mark:hover {
			background: hsl(var(--at-fg) / 0.05);
		}
	}

	.mp-mark.active {
		background: color-mix(in srgb, var(--mark-color) 10%, transparent);
	}

	.mp-mark.active .mp-mark-type {
		color: hsl(var(--at-fg));
	}

	.mp-mark-main {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 10px;
		min-width: 0;
		height: 30px;
		padding: 0 8px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.mp-dot {
		width: 8px;
		height: 8px;
		flex: 0 0 auto;
		border-radius: 50%;
		background: var(--mark-color);
	}

	.mp-mark-type {
		flex: 1;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		font-weight: 400;
	}

	.mp-mark-time {
		color: hsl(var(--at-fg-muted));
		font-family: var(--at-font-mono);
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
	}

	/* The selected mark (the one at the playhead; click or tap a row to go there)
	   gets a small nudge bar on a second line, so its timecode stays in the value
	   column and the list only grows by one short row. */
	.mp-mark {
		flex-wrap: wrap;
	}

	.mp-mark-actions {
		display: flex;
		flex: 1 0 100%;
		align-items: center;
		gap: 4px;
		padding: 0 8px 7px 26px;
	}

	.mp-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-width: 30px;
		height: 24px;
		padding: 0 8px;
		border: none;
		border-radius: 6px;
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease;
	}

	.mp-icon-btn svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mp-icon-btn:hover {
		background: hsl(var(--at-fg) / 0.14);
	}

	.mp-remove {
		margin-left: auto;
		background: transparent;
		color: hsl(var(--at-fg-muted));
		font-weight: 500;
	}

	.mp-remove:hover,
	.mp-remove:active {
		background: hsl(var(--at-error) / 0.14);
		color: hsl(var(--at-error));
	}

	/* Label on the left; the value right-aligned in the same column as the timecodes.
	   The line runs through the mark dots (8px padding + half the dot). */
	.mp-interval {
		--interval-color: hsl(var(--at-takeoff) / 0.6);
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: 11px;
		padding: 3px 8px 3px 13px;
		border-left: 2px dashed var(--interval-color);
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		white-space: nowrap;
	}

	.mp-interval-contact {
		--interval-color: hsl(var(--at-landing) / 0.55);
	}

	.mp-interval-label {
		overflow: hidden;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		text-overflow: ellipsis;
	}

	.mp-interval-frames {
		margin-left: 6px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	/* The measurement is the point of the card, so it is the strongest value. */
	.mp-interval-value {
		margin-left: auto;
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.mp-warning {
		padding: 8px 10px;
		border: 1px solid hsl(var(--at-warning) / 0.25);
		border-radius: 8px;
		background: hsl(var(--at-warning) / 0.08);
		color: hsl(var(--at-warning));
		font-size: 12px;
		line-height: 1.4;
	}

	.mp-text-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 28px;
		padding: 0 8px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.mp-text-btn svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mp-danger {
		color: hsl(var(--at-fg-muted));
	}

	.mp-text-btn:hover:not(:disabled) {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.mp-danger:hover:not(:disabled) {
		background: hsl(var(--at-error) / 0.12);
		color: hsl(var(--at-error));
	}

	.mp-text-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	@media (pointer: coarse) {
		/* Visually 32px; the hit area reaches 44. */
		.mp-icon-btn {
			position: relative;
			min-width: 44px;
			height: 32px;
			font-size: 13px;
			background: hsl(var(--at-fg) / 0.08);
		}

		.mp-icon-btn::after {
			content: '';
			position: absolute;
			inset: -6px 0;
		}

		.mp-remove {
			background: transparent;
		}

		.mp-text-btn {
			height: 44px;
			font-size: 13px;
		}

		.mp-section-head {
			margin-block: -12px -6px;
		}

		.mp-field {
			height: 40px;
			font-size: 16px;
		}

		.mp-notes {
			font-size: 16px;
		}

		.mp-mark-type {
			font-size: 13px;
		}

		.mp-mark-main {
			height: 44px;
		}

		.mp-interval-value {
			font-size: 14px;
		}

		.mp-jump-head {
			font-size: 15px;
		}

		.mp-details-value {
			font-size: 13px;
		}
	}

	/* Sheet: stacked under the video on narrow screens. Collapsed it is just the
	   summary toggle; expanded it scrolls under a pinned toggle. */
	.marks-panel.sheet {
		flex: 0 0 auto;
		width: 100%;
		height: auto;
		max-height: min(58dvh, 600px);
	}

	/* Under a landscape video the expanded sheet runs to the bottom of the screen
	   as a pane of its own rather than a card that looks cut off. */
	.marks-panel.sheet.fill {
		flex: 1 1 auto;
		max-height: none;
		margin: 0 -8px -8px;
		border-width: 1px 0 0;
		border-radius: 14px 14px 0 0;
	}

	.sheet .mp-summary,
	.sheet .mp-hero {
		display: none;
	}

	.sheet .mp-summary + .mp-section {
		margin-top: 0;
	}

	.sheet .mp-section-head {
		position: sticky;
		top: -14px;
		z-index: 1;
		margin: -14px -16px 0;
		padding: 10px 16px 8px;
		background: hsl(var(--at-bg-elevated));
	}

	.mp-sheet-heading {
		margin: 0;
		font: inherit;
	}

	/* A grab handle: the summary row is the top of a sheet you can pull open. */
	.mp-sheet-toggle::before {
		content: '';
		position: absolute;
		top: 6px;
		left: 50%;
		width: 32px;
		height: 4px;
		border-radius: 2px;
		background: hsl(var(--at-fg) / 0.2);
		transform: translateX(-50%);
	}

	.mp-sheet-toggle {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) 44px;
		row-gap: 2px;
		gap: 8px;
		width: 100%;
		min-height: 64px;
		padding: 16px 2px 8px 16px;
		border: none;
		border-radius: var(--at-radius-lg);
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}

	.sheet:not(.collapsed) .mp-sheet-toggle {
		min-height: 64px;
		border-bottom: 1px solid hsl(var(--at-border));
		border-radius: var(--at-radius-lg) var(--at-radius-lg) 0 0;
	}

	.mp-peek-hint {
		grid-column: 1 / 4;
		grid-row: 1 / 3;
	}

	.mp-peek-hint {
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
	}

	.mp-sheet-chevron {
		grid-column: 4;
		grid-row: 1 / 3;
		align-self: center;
		justify-self: center;
		width: 18px;
		height: 18px;
		color: hsl(var(--at-fg-secondary));
		transition: transform 160ms ease;
	}

	.sheet:not(.collapsed) .mp-sheet-chevron {
		transform: rotate(180deg);
	}

	/* Labels share the first row and values the second, so they line up across stats. */
	.mp-peek-stat {
		display: contents;
	}

	.mp-peek-stat .mp-peek-label {
		grid-row: 1;
		align-self: end;
	}

	.mp-peek-stat .mp-peek-value {
		grid-row: 2;
		align-self: last baseline;
	}

	.mp-peek-label {
		overflow: hidden;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mp-peek-value {
		font-size: 15px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.mp-peek-primary .mp-peek-value {
		font-size: 18px;
	}

	.mp-peek-value small {
		margin-left: 3px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
	}

	@media (hover: hover) {
		.mp-sheet-toggle:hover {
			background: hsl(var(--at-surface));
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mp-sheet-chevron {
			transition: none;
		}
	}
</style>
