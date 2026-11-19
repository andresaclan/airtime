<script lang="ts">
	import type { MarkStep } from '$lib/video/guide';

	// Where a step sits in a jump, without colour: the ground contact (plant step to
	// takeoff), then the flight arc down to the landing. The step in question is one solid
	// dot; the other two are hollow rings, so position never relies on colour or size alone.
	// Drawn on whole pixels at 36×16 (the viewBox), so the rings stay crisp at 1×.
	let { step, small = false }: { step: MarkStep; small?: boolean } = $props();

	const id = $props.id();
	const POINTS: Record<MarkStep, number> = { plant: 3, takeoff: 15, landing: 33 };
	const STEPS = Object.keys(POINTS) as MarkStep[];
</script>

<svg
	class="mark-arc"
	viewBox="0 0 36 16"
	width={small ? 32 : 36}
	height={small ? 14 : 16}
	aria-hidden="true"
>
	<defs>
		<!-- Cuts the lines around each dot, so a ring reads as a ring. -->
		<mask id="{id}-cut" maskUnits="userSpaceOnUse" x="-2" y="-4" width="40" height="22">
			<rect x="-2" y="-4" width="40" height="22" fill="#fff" />
			{#each STEPS as at (at)}
				<circle cx={POINTS[at]} cy="12" r={at === step ? 4.25 : 3.5} fill="#000" />
			{/each}
		</mask>
	</defs>
	<g mask="url(#{id}-cut)">
		<path class="ground" d="M3 12H15" />
		<path class="flight" d="M15 12Q24 -5 33 12" />
	</g>
	{#each STEPS as at (at)}
		{#if at === step}
			<circle class="current" cx={POINTS[at]} cy="12" r="3" />
		{:else}
			<circle class="ring" cx={POINTS[at]} cy="12" r="2.25" />
		{/if}
	{/each}
</svg>

<style>
	.mark-arc {
		flex: 0 0 auto;
		overflow: visible;
	}
	.ground,
	.flight {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
	}
	.ground {
		opacity: 0.45;
	}
	.flight {
		opacity: 0.6;
	}
	.ring {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		opacity: 0.6;
	}
	.current {
		fill: currentColor;
	}
</style>
