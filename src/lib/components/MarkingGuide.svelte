<script lang="ts">
	import { groupJumps, type Analysis, type Mark, type MarkType } from '$lib/video/marks';
	import { GUIDE_STEPS, STEP_MARK, guideStep, plantLabel } from '$lib/video/guide';
	import type { JumpType } from '$lib/session/schema';

	interface Props {
		marks: Mark[];
		analysis: Analysis;
		jumpType: JumpType | null;
		/** Marking waits for the frame rate; `failed` means it never will. */
		frameRate: 'detecting' | 'known' | 'failed';
		saveShortcut: string;
		onHide: () => void;
	}

	let { marks, analysis, jumpType, frameRate, saveShortcut, onHide }: Props = $props();

	let step = $derived(guideStep(marks));
	let grouped = $derived(groupJumps(marks, analysis));
	let measured = $derived(grouped.jumps.filter((jump) => jump.flight));
	let lastJump = $derived(measured.at(-1));
	let stepIndex = $derived(step === 'done' ? GUIDE_STEPS.length : GUIDE_STEPS.indexOf(step));

	const LABELS: Record<(typeof GUIDE_STEPS)[number], string> = {
		plant: 'Plant step',
		takeoff: 'Takeoff',
		landing: 'Landing'
	};

	function label(name: (typeof GUIDE_STEPS)[number]): string {
		return name === 'plant' ? plantLabel(jumpType) : LABELS[name];
	}

	// Where to look for the touchdown that starts the jump.
	let plantTarget = $derived(
		jumpType === 'drop-jump'
			? 'your feet touch the ground after stepping off the box'
			: jumpType === 'repeat-hops'
				? 'your feet touch down before the first hop'
				: 'your plant foot touches the ground'
	);
</script>

