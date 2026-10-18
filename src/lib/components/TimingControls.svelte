<script lang="ts">
	interface Props {
		timingModeEnabled: boolean;
		inPoint: number | null;
		outPoint: number | null;
		frameRate: number;
		onToggleTiming?: () => void;
		onMarkIn?: () => void;
		onMarkOut?: () => void;
		onViewDetails?: () => void;
	}

	let {
		timingModeEnabled,
		inPoint,
		outPoint,
		frameRate,
		onToggleTiming,
		onMarkIn,
		onMarkOut,
		onViewDetails
	}: Props = $props();

	let frameCount = $derived(
		inPoint !== null && outPoint !== null
			? Math.round((Math.max(inPoint, outPoint) - Math.min(inPoint, outPoint)) * frameRate)
			: null
	);

	let durationMs = $derived(
		inPoint !== null && outPoint !== null
			? (Math.max(inPoint, outPoint) - Math.min(inPoint, outPoint)) * 1000
			: null
	);

	let hasBothPoints = $derived(inPoint !== null && outPoint !== null);

	function formatTimeCompact(seconds: number, fps: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
		const totalFrames = Math.round(seconds * fps);
		const frameInSecond = totalFrames % Math.round(fps);
		const totalSeconds = Math.floor(seconds);
		const mins = Math.floor(totalSeconds / 60);
		const secs = totalSeconds % 60;
		return `${mins}:${secs.toString().padStart(2, '0')}:${frameInSecond.toString().padStart(2, '0')}`;
	}
</script>

<div class="timing-section">
	<!-- Timing toggle -->
	<button
		onclick={onToggleTiming}
		class="timing-toggle"
		class:active={timingModeEnabled}
		aria-pressed={timingModeEnabled}
		title="Toggle timing mode (T)"
	>
		<span class="timing-toggle-dot"></span>
		<span class="timing-toggle-text">Timing</span>
	</button>

	{#if timingModeEnabled}
		<!-- Mark buttons -->
		<div class="mark-buttons">
			<button
				onclick={onMarkIn}
				class="mark-btn mark-btn-in"
				class:marked={inPoint !== null}
				title="Mark in point (I)"
			>
				<span class="mark-btn-key">I</span>
				<span class="mark-btn-time">
					{inPoint !== null ? formatTimeCompact(inPoint, frameRate) : 'In'}
				</span>
			</button>

			<button
				onclick={onMarkOut}
				class="mark-btn mark-btn-out"
				class:marked={outPoint !== null}
				title="Mark out point (O)"
			>
				<span class="mark-btn-key">O</span>
				<span class="mark-btn-time">
					{outPoint !== null ? formatTimeCompact(outPoint, frameRate) : 'Out'}
				</span>
			</button>
		</div>

		<!-- Results -->
		{#if hasBothPoints}
			<div class="timing-results">
				<div class="timing-stat">
					<span class="timing-stat-value">{frameCount}</span>
					<span class="timing-stat-label">frames</span>
				</div>
				<div class="timing-divider"></div>
				<div class="timing-stat">
					<span class="timing-stat-value">{durationMs?.toFixed(0)}</span>
					<span class="timing-stat-label">ms</span>
				</div>
				<button onclick={onViewDetails} class="details-btn" title="View timing details">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<circle cx="8.5" cy="8.5" r="1.5" />
						<polyline points="21 15 16 10 5 21" />
					</svg>
				</button>
			</div>
		{/if}
	{/if}
</div>

<style>
	.timing-section {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding-top: 0;
		flex-wrap: wrap;
	}

	.timing-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 9px;
		background: hsl(var(--at-surface) / 0.1);
		border: 1px solid hsl(var(--at-border) / 0.55);
		border-radius: 100px;
		cursor: pointer;
		transition: all 180ms ease;
	}

	.timing-toggle:hover {
		border-color: hsl(var(--at-accent) / 0.68);
		background: hsl(var(--at-surface) / 0.18);
	}

	.timing-toggle.active {
		background: hsl(var(--at-accent) / 0.12);
		border-color: hsl(var(--at-accent));
	}

	.timing-toggle-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--at-fg-muted));
		transition: all 180ms ease;
	}

	.timing-toggle.active .timing-toggle-dot {
		background: hsl(var(--at-accent));
		box-shadow: 0 0 12px hsl(var(--at-accent));
	}

	.timing-toggle-text {
		font-size: 11px;
		font-weight: 600;
		color: hsl(var(--at-fg-secondary));
		text-shadow: 0 1px 3px hsl(var(--at-shadow) / 0.95);
	}

	.timing-toggle.active .timing-toggle-text {
		color: hsl(var(--at-accent));
	}

	.mark-buttons {
		display: flex;
		gap: 8px;
	}

	.mark-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px;
		background: hsl(var(--at-surface) / 0.1);
		border: 1px solid hsl(var(--at-border) / 0.55);
		border-radius: 10px;
		cursor: pointer;
		transition: all 180ms ease;
	}

	.mark-btn:hover {
		background: hsl(var(--at-surface-hover) / 0.2);
	}

	.mark-btn-in.marked {
		border-color: hsl(var(--at-in));
		background: hsl(var(--at-in) / 0.1);
	}

	.mark-btn-out.marked {
		border-color: hsl(var(--at-out));
		background: hsl(var(--at-out) / 0.1);
	}

	.mark-btn-key {
		width: 17px;
		height: 17px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 700;
		border-radius: 4px;
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg-muted));
	}

	.mark-btn-in .mark-btn-key {
		background: hsl(var(--at-in) / 0.2);
		color: hsl(var(--at-in));
	}

	.mark-btn-out .mark-btn-key {
		background: hsl(var(--at-out) / 0.2);
		color: hsl(var(--at-out));
	}

	.mark-btn-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 10px;
		font-weight: 500;
		color: hsl(var(--at-fg));
		text-shadow: 0 1px 3px hsl(var(--at-shadow) / 0.95);
	}

	.timing-results {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 9px;
		background: hsl(var(--at-accent) / 0.08);
		border: 1px solid hsl(var(--at-accent) / 0.25);
		border-radius: 10px;
	}

	.timing-stat {
		display: flex;
		align-items: baseline;
		gap: 4px;
	}

	.timing-stat-value {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 16px;
		font-weight: 700;
		color: hsl(var(--at-accent));
	}

	.timing-stat-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		color: hsl(var(--at-fg-muted));
	}

	.timing-divider {
		width: 1px;
		height: 20px;
		background: hsl(var(--at-accent) / 0.3);
	}

	.details-btn {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: hsl(var(--at-accent));
		cursor: pointer;
		border-radius: 6px;
		transition: all 150ms ease;
	}

	.details-btn:hover {
		background: hsl(var(--at-accent) / 0.15);
	}

	@media (max-width: 480px) {
		.timing-section {
			gap: 8px;
		}

		.mark-btn {
			padding: 8px 12px;
		}

		.timing-results {
			padding: 6px 10px;
			gap: 8px;
		}
	}
</style>
