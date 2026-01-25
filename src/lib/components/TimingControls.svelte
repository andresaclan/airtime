<script lang="ts">
	interface Props {
		timingModeEnabled: boolean;
		inPoint: number | null;
		outPoint: number | null;
		currentTime: number;
		frameRate: number;
		onToggleTiming?: () => void;
		onMarkIn?: () => void;
		onMarkOut?: () => void;
		onClear?: () => void;
		onViewDetails?: () => void;
	}

	let {
		timingModeEnabled,
		inPoint,
		outPoint,
		currentTime,
		frameRate,
		onToggleTiming,
		onMarkIn,
		onMarkOut,
		onClear,
		onViewDetails
	}: Props = $props();

	// Calculate frame count between in and out points
	let frameCount = $derived(
		inPoint !== null && outPoint !== null ? Math.round((outPoint - inPoint) * frameRate) : null
	);

	// Calculate duration in milliseconds
	let durationMs = $derived(
		inPoint !== null && outPoint !== null ? (outPoint - inPoint) * 1000 : null
	);

	// Check if we have both points set
	let hasBothPoints = $derived(inPoint !== null && outPoint !== null);
</script>

<div class="at-reveal flex items-center justify-center gap-2 px-4 py-2" style="--delay: 90ms">
	<!-- Toggle Timing Mode Button -->
	<button
		onclick={onToggleTiming}
		class="at-btn at-btn-icon-sm {timingModeEnabled ? 'at-btn-primary' : ''}"
		aria-label={timingModeEnabled ? 'Disable timing mode' : 'Enable timing mode'}
		title="Toggle timing mode (T)"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="square"
		>
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	</button>

	{#if timingModeEnabled}
		<!-- Mark In Button -->
		<button
			onclick={onMarkIn}
			class="at-btn {inPoint !== null ? 'at-btn-in' : ''}"
			style="padding: 4px 10px;"
			aria-label="Mark in point"
			title="Mark in point (I)"
		>
			<span class="text-xs font-semibold">In</span>
		</button>

		<!-- Mark Out Button -->
		<button
			onclick={onMarkOut}
			class="at-btn {outPoint !== null ? 'at-btn-out' : ''}"
			style="padding: 4px 10px;"
			aria-label="Mark out point"
			title="Mark out point (O)"
		>
			<span class="text-xs font-semibold">Out</span>
		</button>

		<!-- Clear Button -->
		<button
			onclick={onClear}
			class="at-btn at-btn-icon-sm"
			disabled={inPoint === null && outPoint === null}
			aria-label="Clear in/out points"
			title="Clear in/out points"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-3 w-3"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="square"
			>
				<line x1="18" y1="6" x2="6" y2="18" />
				<line x1="6" y1="6" x2="18" y2="18" />
			</svg>
		</button>

		<!-- Results (compact, inline) -->
		{#if hasBothPoints}
			<div class="h-4 w-px" style="background: hsl(var(--at-border))"></div>

			<span class="font-mono text-xs" style="color: hsl(var(--at-accent))">
				{frameCount}f
			</span>
			<span class="font-mono text-xs" style="color: hsl(var(--at-success))">
				{durationMs?.toFixed(0)}ms
			</span>

			<!-- View Details Button -->
			<button
				onclick={onViewDetails}
				class="at-btn at-btn-icon-sm"
				aria-label="View timing details with thumbnails"
				title="View timing details"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
					<circle cx="8.5" cy="8.5" r="1.5" />
					<polyline points="21 15 16 10 5 21" />
				</svg>
			</button>
		{/if}
	{/if}
</div>

<style>
	.at-btn-in {
		border-color: hsl(var(--at-success));
		background: hsl(var(--at-success) / 0.15);
		color: hsl(var(--at-success));
	}

	.at-btn-in:hover:not(:disabled) {
		background: hsl(var(--at-success) / 0.25);
		border-color: hsl(var(--at-success));
	}

	.at-btn-out {
		border-color: hsl(var(--at-error));
		background: hsl(var(--at-error) / 0.15);
		color: hsl(var(--at-error));
	}

	.at-btn-out:hover:not(:disabled) {
		background: hsl(var(--at-error) / 0.25);
		border-color: hsl(var(--at-error));
	}
</style>
