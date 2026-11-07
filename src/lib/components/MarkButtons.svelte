<script lang="ts">
	import MarkGlyph from './MarkGlyph.svelte';
	import type { MarkType } from '$lib/video/marks';
	import { stepLabel, type MarkAction } from '$lib/video/guide';
	import type { JumpType } from '$lib/session/schema';

	// The marking controls on /alpha. One button names the step that belongs at the frame
	// on screen and marks it; a small one beside it marks the other type instead. The
	// button is the guide, so its words are the only instructions while marking.
	interface Props {
		/** Null until the video can be marked. */
		action: MarkAction | null;
		/** Marking waits for the frame rate; `failed` means it never will. */
		frameRate: 'detecting' | 'known' | 'failed';
		jumpType: JumpType | null;
		/** Marks the step that belongs on the frame left on screen. */
		onMarkNext: () => void;
		/** Marks this frame as `type`, replacing a mark of the other type on it. */
		onMark: (type: MarkType) => void;
		/** Opens the controls for the mark on this frame. */
		onEdit: () => void;
	}

	let { action, frameRate, jumpType, onMarkNext, onMark, onEdit }: Props = $props();

	let chooseOpen = $state(false);
	let root: HTMLDivElement | null = $state(null);

	let ready = $derived(frameRate === 'known' && action !== null);
	let type: MarkType | null = $derived(
		action?.kind === 'add' ? action.type : action?.kind === 'on-frame' ? action.mark.type : null
	);
	let other: MarkType = $derived(type === 'takeoff' ? 'landing' : 'takeoff');
	/** The other-type button only shows while there's a step to offer it against. */
	let showAlt = $derived(ready && action?.kind !== 'choose');
	let label = $derived(
		action?.kind === 'add' || action?.kind === 'on-frame' ? stepLabel(action.step, jumpType) : ''
	);

	$effect(() => {
		// A new frame or a new mark closes the choice; it was about the old one.
		void action;
		chooseOpen = false;
	});

	/** What pressing the big button (or M) does. */
	export function press(fromKey = false) {
		if (!ready || !action) return;
		if (action.kind === 'add') onMarkNext();
		else if (action.kind === 'on-frame') onEdit();
		else {
			chooseOpen = !chooseOpen;
			if (chooseOpen && fromKey) {
				queueMicrotask(() => root?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
			}
		}
	}

	function choose(choice: MarkType) {
		chooseOpen = false;
		onMark(choice);
	}

	function handleMenuKey(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.stopPropagation();
			chooseOpen = false;
			root?.querySelector<HTMLElement>('.mark-primary')?.focus();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const items = [...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
			const at = items.indexOf(document.activeElement as HTMLElement);
			items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
		}
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (chooseOpen && !root?.contains(event.target as Node)) chooseOpen = false;
	}

	// Escape closes the choice wherever focus is (a tap or click leaves it on the button).
	function handleWindowKeyDown(event: KeyboardEvent) {
		if (chooseOpen && event.key === 'Escape') chooseOpen = false;
	}

	function typeName(markType: MarkType): string {
		return markType === 'takeoff' ? 'takeoff' : 'landing';
	}
</script>

<svelte:window onpointerdown={handleWindowPointerDown} onkeydown={handleWindowKeyDown} />

<div class="step-marks" class:solo={!showAlt} bind:this={root}>
	<button
		class="mark-primary"
		class:add={action?.kind === 'add'}
		class:on-frame={action?.kind === 'on-frame'}
		class:choose={action?.kind === 'choose'}
		class:takeoff={type === 'takeoff'}
		disabled={!ready}
		onclick={() => press()}
		aria-keyshortcuts={ready ? 'M' : undefined}
		aria-haspopup={action?.kind === 'choose' ? 'menu' : undefined}
		aria-expanded={action?.kind === 'choose' ? chooseOpen : undefined}
		aria-label={action?.kind === 'on-frame' ? `${label} is on this frame. Edit it` : undefined}
		title={!ready
			? undefined
			: action?.kind === 'add'
				? `Mark ${label.toLowerCase()} on this frame (M)`
				: action?.kind === 'on-frame'
					? `Edit the ${label.toLowerCase()} on this frame (M)`
					: 'Choose what to mark on this frame (M)'}
	>
		{#if frameRate === 'failed'}
			<span class="mark-primary-label">Can't mark this video</span>
		{:else if !ready}
			<span class="mark-primary-label">Reading frame rate…</span>
		{:else if action?.kind === 'add'}
			<MarkGlyph type={action.type} size={17} />
			<span class="mark-primary-label">Mark {label.toLowerCase()}</span>
			<kbd>M</kbd>
		{:else if action?.kind === 'on-frame'}
			<svg class="mark-check" viewBox="0 0 16 16" aria-hidden="true"
				><path d="m3.5 8.5 3 3 6-7" /></svg
			>
			<span class="mark-primary-label">{label}</span>
		{:else}
			<span class="mark-primary-label">Mark…</span>
			<kbd>M</kbd>
		{/if}
	</button>

	{#if showAlt}
		<button
			class="mark-alt"
			class:takeoff={other === 'takeoff'}
			onclick={() => onMark(other)}
			aria-label={action?.kind === 'on-frame'
				? `Change to ${typeName(other)}`
				: `Mark ${typeName(other)} instead`}
			aria-keyshortcuts={other === 'takeoff' ? 'T' : 'L'}
			title={action?.kind === 'on-frame'
				? `Change to ${typeName(other)} (${other === 'takeoff' ? 'T' : 'L'})`
				: `Mark ${typeName(other)} instead (${other === 'takeoff' ? 'T' : 'L'})`}
		>
			<MarkGlyph type={other} size={18} />
		</button>
	{/if}

	{#if chooseOpen && action?.kind === 'choose'}
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div class="mark-menu" role="menu" aria-label="Mark this frame as" onkeydown={handleMenuKey}>
			<button class="mark-menu-item" role="menuitem" onclick={() => choose('landing')}>
				<MarkGlyph type="landing" />Touchdown or landing<kbd>L</kbd>
			</button>
			<button class="mark-menu-item takeoff" role="menuitem" onclick={() => choose('takeoff')}>
				<MarkGlyph type="takeoff" />Takeoff<kbd>T</kbd>
			</button>
		</div>
	{/if}
</div>

<style>
	/* After the frame controls, inside the transport dock. */
	.step-marks {
		grid-area: landing;
		justify-self: start;
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		padding-left: 8px;
	}

	.mark-primary,
	.mark-alt {
		--mark-color: hsl(var(--at-landing));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 32px;
		border: 1px solid transparent;
		border-radius: 7px;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background 140ms var(--at-ease),
			border-color 140ms var(--at-ease),
			color 140ms var(--at-ease);
	}

	.takeoff,
	.mark-menu-item.takeoff {
		--mark-color: hsl(var(--at-takeoff));
	}

	/* A fixed width, so the label can change step to step without moving anything. */
	.mark-primary {
		min-width: 196px;
		padding: 0 8px 0 10px;
		background: hsl(var(--at-fg) / 0.06);
		color: hsl(var(--at-fg-muted));
	}

	.mark-primary-label {
		flex: 1 1 auto;
		text-align: left;
	}

	/* The step that belongs here: filled in its type's colour, the one loud thing in the bar. */
	.mark-primary.add {
		background: var(--mark-color);
		color: hsl(var(--at-bg));
	}

	/* A mark is already here: quiet, outlined in its colour, and it opens its controls. */
	.mark-primary.on-frame {
		border-color: color-mix(in srgb, var(--mark-color) 60%, transparent);
		background: color-mix(in srgb, var(--mark-color) 10%, hsl(var(--at-surface)));
		color: hsl(var(--at-fg));
	}

	.mark-primary.choose {
		border-color: hsl(var(--at-border-hover));
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
	}

	.mark-primary:disabled {
		cursor: default;
	}

	.mark-check {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: var(--mark-color);
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mark-alt {
		width: 32px;
		padding: 0;
		background: transparent;
		color: var(--mark-color);
	}

	kbd {
		min-width: 14px;
		color: inherit;
		opacity: 0.6;
		font:
			600 11px/1 var(--at-font-sans),
			sans-serif;
	}

	@media (hover: hover) {
		.mark-primary.add:hover {
			background: color-mix(in srgb, var(--mark-color) 86%, hsl(var(--at-fg)));
		}
		.mark-primary.on-frame:hover,
		.mark-primary.choose:hover {
			border-color: var(--mark-color);
		}
		.mark-primary.choose:hover {
			border-color: hsl(var(--at-fg-muted));
		}
		.mark-alt:hover {
			background: hsl(var(--at-fg) / 0.1);
		}
	}

	.mark-primary:not(:disabled):active,
	.mark-alt:active {
		transform: translateY(1px);
	}

	.mark-menu {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 8px;
		z-index: 40;
		display: flex;
		flex-direction: column;
		min-width: 220px;
		padding: 4px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 10px;
		background: hsl(var(--at-bg-elevated));
		box-shadow: 0 12px 32px hsl(var(--at-shadow) / 0.5);
	}

	.mark-menu-item {
		--mark-color: hsl(var(--at-landing));
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 36px;
		padding: 0 10px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}

	.mark-menu-item :global(.mark-glyph) {
		color: var(--mark-color);
	}

	.mark-menu-item kbd {
		margin-left: auto;
	}

	.mark-menu-item:hover,
	.mark-menu-item:focus-visible {
		background: hsl(var(--at-fg) / 0.08);
		outline: none;
	}

	@media (hover: none) and (pointer: coarse) {
		kbd {
			display: none;
		}
		.mark-primary,
		.mark-alt {
			min-height: 44px;
		}
	}

	/* A phone: one big button under the thumb, the other type a square beside it. */
	@container control-bar (max-width: 700px) {
		.step-marks {
			grid-area: marks;
			justify-self: stretch;
			display: grid;
			grid-template-columns: 52px minmax(0, 1fr);
			gap: 10px;
			margin-top: 6px;
			padding: 0;
		}
		.mark-primary {
			order: 2;
			min-width: 0;
			height: 52px;
			padding: 0 18px;
			border-radius: 14px;
			font-size: 16px;
			justify-content: center;
		}
		.mark-primary-label {
			flex: 0 1 auto;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.step-marks.solo {
			grid-template-columns: minmax(0, 1fr);
		}
		.mark-alt {
			order: 1;
			width: 52px;
			height: 52px;
			border-radius: 14px;
			background: hsl(var(--at-fg) / 0.07);
		}
		.mark-menu {
			left: 0;
			right: 0;
		}
		.mark-menu-item {
			min-height: 48px;
			font-size: 15px;
		}
	}
</style>
