<script lang="ts">
	import type { MarkType } from '$lib/video/marks';

	// What a mark's type looks like without its colour: an arrow coming down onto the
	// ground for a touchdown or landing, and one leaving it for a takeoff.
	let { type, size = 16 }: { type: MarkType; size?: number } = $props();
</script>

<svg
	class="mark-glyph"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M2.5 14h11" />
	{#if type === 'takeoff'}
		<path d="M8 11V2.5M4.75 5.75 8 2.5l3.25 3.25" />
	{:else}
		<path d="M8 2v8.5M4.75 7.25 8 10.5l3.25-3.25" />
	{/if}
</svg>

<style>
	.mark-glyph {
		flex: 0 0 auto;
	}
</style>
