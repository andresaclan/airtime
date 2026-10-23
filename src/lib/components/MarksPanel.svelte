<script lang="ts">
	import { formatTimecode } from '$lib/video/timecode';
	import type { Analysis, Interval, Mark } from '$lib/video/marks';
	import { TIME_SCALES } from '$lib/session/schema';

	interface Props {
		marks: Mark[];
		analysis: Analysis;
		frameRate: number;
		title: string;
		notes: string;
		timeScale: number;
		titlePlaceholder: string;
		activeMarkId: string | null;
		canUndo: boolean;
		onSeek: (time: number) => void;
		onNudge: (id: string, frames: number) => void;
		onRemove: (id: string) => void;
		onUndo: () => void;
		onClear: () => void;
		onClose: () => void;
	}

	let {
		marks,
		analysis,
		frameRate,
		title = $bindable(),
		notes = $bindable(),
		timeScale = $bindable(),
		titlePlaceholder,
		activeMarkId,
		canUndo,
		onSeek,
		onNudge,
		onRemove,
		onUndo,
		onClear,
		onClose
	}: Props = $props();

	const LABELS = { takeoff: 'Takeoff', landing: 'Landing' } as const;

	let flights = $derived(analysis.intervals.filter((interval) => interval.kind === 'flight'));
	let bestFlight = $derived(
		flights.reduce<Interval | null>(
			(best, flight) => (!best || flight.seconds > best.seconds ? flight : best),
			null
		)
	);
	// Real time per frame, so precision is honest for slow-motion footage too.
	let frameMs = $derived(frameRate > 0 ? (1000 / frameRate) * timeScale : 0);
	let slowMotion = $derived(
		TIME_SCALES.find((scale) => scale.value === timeScale && scale.value !== 1)
	);
	// Interval that starts at each mark, so it can be drawn between that row and the next.
	let intervalFrom = $derived(
		new Map(analysis.intervals.map((interval) => [interval.from.id, interval]))
	);

	function formatMs(seconds: number): string {
		return `${(seconds * 1000).toFixed(1)}`;
	}
</script>

