<script lang="ts">
	import { KEYBIND_GROUPS, platformKeys } from '$lib/keybinds';
	import { dialogFocus, trapTab } from '$lib/dialogFocus';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

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
			if (event.key !== 'Tab') {
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

	// "Ctrl / ⌘ + Z" → keys with the separators between them, so each key gets its own cap.
	function keyTokens(keys: string): { text: string; key: boolean }[] {
		return platformKeys(keys)
			.split(' ')
			.map((text) => ({ text, key: text !== '/' && text !== '+' }));
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
				{#each KEYBIND_GROUPS as group (group.title)}
					<section class="keybinds-group">
						<h3 class="group-title">{group.title}</h3>
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
		background: hsl(var(--at-bg) / 0.72);
		backdrop-filter: blur(8px);
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
		max-width: 760px;
		max-height: 85dvh;
		overflow-y: auto;
		padding: 0 0 24px;
		background: hsl(var(--at-bg-elevated));
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 16px;
		box-shadow:
			0 32px 80px hsl(var(--at-shadow) / 0.7),
			0 0 0 1px hsl(var(--at-shadow) / 0.6);
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
		background: hsl(var(--at-bg-elevated));
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

	.close-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.keybinds-groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 24px 40px;
		padding: 20px 24px 0;
	}

	.group-title {
		margin-bottom: 6px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.bind-list {
		display: flex;
		flex-direction: column;
	}

	.bind-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 36px;
		border-bottom: 1px solid hsl(var(--at-border) / 0.7);
	}

	.bind-row:last-child {
		border-bottom: none;
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
		border: 1px solid hsl(var(--at-border-hover));
		border-bottom-width: 2px;
		border-radius: 5px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font:
			600 11px/1 var(--at-font-mono),
			monospace;
		white-space: nowrap;
	}

	@media (prefers-reduced-motion: reduce) {
		.dialog-backdrop,
		.dialog-card {
			animation: none;
		}
	}
</style>
