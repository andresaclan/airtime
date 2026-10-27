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
						Saved in this browser. Open the same video again to bring back its marks.
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
						<p>
							Mark a video and <span class="pointer-only"
								>press <kbd>⌘S</kbd> / <kbd>Ctrl S</kbd></span
							><span class="touch-only">tap Save</span> to keep it here.
						</p>
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
									<button class="secondary-btn small" onclick={() => downloadExport([session])}
										>Export</button
									>
									<span class="action-divider" aria-hidden="true"></span>
									<button
										class="icon-btn danger"
										onclick={() => handleDelete(session)}
										aria-label="Delete {session.title}"
										title="Delete"
										><svg viewBox="0 0 24 24" aria-hidden="true"
											><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></svg
										></button
									>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
				{#if sessions.length > 0 || backup.unreadable > 0}
					<div
						class="sessions-status"
						class:warn={protection === 'unprotected' || backup.due || backup.unreadable > 0}
					>
						<svg class="status-icon" viewBox="0 0 24 24" aria-hidden="true"
							><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6z" /></svg
						>
						{#if protection === 'protected'}
							<p class="status-line ok">
								<span>Protected: the browser won't clear these to free space.</span>
							</p>
						{:else if protection === 'unprotected' && (protectDeclined || sessions.length === 0)}
							<p class="status-line warn">
								<span class="status-text"
									>{protectDeclined
										? 'The browser declined to protect these; it may still clear them if space runs low.'
										: 'The browser may clear saved sessions when storage runs low.'}{#if !protectDeclined}
										<button class="link-btn" onclick={handleProtect}>Keep them safe</button
										>{/if}</span
								>
							</p>
						{/if}
						{#if sessions.length > 0}
							<p
								class="status-line"
								class:ok={backup.notBackedUp === 0}
								class:warn={backup.notBackedUp > 0 && backup.due}
							>
								<span>
									{#if backup.notBackedUp === 0}
										All sessions backed up {formatDate(backup.lastBackupAt ?? '')}.
									{:else}
										{backup.lastBackupAt
											? `Last backup ${formatDate(backup.lastBackupAt)}`
											: 'Never backed up'} · {backup.notBackedUp} session{backup.notBackedUp === 1
											? ''
											: 's'} only in this browser. Export all to keep a copy{#if protection === 'unprotected' && !protectDeclined},
											or
											<button class="link-btn" onclick={handleProtect}
												>ask the browser to keep them</button
											>{/if}.
									{/if}
								</span>
							</p>
						{/if}
						{#if backup.unreadable > 0}
							<p class="status-line warn">
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
				<button class="secondary-btn" onclick={() => importInput?.click()}>Import backup…</button>
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
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 560px;
		max-height: 85dvh;
		overflow: hidden;
		background: hsl(var(--at-popover));
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		box-shadow: 0 24px 64px hsl(var(--at-shadow) / 0.6);
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
		overscroll-behavior: contain;
	}

	/* Storage notes: one quiet callout under the list; the sessions stay the focus. */
	.sessions-status {
		display: grid;
		grid-template-columns: 16px 1fr;
		column-gap: 10px;
		row-gap: 4px;
		padding: 2px 0 0;
	}

	.sessions-status > :not(.status-icon) {
		grid-column: 2;
	}

	.status-icon {
		grid-row: 1 / span 3;
		width: 16px;
		height: 16px;
		margin-top: 1px;
		fill: none;
		stroke: hsl(var(--at-success));
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.sessions-status.warn .status-icon {
		stroke: hsl(var(--at-warning));
	}

	.status-line {
		display: flex;
		align-items: baseline;
		gap: 9px;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 1.5;
	}

	.status-text {
		flex: 1;
	}

	.status-line .link-btn {
		margin-left: 0;
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
		gap: 2px;
		margin: 0 -12px;
		list-style: none;
	}

	.session-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 8px 8px 8px 12px;
		border-radius: 10px;
		transition:
			background 120ms ease,
			border-color 120ms ease;
	}

	.session-row.current {
		background: hsl(var(--at-fg) / 0.05);
	}

	.session-height {
		flex: 0 0 64px;
		color: hsl(var(--at-fg));
		font-size: 16px;
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
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 6px;
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
		font-weight: 500;
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
		align-items: center;
		gap: 4px;
	}

	.dialog-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		padding: 12px 24px;
		border-top: 1px solid hsl(var(--at-border));
	}

	.text-btn,
	.primary-btn {
		height: 30px;
		padding: 0 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.secondary-btn {
		height: 30px;
		padding: 0 10px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 8px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.secondary-btn.small {
		height: 28px;
		padding: 0 10px;
		font-size: 12px;
	}

	.action-divider {
		width: 1px;
		height: 18px;
		margin: 0 4px;
		background: hsl(var(--at-border-hover));
	}

	.icon-btn {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 7px;
		background: transparent;
		color: hsl(var(--at-fg-muted));
		cursor: pointer;
	}

	.icon-btn svg {
		width: 15px;
		height: 15px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon-btn:hover {
		background: hsl(var(--at-error) / 0.14);
		color: hsl(var(--at-error));
	}

	.secondary-btn:hover {
		border-color: hsl(var(--at-fg) / 0.28);
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.text-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.primary-btn {
		border: 1px solid hsl(var(--at-accent) / 0.5);
		background: hsl(var(--at-accent) / 0.18);
		color: hsl(var(--at-accent-fg));
	}

	.primary-btn:hover:not(:disabled) {
		background: hsl(var(--at-accent) / 0.28);
		color: hsl(var(--at-fg));
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
		.dialog-footer {
			justify-content: flex-end;
		}
	}

	@media (pointer: coarse) {
		.text-btn,
		.primary-btn,
		.secondary-btn,
		.icon-btn,
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
