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
	} = $props<Props>();

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

<div class="at-reveal px-4 py-3" style="--delay: 90ms">
	<!-- Timing mode toggle row -->
	<div class="flex items-center justify-center gap-3">
		<!-- Toggle Timing Mode Button -->
		<button
			onclick={onToggleTiming}
			class="at-btn at-btn-pill touch-manipulation {timingModeEnabled ? 'at-btn-primary' : ''}"
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
				stroke-linecap="round"
			>
				<circle cx="12" cy="12" r="10" />
				<polyline points="12 6 12 12 16 14" />
			</svg>
			<span class="text-sm font-semibold">Timing</span>
		</button>

		{#if timingModeEnabled}
			<!-- Mark In Button -->
			<button
				onclick={onMarkIn}
				class="at-btn touch-manipulation {inPoint !== null ? 'at-btn-in' : ''}"
				aria-label="Mark in point"
				title="Mark in point (I)"
			>
				<span class="text-sm font-semibold">In</span>
			</button>

			<!-- Mark Out Button -->
			<button
				onclick={onMarkOut}
				class="at-btn touch-manipulation {outPoint !== null ? 'at-btn-out' : ''}"
				aria-label="Mark out point"
				title="Mark out point (O)"
			>
				<span class="text-sm font-semibold">Out</span>
			</button>

			<!-- Clear Button -->
			<button
				onclick={onClear}
				class="at-btn at-btn-icon at-btn-ghost touch-manipulation"
				disabled={inPoint === null && outPoint === null}
				aria-label="Clear in/out points"
				title="Clear in/out points"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
				>
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		{/if}
	</div>

	<!-- Results display (when both points are set) -->
	{#if timingModeEnabled && hasBothPoints}
		<div class="mt-3 flex items-center justify-center gap-4">
			<div class="flex items-center gap-2">
				<span class="at-badge at-badge-accent">
					<span class="font-mono">{frameCount}</span> frames
				</span>
				<span class="at-badge at-badge-success">
					<span class="font-mono">{durationMs?.toFixed(0)}</span> ms
				</span>
			</div>

			<!-- View Details Button -->
			<button
				onclick={onViewDetails}
				class="at-btn at-btn-icon at-btn-ghost touch-manipulation"
				aria-label="View timing details with thumbnails"
				title="View timing details"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5"
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
		</div>
	{/if}
</div>

<style>
	.at-btn-in {
		border-color: hsl(var(--at-success));
		background: hsl(var(--at-success) / 0.12);
		color: hsl(var(--at-success));
	}

	.at-btn-in:hover:not(:disabled) {
		background: hsl(var(--at-success) / 0.2);
		border-color: hsl(var(--at-success));
	}

	.at-btn-out {
		border-color: hsl(var(--at-error));
		background: hsl(var(--at-error) / 0.12);
		color: hsl(var(--at-error));
	}

	.at-btn-out:hover:not(:disabled) {
		background: hsl(var(--at-error) / 0.2);
		border-color: hsl(var(--at-error));
	}
</style>
