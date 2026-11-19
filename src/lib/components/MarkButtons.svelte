<script lang="ts">
	import MarkArc from './MarkArc.svelte';
	import type { MarkType } from '$lib/video/marks';
	import { stepLabel, type MarkAction, type MarkStep } from '$lib/video/guide';
	import type { JumpType } from '$lib/session/schema';

	// The marking controls. One button names the step that belongs at the frame on screen
	// and marks it; a quieter one beside it marks the other type instead. A marked frame
	// shows that mark, and pressing it swaps the row for the mark's editor. The buttons are
	// the guide, so their words are the only instructions while marking. A small jump arc
	// on each says where the step sits: plant step, takeoff, landing.
	interface Props {
		/** The step a landing-type mark would be here: a plant step, or a landing after a takeoff. */
		landingStep: Exclude<MarkStep, 'takeoff'>;
		/** Null until the video can be marked. */
		action: MarkAction | null;
		/** Marking waits for the frame rate; `failed` means it never will. */
		frameRate: 'detecting' | 'known' | 'failed';
		jumpType: JumpType | null;
		/**
		 * The main button (or M): pauses on the frame on screen, then marks its step, opens
		 * the editor of the mark on it (`openEditor`), or focuses the choice (`openChoice`).
		 */
		onPress: () => void;
		/** Marks this frame as `type`, replacing a mark of the other type on it. */
		onMark: (type: MarkType) => void;
		/** Moves the mark on this frame by whole frames. */
		onNudge: (id: string, frames: number) => void;
		onRemove: (id: string) => void;
	}

	let { landingStep, action, frameRate, jumpType, onPress, onMark, onNudge, onRemove }: Props =
		$props();

	let root: HTMLDivElement | null = $state(null);
	let editing = $state(false);

	let ready = $derived(frameRate === 'known' && action !== null);
	let label = $derived(
		action?.kind === 'add' || action?.kind === 'on-frame' ? stepLabel(action.step, jumpType) : ''
	);
	let type: MarkType | null = $derived(
		action?.kind === 'add' ? action.type : action?.kind === 'on-frame' ? action.mark.type : null
	);
	let other: MarkType = $derived(type === 'takeoff' ? 'landing' : 'takeoff');
	let otherStep: MarkStep = $derived(other === 'takeoff' ? 'takeoff' : landingStep);
	let otherLabel = $derived(stepLabel(otherStep, jumpType));
	let landingLabel = $derived(stepLabel(landingStep, jumpType));

	// The editor belongs to a marked frame; anywhere else (or once the mark is gone) it closes.
	let onFrame = $derived(action?.kind === 'on-frame');
	$effect(() => {
		if (!onFrame) editing = false;
	});

	function keyFor(markType: MarkType) {
		return markType === 'takeoff' ? 'T' : 'L';
	}

	function focus(selector: string) {
		queueMicrotask(() => root?.querySelector<HTMLElement>(selector)?.focus());
	}

	/** Swaps a marked frame's row for its editor; from the keyboard, with focus in it. */
	export function openEditor(fromKey = false) {
		editing = true;
		if (fromKey) focus('.mark-editor button:not([hidden])');
	}

	/** Where nothing obviously belongs: from the keyboard, focus goes to the first choice. */
	export function openChoice(fromKey = false) {
		if (fromKey) focus('.mark-choice');
	}

	function closeEditor() {
		const hadFocus = root?.contains(document.activeElement) ?? false;
		editing = false;
		if (hadFocus) focus('.mark-primary');
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (editing && event.key === 'Escape') {
			event.stopPropagation();
			closeEditor();
		}
	}

	// On a narrow phone the main button drops its verb ("Box landing") when the whole label
	// won't fit, rather than cutting it off. 8px of slack keeps it from flickering at the
	// edge. The accessible name always says "Mark …".
	let labelSlot: HTMLSpanElement | null = $state(null);
	let measure: HTMLSpanElement | null = $state(null);
	let tight = $state(false);
	$effect(() => {
		if (!labelSlot || !measure) return;
		void label;
		const slot = labelSlot;
		const full = measure;
		const fit = () => {
			const room = slot.clientWidth;
			const need = full.offsetWidth;
			tight = tight ? need > room - 8 : need > room;
		};
		fit();
		const observer = new ResizeObserver(fit);
		observer.observe(slot);
		return () => observer.disconnect();
	});
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="step-marks" bind:this={root}>
	{#if !ready}
		<button class="mark-primary mark-status" class:failed={frameRate === 'failed'} disabled>
			{#if frameRate === 'failed'}
				Can't mark this video
			{:else}
				<span class="mark-spinner" aria-hidden="true"></span>Reading frame rate…
			{/if}
		</button>
	{:else if action?.kind === 'add'}
		<button
			class="mark-primary mark-add"
			onclick={onPress}
			aria-label="Mark {label.toLowerCase()}"
			aria-keyshortcuts="M"
			title="Mark {label.toLowerCase()} on this frame (M)"
		>
			<MarkArc step={action.step} />
			<span class="mark-label" bind:this={labelSlot}>
				{tight ? label : `Mark ${label.toLowerCase()}`}
				<span class="mark-measure" bind:this={measure} aria-hidden="true"
					>Mark {label.toLowerCase()}</span
				>
			</span>
			<kbd>M</kbd>
		</button>
		<button
			class="mark-alt"
			onclick={() => onMark(other)}
			aria-label="Mark {otherLabel.toLowerCase()} instead"
			aria-keyshortcuts={keyFor(other)}
			title="Mark {otherLabel.toLowerCase()} instead ({keyFor(other)})"
		>
			<MarkArc step={otherStep} />
			<span class="mark-label">{otherLabel}</span>
		</button>
	{:else if action?.kind === 'on-frame' && !editing}
		<button
			class="mark-primary mark-on-frame"
			onclick={onPress}
			aria-label="{label} is marked on this frame. Edit it"
			aria-keyshortcuts="M"
			title="Edit the {label.toLowerCase()} on this frame (M)"
		>
			<MarkArc step={action.step} />
			<span class="mark-label">{label}</span>
			<svg class="mark-check" viewBox="0 0 16 16" aria-hidden="true"
				><path d="m3.5 8.5 3 3 6-7" /></svg
			>
			<span class="mark-edit-hint">
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 13 5.5 6 12.5H3.5V10z" /></svg
				>Edit
			</span>
		</button>
	{:else if action?.kind === 'on-frame'}
		{@const mark = action.mark}
		<div class="mark-editor" role="group" aria-label="Edit the {label.toLowerCase()}">
			<span class="mark-nudge">
				<button
					onclick={() => onNudge(mark.id, -1)}
					aria-label="Move the {label.toLowerCase()} one frame earlier"
					title="One frame earlier">−1</button
				>
				<button
					onclick={() => onNudge(mark.id, 1)}
					aria-label="Move the {label.toLowerCase()} one frame later"
					title="One frame later">+1</button
				>
			</span>
			<button
				class="mark-swap"
				onclick={() => onMark(other)}
				aria-label="Change to {otherLabel.toLowerCase()}"
				aria-keyshortcuts={keyFor(other)}
				title="Change to {otherLabel.toLowerCase()} ({keyFor(other)})"
			>
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><path d="M3 5h9.5M10 2.5 12.5 5 10 7.5M13 11H3.5M6 8.5 3.5 11 6 13.5" /></svg
				>
				<span class="mark-label">{otherLabel}</span>
			</button>
			<button
				class="mark-remove"
				onclick={() => onRemove(mark.id)}
				aria-label="Remove the {label.toLowerCase()}"
				title="Remove the {label.toLowerCase()}"
			>
				<svg viewBox="0 0 16 16" aria-hidden="true"
					><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" /></svg
				>
			</button>
			<button class="mark-done" onclick={closeEditor}>Done</button>
		</div>
	{:else}
		<button
			class="mark-primary mark-choice"
			onclick={() => onMark('landing')}
			aria-label="Mark {landingLabel.toLowerCase()}"
			aria-keyshortcuts="L"
			title="Mark {landingLabel.toLowerCase()} on this frame (L)"
		>
			<MarkArc step={landingStep} />
			<span class="mark-label">Mark {landingLabel.toLowerCase()}</span>
		</button>
		<button
			class="mark-choice"
			onclick={() => onMark('takeoff')}
			aria-label="Mark takeoff"
			aria-keyshortcuts="T"
			title="Mark takeoff on this frame (T)"
		>
			<MarkArc step="takeoff" />
			<span class="mark-label">Mark takeoff</span>
		</button>
	{/if}
</div>

<style>
	/* After the frame controls, inside the transport dock: one fixed-width row, so the
	   frame controls beside it never shift as labels change. */
	.step-marks {
		grid-area: landing;
		justify-self: start;
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		width: var(--mark-slot, 372px);
		padding-left: 8px;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-width: 0;
		height: 32px;
		padding: 0 12px;
		border: none;
		border-radius: var(--at-radius);
		background: hsl(var(--at-fg) / 0.06);
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		letter-spacing: -0.005em;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 140ms var(--at-ease),
			box-shadow 140ms var(--at-ease),
			color 140ms var(--at-ease);
	}

	button:disabled {
		cursor: default;
	}

	button:not(:disabled):active {
		transform: translateY(1px);
	}

	/* Keyboard focus: one 2px ring drawn just inside the button's edge, so it never runs
	   into the dock around it or doubles up with a hairline. A bright button keeps a rim
	   of its fill outside a dark ring. */
	button:focus-visible {
		outline: 2px solid hsl(var(--at-fg));
		outline-offset: -2px;
		border-radius: var(--at-radius);
	}

	.mark-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: left;
	}

	/* The step that belongs here: the one bright fill in the bar. */
	.mark-add {
		position: relative;
		flex: 1 1 0;
		justify-content: flex-start;
		background: hsl(var(--at-emphasis));
		color: hsl(var(--at-bg));
	}

	.mark-add .mark-label {
		flex: 1 1 0;
	}

	/* The full label, laid out off to the side, to tell whether it fits. */
	.mark-measure {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
		white-space: nowrap;
	}

	kbd {
		margin-left: auto;
		padding-left: 4px;
		color: inherit;
		opacity: 0.62;
		font:
			500 11px/1 var(--at-font-sans),
			sans-serif;
	}

	/* The other type: quiet, a fixed width so the main button's edge never moves. */
	.mark-alt {
		flex: 0 0 152px;
		justify-content: flex-start;
		background: hsl(var(--at-fg) / 0.04);
		box-shadow: inset 0 0 0 1px hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg-secondary));
	}

	/* A marked frame: the whole row is one outlined button, with Edit as its hint. */
	.mark-on-frame {
		flex: 1 1 0;
		justify-content: flex-start;
		background: hsl(var(--at-fg) / 0.03);
		box-shadow: inset 0 0 0 1px hsl(var(--at-fg) / 0.18);
	}

	.mark-alt:focus-visible,
	.mark-on-frame:focus-visible {
		box-shadow: none;
	}

	.mark-add:focus-visible,
	.mark-done:focus-visible {
		outline-color: hsl(var(--at-bg));
		outline-offset: -4px;
	}

	.mark-check {
		flex: 0 0 auto;
		width: 14px;
		height: 14px;
		opacity: 0.7;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mark-edit-hint {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-left: auto;
		color: hsl(var(--at-fg-secondary));
	}

	.mark-edit-hint svg {
		width: 13px;
		height: 13px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* Nothing obviously belongs here: two equal choices. */
	.mark-choice {
		flex: 1 1 0;
		background: hsl(var(--at-fg) / 0.08);
	}

	.mark-status {
		flex: 1 1 0;
		gap: 8px;
		background: hsl(var(--at-fg) / 0.03);
		color: hsl(var(--at-fg-muted));
		font-weight: 400;
	}

	.mark-status.failed {
		background: hsl(var(--at-warning) / 0.08);
		color: hsl(var(--at-warning));
	}

	.mark-spinner {
		width: 11px;
		height: 11px;
		border: 1.5px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: mark-spin 0.9s linear infinite;
	}

	@keyframes mark-spin {
		to {
			rotate: 1turn;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.mark-spinner {
			animation: none;
		}
	}

	/* The editor takes the row's place: nudge, change type, remove, done. */
	.mark-editor {
		display: flex;
		flex: 1 1 0;
		gap: 4px;
		min-width: 0;
	}

	.mark-nudge {
		display: flex;
		flex: 0 0 auto;
		border-radius: var(--at-radius);
		background: hsl(var(--at-fg) / 0.06);
		font-variant-numeric: tabular-nums;
	}

	.mark-nudge button {
		width: 36px;
		padding: 0;
		background: transparent;
	}

	.mark-nudge button + button {
		box-shadow: inset 1px 0 0 hsl(var(--at-fg) / 0.1);
	}

	.mark-swap {
		flex: 1 1 0;
	}

	.mark-editor svg {
		flex: 0 0 auto;
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.7;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mark-remove {
		flex: 0 0 32px;
		padding: 0;
		color: hsl(var(--at-fg-muted));
	}

	.mark-done {
		flex: 0 0 64px;
		background: hsl(var(--at-emphasis));
		color: hsl(var(--at-bg));
	}

	@media (hover: hover) {
		.mark-add:hover,
		.mark-done:hover {
			background: hsl(var(--at-emphasis-strong));
		}
		.mark-alt:hover,
		.mark-on-frame:hover,
		.mark-choice:hover,
		.mark-swap:hover,
		.mark-nudge button:hover {
			background: hsl(var(--at-fg) / 0.1);
		}
		.mark-remove:hover {
			color: hsl(var(--at-error));
		}
	}

	@media (hover: none) and (pointer: coarse) {
		kbd {
			display: none;
		}
	}

	/* A phone: one row of 52px buttons under the thumb. The main button keeps the right
	   edge; the other type hugs its label on the left, so the main button gets the room. */
	@container control-bar (max-width: 700px) {
		/* Sized by the bar, never by its labels, so a long one can't widen the bar. */
		.step-marks {
			grid-area: marks;
			justify-self: stretch;
			contain: inline-size;
			gap: 8px;
			width: auto;
			margin-top: 6px;
			padding: 0;
		}
		button {
			height: 52px;
			padding: 0 12px;
			border-radius: 14px;
			font-size: 16px;
		}
		.step-marks :global(.mark-arc) {
			width: 32px;
			height: 14px;
		}
		.mark-add {
			order: 2;
		}
		.mark-alt {
			order: 1;
			flex: 0 0 auto;
			min-width: 128px;
			background: hsl(var(--at-fg) / 0.06);
			box-shadow: none;
		}
		kbd {
			display: none;
		}
		.mark-editor {
			gap: 8px;
		}
		/* Nudge and remove live in the jump strip above on a phone. */
		.mark-nudge,
		.mark-remove {
			display: none;
		}
		.mark-done {
			flex-basis: 96px;
		}
	}
</style>
