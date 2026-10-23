<script lang="ts">
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import MarksPanel from '$lib/components/MarksPanel.svelte';
	import KeybindsDialog from '$lib/components/KeybindsDialog.svelte';
	import SessionsDialog from '$lib/components/SessionsDialog.svelte';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { detectSourceFrameRateFromFile } from '$lib/video/frameRate';
	import { formatTimecode } from '$lib/video/timecode';
	import {
		analyzeMarks,
		frameOf,
		markAtFrame,
		moveMark,
		newId,
		placeMark,
		removeMark,
		sortMarks,
		type Mark,
		type MarkType
	} from '$lib/video/marks';
	import { SCHEMA_VERSION, type FrameRateSource, type Session } from '$lib/session/schema';
	import { fingerprintFile } from '$lib/session/fingerprint';
	import {
		findSessionByFingerprint,
		listSessions,
		requestPersistentStorage,
		saveSession
	} from '$lib/session/store';
	import { backupStatus, lastBackupAt, type BackupStatus } from '$lib/session/backup';

	let videoElement: HTMLVideoElement | null = $state(null);
	let videoSrc: string | null = $state(null);
	let videoFileName: string = $state('');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let frameRate = $state(30);
	let sourceFrameRate: number | null = $state(null);
	let playbackFrameRate: number | null = $state(null);
	// False until the viewer has either measured a rate or given up and fallen back to 30.
	let frameRateSettled = $state(false);
	let playbackRate = $state(1);
	let volume = $state(1);
	let isMuted = $state(false);
	let isScrubbing = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);
	let isDragging = $state(false);
	let mediaError = $state(false);

	// Marks are kept in media-time order; each snapshot pushed to history makes
	// every edit (including Clear all) undoable.
	let marks: Mark[] = $state([]);
	let markHistory: Mark[][] = $state([]);
	let markFuture: Mark[][] = $state([]);
	let panelOpen = $state(true);
	let keybindsOpen = $state(false);
	let sessionsOpen = $state(false);
	let backup: BackupStatus | null = $state(null);

	// Saving is explicit (⌘S). The session is "dirty" whenever the marks or details
	// differ from what was last saved or restored for this video.
	let videoFile: File | null = null;
	let fingerprintPromise: Promise<string> | null = null;
	let sessionId: string | null = $state(null);
	let sessionCreatedAt: string | null = null;
	let sessionTitle = $state('');
	let sessionNotes = $state('');
	let timeScale = $state(1);
	let savedSignature: string | null = $state(null);
	let isSaving = $state(false);
	let notice: string | null = $state(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let defaultTitle = $derived(videoFileName.replace(/\.[^.]+$/, '') || 'Untitled');
	let signature = $derived(
		JSON.stringify({ marks, title: sessionTitle, notes: sessionNotes, timeScale })
	);
	let isDirty = $derived(videoSrc !== null && signature !== savedSignature);
	let frameRateSource: FrameRateSource = $derived(
		sourceFrameRate ? 'container' : playbackFrameRate ? 'playback-estimate' : 'default'
	);

	let analysis = $derived(analyzeMarks(marks, frameRate, timeScale));
	let activeMark = $derived(markAtFrame(marks, currentTime, frameRate));

	// Zoom state
	let zoomLevel = $state(1);
	let videoViewerRef: { resetZoom: () => void; zoomIn: () => void; zoomOut: () => void } | null =
		$state(null);
	let activeVideoLoadId = $state(0);

	$effect(() => {
		const activeSrc = videoSrc;
		return () => {
			if (activeSrc) URL.revokeObjectURL(activeSrc);
		};
	});

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file && isLikelyVideoFile(file)) {
			loadVideoFile(file);
		}
		target.value = '';
	}

	function isLikelyVideoFile(file: File): boolean {
		if (file.type.startsWith('video/')) return true;
		const lowerName = file.name.toLowerCase();
		return /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|m4p|mpg|mpeg|3gp|ogv)$/.test(lowerName);
	}

	function loadVideoFile(file: File) {
		if (isDirty && !confirm(`Discard unsaved changes to "${sessionTitle || defaultTitle}"?`)) {
			return;
		}
		activeVideoLoadId += 1;
		const loadId = activeVideoLoadId;

		if (videoSrc) {
			videoElement?.pause();
		}

		videoSrc = URL.createObjectURL(file);
		videoFileName = file.name;
		isPlaying = false;
		mediaError = false;
		currentTime = 0;
		duration = 0;
		frameRate = 30;
		sourceFrameRate = null;
		playbackFrameRate = null;
		frameRateSettled = false;

		marks = [];
		markHistory = [];
		markFuture = [];
		zoomLevel = 1;

		videoFile = file;
		sessionId = null;
		sessionCreatedAt = null;
		sessionTitle = defaultTitle;
		sessionNotes = '';
		timeScale = 1;
		savedSignature = signature;
		fingerprintPromise = fingerprintFile(file);
		void restoreSession(loadId, fingerprintPromise, expectedSession ?? undefined);
		expectedSession = null;

		void detectSourceFrameRateFromFile(file)
			.then((detectedFps) => {
				if (loadId !== activeVideoLoadId) return;
				sourceFrameRate = detectedFps;
				if (detectedFps) {
					frameRate = detectedFps;
				}
			})
			.catch(() => {
				if (loadId !== activeVideoLoadId) return;
				sourceFrameRate = null;
			});
	}

	function showNotice(text: string) {
		notice = text;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), 3500);
	}

	function formatSavedAt(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	/** Restores the saved session for this file, unless the user has already started editing. */
	async function restoreSession(loadId: number, fingerprint: Promise<string>, expected?: Session) {
		try {
			const saved = await findSessionByFingerprint(await fingerprint);
			if (loadId !== activeVideoLoadId || isDirty) return;
			if (!saved) {
				if (expected) {
					showNotice(
						`This isn't the video saved as "${expected.title}" — look for ${expected.media.fileName}`
					);
				}
				return;
			}
			sessionId = saved.id;
			sessionCreatedAt = saved.createdAt;
			sessionTitle = saved.title;
			sessionNotes = saved.notes;
			timeScale = saved.timeScale;
			marks = sortMarks(saved.marks);
			markHistory = [];
			markFuture = [];
			savedSignature = signature;
			const count = saved.marks.length;
			if (expected && expected.id !== saved.id) {
				showNotice(`This video belongs to "${saved.title}", not "${expected.title}"`);
				return;
			}
			showNotice(
				`Restored ${count} mark${count === 1 ? '' : 's'} · saved ${formatSavedAt(saved.updatedAt)}`
			);
		} catch {
			// No storage available (e.g. private browsing); the video still works unsaved.
		}
	}

	async function refreshBackup(): Promise<BackupStatus | null> {
		try {
			backup = backupStatus(await listSessions(), lastBackupAt());
		} catch {
			backup = null;
		}
		return backup;
	}

	onMount(() => {
		void refreshBackup();
	});

	function closeSessions() {
		sessionsOpen = false;
		void refreshBackup();
	}

	async function save() {
		if (!videoFile || !fingerprintPromise || !isDirty || isSaving) return;
		const loadId = activeVideoLoadId;
		const savingSignature = signature;
		const now = new Date().toISOString();
		isSaving = true;
		try {
			const session: Session = {
				schemaVersion: SCHEMA_VERSION,
				id: sessionId ?? newId(),
				title: sessionTitle.trim() || defaultTitle,
				notes: sessionNotes,
				createdAt: sessionCreatedAt ?? now,
				updatedAt: now,
				media: {
					fileName: videoFile.name,
					mimeType: videoFile.type,
					sizeBytes: videoFile.size,
					lastModified: new Date(videoFile.lastModified).toISOString(),
					durationSeconds: duration,
					width: videoElement?.videoWidth ?? 0,
					height: videoElement?.videoHeight ?? 0,
					fingerprint: await fingerprintPromise
				},
				frameRate: { value: frameRate, source: frameRateSource },
				timeScale,
				marks: $state.snapshot(marks)
			};
			await saveSession(session);
			requestPersistentStorage();
			if (loadId !== activeVideoLoadId) return;
			sessionId = session.id;
			sessionCreatedAt = session.createdAt;
			savedSignature = savingSignature;
			const status = await refreshBackup();
			showNotice(
				status?.due
					? `Saved · ${status.notBackedUp} sessions not backed up — export from Sessions`
					: 'Saved'
			);
		} catch {
			showNotice("Couldn't save — browser storage is unavailable");
		} finally {
			isSaving = false;
		}
	}

	function handleSessionDeleted(id: string) {
		if (id !== sessionId) return;
		// The open session is gone from storage, so everything on screen is now unsaved.
		// Its ID is kept so saving again (or importing a backup) recreates the same session.
		savedSignature = null;
	}

	// Set when a saved session asks for its video, so a mismatched file can be flagged.
	let expectedSession: Session | null = null;

	function handleSessionOpen(session: Session) {
		closeSessions();
		expectedSession = session;
		openFilePicker();
	}

	function handleSessionsImported() {
		if (videoSrc && fingerprintPromise && !isDirty) {
			void restoreSession(activeVideoLoadId, fingerprintPromise);
		}
	}

	function handleBeforeUnload(event: BeforeUnloadEvent) {
		if (isDirty) event.preventDefault();
	}

	function commitMarks(next: Mark[]) {
		markHistory = [...markHistory, marks];
		markFuture = [];
		marks = next;
	}

	function addMark(type: MarkType) {
		if (!videoElement) return;
		// Marking while playing would land between frames; pause on the frame instead.
		if (!videoElement.paused) videoElement.pause();
		commitMarks(placeMark(marks, type, videoElement.currentTime, frameRate));
	}

	function nudgeMark(id: string, frames: number) {
		const mark = marks.find((candidate) => candidate.id === id);
		if (!mark) return;
		const maxFrame = duration > 0 ? Math.floor(duration * frameRate) : Infinity;
		const frame = Math.max(0, Math.min(maxFrame, frameOf(mark.time, frameRate) + frames));
		commitMarks(moveMark(marks, id, frame / frameRate));
		seekTo(frame / frameRate);
	}

	function deleteMark(id: string) {
		commitMarks(removeMark(marks, id));
	}

	function clearMarks() {
		if (marks.length) commitMarks([]);
	}

	function undoMarks() {
		const previous = markHistory.at(-1);
		if (!previous) return;
		markHistory = markHistory.slice(0, -1);
		markFuture = [...markFuture, marks];
		marks = previous;
	}

	function redoMarks() {
		const next = markFuture.at(-1);
		if (!next) return;
		markFuture = markFuture.slice(0, -1);
		markHistory = [...markHistory, marks];
		marks = next;
	}

	const PLAYBACK_RATES = [1, 0.5, 0.25];

	function cyclePlaybackRate() {
		const index = PLAYBACK_RATES.indexOf(playbackRate);
		playbackRate = PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length];
	}

	function seekTo(time: number) {
		if (!videoElement) return;
		videoElement.pause();
		videoElement.currentTime = time;
		currentTime = time;
	}

	function seekAdjacentMark(direction: 1 | -1) {
		const frame = frameOf(currentTime, frameRate);
		const target =
			direction > 0
				? marks.find((mark) => frameOf(mark.time, frameRate) > frame)
				: marks.findLast((mark) => frameOf(mark.time, frameRate) < frame);
		if (target) seekTo(target.time);
	}

	function handleMarkKeyDown(event: KeyboardEvent) {
		const target = event.target;
		if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 's') {
			event.preventDefault();
			void save();
			return;
		}
		if (
			event.key === '?' &&
			!event.metaKey &&
			!event.ctrlKey &&
			!(target instanceof HTMLElement && target.closest('input, textarea, select'))
		) {
			event.preventDefault();
			keybindsOpen = true;
			return;
		}
		if (
			!videoSrc ||
			event.altKey ||
			(target instanceof HTMLElement &&
				(target.isContentEditable || target.closest('input, textarea, select')))
		) {
			return;
		}
		const key = event.key.toLowerCase();
		if ((event.metaKey || event.ctrlKey) && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) redoMarks();
			else undoMarks();
			return;
		}
		if (event.ctrlKey && !event.metaKey && key === 'y') {
			event.preventDefault();
			redoMarks();
			return;
		}
		if (event.metaKey || event.ctrlKey) return;
		if (key === 't' || key === 'l') {
			event.preventDefault();
			addMark(key === 't' ? 'takeoff' : 'landing');
		} else if ((key === 'backspace' || key === 'delete') && activeMark) {
			event.preventDefault();
			deleteMark(activeMark.id);
		} else if (key === '[' || key === ']') {
			event.preventDefault();
			seekAdjacentMark(key === ']' ? 1 : -1);
		} else if (key === 'a') {
			event.preventDefault();
			panelOpen = !panelOpen;
		} else if (key === 'r') {
			event.preventDefault();
			cyclePlaybackRate();
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		const files = Array.from(event.dataTransfer?.files ?? []);
		const file = files.find((candidate) => isLikelyVideoFile(candidate));
		if (file) {
			loadVideoFile(file);
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy';
		}
		isDragging = true;
	}

	function handleDragEnter(event: DragEvent) {
		event.preventDefault();
		if ((event.dataTransfer?.types ?? []).includes('Files')) {
			isDragging = true;
		}
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		const currentTarget = event.currentTarget as HTMLElement | null;
		const nextTarget = event.relatedTarget as Node | null;
		if (!currentTarget || !nextTarget || !currentTarget.contains(nextTarget)) {
			isDragging = false;
		}
	}

	function handleMediaError() {
		mediaError = true;
		isPlaying = false;
	}

	function openFilePicker() {
		if (!fileInputRef) return;
		fileInputRef.click();
	}

	function formatTimeWithFrames(seconds: number, fps: number): string {
		return formatTimecode(seconds, fps);
	}
