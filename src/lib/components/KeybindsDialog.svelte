<script lang="ts">
	import { KEYBIND_GROUPS, platformKeys, type KeybindGroup } from '$lib/keybinds';
	import { dialogFocus, trapTab } from '$lib/dialogFocus';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
		/** The marking guide was hidden; it can be brought back from here. */
		guideHidden?: boolean;
		onShowGuide?: () => void;
		groups?: KeybindGroup[];
	}

	let {
		isOpen,
		onClose,
		guideHidden = false,
		onShowGuide,
		groups = KEYBIND_GROUPS
	}: Props = $props();

	let card: HTMLElement | null = $state(null);

	// While open, the overlay owns the keyboard: only Esc and ? (to close) get through,
	// so playback and marking shortcuts don't fire behind it.
	$effect(() => {
		if (!isOpen) return;

		function handleCaptureKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape' || event.key === '?') {
				event.preventDefault();
				event.stopImmediatePropagation();
				onClose();
				return;
			}
			// Tab moves focus, and Enter or Space still press the focused button.
			const pressesButton =
				(event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLButtonElement;
			if (event.key !== 'Tab' && !pressesButton) {
				event.preventDefault();
			}
			trapTab(event, card);
			event.stopImmediatePropagation();
		}

		window.addEventListener('keydown', handleCaptureKeyDown, true);
		return () => window.removeEventListener('keydown', handleCaptureKeyDown, true);
	});

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose();
		}
	}

	// Playback and Timeline on the left; the rest on the right.
	const LEFT = ['Playback', 'Timeline'];
	let columns = $derived([
		groups.filter((group) => LEFT.includes(group.title)),
		groups.filter((group) => !LEFT.includes(group.title))
	]);

	// "Ctrl / ⌘ + Z" → keys with the separators between them, so each key gets its own cap.
	function keyTokens(keys: string): { text: string; key: boolean }[] {
		return platformKeys(keys)
			.split(' ')
			.map((text) => ({ text, key: !['/', '+', 'or'].includes(text) }));
	}

	function handleBackdropKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

{#if isOpen}
	<div
		class="dialog-backdrop"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeyDown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="keybinds-title"
		tabindex="-1"
	>
		<div class="dialog-card" bind:this={card} use:dialogFocus tabindex="-1">
			<div class="dialog-header">
				<h2 id="keybinds-title" class="dialog-title">Keyboard shortcuts</h2>
				<button class="close-btn" onclick={onClose} aria-label="Close" title="Close (Esc)">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M17 7 7 17M7 7l10 10" stroke-linecap="round" />
					</svg>
				</button>
			</div>

			<div class="keybinds-groups">
				{#each columns as column, c (c)}
					<div class="keybinds-column">
						{#each column as group (group.title)}
							<section class="keybinds-group">
								<h3 class="group-title">
									{group.title}{#if group.title === 'Timeline'}<span class="group-note"
											>when the timeline has focus</span
										>{/if}
								</h3>
								<dl class="bind-list">
									{#each group.binds as bind (bind.keys)}
										<div class="bind-row">
											<dt>{bind.action}</dt>
											<dd>
												{#each keyTokens(bind.keys) as token, i (i)}{#if token.key}<kbd
															>{token.text}</kbd
														>{:else}<span class="bind-sep">{token.text}</span>{/if}{/each}
											</dd>
										</div>
									{/each}
								</dl>
							</section>
						{/each}
					</div>
				{/each}
			</div>
			{#if guideHidden && onShowGuide}
				<div class="guide-footer">
					<span>The marking guide walks you through a jump, step by step.</span>
					<button class="guide-show" onclick={onShowGuide}>Show marking guide</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: hsl(var(--at-shadow) / 0.5);
		animation: fadeIn 160ms ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.dialog-card {
		width: 100%;
		max-width: 740px;
		max-height: 85dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 0 24px;
		background: hsl(var(--at-popover));
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		box-shadow: 0 24px 64px hsl(var(--at-shadow) / 0.6);
		outline: none;
		animation: rise 200ms cubic-bezier(0.2, 0, 0, 1);
	}

	.dialog-header {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 16px 14px 24px;
		border-bottom: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-popover));
	}

	.dialog-title {
		font-size: 15px;
		font-weight: 600;
		color: hsl(var(--at-fg));
	}

	.close-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: hsl(var(--at-fg-muted));
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.close-btn svg {
		width: 18px;
		height: 18px;
	}

	@media (hover: hover) {
		.close-btn:hover {
			background: hsl(var(--at-surface-hover));
			color: hsl(var(--at-fg));
		}
	}

	@media (pointer: coarse) {
		.close-btn {
			width: 44px;
			height: 44px;
		}
	}

	.keybinds-groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 24px;
		padding: 20px 24px 0;
	}

	.keybinds-column {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.group-note {
		margin-left: 8px;
		color: hsl(var(--at-fg-muted));
		font-weight: 400;
	}

	.group-title {
		margin-bottom: 8px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		font-weight: 500;
	}

	/* Each group is a bordered list of rows, as in T3's keybindings settings. */
	.bind-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		border: 1px solid hsl(var(--at-border));
		border-radius: 10px;
		background: hsl(var(--at-bg) / 0.6);
		overflow: hidden;
	}

	.bind-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 36px;
		padding: 0 10px 0 12px;
	}

	.bind-row + .bind-row {
		border-top: 1px solid hsl(var(--at-border));
	}

	.bind-row dt {
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
	}

	.bind-row dd {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 4px;
	}

	.bind-sep {
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
	}

	kbd {
		display: inline-grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		border: 1px solid hsl(var(--at-fg) / 0.06);
		border-radius: 5px;
		background: hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg));
		font:
			600 11px/1 var(--at-font-mono),
			monospace;
		white-space: nowrap;
	}

	.guide-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		margin: 24px 24px 0;
		padding: 12px 12px 12px 14px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 10px;
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
	}

	.guide-show {
		height: 30px;
		padding: 0 12px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 8px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	@media (hover: hover) {
		.guide-show:hover {
			background: hsl(var(--at-surface-hover));
		}
	}

	@media (pointer: coarse) {
		.guide-show {
			height: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dialog-backdrop,
		.dialog-card {
			animation: none;
		}
	}
</style>
