<script lang="ts">
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import MarksPanel from '$lib/components/MarksPanel.svelte';
	import KeybindsDialog from '$lib/components/KeybindsDialog.svelte';
	import SessionsDialog from '$lib/components/SessionsDialog.svelte';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { isApplePlatform } from '$lib/keybinds';
	import { detectSourceTimingFromFile } from '$lib/video/frameRate';
	import { formatFrameTimecode, formatTimecode } from '$lib/video/timecode';
	import {
		clampFrame,
		frameAt,
		frameLabel,
		frameSeekTime,
		frameStartTime,
		type FrameTiming
	} from '$lib/video/frames';
	import { displayedFrame, settledDisplayedFrame } from '$lib/video/presentedFrame';
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
	import {
		DEFAULT_JUMP_TYPE,
		SCHEMA_VERSION,
		type FrameRateSource,
		type JumpType,
		type Session
	} from '$lib/session/schema';
	import { fingerprintFile } from '$lib/session/fingerprint';
	import {
		findSessionByFingerprint,
		readSessions,
		requestPersistentStorage,
		saveSession
	} from '$lib/session/store';
	import {
		backUp,
		backupStatus,
		importBackup,
		importFailure,
		importSummary,
		lastBackupAt,
		needsBackup,
		type BackupStatus
	} from '$lib/session/backup';

	let videoElement: HTMLVideoElement | null = $state(null);
	let videoSrc: string | null = $state(null);
	let videoFileName: string = $state('');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let frameRate = $state(30);
	let sourceFrameRate: number | null = $state(null);
	// The time of every frame, read from the file. Frame math uses it whenever it's there,
	// so frames that aren't evenly spaced (variable frame rate) are still stepped one by one.
	let frameTimes: number[] | null = $state.raw(null);
	// The file's frame durations vary, so one fps value doesn't describe its frame times.
	let variableFrameRate = $state(false);
	let playbackFrameRate: number | null = $state(null);
	// False until the file has been checked for a frame rate.
	let sourceFrameRateChecked = $state(false);
	// False until the viewer has either measured a rate or given up.
	let frameRateSettled = $state(false);
	// Marks snap to frames, so a video can only be marked once its frame rate is read or
	// measured. `frameRate` keeps 30 until then purely so frame stepping still works.
	let frameRateKnown = $derived(Boolean(sourceFrameRate || playbackFrameRate));
	let frameRateFailed = $derived(frameRateSettled && sourceFrameRateChecked && !frameRateKnown);
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
	// Below 900px the panel stacks under the video as a sheet (keep in sync with
	// layout.css). There panelOpen means expanded; collapsed it is a one-line summary.
	const stacked = new MediaQuery('max-width: 900px');
	let panelOpen = $state(true);
	let keybindsOpen = $state(false);
	let sessionsOpen = $state(false);
	let backup: BackupStatus | null = $state(null);
	// Kept loaded so Back up now can open the share sheet without awaiting storage first.
	let savedSessions: Session[] | null = $state(null);
	let savedSessionsReadAt = '';
	let reminderDismissed = $state(false);
	let showBackupReminder = $derived(needsBackup(backup) && !reminderDismissed);
	let isAppEmpty = $derived.by(() => savedSessions?.length === 0 && backup?.unreadable === 0);
	let importInput: HTMLInputElement | null = $state(null);
	let importMessage: { text: string; error?: boolean } | null = $state(null);

	// Saving is explicit (⌘S). The session is "dirty" whenever the marks or details
	// differ from what was last saved or restored for this video.
	let videoFile: File | null = null;
	let fingerprintPromise: Promise<string> | null = null;
	let sessionId: string | null = $state(null);
	let sessionCreatedAt: string | null = null;
	let sessionTitle = $state('');
	let sessionNotes = $state('');
	let jumpType: JumpType | null = $state(DEFAULT_JUMP_TYPE);
	let sessionRecordedAt = $state('');
	let timeScale = $state(1);
	let savedSignature: string | null = $state(null);
	let isSaving = $state(false);
	let notice: string | null = $state(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	let defaultTitle = $derived(videoFileName.replace(/\.[^.]+$/, '') || 'Untitled');
	let signature = $derived(
		JSON.stringify({
			marks,
			title: sessionTitle,
			notes: sessionNotes,
			jumpType,
			recordedAt: sessionRecordedAt,
			timeScale
		})
	);
	let isDirty = $derived(videoSrc !== null && signature !== savedSignature);
	let frameRateSource: FrameRateSource = $derived(
		sourceFrameRate ? 'container' : 'playback-estimate'
	);

	let timing: FrameTiming = $derived({
		fps: frameRate,
		frameTimes: sourceFrameRate ? frameTimes : null
	});
	let analysis = $derived(analyzeMarks(marks, timing, timeScale));
	let activeMark = $derived(markAtFrame(marks, currentTime, timing));

	// Width over height, once the video's metadata is in. On narrow screens a landscape
	// video is sized to fit and the analysis sheet takes the room left underneath.
	let videoAspect: number | null = $state(null);
	let fitLandscape = $derived(stacked.current && (videoAspect ?? 0) > 1);

	let saveShortcut = $state('⌘S');

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
		frameTimes = null;
		variableFrameRate = false;
		playbackFrameRate = null;
		sourceFrameRateChecked = false;
		frameRateSettled = false;

		marks = [];
		markHistory = [];
		markFuture = [];
		zoomLevel = 1;
		videoAspect = null;

		videoFile = file;
		sessionId = null;
		sessionCreatedAt = null;
		sessionTitle = defaultTitle;
		sessionNotes = '';
		jumpType = DEFAULT_JUMP_TYPE;
		sessionRecordedAt = new Date(file.lastModified).toISOString();
		timeScale = 1;
		savedSignature = signature;
		fingerprintPromise = fingerprintFile(file);
		void restoreSession(loadId, fingerprintPromise, expectedSession ?? undefined);
		expectedSession = null;

		void detectSourceTimingFromFile(file)
			.then((timing) => {
				if (loadId !== activeVideoLoadId) return;
				const detectedFps = timing?.fps ?? null;
				sourceFrameRate = detectedFps;
				frameTimes = timing?.frameTimes ?? null;
				variableFrameRate = timing?.variableFrameRate ?? false;
				sourceFrameRateChecked = true;
				if (detectedFps) {
					frameRate = detectedFps;
				}
				if (variableFrameRate) showNotice(VARIABLE_FRAME_RATE);
			})
			.catch(() => {
				if (loadId !== activeVideoLoadId) return;
				sourceFrameRate = null;
				sourceFrameRateChecked = true;
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
			jumpType = saved.jumpType;
			sessionRecordedAt = saved.recordedAt;
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
			const readAt = new Date().toISOString();
			const stored = await readSessions();
			savedSessions = stored.sessions;
			savedSessionsReadAt = readAt;
			backup = backupStatus(stored.sessions, lastBackupAt(), {
				unreadable: stored.unreadableIds.length
			});
		} catch {
			savedSessions = null;
			backup = null;
		}
		return backup;
	}

	async function handleBackUpNow() {
		if (!savedSessions) return;
		const outcome = await backUp(savedSessions, savedSessionsReadAt);
		if (outcome === 'cancelled') return;
		await refreshBackup();
		showNotice(outcome === 'shared' ? 'Backup shared' : 'Backup downloaded');
	}

	async function handleImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		importMessage = null;
		try {
			const result = await importBackup(file);
			importMessage = {
				text:
					importSummary(result) +
					(result.imported ? ' — open each video to bring back its marks.' : '')
			};
			await refreshBackup();
		} catch (error) {
			importMessage = { text: importFailure(error), error: true };
		}
	}

	function backupReminder(status: BackupStatus): string {
		if (status.unreadable > 0) return 'some sessions need a newer Airtime — reload to update';
		return `${status.notBackedUp} sessions not backed up — export from Sessions`;
	}

	onMount(() => {
		saveShortcut = isApplePlatform() ? '⌘S' : 'Ctrl S';
		// Phones start with the sheet collapsed so the video gets the height.
		if (stacked.current) panelOpen = false;
		void refreshBackup();
	});

	function closeSessions() {
		sessionsOpen = false;
		void refreshBackup();
	}

	const VARIABLE_FRAME_RATE =
		"This video's frames aren't evenly spaced (variable frame rate). Stepping follows " +
		'its real frames, and timings use their actual times';

	const FRAME_RATE_FAILED =
		"This video can't be marked: its frame rate couldn't be read or measured";

	$effect(() => {
		if (frameRateFailed) showNotice(FRAME_RATE_FAILED);
	});

	/** Says why not when the frame rate isn't known yet, or never will be. */
	function canMark(): boolean {
		if (frameRateKnown) return true;
		showNotice(frameRateFailed ? FRAME_RATE_FAILED : 'Detecting the frame rate…');
		return false;
	}

	async function save() {
		if (!videoFile || !fingerprintPromise || !isDirty || isSaving) return;
		if (!canMark()) return;
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
				jumpType,
				createdAt: sessionCreatedAt ?? now,
				updatedAt: now,
				recordedAt: sessionRecordedAt,
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
			// While the reminder bar is up it already says this.
			showNotice(
				status?.due && !showBackupReminder ? `Saved · ${backupReminder(status)}` : 'Saved'
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

	async function addMark(type: MarkType) {
		if (!videoElement || !canMark()) return;
		const loadId = activeVideoLoadId;
		// Marking while playing would land between frames; pause on the frame instead,
		// and mark the frame left on screen.
		if (!videoElement.paused) videoElement.pause();
		const frame = await settledDisplayedFrame(videoElement, timing);
		if (loadId !== activeVideoLoadId) return;
		commitMarks(placeMark(marks, type, frameStartTime(frame, timing), timing));
	}

	function nudgeMark(id: string, frames: number) {
		const mark = marks.find((candidate) => candidate.id === id);
		if (!mark || !canMark()) return;
		const frame = clampFrame(frameOf(mark.time, timing) + frames, duration, timing);
		commitMarks(moveMark(marks, id, frameStartTime(frame, timing)));
		seekToFrame(frame);
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

	/** Shows the frame by seeking to its middle (see frames.ts). */
	function seekToFrame(frame: number) {
		if (!videoElement) return;
		videoElement.pause();
		const time = frameSeekTime(clampFrame(frame, duration, timing), timing, duration);
		videoElement.currentTime = time;
		currentTime = time;
	}

	/** Shows the frame a mark's stored time refers to. */
	function seekToMark(time: number) {
		seekToFrame(frameOf(time, timing));
	}

	function seekAdjacentMark(direction: 1 | -1) {
		const frame = videoElement
			? displayedFrame(videoElement, timing)
			: frameAt(currentTime, timing);
		const target =
			direction > 0
				? marks.find((mark) => frameOf(mark.time, timing) > frame)
				: marks.findLast((mark) => frameOf(mark.time, timing) < frame);
		if (target) seekToMark(target.time);
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
		if (keybindsOpen || sessionsOpen) return;

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
		// A null relatedTarget means the drag left the window (or the browser doesn't report it).
		if (!event.relatedTarget) isDragging = false;
	}

	function handleVideoMetadata() {
		const video = videoElement;
		if (!video?.videoWidth || !video.videoHeight) return;
		const first = videoAspect === null;
		videoAspect = video.videoWidth / video.videoHeight;
		// Below a landscape video the sheet has room, so open it rather than leave a gap.
		if (first && fitLandscape) panelOpen = true;
	}

	function handleMediaError() {
		mediaError = true;
		isPlaying = false;
	}

	function openFilePicker() {
		if (!fileInputRef) return;
		fileInputRef.click();
	}

	// With a timing table the end is one frame past the last one, so a clip that starts
	// late (an edit list) or drops frames still reads as its real length.
	function formatDuration(): string {
		const times = timing.frameTimes;
		if (!times?.length) return formatTimecode(duration, timing);
		return formatFrameTimecode(frameLabel(times.length - 1, timing) + 1, timing);
	}
</script>

<svelte:head>
	<title>{videoSrc ? `${sessionTitle || defaultTitle} · Airtime` : 'Airtime'}</title>
</svelte:head>

<!-- Drag and drop is handled on the window so the app shell stays a plain, non-interactive element. -->
<svelte:window
	onkeydown={handleMarkKeyDown}
	onbeforeunload={handleBeforeUnload}
	ondragover={handleDragOver}
	ondrop={handleDrop}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
/>

<KeybindsDialog isOpen={keybindsOpen} onClose={() => (keybindsOpen = false)} />
<SessionsDialog
	isOpen={sessionsOpen}
	currentSessionId={sessionId}
	onClose={closeSessions}
	onDeleted={handleSessionDeleted}
	onImported={handleSessionsImported}
	onOpen={handleSessionOpen}
/>

<div class="app-shell flex h-dvh flex-col bg-[hsl(var(--at-bg))]">
	<header class="app-header">
		<div class="header-start">
			<a class="brand-mark" href={resolve('/')} aria-label="Airtime home">
				<svg class="brand-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<rect width="24" height="24" rx="7" fill="hsl(var(--at-surface-hover))" />
					<path
						d="M6 17.5C7.6 8.8 9.7 6.5 12 6.5s4.4 2.3 6 11"
						stroke="hsl(var(--at-fg) / 0.55)"
						stroke-width="1.6"
						stroke-linecap="round"
						stroke-dasharray="0.1 2.6"
					/>
					<circle cx="6" cy="17.5" r="2.2" fill="hsl(var(--at-takeoff))" />
					<circle cx="18" cy="17.5" r="2.2" fill="hsl(var(--at-landing))" />
				</svg>
				Airtime
			</a>
			{#if videoSrc}
				<div class="header-file" title={videoFileName}>
					<span class="header-file-name">{videoFileName}</span>
					{#if isDirty}
						<span class="header-status unsaved">Unsaved</span>
					{:else if sessionId}
						<span class="header-status">Saved</span>
					{/if}
				</div>
			{/if}
		</div>
		<div class="header-actions">
			<button
				class="btn btn-icon header-shortcuts"
				onclick={() => (keybindsOpen = true)}
				aria-label="Keyboard shortcuts"
				title="Keyboard shortcuts (?)"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path
						d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"
					/></svg
				>
			</button>
			<button
				class="btn"
				onclick={() => (sessionsOpen = true)}
				title={backup?.due ? backupReminder(backup) : 'Saved sessions, export and import'}
			>
				Sessions{#if backup?.due}<span class="header-backup-dot" aria-label="Backup recommended"
					></span>{/if}
			</button>
			{#if videoSrc}
				<button
					class="btn header-analysis"
					onclick={() => (panelOpen = !panelOpen)}
					aria-pressed={panelOpen}
					title="Toggle analysis panel (A)"
				>
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="1.7"
						aria-hidden="true"
						><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></svg
					>
					Analysis
				</button>
			{/if}
			<span class="header-divider" aria-hidden="true"></span>
			<button
				onclick={openFilePicker}
				class="btn"
				aria-label={videoSrc ? 'Replace video' : 'Open video'}
				title={videoSrc ? 'Change video' : 'Open video'}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><path
						d="M3.5 7.5v9a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-6l-2-2h-5a2 2 0 0 0-2 2z"
					/></svg
				>
				<span class="header-open-label">{videoSrc ? 'Change video' : 'Open video'}</span>
			</button>
			{#if videoSrc}
				<button
					class="btn {isDirty ? 'btn-primary' : 'btn-secondary'}"
					onclick={save}
					disabled={!isDirty || isSaving}
					title="Save marks to this browser ({saveShortcut})"
				>
					Save{#if isDirty}<kbd class="btn-kbd">{saveShortcut}</kbd>{/if}
				</button>
			{/if}
		</div>
		<div class="app-notice" class:visible={notice} role="status">{notice ?? ''}</div>
	</header>
	{#if showBackupReminder && backup}
		<section class="backup-reminder" aria-label="Backup reminder">
			<span class="backup-reminder-dot"></span>
			<span class="backup-reminder-text">
				{backup.notBackedUp} session{backup.notBackedUp === 1 ? '' : 's'} not backed up
			</span>
			<button class="btn btn-primary" onclick={handleBackUpNow}>Back up now</button>
			<button
				class="btn btn-icon"
				onclick={() => (reminderDismissed = true)}
				aria-label="Dismiss backup reminder"
				title="Hide until next visit"
			>
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
		</section>
	{/if}
	<!-- Viewing stage -->
	<div
		class="viewer-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
		class:overflow-y-auto={!videoSrc}
	>
		{#if !videoSrc}
			<div class="empty">
				<h1 class="empty-title at-reveal">Measure jump height from video</h1>
				<p class="empty-lede at-reveal" style="--delay: 40ms">
					Step to the frames where your feet leave and touch the ground. Airtime turns the flight
					time into jump height.
				</p>
				<button
					onclick={openFilePicker}
					class="dropzone at-reveal"
					class:dragging={isDragging}
					style="--delay: 80ms"
				>
					<span class="dropzone-icon" aria-hidden="true">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
							><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path
								d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3"
							/></svg
						>
					</span>
					<span class="dropzone-title">{isDragging ? 'Drop to open' : 'Open a jump video'}</span>
					<span class="dropzone-sub"
						><span class="pointer-only">Drag a clip here, or browse your files</span><span
							class="touch-only">Choose a clip from your library or files</span
						></span
					>
					<span class="btn btn-primary">Choose video</span>
				</button>
				<ol class="empty-steps at-reveal" style="--delay: 120ms">
					<li>
						<strong><span class="empty-step-num">1</span>Find takeoff</strong>
						Step to the first frame the feet leave the ground.
					</li>
					<li>
						<strong><span class="empty-step-num">2</span>Find landing</strong>
						Step to the first frame they touch down again.
					</li>
					<li>
						<strong><span class="empty-step-num">3</span>Read the jump</strong>
						Flight time, contact time and height, per jump.
					</li>
				</ol>
				<div class="empty-footer at-reveal" style="--delay: 160ms">
					<span>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.8"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
							><rect x="5" y="11" width="14" height="9" rx="2" /><path
								d="M8 11V8a4 4 0 0 1 8 0v3"
							/></svg
						>
						Videos stay on your device
					</span>
					<span class="empty-hint">Press <kbd>?</kbd> for shortcuts</span>
					{#if isAppEmpty}
						<span
							>Have a backup? <button class="link-btn" onclick={() => importInput?.click()}
								>Import it</button
							></span
						>
					{/if}
				</div>
				<p class="empty-import-message" class:error={importMessage?.error} role="status">
					{importMessage?.text ?? ''}
				</p>
			</div>
		{:else}
			<div
				class="viewer-frame"
				class:landscape={fitLandscape}
				style:--video-aspect={videoAspect ?? undefined}
			>
				<VideoViewer
					bind:this={videoViewerRef}
					bind:videoElement
					{videoSrc}
					bind:isPlaying
					bind:currentTime
					bind:duration
					{sourceFrameRate}
					frameTimes={timing.frameTimes}
					bind:frameRate
					bind:playbackFrameRate
					bind:volume
					bind:isMuted
					bind:zoomLevel
					{playbackRate}
					onFrameRateDetected={() => (frameRateSettled = true)}
					onDurationChange={handleVideoMetadata}
					onError={handleMediaError}
				/>

				{#if mediaError}
					<div class="viewer-overlay z-10">
						<span class="viewer-overlay-icon" aria-hidden="true">
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.7"
								stroke-linecap="round"
								><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></svg
							>
						</span>
						<p class="viewer-overlay-title">Unable to play this video</p>
						<p class="viewer-overlay-text">
							The file may be unsupported or damaged. Choose another video to continue.
						</p>
					</div>
				{:else}
					<div class="viewer-badge">
						<span class="viewer-badge-dot" class:uncertain={!sourceFrameRate}
						></span>{#if sourceFrameRate && variableFrameRate}
							<span title={VARIABLE_FRAME_RATE}>{sourceFrameRate} fps · variable</span>
						{:else if sourceFrameRate}
							{sourceFrameRate} fps
						{:else if playbackFrameRate}
							<span title="Couldn't read the frame rate from the file; estimated from playback">
								~{playbackFrameRate} fps · estimated
							</span>
						{:else if frameRateFailed}
							<span title={FRAME_RATE_FAILED}>Frame rate unknown</span>
						{:else}
							Detecting fps…
						{/if}{#if playbackRate !== 1}<span class="viewer-badge-rate">{playbackRate}×</span>{/if}
					</div>
				{/if}

				<!-- Drag overlay -->
				{#if isDragging}
					<div class="viewer-overlay drop z-20">
						<span class="viewer-overlay-icon" aria-hidden="true">
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
								><path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path
									d="M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3"
								/></svg
							>
						</span>
						<p class="viewer-overlay-title">Drop to replace video</p>
					</div>
				{/if}
				<div class="control-bar">
					<div class="control-bar-inner">
						<VideoScrubber
							{currentTime}
							{duration}
							{timing}
							{videoElement}
							{marks}
							intervals={analysis.intervals}
							activeMarkId={activeMark?.id ?? null}
							bind:isScrubbing
						/>

						<div class="control-toolbar">
							<div class="time-readout">
								<span class="time-current">{formatTimecode(currentTime, timing)}</span>
								<span class="time-separator">/</span>
								<span class="time-duration">{formatDuration()}</span>
							</div>

							<VideoControls
								{isPlaying}
								{currentTime}
								{duration}
								{timing}
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
			{#if panelOpen || stacked.current}
				<MarksPanel
					{marks}
					{analysis}
					{timing}
					{variableFrameRate}
					bind:title={sessionTitle}
					bind:notes={sessionNotes}
					bind:recordedAt={sessionRecordedAt}
					bind:timeScale
					bind:jumpType
					titlePlaceholder={defaultTitle}
					activeMarkId={activeMark?.id ?? null}
					canUndo={markHistory.length > 0}
					onSeek={seekToMark}
					onNudge={nudgeMark}
					onRemove={deleteMark}
					onUndo={undoMarks}
					onClear={clearMarks}
					sheet={stacked.current}
					fill={fitLandscape}
					expanded={panelOpen}
					onToggle={() => (panelOpen = !panelOpen)}
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
	<input
		bind:this={importInput}
		type="file"
		accept="application/json,.json"
		onchange={handleImport}
		class="sr-only"
	/>
</div>
