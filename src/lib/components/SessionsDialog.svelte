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
		class="dialog-backdrop"
		onclick={handleBackdropClick}
		onkeydown={() => {}}
		role="dialog"
		aria-modal="true"
		aria-labelledby="sessions-title"
		tabindex="-1"
	>
		<div class="dialog-card" bind:this={card} use:dialogFocus tabindex="-1">
			<div class="dialog-header">
				<div>
					<h2 id="sessions-title" class="dialog-title">Saved sessions</h2>
					<p class="dialog-subtitle">
						Stored in this browser only. Videos aren't saved: open the same file again (or drop it
						in) to bring back its marks.
					</p>
				</div>
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

			<div class="dialog-body">
				{#if message}
					<p class="sessions-message" class:error={message.error}>{message.text}</p>
				{/if}

				{#if loading && sessions.length === 0}
					<p class="sessions-empty">Loading…</p>
				{:else if sessions.length === 0 && unreadableIds.length === 0}
					<div class="sessions-empty">
						<p class="sessions-empty-title">No saved sessions yet</p>
						<p>Mark a video and press <kbd>⌘S</kbd> / <kbd>Ctrl S</kbd> to keep it here.</p>
						<p class="sessions-empty-import">
							Have a backup? <button class="link-btn" onclick={() => importInput?.click()}
								>Import backup</button
							>
						</p>
					</div>
				{:else}
					<ul class="sessions-list">
						{#each sessions as session (session.id)}
							{@const height = bestHeight(session)}
							<li class="session-row" class:current={session.id === currentSessionId}>
								<div class="session-height" class:none={height === null}>
									{#if height !== null}{height.toFixed(1)}<small>cm</small>{:else}—{/if}
								</div>
								<div class="session-info">
									<span class="session-name">
										<span class="session-title">{session.title}</span>
										{#if session.id === currentSessionId}<span class="session-current">Current</span
											>{/if}
									</span>
									<span class="session-meta">
										{formatDate(session.updatedAt)} · {session.marks.length} mark{session.marks
											.length === 1
											? ''
											: 's'} · {session.media.fileName}
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
									<button class="text-btn danger" onclick={() => handleDelete(session)}
										>Delete</button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if sessions.length > 0 || backup.unreadable > 0}
					<div class="sessions-status">
						{#if protection === 'protected'}
							<p class="status-line ok">
								<span class="status-dot"></span><span
									>Protected: the browser won't clear these to free space.</span
								>
							</p>
						{:else if protection === 'unprotected'}
							<p class="status-line warn">
								<span class="status-dot"></span>
								<span class="status-text"
									>{protectDeclined
										? 'The browser declined to protect these; it may still clear them if space runs low.'
										: 'The browser may clear saved sessions when storage runs low.'}</span
								>
								{#if !protectDeclined}<button class="status-action" onclick={handleProtect}
										>Prevent this</button
									>{/if}
							</p>
						{/if}
						{#if sessions.length > 0}
							<p
								class="status-line"
								class:ok={backup.notBackedUp === 0}
								class:warn={backup.notBackedUp > 0 && backup.due}
							>
								<span class="status-dot"></span>
								<span>
									{#if backup.notBackedUp === 0}
										All sessions backed up {formatDate(backup.lastBackupAt ?? '')}.
									{:else}
										{backup.lastBackupAt
											? `Last backup ${formatDate(backup.lastBackupAt)}`
											: 'Never backed up'} · {backup.notBackedUp} session{backup.notBackedUp === 1
											? ''
											: 's'} only in this browser. Export all to keep a copy.
									{/if}
								</span>
							</p>
						{/if}
						{#if backup.unreadable > 0}
							<p class="status-line warn">
								<span class="status-dot"></span>
								<span
									>{backup.unreadable === 1
										? "1 session was saved by a newer version of Airtime and can't be shown or exported here. It's kept safe"
										: `${backup.unreadable} sessions were saved by a newer version of Airtime and can't be shown or exported here. They're kept safe`}
									— reload the page to update the app.</span
								>
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="dialog-footer">
				<span class="footer-note">Exports are JSON files you can import in any browser.</span>
				<button class="text-btn" onclick={() => importInput?.click()}>Import backup…</button>
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
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 680px;
		max-height: 85dvh;
		overflow: hidden;
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
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 16px 16px 24px;
		border-bottom: 1px solid hsl(var(--at-border));
	}

	.dialog-title {
		font-size: 15px;
		font-weight: 600;
		color: hsl(var(--at-fg));
	}

	.dialog-subtitle {
		max-width: 480px;
		margin-top: 4px;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		line-height: 1.5;
	}

	.close-btn {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		width: 32px;
		height: 32px;
		margin-top: -4px;
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

	.dialog-body {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		padding: 16px 24px;
		overflow-y: auto;
	}

	/* Storage notes sit quietly under the list; the sessions are the focus. */
	.sessions-status {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 0 2px;
	}

	.status-line {
		display: flex;
		align-items: baseline;
		min-height: 24px;
		gap: 9px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 1.5;
	}

	.status-text {
		flex: 1;
	}

	.status-action {
		flex: 0 0 auto;
		align-self: center;
		height: 24px;
		padding: 0 10px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 6px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}

	.status-action:hover {
		border-color: hsl(var(--at-fg) / 0.3);
		background: hsl(var(--at-surface-hover));
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
		flex: 0 0 auto;
		padding: 0;
		border: none;
		background: none;
		color: hsl(var(--at-accent-hover));
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.link-btn:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.sessions-message {
		padding: 9px 12px;
		border: 1px solid hsl(var(--at-success) / 0.25);
		border-radius: 8px;
		background: hsl(var(--at-success) / 0.08);
		color: hsl(var(--at-fg));
		font-size: 12px;
	}

	.sessions-message.error {
		border-color: hsl(var(--at-error) / 0.3);
		background: hsl(var(--at-error) / 0.1);
	}

	.sessions-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 32px 0;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		text-align: center;
	}

	.sessions-empty-title {
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 600;
	}

	.sessions-empty-import {
		margin-top: 6px;
		font-size: 12px;
	}

	kbd {
		display: inline-grid;
		place-items: center;
		height: 20px;
		padding: 0 5px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 4px;
		background: hsl(var(--at-surface));
		color: hsl(var(--at-fg));
		font:
			600 10px/1 var(--at-font-mono),
			monospace;
	}

	.sessions-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		list-style: none;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 10px 10px 12px;
		border: 1px solid hsl(var(--at-border));
		border-radius: 10px;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	.session-row.current {
		border-color: hsl(var(--at-fg) / 0.2);
		background: hsl(var(--at-surface) / 0.8);
	}

	.session-height {
		flex: 0 0 64px;
		color: hsl(var(--at-fg));
		font-size: 18px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.02em;
	}

	.session-height small {
		margin-left: 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0;
	}

	.session-height.none {
		color: hsl(var(--at-fg-muted));
	}

	.session-info {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.session-name {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.session-title {
		overflow: hidden;
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-current {
		flex: 0 0 auto;
		padding: 2px 7px;
		border-radius: 999px;
		background: hsl(var(--at-fg) / 0.12);
		color: hsl(var(--at-fg));
		font-size: 10px;
		font-weight: 600;
	}

	.session-meta {
		overflow: hidden;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.session-actions {
		display: flex;
		flex-shrink: 0;
		gap: 2px;
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 12px 16px 12px 24px;
		border-top: 1px solid hsl(var(--at-border));
		background: hsl(var(--at-bg) / 0.4);
	}

	.footer-note {
		flex: 1;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.text-btn,
	.primary-btn {
		height: 32px;
		padding: 0 12px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.text-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.text-btn.danger {
		color: hsl(var(--at-error) / 0.85);
	}

	.text-btn.danger:hover {
		background: hsl(var(--at-error) / 0.12);
		color: hsl(var(--at-error));
	}

	.primary-btn {
		background: hsl(var(--at-accent));
		color: hsl(var(--at-on-accent));
		font-weight: 600;
	}

	.primary-btn:hover:not(:disabled) {
		background: hsl(var(--at-accent-hover));
	}

	.primary-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	@media (max-width: 560px) {
		.session-row {
			flex-wrap: wrap;
			gap: 4px 12px;
		}
		.session-actions {
			width: 100%;
			justify-content: flex-end;
		}
		.footer-note {
			display: none;
		}
		.dialog-footer {
			justify-content: flex-end;
		}
	}

	@media (pointer: coarse) {
		.text-btn,
		.primary-btn,
		.close-btn {
			min-height: 44px;
			min-width: 44px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dialog-backdrop,
		.dialog-card {
			animation: none;
		}
	}
</style>
