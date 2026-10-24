<script lang="ts">
	import { analyzeMarks } from '$lib/video/marks';
	import type { Session } from '$lib/session/schema';
	import { deleteSession, readSessions } from '$lib/session/store';
	import { dialogFocus, focusFirst, trapTab } from '$lib/dialogFocus';
	import { downloadExport } from '$lib/session/exportFile';
	import {
		backUp,
		backupStatus,
		importBackup,
		importFailure,
		importSummary,
		lastBackupAt,
		protectStorage,
		storageProtection,
		type StorageProtection
	} from '$lib/session/backup';

	interface Props {
		isOpen: boolean;
		currentSessionId: string | null;
		onClose: () => void;
		onDeleted: (id: string) => void;
		onImported: () => void;
		/** Asks for the session's video; the session restores once the matching file is opened. */
		onOpen: (session: Session) => void;
	}

	let { isOpen, currentSessionId, onClose, onDeleted, onImported, onOpen }: Props = $props();

	let sessions: Session[] = $state([]);
	let loading = $state(false);
	let message: { text: string; error?: boolean } | null = $state(null);
	let importInput: HTMLInputElement | null = $state(null);
	let card: HTMLElement | null = $state(null);
	let protection: StorageProtection = $state('unknown');
	let protectDeclined = $state(false);
	let lastBackup: string | null = $state(null);
	let sessionsReadAt = '';
	let unreadableIds: string[] = $state([]);
	let backup = $derived(backupStatus(sessions, lastBackup, { unreadable: unreadableIds.length }));

	async function refresh() {
		loading = true;
		lastBackup = lastBackupAt();
		protection = await storageProtection();
		try {
			const readAt = new Date().toISOString();
			({ sessions, unreadableIds } = await readSessions());
			sessionsReadAt = readAt;
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
			const result = await importBackup(file);
			message = { text: importSummary(result) };
			await refresh();
			if (result.imported) onImported();
		} catch (error) {
			message = { text: importFailure(error), error: true };
		}
	}

	async function handleProtect() {
		protectDeclined = !(await protectStorage());
		protection = await storageProtection();
	}

	async function handleExportAll() {
		if ((await backUp(sessions, sessionsReadAt)) !== 'cancelled') lastBackup = lastBackupAt();
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
				Stored in this browser only. Videos aren't saved — choose Open… and pick the same file (or
				drop it in) to reopen its marks. Export to back up or to hand the data to an agent.
			</p>

			{#if message}
				<p class="sessions-message" class:error={message.error}>{message.text}</p>
			{/if}

			{#if sessions.length > 0 || backup.unreadable > 0}
				<div class="sessions-status">
					{#if protection === 'protected'}
						<p class="status-line ok">
							<span class="status-dot"></span>Protected: the browser won't clear these to free
							space.
						</p>
					{:else if protection === 'unprotected'}
						<p class="status-line warn">
							<span class="status-dot"></span>
							{protectDeclined
								? 'The browser declined to protect these; it may still clear them if space runs low.'
								: 'The browser may clear these if space runs low.'}
							{#if !protectDeclined}<button class="link-btn" onclick={handleProtect}>Protect</button
								>{/if}
						</p>
					{/if}
					{#if sessions.length > 0}
						<p class="status-line" class:warn={backup.notBackedUp > 0 && backup.due}>
							<span class="status-dot"></span>
							{#if backup.notBackedUp === 0}
								All sessions backed up {formatDate(backup.lastBackupAt ?? '')}.
							{:else}
								{backup.lastBackupAt
									? `Last backup ${formatDate(backup.lastBackupAt)}`
									: 'Never backed up'} · {backup.notBackedUp} session{backup.notBackedUp === 1
									? ''
									: 's'} only in this browser. Clearing browser data deletes them; Export all keeps a
								copy.
							{/if}
						</p>
					{/if}
					{#if backup.unreadable > 0}
						<p class="status-line warn">
							<span class="status-dot"></span>
							{backup.unreadable === 1
								? "1 session was saved by a newer version of Airtime and can't be shown or exported here. It's kept safe"
								: `${backup.unreadable} sessions were saved by a newer version of Airtime and can't be shown or exported here. They're kept safe`}
							— reload the page to update the app.
						</p>
					{/if}
				</div>
			{/if}

			{#if loading && sessions.length === 0}
				<p class="sessions-empty">Loading…</p>
			{:else if sessions.length === 0 && unreadableIds.length === 0}
				<div class="sessions-empty">
					<p>No saved sessions yet. Mark a video and press ⌘/Ctrl + S.</p>
					<p class="sessions-empty-import">
						Have a backup? <button class="link-btn" onclick={() => importInput?.click()}
							>Import it</button
						>
					</p>
				</div>
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
									<button
										class="text-btn"
										onclick={() => onOpen(session)}
										title="Choose {session.media.fileName} to reopen its marks"
									>
										Open…
									</button>
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
				<button class="primary-btn" onclick={handleExportAll} disabled={sessions.length === 0}>
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

	.sessions-status {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
	}

	.status-line {
		display: flex;
		align-items: baseline;
		gap: 7px;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
		line-height: 1.45;
	}

	.status-dot {
		flex: 0 0 auto;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: hsl(var(--at-fg-muted));
		transform: translateY(-1px);
	}

	.status-line.ok .status-dot {
		background: hsl(var(--at-success));
	}

	.status-line.warn .status-dot {
		background: hsl(var(--at-warning));
	}

	.link-btn {
		padding: 0;
		border: none;
		background: none;
		color: hsl(var(--at-accent));
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.link-btn:hover {
		text-decoration: underline;
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

	.sessions-empty-import {
		margin-top: 8px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
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
