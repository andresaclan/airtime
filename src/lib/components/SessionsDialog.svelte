<script lang="ts">
	import { analyzeMarks } from '$lib/video/marks';
	import type { Session } from '$lib/session/schema';
	import { deleteSession, listSessions, putSessions } from '$lib/session/store';
	import { dialogFocus, focusFirst, trapTab } from '$lib/dialogFocus';
	import { downloadExport, parseImport, sessionsToImport } from '$lib/session/exportFile';

	interface Props {
		isOpen: boolean;
		currentSessionId: string | null;
		onClose: () => void;
		onOpen: (session: Session) => void;
		onDeleted: (id: string) => void;
		onImported: () => void;
	}

	let { isOpen, currentSessionId, onClose, onOpen, onDeleted, onImported }: Props = $props();

	let sessions: Session[] = $state([]);
	let loading = $state(false);
	let message: { text: string; error?: boolean } | null = $state(null);
	let importInput: HTMLInputElement | null = $state(null);
	let card: HTMLElement | null = $state(null);

	async function refresh() {
		loading = true;
		try {
			sessions = await listSessions();
		} catch {
			message = { text: "Couldn't read saved sessions from this browser.", error: true };
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!isOpen) return;
		message = null;
		void refresh();
	});

	// While open, the dialog owns the keyboard so playback and marking shortcuts don't
	// fire behind it. Default actions (Enter/Space on buttons, Tab) still work.
	$effect(() => {
		if (!isOpen) return;

		function handleCaptureKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
			trapTab(event, card);
			event.stopImmediatePropagation();
		}

		window.addEventListener('keydown', handleCaptureKeyDown, true);
		return () => window.removeEventListener('keydown', handleCaptureKeyDown, true);
	});

	function bestHeight(session: Session): number | null {
		const heights = analyzeMarks(session.marks, session.frameRate.value, session.timeScale)
			.intervals.map((interval) => interval.heightCm)
			.filter((height) => height !== undefined);
		return heights.length ? Math.max(...heights) : null;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	async function handleDelete(session: Session) {
		if (!confirm(`Delete "${session.title}"? This can't be undone unless you've exported it.`)) {
			return;
		}
		await deleteSession(session.id);
		onDeleted(session.id);
		await refresh();
		// The focused Delete button is gone; keep keyboard focus inside the dialog.
		if (card && !card.contains(document.activeElement)) focusFirst(card);
	}

	async function handleImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		message = null;
		try {
			const incoming = parseImport(await file.text());
			const toImport = sessionsToImport(incoming, await listSessions());
			await putSessions(toImport);
			const skipped = incoming.length - toImport.length;
			message = {
				text:
					`Imported ${toImport.length} session${toImport.length === 1 ? '' : 's'}` +
					(skipped ? ` · skipped ${skipped} already up to date` : '')
			};
			await refresh();
			if (toImport.length) onImported();
		} catch (error) {
			message = {
				text: `Import failed: ${error instanceof Error ? error.message : 'unknown error'}`,
				error: true
			};
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) onClose();
	}
</script>

{#if isOpen}
	<div
		class="sessions-backdrop"
		onclick={handleBackdropClick}
		onkeydown={() => {}}
		role="dialog"
		aria-modal="true"
		aria-label="Saved sessions"
		tabindex="-1"
	>
		<div class="sessions-card" bind:this={card} use:dialogFocus tabindex="-1">
			<div class="sessions-header">
				<h2 class="sessions-title">Saved sessions</h2>
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

			<p class="sessions-hint">
				Stored in this browser only. Videos aren't saved — choose Open (or drop the same file in) to
				reopen a session's marks. Export to back up or to hand the data to an agent.
			</p>

			{#if message}
				<p class="sessions-message" class:error={message.error}>{message.text}</p>
			{/if}

			{#if loading && sessions.length === 0}
				<p class="sessions-empty">Loading…</p>
			{:else if sessions.length === 0}
				<p class="sessions-empty">No saved sessions yet. Mark a video and press ⌘/Ctrl + S.</p>
			{:else}
				<ul class="sessions-list">
					{#each sessions as session (session.id)}
						{@const height = bestHeight(session)}
						<li class="session-row">
							<div class="session-info">
								<span class="session-name">
									{session.title}
									{#if session.id === currentSessionId}<span class="session-current">Open</span
										>{/if}
								</span>
								<span class="session-meta">
									{session.media.fileName} · {session.marks.length} mark{session.marks.length === 1
										? ''
										: 's'}{#if height !== null}&nbsp;· best {height.toFixed(1)} cm{/if} · {formatDate(
										session.updatedAt
									)}
								</span>
							</div>
							<div class="session-actions">
								{#if session.id !== currentSessionId}
									<button class="text-btn" onclick={() => onOpen(session)}>Open</button>
								{/if}
								<button class="text-btn" onclick={() => downloadExport([session])}>Export</button>
								<button class="text-btn danger" onclick={() => handleDelete(session)}>Delete</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="sessions-footer">
				<button class="text-btn" onclick={() => importInput?.click()}>Import…</button>
				<button
					class="primary-btn"
					onclick={() => downloadExport(sessions)}
					disabled={sessions.length === 0}
				>
					Export all
				</button>
			</div>
		</div>
		<input
			bind:this={importInput}
			type="file"
			accept="application/json,.json"
			onchange={handleImport}
			class="sr-only"
		/>
	</div>
{/if}

<style>
	.sessions-backdrop {
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

	.sessions-card {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 640px;
		max-height: 85dvh;
		padding: 20px 24px 20px;
		background: hsl(var(--at-bg-elevated));
		border: 1px solid hsl(var(--at-border));
		border-radius: 16px;
		box-shadow: 0 24px 60px hsl(var(--at-shadow) / 0.5);
		outline: none;
	}

	.sessions-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}

	.sessions-title {
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

	.sessions-hint {
		margin-bottom: 12px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 1.5;
	}

	.sessions-message {
		margin-bottom: 10px;
		padding: 8px 10px;
		border-radius: 8px;
		background: hsl(var(--at-success) / 0.12);
		color: hsl(var(--at-fg));
		font-size: 12px;
	}

	.sessions-message.error {
		background: hsl(var(--at-error) / 0.14);
	}

	.sessions-empty {
		padding: 24px 0;
		color: hsl(var(--at-fg-secondary));
		font-size: 13px;
		text-align: center;
	}

	.sessions-list {
		flex: 1;
		min-height: 0;
		margin: 0 -8px;
		overflow-y: auto;
		list-style: none;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 9px 8px;
		border-radius: 8px;
	}

	.session-row:hover {
		background: hsl(var(--at-surface));
	}

	.session-info {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.session-name {
		overflow: hidden;
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-current {
		margin-left: 6px;
		padding: 1px 6px;
		border-radius: 6px;
		background: hsl(var(--at-fg) / 0.1);
		color: hsl(var(--at-fg-secondary));
		font-size: 10px;
		font-weight: 600;
	}

	.session-meta {
		overflow: hidden;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-actions {
		display: flex;
		flex-shrink: 0;
		gap: 2px;
	}

	.sessions-footer {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid hsl(var(--at-border) / 0.8);
	}

	.text-btn,
	.primary-btn {
		padding: 6px 10px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.text-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.text-btn.danger:hover {
		color: hsl(var(--at-error));
	}

	.primary-btn {
		background: hsl(var(--at-accent));
		color: hsl(var(--at-bg));
		font-weight: 600;
	}

	.primary-btn:hover:not(:disabled) {
		background: hsl(var(--at-accent-hover));
	}

	.primary-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
