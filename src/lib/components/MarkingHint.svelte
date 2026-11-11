<script lang="ts">
	import { stepDefinition, type MarkAction } from '$lib/video/guide';
	import type { JumpType } from '$lib/session/schema';

	// One line under the picture that says which frame the step on the Mark button is,
	// until the athlete knows them. It retires itself after a few measured jumps; Got it
	// hides it sooner. A video that can't be marked always says so here.
	interface Props {
		action: MarkAction | null;
		frameRate: 'detecting' | 'known' | 'failed';
		jumpType: JumpType | null;
		/** Said instead of the step, when the jump isn't being marked (its result, a correction). */
		text?: string;
		hidden: boolean;
		onHide: () => void;
	}

	let { action, frameRate, jumpType, text: override, hidden, onHide }: Props = $props();

	let text = $derived.by(() => {
		if (frameRate === 'detecting')
			return "Reading the video's frame rate. Marking unlocks in a moment.";
		if (override) return override;
		if (!action) return '';
		if (action.kind === 'choose') {
			return 'Nothing new belongs between these marks. Choose a type to mark anyway, or move a mark.';
		}
		return stepDefinition(action.step, jumpType);
	});
</script>

{#if frameRate === 'failed'}
	<p class="marking-hint failed" role="status">
		<strong>This video can't be marked.</strong> Its frame rate couldn't be read or measured. Try the
		original file from your camera.
	</p>
{:else if !hidden}
	<div class="marking-hint">
		<p class="hint-text" aria-live="polite">{text}</p>
		<button class="hint-hide" onclick={onHide} title="Hide these hints">Got it</button>
	</div>
{/if}

<style>
	/* A single line between the picture and its controls, the same height at every step
	   so the picture never moves. */
	.marking-hint {
		position: relative;
		z-index: 31;
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 12px;
		height: 34px;
		margin: 0;
		padding: 0 8px 0 14px;
		border-top: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		line-height: 18px;
	}

	.marking-hint.failed {
		height: auto;
		min-height: 34px;
		padding-block: 8px;
		background: hsl(var(--at-warning) / 0.07);
	}

	.marking-hint strong {
		color: hsl(var(--at-fg));
		font-weight: 500;
	}

	.hint-text {
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hint-hide {
		flex: 0 0 auto;
		height: 24px;
		padding: 0 8px;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: hsl(var(--at-fg-muted));
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	@media (hover: hover) {
		.hint-hide:hover {
			background: hsl(var(--at-fg) / 0.06);
			color: hsl(var(--at-fg));
		}
	}

	/* Touch: a 44px hit area for Got it. */
	@media (pointer: coarse) {
		.hint-hide {
			position: relative;
			color: hsl(var(--at-fg-secondary));
			font-size: 13px;
		}
		.hint-hide::after {
			content: '';
			position: absolute;
			inset: -10px -4px;
		}
	}

	/* A phone, upright or in the rail beside a sideways picture: two lines of room, so
	   a definition never gets cut off. */
	@container jump-dock (max-width: 480px) {
		.marking-hint:not(.failed) {
			height: 46px;
			padding-left: 16px;
		}
		.hint-text {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			white-space: normal;
		}
	}
</style>
