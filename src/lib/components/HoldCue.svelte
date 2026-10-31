<script module lang="ts">
	import type { MarkType } from '$lib/video/marks';

	/** What a touch on the timeline is doing (VideoScrubber), for HoldCue to show. */
	export type ScrubCue = {
		text: string;
		/** The point it's about, which colours the cue; null for a plain hint. */
		type: MarkType | null;
		/** `up`: slide up to mark; `filling`: a pause is about to set the point; `set`: it did. */
		state: 'hint' | 'up' | 'filling' | 'set';
	};
</script>

<script lang="ts">
	// Drawn over the picture, where the thumb on the timeline can't cover it: a pill at
	// the top says what the touch can do, and while a pause fills, a tint of the point's
	// colour sweeps across the picture, then flashes as the point is set.
	interface Props {
		cue: ScrubCue | null;
		/** How long the sweep takes; it ends as the point is set. */
		fillMs: number;
	}

	let { cue, fillMs }: Props = $props();
</script>

{#if cue}
	<div
		class="cue cue-{cue.type ?? 'plain'}"
		class:filling={cue.state === 'filling'}
		class:set={cue.state === 'set'}
		style:--fill="{fillMs}ms"
		aria-hidden="true"
	>
		{#key cue.state}<div class="wash"></div>{/key}
		<span class="pill">
			{#if cue.state === 'set'}
				<svg viewBox="0 0 16 16" fill="none"
					><path
						d="m3.5 8.5 3 3 6-7"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			{:else if cue.state === 'up'}
				<svg viewBox="0 0 16 16" fill="none"
					><path
						d="M8 13V3.5M4 7l4-4 4 4"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
					/></svg
				>
			{:else if cue.type}
				<span class="dot"></span>
			{/if}
			{cue.text}
		</span>
	</div>
{/if}

<style>
	.cue {
		--mark-color: hsl(var(--at-fg));
		position: absolute;
		inset: 0;
		overflow: hidden;
		pointer-events: none;
	}

	.cue-takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	.cue-landing {
		--mark-color: hsl(var(--at-landing));
	}

	/* Light enough to judge the frame through. */
	.wash {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 0;
		opacity: 0;
		background: color-mix(in srgb, var(--mark-color) 24%, transparent);
	}

	/* The sweep has a bright leading edge, so its progress reads at a glance. */
	.filling .wash {
		opacity: 1;
		border-right: 3px solid var(--mark-color);
		animation: sweep var(--fill) linear forwards;
	}

	.set .wash {
		width: 100%;
		background: color-mix(in srgb, var(--mark-color) 34%, transparent);
		animation: flash 750ms var(--at-ease) forwards;
	}

	.pill {
		position: absolute;
		top: 12px;
		left: 50%;
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 14px;
		border-radius: 16px;
		background: hsl(var(--at-bg) / 0.72);
		box-shadow: 0 4px 16px hsl(var(--at-shadow) / 0.4);
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		transform: translateX(-50%);
		backdrop-filter: blur(12px);
		animation: pill-in 160ms var(--at-ease);
	}

	.set .pill {
		background: var(--mark-color);
		color: hsl(var(--at-bg));
		animation: pill-pop 300ms var(--at-ease);
	}

	.pill svg {
		width: 15px;
		height: 15px;
		margin-left: -3px;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--mark-color);
	}

	@keyframes sweep {
		to {
			width: 100%;
		}
	}

	@keyframes flash {
		0% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	@keyframes pill-in {
		from {
			opacity: 0;
			transform: translate(-50%, -4px);
		}
	}

	@keyframes pill-pop {
		0% {
			transform: translateX(-50%) scale(0.9);
		}
		55% {
			transform: translateX(-50%) scale(1.06);
		}
		100% {
			transform: translateX(-50%) scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pill,
		.set .pill {
			animation: none;
		}
		.set .wash {
			animation-duration: 1ms;
		}
	}
</style>