<aside class="marks-panel" aria-label="Jump analysis">
	<header class="mp-header">
		<h2>Analysis</h2>
		<button
			class="mp-icon-btn"
			onclick={onClose}
			aria-label="Hide analysis"
			title="Hide analysis (A)"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
				><path d="M9 6l6 6-6 6" /></svg
			>
		</button>
	</header>

	<div class="mp-session">
		<input
			class="mp-field mp-title"
			bind:value={title}
			placeholder={titlePlaceholder}
			aria-label="Session title"
			spellcheck="false"
		/>
		<textarea
			class="mp-field mp-notes"
			bind:value={notes}
			placeholder="Notes (exercise, attempt, how it felt…)"
			aria-label="Session notes"
			rows="2"
		></textarea>
		<label class="mp-scale">
			<span>Footage</span>
			<select class="mp-field" bind:value={timeScale}>
				{#each TIME_SCALES as scale (scale.value)}
					<option value={scale.value}>{scale.label}</option>
				{/each}
			</select>
		</label>
	</div>

	{#if bestFlight}
		<div class="mp-summary">
			<div class="mp-stat">
				<span class="mp-stat-label">{flights.length > 1 ? 'Best height' : 'Jump height'}</span>
				<span class="mp-stat-value">{bestFlight.heightCm?.toFixed(1)}<small>cm</small></span>
				<span class="mp-stat-sub">{((bestFlight.heightCm ?? 0) / 2.54).toFixed(1)} in</span>
			</div>
			<div class="mp-stat">
				<span class="mp-stat-label">Flight time</span>
				<span class="mp-stat-value">{formatMs(bestFlight.realSeconds)}<small>ms</small></span>
				<span class="mp-stat-sub">{bestFlight.frames} frames</span>
			</div>
		</div>
		<p class="mp-precision">
			±1 frame = ±{frameMs.toFixed(1)} ms at {frameRate.toFixed(2)} fps{#if slowMotion}&nbsp;· real
				time ({slowMotion.label.toLowerCase()}){/if}
		</p>
	{/if}

	{#if marks.length === 0}
		<div class="mp-empty">
			<p class="mp-empty-title">Mark a jump</p>
			<ol>
				<li>Pause on the first frame the feet leave the ground and press <kbd>T</kbd>.</li>
				<li>Step to the first frame they touch down and press <kbd>L</kbd>.</li>
			</ol>
			<p class="mp-empty-hint">
				Step frames with <kbd>,</kbd> <kbd>.</kbd> · mark a landing before the takeoff to also get contact
				time.
			</p>
		</div>
	{:else}
		<ol class="mp-list">
			{#each marks as mark, index (mark.id)}
				{@const interval = intervalFrom.get(mark.id)}
				<li class="mp-mark mp-mark-{mark.type}" class:active={mark.id === activeMarkId}>
					<button class="mp-mark-main" onclick={() => onSeek(mark.time)} title="Go to this frame">
						<span class="mp-dot"></span>
						<span class="mp-mark-type">{LABELS[mark.type]}</span>
						<span class="mp-mark-time">{formatTimecode(mark.time, frameRate)}</span>
					</button>
					<div class="mp-mark-actions">
						<button
							class="mp-icon-btn"
							onclick={() => onNudge(mark.id, -1)}
							aria-label="Move {LABELS[mark.type].toLowerCase()} one frame earlier"
							title="1 frame earlier">‹</button
						>
						<button
							class="mp-icon-btn"
							onclick={() => onNudge(mark.id, 1)}
							aria-label="Move {LABELS[mark.type].toLowerCase()} one frame later"
							title="1 frame later">›</button
						>
						<button
							class="mp-icon-btn mp-remove"
							onclick={() => onRemove(mark.id)}
							aria-label="Remove {LABELS[mark.type].toLowerCase()}"
							title="Remove (Backspace)">×</button
						>
					</div>
				</li>
				{#if index + 1 < marks.length && analysis.outOfSequence.has(marks[index + 1].id)}
					<li class="mp-interval mp-warning">
						Two {LABELS[mark.type].toLowerCase()}s in a row — no timing between them
					</li>
				{:else if interval}
					<li class="mp-interval mp-interval-{interval.kind}">
						<span class="mp-interval-label"
							>{interval.kind === 'flight' ? 'Flight' : 'Contact'}</span
						>
						<span class="mp-interval-value">{formatMs(interval.realSeconds)} ms</span>
						<span class="mp-interval-meta">
							{interval.frames} fr{#if interval.heightCm !== undefined}&nbsp;· {interval.heightCm.toFixed(
									1
								)} cm{/if}
						</span>
					</li>
				{/if}
			{/each}
		</ol>
	{/if}

	<footer class="mp-footer">
		<button class="mp-text-btn" onclick={onUndo} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
		<button class="mp-text-btn" onclick={onClear} disabled={marks.length === 0}>Clear all</button>
	</footer>
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

	.mp-notes {
		resize: vertical;
		line-height: 1.4;
	}

	.mp-scale {
		display: flex;
		align-items: center;
		gap: 8px;
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
		gap: 8px;
		padding: 4px 12px 0;
	}

	.mp-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 12px;
		border-radius: 10px;
		background: hsl(var(--at-surface));
	}

	.mp-stat-label {
		color: hsl(var(--at-fg-muted));
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.mp-stat-value {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 22px;
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
		margin: 6px 16px 0;
		color: hsl(var(--at-fg-muted));
		font-size: 10px;
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

	.mp-list {
		flex: 1;
		min-height: 0;
		margin: 10px 0 0;
		padding: 0 8px;
		overflow-y: auto;
		list-style: none;
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
		padding: 7px 8px;
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

	/* Interval rows hang off a rail between the two marks they connect. */
	.mp-interval {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 0 11px;
		padding: 4px 8px 4px 16px;
		border-left: 2px solid var(--rail);
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
	}

	.mp-interval-flight {
		--rail: hsl(var(--at-takeoff) / 0.7);
	}

	.mp-interval-contact {
		--rail: hsl(var(--at-landing) / 0.5);
	}

	.mp-interval-label {
		min-width: 46px;
		color: hsl(var(--at-fg-muted));
	}

	.mp-interval-value {
		color: hsl(var(--at-fg));
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.mp-interval-meta {
		margin-left: auto;
		color: hsl(var(--at-fg-muted));
		font-variant-numeric: tabular-nums;
	}

	.mp-warning {
		--rail: hsl(var(--at-warning) / 0.6);
		color: hsl(var(--at-warning));
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

	@media (max-width: 900px) {
		.marks-panel {
			flex: 0 0 auto;
			width: 100%;
			height: auto;
			max-height: 38vh;
		}
	}
</style>
