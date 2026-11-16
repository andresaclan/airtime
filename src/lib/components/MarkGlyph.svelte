<script lang="ts">
	import type { MarkType } from '$lib/video/marks';

	// What a mark's type looks like without its colour. Time runs left to right, as on the
	// timeline: a takeoff is the flight arc leaving the ground, a touchdown or landing is the
	// arc coming back down onto it. Curved, so it doesn't read as upload or download.
	let { type, size = 16 }: { type: MarkType; size?: number } = $props();
</script>

<svg
	class="mark-glyph"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.7"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M1.5 14h13" />
	{#if type === 'takeoff'}
		<path d="M3.5 11.5C4.5 6.5 8 3.5 13 3M10.2 1.6 13 3l-1.7 2.7" />
	{:else}
		<path d="M3 3c5 .5 8.5 3.5 9.5 8.5M10 9.6l2.5 1.9 1.6-2.6" />
	{/if}
</svg>

<style>
	.mark-glyph {
		flex: 0 0 auto;
	}
</style>