</script>

<svelte:head>
	<title>Airtime</title>
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:window onkeydown={handleMarkKeyDown} onbeforeunload={handleBeforeUnload} />

<KeybindsDialog isOpen={keybindsOpen} onClose={() => (keybindsOpen = false)} />
<SessionsDialog
	isOpen={sessionsOpen}
	currentSessionId={sessionId}
	onClose={closeSessions}
	onDeleted={handleSessionDeleted}
	onImported={handleSessionsImported}
	onOpen={handleSessionOpen}
/>

<div
	class="app-shell flex h-dvh flex-col bg-[hsl(var(--at-bg))]"
	role="application"
	ondragover={handleDragOver}
	ondrop={handleDrop}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
>
	<header class="app-header">
		<a class="brand-mark" href={resolve('/')} aria-label="Airtime home">Airtime</a>
		{#if videoSrc}
			<div class="header-file" title={videoFileName}>
				<span class="header-file-dot" class:unsaved={isDirty}></span>
				<span class="truncate">{videoFileName}</span>
				{#if notice}
					<span class="header-status">{notice}</span>
				{:else if isDirty}
					<span class="header-status unsaved">Unsaved</span>
				{/if}
			</div>
		{/if}
		<div class="header-actions">
			<button
				class="header-open header-icon"
				onclick={() => (keybindsOpen = true)}
				aria-label="Keyboard shortcuts"
				title="Keyboard shortcuts (?)"
			>
				?
			</button>
			<button
				class="header-open"
				onclick={() => (sessionsOpen = true)}
				title={backup?.due
					? `${backup.notBackedUp} sessions are only saved in this browser — export a backup`
					: 'Saved sessions, export and import'}
			>
				Sessions{#if backup?.due}<span class="header-backup-dot" aria-label="Backup recommended"
					></span>{/if}
			</button>
			{#if videoSrc}
				<button
					class="header-open"
					onclick={save}
					disabled={!isDirty || isSaving}
					title="Save marks to this browser (⌘S)"
				>
					Save
				</button>
				<button
					class="header-open"
					class:active={panelOpen}
					onclick={() => (panelOpen = !panelOpen)}
					aria-pressed={panelOpen}
					title="Toggle analysis panel (A)"
				>
					Analysis
				</button>
			{/if}
			<button
				onclick={openFilePicker}
				class="header-open"
				aria-label={videoSrc ? 'Replace video' : 'Open video'}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="1.8"
					><path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
					/></svg
				>
				<span>{videoSrc ? 'Change video' : 'Open video'}</span>
			</button>
		</div>
	</header>
	<!-- Viewing stage -->
	<div
		class="viewer-stage relative flex min-h-0 flex-1 items-center justify-center gap-3 overflow-hidden"
	>
		{#if !videoSrc}
			<!-- Empty state -->
			<button
				onclick={openFilePicker}
				class="empty-state at-reveal cursor-pointer"
				style="--delay: 50ms"
			>
				<div class="empty-state-icon" class:animate-pulse={isDragging}>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-10 w-10"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="1.5"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<div class="empty-state-title">
					{isDragging ? 'Drop video here' : 'Open a video'}
				</div>
				<div class="empty-state-description">Click to browse or drag and drop a video file</div>
				<div class="empty-state-hint">Press <kbd>?</kbd> for keyboard shortcuts</div>
			</button>
		{:else}
			<div class="viewer-frame">
				<VideoViewer
					bind:this={videoViewerRef}
					bind:videoElement
					{videoSrc}
					bind:isPlaying
					bind:currentTime
					bind:duration
					{sourceFrameRate}
					bind:frameRate
					bind:playbackFrameRate
					bind:volume
					bind:isMuted
					bind:zoomLevel
					{playbackRate}
					onFrameRateDetected={() => (frameRateSettled = true)}
					onError={handleMediaError}
				/>

				{#if mediaError}
					<div
						class="absolute inset-0 z-10 flex items-center justify-center bg-[hsl(var(--at-bg)/0.9)] p-6 text-center backdrop-blur-sm"
					>
						<div>
							<p class="text-lg font-semibold text-[hsl(var(--at-fg))]">
								Unable to play this video
							</p>
							<p class="mt-2 text-sm text-[hsl(var(--at-fg-muted))]">
								The file may be unsupported or damaged. Choose another video to continue.
							</p>
						</div>
					</div>
				{:else}
					<div class="viewer-badge">
						<span class="viewer-badge-dot" class:uncertain={!sourceFrameRate}
						></span>{#if sourceFrameRate}
							{sourceFrameRate} fps
						{:else if playbackFrameRate}
							<span title="Couldn't read the frame rate from the file; estimated from playback">
								~{playbackFrameRate} fps (estimated)
							</span>
						{:else if frameRateSettled}
							<span title="Couldn't detect the frame rate; frame math assumes 30 fps">
								30 fps (assumed)
							</span>
						{:else}
							Detecting fps…
						{/if}{#if playbackRate !== 1}<span class="viewer-badge-rate">{playbackRate}×</span>{/if}
					</div>
				{/if}

				<!-- Drag overlay -->
				{#if isDragging}
					<div
						class="absolute inset-0 z-20 flex items-center justify-center bg-[hsl(var(--at-bg)/0.9)] backdrop-blur-sm"
					>
						<div class="text-center">
							<div
								class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--at-surface))]"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-8 w-8 text-[hsl(var(--at-fg-secondary))]"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
									/>
								</svg>
							</div>
							<p class="text-lg font-semibold text-[hsl(var(--at-fg))]">Drop to replace video</p>
						</div>
					</div>
				{/if}
				<div class="control-bar">
					<div class="control-bar-inner">
						<VideoScrubber
							{currentTime}
							{duration}
							{videoElement}
							{marks}
							intervals={analysis.intervals}
							activeMarkId={activeMark?.id ?? null}
							bind:isScrubbing
						/>

						<div class="control-toolbar">
							<div class="time-readout">
								<span class="time-current">{formatTimeWithFrames(currentTime, frameRate)}</span>
								<span class="time-separator">/</span>
								<span class="time-duration">{formatTimeWithFrames(duration, frameRate)}</span>
							</div>

							<VideoControls
								{isPlaying}
								{currentTime}
								{duration}
								{frameRate}
								{videoElement}
								bind:volume
								bind:isMuted
								{playbackRate}
								onCyclePlaybackRate={cyclePlaybackRate}
							/>

							<div class="mark-actions">
								<button
									class="mark-action mark-action-takeoff"
									class:on-frame={activeMark?.type === 'takeoff'}
									onclick={() => addMark('takeoff')}
									title="Mark takeoff on this frame (T)"
								>
									<span class="mark-action-dot"></span>Takeoff<kbd>T</kbd>
								</button>
								<button
									class="mark-action mark-action-landing"
									class:on-frame={activeMark?.type === 'landing'}
									onclick={() => addMark('landing')}
									title="Mark landing on this frame (L)"
								>
									<span class="mark-action-dot"></span>Landing<kbd>L</kbd>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
			{#if panelOpen}
				<MarksPanel
					{marks}
					{analysis}
					{frameRate}
					bind:title={sessionTitle}
					bind:notes={sessionNotes}
					bind:timeScale
					titlePlaceholder={defaultTitle}
					activeMarkId={activeMark?.id ?? null}
					canUndo={markHistory.length > 0}
					onSeek={seekTo}
					onNudge={nudgeMark}
					onRemove={deleteMark}
					onUndo={undoMarks}
					onClear={clearMarks}
					onClose={() => (panelOpen = false)}
				/>
			{/if}
		{/if}
	</div>

	<!-- Hidden file input -->
	<input
		id="video-file-input"
		bind:this={fileInputRef}
		type="file"
		accept="video/*"
		onchange={handleFileSelect}
		oncancel={() => (expectedSession = null)}
		class="sr-only"
	/>
</div>
