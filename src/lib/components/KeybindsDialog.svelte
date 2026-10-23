<script lang="ts">
	import { KEYBIND_GROUPS } from '$lib/keybinds';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen, onClose }: Props = $props();

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

	function handleBackdropKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose();
		}
	}
</script>

{#if isOpen}
	<div
		class="keybinds-backdrop"
		onclick={handleBackdropClick}
		onkeydown={handleBackdropKeyDown}
		role="dialog"
		aria-modal="true"
		aria-label="Keyboard shortcuts"
		tabindex="-1"
	>
		<div class="keybinds-card">
			<div class="keybinds-header">
				<h2 class="keybinds-title">Keyboard Shortcuts</h2>
				<button class="close-btn" onclick={onClose} aria-label="Close">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-5 w-5"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
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
									<dt><kbd>{bind.keys}</kbd></dt>
									<dd>{bind.action}</dd>
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
	.keybinds-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: hsl(var(--at-bg) / 0.85);
		backdrop-filter: blur(12px);
		animation: fadeIn 150ms ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.keybinds-card {
		width: 100%;
		max-width: 640px;
		max-height: 85dvh;
		overflow-y: auto;
		padding: 20px 24px 24px;
		background: hsl(var(--at-bg-elevated));
		border: 1px solid hsl(var(--at-border));
		border-radius: 16px;
		box-shadow: 0 24px 60px hsl(var(--at-shadow) / 0.5);
	}

	.keybinds-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.keybinds-title {
		font-size: 16px;
		font-weight: 600;
		color: hsl(var(--at-fg));
	}

	.close-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: hsl(var(--at-fg-secondary));
		background: transparent;
		border: none;
		cursor: pointer;
	}

	.close-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.keybinds-groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 20px 28px;
	}

	.group-title {
		margin-bottom: 8px;
		font-size: 12px;
		font-weight: 600;
		color: hsl(var(--at-fg-secondary));
	}

	.bind-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.bind-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.bind-row dt {
		flex-shrink: 0;
	}

	.bind-row dd {
		font-size: 13px;
		text-align: right;
		color: hsl(var(--at-fg-secondary));
	}

	kbd {
		display: inline-block;
		padding: 3px 7px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		background: hsl(var(--at-surface));
		border: 1px solid hsl(var(--at-border));
		border-radius: 5px;
		color: hsl(var(--at-fg));
	}
</style>
