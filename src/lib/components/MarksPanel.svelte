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

	function jumpTitle(jump: Jump, index: number): string {
		const parts = [`Jump ${index + 1}`];
		if (jump.flight?.heightCm !== undefined) {
			parts.push(`${jump.flight.heightCm.toFixed(1)} cm`);
			const index = contactApplies ? rsi(jump) : undefined;
			if (index !== undefined) parts.push(`RSI ${index.toFixed(2)}`);
		}
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
				title="1 frame earlier">‹</button
			>
			<button
				class="mp-icon-btn"
				onclick={() => onNudge(mark.id, 1)}
				aria-label="Move {label.toLowerCase()} one frame later"
				title="1 frame later">›</button
			>
			<button
				class="mp-icon-btn mp-remove"
				onclick={() => onRemove(mark.id)}
				aria-label="Remove {label.toLowerCase()}"
				title="Remove (Backspace)">×</button
			>
		</div>
	</div>
{/snippet}

<aside class="marks-panel" class:sheet class:collapsed={!showDetails} aria-label="Jump analysis">
	{#if sheet}
		<!-- One button for both states, so focus stays put when the sheet expands or collapses. -->
		<h2 class="mp-sheet-heading">
			<button class="mp-sheet-toggle" onclick={onToggle} aria-expanded={expanded}>
				{#if expanded}
					<span class="mp-sheet-title">Analysis</span>
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
			<button
				class="mp-icon-btn"
				onclick={onToggle}
				aria-label="Hide analysis"
				title="Hide analysis (A)"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
					><path d="M9 6l6 6-6 6" /></svg
				>
			</button>
		</header>
	{/if}

	{#if showDetails}
		<div class="mp-body">
			{#if bestJump?.flight}
				<div class="mp-summary">
					<div class="mp-stat mp-stat-primary">
						<span class="mp-stat-label"
							>{completedJumps > 1 ? 'Best jump height' : 'Jump height'}</span
						>
						<span class="mp-stat-value"
							>{bestJump.flight.heightCm?.toFixed(1)}<small>cm</small></span
						>
						<span class="mp-stat-sub">{((bestJump.flight.heightCm ?? 0) / 2.54).toFixed(1)} in</span
						>
					</div>
					<div class="mp-stat">
						<span class="mp-stat-label">Flight time</span>
						<span class="mp-stat-value"
							>{formatMs(bestJump.flight.realSeconds)}<small>ms</small></span
						>
						<span class="mp-stat-sub">{bestJump.flight.frames} fr</span>
					</div>
					<div class="mp-stat" class:mp-stat-muted={!contactApplies}>
						<span class="mp-stat-label">Contact time</span>
						{#if bestJump.contact}
							<span class="mp-stat-value"
								>{formatMs(bestJump.contact.realSeconds)}<small>ms</small></span
							>
							<span class="mp-stat-sub"
								>{bestJump.contact.frames} fr{#if !contactApplies}
									· not used for {jumpTypeLabel?.toLowerCase()}{/if}</span
							>
						{:else}
							<span class="mp-stat-value">—</span>
							<span class="mp-stat-sub">No contact</span>
						{/if}
					</div>
				</div>
			{/if}
			<div class="mp-calibration">
				<p class="mp-precision">
					{#if longestFrameMs > frameMs + 0.05}
						±1 frame = ±{frameMs.toFixed(1)}–{longestFrameMs.toFixed(1)} ms (variable frame rate)
					{:else}
						±1 frame = ±{frameMs.toFixed(1)} ms at {frameRate.toFixed(2)} fps
					{/if}{#if slowMotion}
						· real time ({slowMotion.label.toLowerCase()}){/if}
				</p>
				<label class="mp-scale">
					<span>Footage</span>
					<select class="mp-field" bind:value={timeScale}>
						{#each TIME_SCALES as scale (scale.value)}<option value={scale.value}
								>{scale.label}</option
							>{/each}
					</select>
				</label>
				<label class="mp-scale">
					<span>Jump type</span>
					<select
						class="mp-field"
						bind:value={jumpType}
						aria-describedby={jumpType === null ? 'mp-jump-type-hint' : undefined}
					>
						{#if jumpType === null}<option value={null}>Not set</option>{/if}
						{#each JUMP_TYPES as type (type.value)}<option value={type.value}>{type.label}</option
							>{/each}
					</select>
				</label>
				{#if jumpType === null}
					<p id="mp-jump-type-hint" class="mp-precision">
						Set the jump type to compare like with like.
					</p>
				{/if}
			</div>

			{#if marks.length === 0}
				<div class="mp-empty">
					<p class="mp-empty-title">Mark a jump</p>
					<ol>
						<li>
							Pause on the first frame the feet leave the ground and <span class="pointer-only"
								>press <kbd>T</kbd></span
							><span class="touch-only">tap Takeoff</span>.
						</li>
						<li>
							Step to the first frame they touch down and <span class="pointer-only"
								>press <kbd>L</kbd></span
							><span class="touch-only">tap Landing</span>.
						</li>
					</ol>
					<p class="mp-empty-hint">
						<span class="pointer-only">Step frames with <kbd>,</kbd> <kbd>.</kbd></span><span
							class="touch-only">Hold the frame buttons to step quickly</span
						> · mark a landing before the takeoff to also get contact time.
					</p>
				</div>
			{:else}
				<div class="mp-results">
					{#each grouped.jumps as jump, index (jump.takeoff.id)}
						<section
							class="mp-jump"
							class:mp-best={jump === bestJump}
							aria-label="Jump {index + 1}"
						>
							<h3>
								<span class="mp-jump-title">{jumpTitle(jump, index)}</span>
								{#if completedJumps >= 2 && jump === bestJump}<span>Best</span>{/if}
							</h3>
							{#if jump.contact}
								{@render markRow(jump.contact.from, 'Touchdown')}
								<div
									class="mp-interval mp-interval-contact"
									title={intervalDescription(jump.contact)}
								>
									{intervalDescription(jump.contact)}
								</div>
							{/if}
							{@render markRow(jump.takeoff, 'Takeoff')}
							{#if jump.flight}
								<div
									class="mp-interval mp-interval-flight"
									title={intervalDescription(jump.flight)}
								>
									{intervalDescription(jump.flight)}
								</div>
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
						<section class="mp-unpaired" aria-label="Unpaired marks">
							<h3>Unpaired marks</h3>
							{#each grouped.unpairedMarks as mark (mark.id)}{@render markRow(
									mark,
									mark.type === 'landing' ? 'Landing' : 'Takeoff'
								)}{/each}
						</section>
					{/if}
				</div>
			{/if}

			<div class="mp-session">
				<input
					class="mp-field mp-title"
					bind:value={title}
					placeholder={titlePlaceholder}
					aria-label="Session title"
					spellcheck="false"
				/>
				<label class="mp-recorded">
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
					placeholder="Notes (exercise, attempt, how it felt…)"
					aria-label="Session notes"
					rows="2"
				></textarea>
			</div>
		</div>

		<footer class="mp-footer">
			<button class="mp-text-btn" onclick={onUndo} disabled={!canUndo} title="Undo (⌘Z)"
				>Undo</button
			>
			<button class="mp-text-btn" onclick={onClear} disabled={marks.length === 0}>Clear all</button>
		</footer>
	{/if}
</aside>

<style>
	.marks-panel {
		display: flex;
		flex: 0 0 300px;
		flex-direction: column;
		width: 300px;
		min-height: 0;
		height: 100%;
		border: 1px solid hsl(var(--at-border) / 0.82);
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg));
		font-size: 12px;
	}

	/* Transparent on desktop; becomes the scrolling region on narrow screens. */
	.mp-body {
		display: contents;
	}

	.mp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 10px 8px 16px;
	}

	.mp-header h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.mp-session {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0 12px 10px;
		border-top: 1px solid hsl(var(--at-border) / 0.8);
		padding-top: 10px;
	}

	.mp-field {
		width: 100%;
		padding: 6px 9px;
		border: 1px solid hsl(var(--at-border) / 0.8);
		border-radius: 8px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 12px;
		outline: none;
	}

	.mp-field:focus {
		border-color: hsl(var(--at-accent) / 0.65);
	}

	.mp-field::placeholder {
		color: hsl(var(--at-fg-muted));
	}

	.mp-title {
		font-weight: 600;
	}

	.mp-recorded {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	.mp-recorded input {
		width: auto;
		padding: 4px 7px;
	}

	.mp-notes {
		resize: vertical;
		line-height: 1.4;
	}

	.mp-scale {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	.mp-scale select {
		flex: 1;
		padding: 4px 6px;
	}

	.mp-summary {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 5px;
		padding: 4px 12px 0;
	}

	.mp-stat {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		padding: 7px 7px;
		border-radius: 8px;
		background: hsl(var(--at-surface));
	}

	.mp-stat-muted .mp-stat-value,
	.mp-stat-muted .mp-stat-sub {
		color: hsl(var(--at-fg-muted));
	}

	.mp-stat-primary {
		grid-column: 1 / -1;
	}

	.mp-stat-primary .mp-stat-value {
		font-size: 26px;
	}

	.mp-stat-label {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.mp-stat-value {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 18px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.mp-stat-value small {
		margin-left: 3px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.mp-stat-sub {
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
	}

	.mp-precision {
		margin: 0;
		color: hsl(var(--at-fg-muted));
		font-size: 10px;
	}

	.mp-calibration {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 5px;
		padding: 8px 12px;
		border-bottom: 1px solid hsl(var(--at-border) / 0.8);
	}

	.mp-calibration .mp-scale {
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.mp-calibration .mp-scale select {
		width: auto;
		min-width: 150px;
		padding: 4px 7px;
	}

	.mp-empty {
		margin: 8px 12px;
		padding: 14px;
		border: 1px dashed hsl(var(--at-border-hover));
		border-radius: 10px;
		color: hsl(var(--at-fg-secondary));
		line-height: 1.5;
	}

	.mp-empty-title {
		margin: 0 0 6px;
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.mp-empty ol {
		margin: 0;
		padding-left: 18px;
		list-style: decimal;
	}

	.mp-empty-hint {
		margin: 10px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	kbd {
		display: inline-block;
		min-width: 18px;
		padding: 1px 5px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 4px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font:
			600 10px 'JetBrains Mono',
			ui-monospace,
			monospace;
		text-align: center;
	}

	.mp-results {
		flex: 1;
		min-height: 0;
		padding: 4px 10px 8px;
		overflow-y: auto;
	}

	.mp-jump,
	.mp-unpaired {
		margin-bottom: 4px;
		padding: 6px 2px 7px;
		border-bottom: 1px solid hsl(var(--at-border) / 0.8);
	}

	.mp-jump.mp-best {
		border-color: hsl(var(--at-border-hover));
	}

	.mp-jump h3,
	.mp-unpaired h3 {
		display: flex;
		justify-content: space-between;
		margin: 0 0 2px;
		font-size: 12px;
		font-weight: 600;
	}

	.mp-jump-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mp-jump h3 span {
		color: hsl(var(--at-fg-muted));
		font-size: 10px;
		font-weight: 500;
	}

	.mp-incomplete,
	.mp-rsi {
		margin: 4px 2px 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	.mp-mark {
		--mark-color: hsl(var(--at-takeoff));
		display: flex;
		align-items: center;
		border-radius: 8px;
	}

	.mp-mark-landing {
		--mark-color: hsl(var(--at-landing));
	}

	.mp-mark:hover {
		background: hsl(var(--at-surface));
	}

	.mp-mark.active {
		background: color-mix(in srgb, var(--mark-color) 16%, transparent);
	}

	.mp-mark-main {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 3px 5px;
		border: none;
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
		font-weight: 500;
	}

	.mp-mark-time {
		color: hsl(var(--at-fg-secondary));
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.mp-mark-actions {
		display: flex;
		gap: 1px;
		padding-right: 4px;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.mp-mark:hover .mp-mark-actions,
	.mp-mark.active .mp-mark-actions,
	.mp-mark:focus-within .mp-mark-actions {
		opacity: 1;
	}

	.mp-icon-btn {
		display: grid;
		width: 24px;
		height: 24px;
		place-items: center;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
	}

	.mp-icon-btn svg {
		width: 16px;
		height: 16px;
	}

	.mp-icon-btn:hover {
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg));
	}

	.mp-remove:hover {
		color: hsl(var(--at-error));
	}

	.mp-interval {
		margin: 0 0 1px 8px;
		padding: 1px 6px;
		border-left: 2px solid hsl(var(--at-border-hover));
		color: hsl(var(--at-fg-secondary));
		font-size: 10px;
		line-height: 1.3;
		white-space: nowrap;
	}

	.mp-interval-flight {
		border-left-color: hsl(var(--at-takeoff) / 0.7);
	}

	.mp-interval-contact {
		border-left-color: hsl(var(--at-landing) / 0.6);
	}

	.mp-warning {
		margin: 4px 0 8px;
		padding: 6px 8px;
		border-left: 2px solid hsl(var(--at-warning) / 0.6);
		color: hsl(var(--at-warning));
		font-size: 10px;
	}

	.mp-footer {
		display: flex;
		justify-content: flex-end;
		gap: 4px;
		margin-top: auto;
		padding: 8px 10px;
		border-top: 1px solid hsl(var(--at-border) / 0.8);
	}

	.mp-text-btn {
		padding: 6px 10px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.mp-text-btn:hover:not(:disabled) {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.mp-text-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}

	@media (hover: none) {
		.mp-mark-actions {
			opacity: 1;
		}
	}

	/* The glyph stays 16px; the button box itself reaches the 44px touch minimum. */
	@media (pointer: coarse) {
		.mp-icon-btn {
			width: 44px;
			height: 44px;
		}

		.mp-header {
			padding-block: 4px 0;
		}

		.mp-mark-actions {
			gap: 0;
			padding-right: 0;
		}

		.mp-footer {
			padding-block: 2px;
		}

		.mp-text-btn {
			min-height: 44px;
		}
	}

	/* Sheet: stacked under the video on narrow screens. Collapsed it is just the
	   summary toggle; expanded it scrolls between a pinned toggle and footer. */
	.marks-panel.sheet {
		flex: 0 0 auto;
		width: 100%;
		height: auto;
		max-height: min(55dvh, 560px);
		overflow: hidden;
	}

	.sheet .mp-body {
		display: block;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.sheet .mp-results {
		overflow-y: visible;
	}

	.mp-sheet-heading {
		margin: 0;
		font: inherit;
	}

	.mp-sheet-toggle {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr)) 44px;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 56px;
		padding: 6px 2px 6px 14px;
		border: none;
		border-radius: 14px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		touch-action: manipulation;
	}

	.sheet:not(.collapsed) .mp-sheet-toggle {
		min-height: 48px;
		border-radius: 14px 14px 0 0;
	}

	.mp-sheet-title,
	.mp-peek-hint {
		grid-column: 1 / 4;
	}

	.mp-sheet-title {
		font-size: 13px;
		font-weight: 600;
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
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mp-peek-value {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 15px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.mp-peek-primary .mp-peek-value {
		font-size: 18px;
	}

	.mp-peek-value small {
		margin-left: 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 10px;
		font-weight: 500;
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