{#snippet press(type: MarkType)}
	<span class="pointer-only">press</span><span class="touch-only">tap</span>
	<span class="guide-button guide-button-{type}"
		><span class="guide-dot"></span>{type === 'takeoff' ? 'Takeoff' : 'Landing'}<kbd
			>{type === 'takeoff' ? 'T' : 'L'}</kbd
		></span
	>
{/snippet}

<section class="marking-guide" class:failed={frameRate === 'failed'} aria-label="Marking guide">
	{#if frameRate === 'failed'}
		<p class="guide-text" role="status">
			<strong>This video can't be marked.</strong> Its frame rate couldn't be read or measured. Try the
			original file from your camera.
		</p>
	{:else}
		<div class="guide-head">
			<ol class="guide-steps">
				{#each GUIDE_STEPS as name, index (name)}
					<li
						class="guide-step guide-step-{STEP_MARK[name]}"
						class:current={index === stepIndex}
						class:complete={index < stepIndex}
						aria-current={index === stepIndex ? 'step' : undefined}
					>
						<span class="guide-step-num" aria-hidden="true"
							>{#if index < stepIndex}<svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" /></svg
								>{:else}{index + 1}{/if}</span
						>{label(name)}
					</li>
				{/each}
			</ol>
			{#if measured.length > 0 && step !== 'done'}
				<span class="guide-jump">Jump {measured.length + 1}</span>
			{/if}
			<button class="guide-hide" onclick={onHide} title="Hide the marking guide">Hide</button>
		</div>
		<p class="guide-text" aria-live="polite">
			{#if frameRate === 'detecting'}
				<span class="guide-wait">Reading the video's frame rate — marking unlocks in a moment.</span
				>
			{:else if step === 'plant'}
				<strong>Find the first frame {plantTarget}</strong>, then {@render press('landing')}.
				<span class="guide-detail"
					><span class="pointer-only"
						>Play with <kbd>Space</kbd>, pause just before it, then step frames with <kbd>,</kbd>
						<kbd>.</kbd></span
					><span class="touch-only"
						>Play, pause just before it, then step frames with ‹ › (hold to keep going).</span
					></span
				>
			{:else if step === 'takeoff'}
				<strong>Step forward to the first frame both feet are off the ground</strong>, then
				{@render press('takeoff')}.
			{:else if step === 'landing'}
				<strong>Step forward to the first frame your feet touch back down</strong>, then
				{@render press('landing')}.
			{:else if lastJump?.flight}
				<strong
					>Jump {measured.length} measured: {lastJump.flight.heightCm?.toFixed(1)} cm, {Math.round(
						lastJump.flight.realSeconds * 1000
					)} ms in the air.</strong
				>
				{#if !lastJump.contact}
					No {label('plant').toLowerCase()} marked, so no contact time: go back to it and
					{@render press('landing')}.
				{:else}
					Save to keep it<span class="pointer-only">&nbsp;(<kbd>{saveShortcut}</kbd>)</span>.
					{#if jumpType === 'repeat-hops'}Next hop? Mark its takeoff.{:else}Another jump in this
						clip? Start again from its {label('plant').toLowerCase()}.{/if}
				{/if}
			{/if}
		</p>
	{/if}
</section>

<style>
	/* A band between the picture and its controls: the step you're on, and which
	   button marks it. */
	.marking-guide {
		position: relative;
		z-index: 31;
		display: flex;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 6px;
		padding: 10px 14px 10px;
		border-top: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		line-height: 1.45;
	}

	.marking-guide.failed {
		background: hsl(var(--at-warning) / 0.07);
	}

	.guide-head {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.guide-steps {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.guide-step {
		--mark-color: hsl(var(--at-landing));
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 9px 0 4px;
		border: 1px solid transparent;
		border-radius: 999px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
	}

	.guide-step-takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	/* A chevron between steps reads as a sequence. */
	.guide-step + .guide-step::before {
		content: '';
		width: 5px;
		height: 5px;
		margin: 0 8px 0 -4px;
		border-top: 1.5px solid hsl(var(--at-fg-muted) / 0.6);
		border-right: 1.5px solid hsl(var(--at-fg-muted) / 0.6);
		transform: rotate(45deg);
	}

	.guide-step-num {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg-secondary));
		font-family: var(--at-font-mono);
		font-size: 10px;
		font-weight: 600;
	}

	.guide-step-num svg {
		width: 11px;
		height: 11px;
		fill: none;
		stroke: currentColor;
		stroke-width: 3;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.guide-step.current {
		border-color: color-mix(in srgb, var(--mark-color) 45%, transparent);
		background: color-mix(in srgb, var(--mark-color) 10%, transparent);
		color: hsl(var(--at-fg));
	}

	.guide-step.current .guide-step-num {
		background: var(--mark-color);
		color: hsl(var(--at-bg));
	}

	.guide-step.complete {
		color: hsl(var(--at-fg-secondary));
	}

	.guide-step.complete .guide-step-num {
		background: color-mix(in srgb, var(--mark-color) 22%, transparent);
		color: var(--mark-color);
	}

	.guide-jump {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		white-space: nowrap;
	}

	.guide-hide {
		margin-left: auto;
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
		.guide-hide:hover {
			background: hsl(var(--at-fg) / 0.06);
			color: hsl(var(--at-fg));
		}
	}

	.guide-text {
		margin: 0;
	}

	.guide-text strong {
		color: hsl(var(--at-fg));
		font-weight: 500;
	}

	.guide-wait {
		color: hsl(var(--at-fg-muted));
	}

	.guide-detail {
		display: block;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	/* The button to press, drawn as it looks in the dock below. */
	.guide-button {
		--mark-color: hsl(var(--at-landing));
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 6px 0 8px;
		border: 1px solid color-mix(in srgb, var(--mark-color) 45%, transparent);
		border-radius: 6px;
		background: color-mix(in srgb, var(--mark-color) 10%, transparent);
		color: hsl(var(--at-fg));
		font-weight: 500;
		white-space: nowrap;
	}

	.guide-button-takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	.guide-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--mark-color);
	}

	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 4px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg-secondary));
		font:
			500 11px/1 var(--at-font-mono),
			monospace;
	}

	.guide-button kbd {
		border: none;
		background: none;
		color: hsl(var(--at-fg-muted));
	}

	/* Touch screens have no keys to show, as on the dock's buttons. */
	@media (hover: none) and (pointer: coarse) {
		.guide-button kbd,
		.guide-detail kbd {
			display: none;
		}
	}

	@media (pointer: coarse) {
		.guide-hide {
			position: relative;
			height: 32px;
			font-size: 13px;
		}

		.guide-hide::after {
			content: '';
			position: absolute;
			inset: -6px 0;
		}
	}

	/* Phones: the step chips shed their labels except the current one. */
	@media (max-width: 480px) {
		.marking-guide {
			padding: 8px 10px;
		}

		.guide-step:not(.current) {
			padding-right: 2px;
			font-size: 0;
		}

		.guide-step:not(.current) .guide-step-num {
			font-size: 10px;
		}
	}
</style>
