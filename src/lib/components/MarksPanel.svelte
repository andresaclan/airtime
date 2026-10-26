<script lang="ts">
	import { formatFrameTimecode } from '$lib/video/timecode';
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
	// Contact and RSI are only meaningful for drop and rebound jumps. An unset type says nothing.
	let contactApplies = $derived(jumpType === null || hasMeaningfulContact(jumpType));
	let jumpTypeLabel = $derived(JUMP_TYPES.find((type) => type.value === jumpType)?.label);
	let completedJumps = $derived(grouped.jumps.filter((jump) => jump.flight).length);

	let bestIndex = $derived(bestJump ? grouped.jumps.indexOf(bestJump) : -1);
	let bestRsi = $derived(bestJump && contactApplies ? rsi(bestJump) : undefined);

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

	function formatMs(seconds: number): string {
		return `${(seconds * 1000).toFixed(1)}`;
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
				>{formatFrameTimecode(frameLabel(frameOf(mark.time, timing), timing), timing)}</span
			>
		</button>
		<div class="mp-mark-actions">
			<button
				class="mp-icon-btn"
				onclick={() => onNudge(mark.id, -1)}
				aria-label="Move {label.toLowerCase()} one frame earlier"
				title="1 frame earlier"
				><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5" /></svg><span
					class="mp-action-label">1 frame</span
				></button
			>
			<button
				class="mp-icon-btn"
				onclick={() => onNudge(mark.id, 1)}
				aria-label="Move {label.toLowerCase()} one frame later"
				title="1 frame later"
				><span class="mp-action-label">1 frame</span><svg viewBox="0 0 24 24" aria-hidden="true"
					><path d="M9.5 6.5 15 12l-5.5 5.5" /></svg
				></button
			>
			<span class="mp-action-divider" aria-hidden="true"></span>
			<button
				class="mp-icon-btn mp-remove"
				onclick={() => onRemove(mark.id)}
				aria-label="Remove {label.toLowerCase()}"
				title="Remove (Backspace)"
				><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 7.5l-9 9M7.5 7.5l9 9" /></svg
				><span class="mp-action-label">Remove</span></button
			>
		</div>
	</div>
{/snippet}

{#snippet interval(span: Interval)}
	<div class="mp-interval mp-interval-{span.kind}" title={intervalDescription(span)}>
		<span class="mp-interval-label"
			>{span.kind === 'flight' ? 'Flight' : 'Contact'} · {span.frames} fr</span
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
				{#if expanded}
					<span class="mp-sheet-title"
						>Analysis{#if bestJump?.flight}<span class="mp-sheet-best"
								>Best {bestJump.flight.heightCm?.toFixed(1)} cm</span
							>{/if}</span
					>
				{:else}
					<span class="sr-only">Analysis:</span>
					{#if bestJump?.flight}
						<span class="mp-peek-stat mp-peek-primary">
							<span class="mp-peek-label">{completedJumps > 1 ? 'Best height' : 'Height'}</span>
							<span class="mp-peek-value"
								>{bestJump.flight.heightCm?.toFixed(1)}<small>cm</small></span
							>
						</span>
						<span class="mp-peek-stat">
							<span class="mp-peek-label">Flight</span>
							<span class="mp-peek-value"
								>{formatMs(bestJump.flight.realSeconds)}<small>ms</small></span
							>
						</span>
						<span class="mp-peek-stat">
							<span class="mp-peek-label">Contact</span>
							<span class="mp-peek-value"
								>{#if bestJump.contact}{formatMs(bestJump.contact.realSeconds)}<small>ms</small
									>{:else}—{/if}</span
							>
						</span>
					{:else}
						<span class="mp-peek-hint"
							>{marks.length > 0
								? 'Mark a landing to measure the jump'
								: 'Mark takeoff and landing to measure a jump'}</span
						>
					{/if}
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
		<header class="mp-header">
			<h2>Analysis</h2>
			{#if completedJumps > 0}<span class="mp-header-meta"
					>{completedJumps} jump{completedJumps === 1 ? '' : 's'}</span
				>{/if}
		</header>
	{/if}

	{#if showDetails}
		<div class="mp-body">
			{#if bestJump?.flight}
				<div class="mp-hero">
					<span class="mp-label"
						>{completedJumps > 1
							? `Best jump · Jump ${bestIndex + 1} of ${completedJumps}`
							: 'Jump height'}</span
					>
					<span class="mp-hero-value"
						>{bestJump.flight.heightCm?.toFixed(1)}<span class="mp-unit">cm</span></span
					>
					<span class="mp-sub">{((bestJump.flight.heightCm ?? 0) / 2.54).toFixed(1)} in</span>
				</div>
				<div class="mp-metrics">
					<div class="mp-metric">
						<span class="mp-label">Flight time</span>
						<span class="mp-metric-value"
							>{formatMs(bestJump.flight.realSeconds)}<span class="mp-unit">ms</span></span
						>
						<span class="mp-sub">{bestJump.flight.frames} frames</span>
					</div>
					<div class="mp-metric" class:mp-metric-muted={!contactApplies}>
						<span class="mp-label">Contact time</span>
						{#if bestJump.contact}
							<span class="mp-metric-value"
								>{formatMs(bestJump.contact.realSeconds)}<span class="mp-unit">ms</span></span
							>
							<span class="mp-sub"
								>{#if !contactApplies}Not used for {jumpTypeLabel?.toLowerCase()}{:else}{bestJump
										.contact.frames} frames{#if bestRsi !== undefined}
										· RSI {bestRsi.toFixed(2)}{/if}{/if}</span
							>
						{:else}
							<span class="mp-metric-value muted" aria-label="None">–</span>
							<span class="mp-sub"
								>{bestIndex === 0 ? 'No landing before it' : 'No landing marked before'}</span
							>
						{/if}
					</div>
				</div>
			{:else}
				<div class="mp-hero is-empty">
					<span class="mp-label">Jump height</span>
					<span class="mp-hero-placeholder">No jump measured yet</span>
					<span class="mp-sub"
						>Mark a takeoff and its landing to see height, flight and contact time.</span
					>
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
							<span class="pointer-only">Step frames with <kbd>,</kbd> and <kbd>.</kbd></span><span
								class="touch-only">Hold the frame buttons to step quickly.</span
							>
						</p>
						<p class="mp-empty-hint secondary">
							Mark a landing before the takeoff to also get contact time.
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

			<section class="mp-section" aria-labelledby="mp-setup-heading">
				<h3 id="mp-setup-heading" class="mp-section-title">Setup</h3>
				<label class="mp-row">
					<span>Footage</span>
					<select class="mp-field mp-select" bind:value={timeScale}>
						{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
								>{scale.label}</option
							>{/each}
					</select>
				</label>
				<label class="mp-row">
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
				{#if jumpType === null}
					<p id="mp-jump-type-hint" class="mp-caption warn">
						Set the jump type to compare like with like.
					</p>
				{/if}
				<p class="mp-caption">
					{#if longestFrameMs > frameMs + 0.05}
						±1 frame = ±{frameMs.toFixed(1)}–{longestFrameMs.toFixed(1)} ms (variable frame rate)
					{:else}
						±1 frame = ±{frameMs.toFixed(1)} ms at {frameRate.toFixed(2)} fps
					{/if}{#if slowMotion}
						· real time ({slowMotion.label.toLowerCase()}){/if}
				</p>
			</section>

			<section class="mp-section mp-session" aria-labelledby="mp-session-heading">
				<h3 id="mp-session-heading" class="mp-section-title">Session</h3>
				<input
					class="mp-field mp-title"
					bind:value={title}
					placeholder={titlePlaceholder}
					aria-label="Session title"
					spellcheck="false"
				/>
				<label class="mp-row">
					<span>Recorded</span>
					<input
						class="mp-field"
						type="datetime-local"
						bind:value={() => toLocalInput(recordedAt), fromLocalInput}
					/>
				</label>
				<textarea
					class="mp-field mp-notes"
					bind:value={notes}
					placeholder="Notes: exercise, attempt, how it felt…"
					aria-label="Session notes"
					rows="2"
				></textarea>
			</section>
		</div>
	{/if}
</aside>

<style>
	.marks-panel {
		/* Three 26px action buttons, a divider and a margin; intervals reserve it so values line up. */
		--mark-actions-width: 82px;
		display: flex;
		flex: 0 0 320px;
		flex-direction: column;
		width: 320px;
		min-height: 0;
		height: 100%;
		overflow: hidden;
		border: 1px solid hsl(var(--at-border));
		border-radius: var(--at-radius-lg);
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg));
		font-size: 13px;
	}

	.mp-body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--at-border-hover)) transparent;
	}

	.mp-header {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: space-between;
		height: 48px;
		padding: 0 16px;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.mp-header h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
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

	.mp-hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 18px 16px 14px;
	}

	.mp-hero-value {
		color: hsl(var(--at-fg));
		font-size: 44px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.035em;
		line-height: 1.05;
	}

	.mp-hero.is-empty {
		gap: 4px;
	}

	.mp-hero-placeholder {
		margin-top: 4px;
		color: hsl(var(--at-fg-secondary));
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.015em;
	}

	.mp-hero.is-empty .mp-sub {
		max-width: 260px;
		line-height: 1.45;
	}

	.mp-header-meta {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.mp-metrics {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin: 0 12px 4px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 10px;
		background: hsl(var(--at-surface) / 0.5);
	}

	.mp-metric {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		padding: 10px 12px;
	}

	.mp-metric + .mp-metric {
		border-left: 1px solid hsl(var(--at-border));
	}

	.mp-metric-value {
		font-size: 20px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}

	.mp-metric-value .mp-unit {
		font-size: 12px;
	}

	.mp-metric-value.muted,
	.mp-metric-muted .mp-metric-value {
		color: hsl(var(--at-fg-muted));
	}

	.mp-metric-value.muted {
		font-weight: 500;
	}

	/* Sections */

	.mp-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 14px 16px 16px;
		border-top: 1px solid hsl(var(--at-border));
	}

	.mp-metrics + .mp-section {
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
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.mp-count {
		color: hsl(var(--at-fg-muted));
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
	}

	.mp-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
	}

	.mp-row > span {
		flex: 0 0 auto;
	}

	.mp-row .mp-field {
		flex: 0 1 196px;
		width: auto;
		min-width: 0;
	}

	.mp-session .mp-row .mp-field {
		flex-basis: 212px;
	}

	.sheet .mp-row .mp-field {
		flex: 1 1 auto;
		max-width: 260px;
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
		padding: 12px;
		border: 1px dashed hsl(var(--at-border-hover));
		border-radius: 10px;
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

	.mp-empty-hint.secondary {
		margin-top: 4px;
		padding-top: 0;
		border-top: none;
	}

	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 4px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font:
			600 10px/1 var(--at-font-mono),
			monospace;
		vertical-align: 1px;
	}

	/* Jumps */

	.mp-results {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mp-jump {
		padding: 4px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 10px;
		background: hsl(var(--at-surface) / 0.4);
	}

	.mp-jump.mp-best {
		border-color: hsl(var(--at-fg) / 0.2);
		background: hsl(var(--at-surface) / 0.8);
	}

	.mp-jump-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		padding: 6px 8px 4px;
		font-size: 12px;
		font-weight: 600;
	}

	.mp-jump-stats {
		margin-left: auto;
		color: hsl(var(--at-fg-secondary));
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.mp-badge {
		padding: 2px 7px;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.12);
		color: hsl(var(--at-fg));
		font-size: 10px;
		font-weight: 600;
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
		background: color-mix(in srgb, var(--mark-color) 14%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mark-color) 35%, transparent);
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
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--mark-color) 20%, transparent);
	}

	.mp-mark-type {
		flex: 1;
		font-weight: 500;
	}

	.mp-mark-time {
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	/* Nudge earlier / later | remove, as one segmented control. */
	.mp-mark-actions {
		display: flex;
		align-items: center;
		margin-right: 3px;
		border-radius: 7px;
		background: hsl(var(--at-fg) / 0.06);
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.mp-mark:hover .mp-mark-actions,
	.mp-mark.active .mp-mark-actions,
	.mp-mark:focus-within .mp-mark-actions {
		opacity: 1;
	}

	.mp-action-divider {
		width: 1px;
		height: 14px;
		background: hsl(var(--at-fg) / 0.12);
	}

	.mp-action-label {
		display: none;
	}

	.mp-icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 26px;
		height: 26px;
		padding: 0;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease;
	}

	.mp-icon-btn svg {
		width: 15px;
		height: 15px;
		flex: 0 0 auto;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mp-icon-btn:hover {
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg));
	}

	.mp-remove:hover {
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
		padding: 3px calc(var(--mark-actions-width) + 8px) 3px 17px;
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
		text-overflow: ellipsis;
	}

	.mp-interval-value {
		margin-left: auto;
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
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

	.mp-session {
		gap: 8px;
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

	.mp-text-btn:hover:not(:disabled) {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.mp-danger {
		color: hsl(var(--at-error) / 0.9);
	}

	.mp-danger:hover:not(:disabled) {
		background: hsl(var(--at-error) / 0.12);
		color: hsl(var(--at-error));
	}

	.mp-text-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* Touch: no hover, so a mark's controls appear as a labelled toolbar under the
	   selected row (tap a row to select it) instead of crowding every row. */
	@media (hover: none) {
		.marks-panel {
			--mark-actions-width: 0px;
		}

		.mp-mark {
			flex-wrap: wrap;
		}

		.mp-mark-actions {
			display: none;
			gap: 6px;
			width: 100%;
			margin: 0;
			padding: 0 8px 8px 26px;
			background: none;
			opacity: 1;
		}

		.mp-mark.active .mp-mark-actions {
			display: flex;
		}

		.mp-action-divider {
			display: none;
		}

		.mp-action-label {
			display: inline;
		}

		.mp-icon-btn {
			flex: 1 1 0;
			width: auto;
			height: 40px;
			border-radius: 8px;
			background: hsl(var(--at-fg) / 0.07);
			color: hsl(var(--at-fg));
			font-size: 14px;
			font-weight: 500;
		}

		.mp-remove {
			color: hsl(var(--at-error));
		}
	}

	@media (pointer: coarse) {
		.mp-mark-main {
			height: 44px;
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

		.mp-row,
		.mp-mark-type {
			font-size: 15px;
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

	.marks-panel.sheet.fill {
		flex: 1 1 auto;
		max-height: none;
	}

	.mp-sheet-heading {
		margin: 0;
		font: inherit;
	}

	.mp-sheet-toggle {
		position: relative;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) 44px;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 60px;
		padding: 8px 2px 8px 16px;
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
		min-height: 52px;
		border-bottom: 1px solid hsl(var(--at-border));
		border-radius: var(--at-radius-lg) var(--at-radius-lg) 0 0;
	}

	.mp-sheet-title,
	.mp-peek-hint {
		grid-column: 1 / 4;
	}

	.mp-sheet-title {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-size: 14px;
		font-weight: 600;
	}

	.mp-sheet-best {
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.mp-peek-hint {
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
	}

	.mp-sheet-chevron {
		grid-column: 4;
		justify-self: center;
		width: 18px;
		height: 18px;
		color: hsl(var(--at-fg-secondary));
		transition: transform 160ms ease;
	}

	.sheet:not(.collapsed) .mp-sheet-chevron {
		transform: rotate(180deg);
	}

	.mp-peek-stat {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
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
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}

	.mp-peek-primary .mp-peek-value {
		font-size: 22px;
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
