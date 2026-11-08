<script lang="ts">
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import MarksPanel from '$lib/components/MarksPanel.svelte';
	import KeybindsDialog from '$lib/components/KeybindsDialog.svelte';
	import SessionsDialog from '$lib/components/SessionsDialog.svelte';
	import MarkingGuide from '$lib/components/MarkingGuide.svelte';
	import HoldCue, { type ScrubCue } from '$lib/components/HoldCue.svelte';
	import { singleTap } from '$lib/components/singleTap';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { resolve } from '$app/paths';
	import { isApplePlatform } from '$lib/keybinds';
	import { detectSourceTimingFromFile } from '$lib/video/frameRate';
	import { HOLD_MS, HOLD_SHOW_MS } from '$lib/video/fineScrub';
	import { formatFrameClock } from '$lib/video/timecode';
	import {
		clampFrame,
		frameAt,
		frameLabel,
		frameSeekTime,
		frameStartTime,
		type FrameTiming
	} from '$lib/video/frames';
	import { displayedFrame, settledDisplayedFrame } from '$lib/video/presentedFrame';
	import { seek } from '$lib/video/seek';
	import {
		STEP_MARK,
		guideStep,
		isGuideHidden,
		plantLabel,
		setGuideHidden
	} from '$lib/video/guide';
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
		DraftWriter,
		makeDraft,
		pickRestore,
		readDraft,
		sessionSignature,
		waitingDrafts,
		type Draft
	} from '$lib/session/draft';
	import {
		deleteDraft,
		findSessionByFingerprint,
		getDraft,
		putDraft,
		readDraftRecords,
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
	let editGap = $state(0);
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
	// A phone held sideways is too short to stack: it gets the side-by-side layout.
	const stacked = new MediaQuery('(max-width: 900px) and (min-height: 501px)');
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
	let videoFile: File | null = $state.raw(null);
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
		sessionSignature({
			marks,
			title: sessionTitle,
			notes: sessionNotes,
			jumpType,
			recordedAt: sessionRecordedAt,
			timeScale
		})
	);
	let isDirty = $derived(videoSrc !== null && signature !== savedSignature);

	// Unsaved work is kept as a draft (draft.ts) while it's dirty, so a reload doesn't lose
	// it: iOS Safari reloads a tab it killed for memory without the beforeunload prompt.
	// Set once this video's saved session and draft have been looked up, so the draft
	// isn't overwritten before it's read.
	let videoFingerprint: string | null = $state(null);
	// Whether this video has a draft in storage, so a clean video doesn't delete a draft
	// it never wrote (one from a newer version of Airtime, say).
	let draftStored = false;
	const drafts = new DraftWriter({ put: putDraft, delete: deleteDraft });
	// Unsaved work on other videos, offered back on the start screen.
	let pendingDrafts: Draft[] = $state([]);
	let frameRateSource: FrameRateSource = $derived(
		sourceFrameRate ? 'container' : 'playback-estimate'
	);

	let timing: FrameTiming = $derived({
		fps: frameRate,
		frameTimes: sourceFrameRate ? frameTimes : null,
		editGap
	});
	let analysis = $derived(analyzeMarks(marks, timing, timeScale));
	let activeMark = $derived(markAtFrame(marks, currentTime, timing));

	// The marking guide walks a new athlete through a jump, step by step, and lights
	// up the button that marks the step they're on.
	let guideHidden = $state(false);
	let showGuide = $derived(!guideHidden && !mediaError);
	let nextMark = $derived.by(() => {
		if (!showGuide || !frameRateKnown) return null;
		const step = guideStep(marks);
		return step === 'done' ? null : STEP_MARK[step];
	});

	// On a touchscreen the bar also marks: scrub to a frame, slide
	// up above the bar to fine-tune, and pause there. The pause sets the mark the jump
	// needs next (the guide's step, shown or not); once a jump has landed, the next
	// pause starts another from its plant step, or with a takeoff for repeat hops, as
	// the guide says. Pins drag and drop. The Takeoff and Landing buttons and the frame
	// steppers stay for marking frame by frame.
	const touchScreen = new MediaQuery('(pointer: coarse)');

	// On a phone held upright the player is laid out after iOS Photos (layout.css): a tap
	// on the picture hides the controls and another brings them back.
	const phonePlayer = new MediaQuery(
		'(max-width: 900px) and (min-height: 501px) and (pointer: coarse)'
	);
	let chromeHidden = $state(false);
	const CHROME_TAP_IGNORE = '.player-dock, .zoom-pill, .viewer-overlay, button, a, input, select';

	function toggleChrome() {
		chromeHidden = phonePlayer.current && !chromeHidden;
	}
	let scrubCue: ScrubCue | null = $state(null);
	let holdStep = $derived(guideStep(marks));
	let holdMark: MarkType | null = $derived.by(() => {
		if (!frameRateKnown || mediaError) return null;
		if (holdStep !== 'done') return STEP_MARK[holdStep];
		return jumpType === 'repeat-hops' ? 'takeoff' : 'landing';
	});
	// The plant step is a landing, but the capsule calls it what the guide does. It's
	// only the step while nothing is marked, so no landing pin takes the name.
	let holdLabels: Record<MarkType, string> = $derived({
		takeoff: 'takeoff',
		landing: holdStep === 'plant' ? plantLabel(jumpType).toLowerCase() : 'landing'
	});

	function frameTaken(frame: number, except?: string): boolean {
		return marks.some((mark) => mark.id !== except && frameOf(mark.time, timing) === frame);
	}

	function handleHold(frame: number): boolean {
		if (!holdMark || frameTaken(frame)) return false;
		commitMarks(placeMark(marks, holdMark, frameStartTime(frame, timing), timing));
		return true;
	}

	function handleMoveMark(mark: Mark, frame: number): boolean {
		if (!frameRateKnown || frameTaken(frame, mark.id)) return false;
		commitMarks(moveMark(marks, mark.id, frameStartTime(frame, timing)));
		return true;
	}

	function setGuide(hidden: boolean) {
		guideHidden = hidden;
		setGuideHidden(hidden);
	}

	// Width over height, once the video's metadata is in. On narrow screens a landscape
	// video is sized to fit and the analysis sheet takes the room left underneath, as
	// long as the controls still fit below it. A phone held sideways has no such room:
	// there the video letterboxes in what's left, so the controls stay on screen.
	let videoAspect: number | null = $state(null);
	// Header, stage padding, control bar and the collapsed sheet, roughly; the
	// marking guide adds its band.
	const STACKED_CHROME_PX = 300;
	const GUIDE_PX = 76;
	let fitLandscape = $derived.by(() => {
		if (!stacked.current || !((videoAspect ?? 0) > 1)) return false;
		const width = innerWidth.current ?? 0;
		const height = innerHeight.current ?? 0;
		const chrome = STACKED_CHROME_PX + (showGuide ? GUIDE_PX : 0);
		return width / videoAspect! <= height - chrome;
	});

	let saveShortcut = $state('⌘S');
	// Phones fold Open video, Sessions and Shortcuts into one menu.
	let menuOpen = $state(false);

	function menuAction(action: () => void) {
		menuOpen = false;
		action();
	}

	function handleWindowPointerDown(event: PointerEvent) {
		if (menuOpen && !(event.target as Element).closest?.('.header-menu, .header-more')) {
			menuOpen = false;
		}
	}

	// Zoom state
	let zoomLevel = $state(1);
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
		if (videoFingerprint && draftStored) void drafts.set(videoFingerprint, null);
		videoFingerprint = null;
		draftStored = false;
		activeVideoLoadId += 1;
		const loadId = activeVideoLoadId;

		if (videoSrc) {
			videoElement?.pause();
		}

		videoSrc = URL.createObjectURL(file);
		videoFileName = file.name;
		isPlaying = false;
		mediaError = false;
		chromeHidden = false;
		currentTime = 0;
		duration = 0;
		frameRate = 30;
		sourceFrameRate = null;
		frameTimes = null;
		editGap = 0;
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
				editGap = timing?.editGap ?? 0;
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

	/** Puts a stored session's edited fields on screen, with a fresh undo history. */
	function applySession(session: Session) {
		sessionTitle = session.title;
		sessionNotes = session.notes;
		jumpType = session.jumpType;
		sessionRecordedAt = session.recordedAt;
		timeScale = session.timeScale;
		marks = sortMarks(session.marks);
		markHistory = [];
		markFuture = [];
	}

	const countMarks = (count: number) => `${count} mark${count === 1 ? '' : 's'}`;

	/**
	 * Restores the saved session for this file, and any unsaved draft on top of it, unless
	 * the user has already started editing.
	 */
	async function restoreSession(loadId: number, fingerprint: Promise<string>, expected?: Session) {
		let resolved: string | null = null;
		try {
			resolved = await fingerprint;
			const [saved, draftRecord] = await Promise.all([
				findSessionByFingerprint(resolved),
				getDraft(resolved).catch(() => undefined)
			]);
			if (loadId !== activeVideoLoadId || isDirty) return;
			const restore = pickRestore(saved, readDraft(draftRecord));
			if (restore.staleDraft) void drafts.set(resolved, null);
			if (saved) {
				sessionId = saved.id;
				sessionCreatedAt = saved.createdAt;
				applySession(saved);
				savedSignature = signature;
			}
			if (restore.kind === 'draft') {
				const { draft } = restore;
				applySession(draft.session);
				if (!draft.isNew) {
					sessionId = draft.session.id;
					sessionCreatedAt = draft.session.createdAt;
					// Its saved session is gone, so all of it is unsaved (as after deleting it).
					if (!saved) savedSignature = null;
				}
				draftStored = true;
				showNotice(
					`Recovered ${countMarks(draft.session.marks.length)} you hadn't saved, from ` +
						`${formatSavedAt(draft.updatedAt)} — save to keep them`
				);
				return;
			}
			if (!saved) {
				if (expected) {
					showNotice(
						`This isn't the video saved as "${expected.title}" — look for ${expected.media.fileName}`
					);
				}
				return;
			}
			if (expected && expected.id !== saved.id) {
				showNotice(`This video belongs to "${saved.title}", not "${expected.title}"`);
				return;
			}
			showNotice(
				`Restored ${countMarks(saved.marks.length)} · saved ${formatSavedAt(saved.updatedAt)}`
			);
		} catch {
			// No storage available (e.g. private browsing); the video still works unsaved.
		} finally {
			if (resolved && loadId === activeVideoLoadId) videoFingerprint = resolved;
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
		guideHidden = isGuideHidden();
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

	/** The session as saving now would write it. */
	function buildSession(file: File, fingerprint: string, now: string): Session {
		return {
			schemaVersion: SCHEMA_VERSION,
			id: sessionId ?? newId(),
			title: sessionTitle.trim() || defaultTitle,
			notes: sessionNotes,
			jumpType,
			createdAt: sessionCreatedAt ?? now,
			updatedAt: now,
			recordedAt: sessionRecordedAt,
			media: {
				fileName: file.name,
				mimeType: file.type,
				sizeBytes: file.size,
				lastModified: new Date(file.lastModified).toISOString(),
				durationSeconds: duration,
				width: videoElement?.videoWidth ?? 0,
				height: videoElement?.videoHeight ?? 0,
				fingerprint
			},
			frameRate: { value: frameRate, source: frameRateSource },
			timeScale,
			marks: $state.snapshot(marks)
		};
	}

	/**
	 * Keeps this video's draft in step with the screen: written while there's unsaved
	 * work, deleted once it's saved or undone back to the saved state.
	 */
	function syncDraft() {
		const fingerprint = videoFingerprint;
		if (!fingerprint || !videoFile) return;
		if (isDirty) {
			const now = new Date().toISOString();
			// The title as typed, so an emptied title doesn't come back as the default.
			const session = { ...buildSession(videoFile, fingerprint, now), title: sessionTitle };
			void drafts.set(fingerprint, makeDraft(session, sessionId === null, now));
			draftStored = true;
		} else if (draftStored) {
			void drafts.set(fingerprint, null);
			draftStored = false;
		}
	}

	// Every edit (a mark, undo, a typed note) writes the draft straight away: a tab killed
	// for memory gets no warning, so there's no later moment to rely on.
	$effect(syncDraft);

	onMount(() => {
		// Belt and braces: on the way out, write whatever the effect hasn't yet.
		const leaving = () => {
			if (document.visibilityState === 'hidden') syncDraft();
		};
		document.addEventListener('visibilitychange', leaving);
		window.addEventListener('pagehide', syncDraft);
		void refreshPendingDrafts();
		return () => {
			document.removeEventListener('visibilitychange', leaving);
			window.removeEventListener('pagehide', syncDraft);
		};
	});

	async function refreshPendingDrafts() {
		try {
			const records = await readDraftRecords();
			pendingDrafts = waitingDrafts(
				records.map(readDraft).filter((draft): draft is Draft => draft !== null)
			);
		} catch {
			pendingDrafts = [];
		}
	}

	async function discardPendingDraft(draft: Draft) {
		const count = countMarks(draft.session.marks.length);
		if (!confirm(`Discard ${count} you hadn't saved on ${draft.session.media.fileName}?`)) return;
		await drafts.set(draft.fingerprint, null);
		await refreshPendingDrafts();
	}

	async function save() {
		if (!videoFile || !fingerprintPromise || !isDirty || isSaving) return;
		if (!canMark()) return;
		const loadId = activeVideoLoadId;
		const savingSignature = signature;
		const now = new Date().toISOString();
		isSaving = true;
		try {
			const session = buildSession(videoFile, await fingerprintPromise, now);
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
		seek(videoElement, time, timing);
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
		if (menuOpen && event.key === 'Escape') {
			menuOpen = false;
			return;
		}
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
		// The phone player centres the picture instead, with the sheet closed under it.
		if (first && fitLandscape && !phonePlayer.current) panelOpen = true;
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
		if (!times?.length) return formatFrameClock(Math.round(duration * timing.fps), timing);
		return formatFrameClock(frameLabel(times.length - 1, timing) + 1, timing);
	}

	// The playhead's frame number counts from 1, the way people number frames.
	let playheadLabel = $derived(frameLabel(frameAt(currentTime, timing), timing));
</script>

<svelte:head>
	<title>{videoSrc ? `${sessionTitle || defaultTitle} · Airtime` : 'Airtime'}</title>
</svelte:head>

<!-- Drag and drop is handled on the window so the app shell stays a plain, non-interactive element. -->
<svelte:window
	onkeydown={handleMarkKeyDown}
	onpointerdown={handleWindowPointerDown}
	onbeforeunload={handleBeforeUnload}
	ondragover={handleDragOver}
	ondrop={handleDrop}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
/>

<KeybindsDialog
	isOpen={keybindsOpen}
	onClose={() => (keybindsOpen = false)}
	{guideHidden}
	onShowGuide={() => {
		setGuide(false);
		keybindsOpen = false;
	}}
/>
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
				<span class="brand-name">Airtime</span>
			</a>
			{#if videoSrc}
				<div class="header-file" title={videoFileName}>
					<span class="header-file-name">{videoFileName}</span>
					{#if isDirty}
						<span class="header-status unsaved">Unsaved</span>
					{:else if sessionId}
						<span class="header-status"
							>Saved<span class="header-status-detail">to this browser</span></span
						>
					{/if}
				</div>
			{/if}
		</div>
		<div class="header-actions">
			<button
				class="btn btn-icon header-shortcuts header-wide"
				onclick={() => (keybindsOpen = true)}
				aria-label="Keyboard shortcuts"
				title="Keyboard shortcuts (?)"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.8"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><circle cx="12" cy="12" r="9" /><path
						d="M9.6 9.4a2.5 2.5 0 0 1 4.85.85c0 1.65-2.45 2.1-2.45 3.6M12 17h.01"
					/></svg
				>
			</button>
			<button
				class="btn btn-icon header-wide header-sessions"
				onclick={() => (sessionsOpen = true)}
				aria-label="Sessions"
				title={backup?.due ? backupReminder(backup) : 'Saved sessions, export and import'}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.7"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					><rect x="4" y="4" width="16" height="6" rx="1.8" /><rect
						x="4"
						y="14"
						width="16"
						height="6"
						rx="1.8"
					/><path d="M8 7h.01M8 17h.01" /></svg
				>{#if backup?.due}<span class="header-more-dot" aria-label="Backup recommended"></span>{/if}
			</button>
			{#if videoSrc}
				<button
					class="btn btn-icon header-analysis"
					onclick={() => (panelOpen = !panelOpen)}
					aria-pressed={panelOpen}
					aria-label="Analysis panel"
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
				</button>
			{/if}
			{#if videoSrc}<span class="header-divider" aria-hidden="true"></span>{/if}
			<button
				onclick={openFilePicker}
				class="btn btn-icon header-wide"
				class:header-open-empty={!videoSrc}
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
			<button
				class="btn btn-icon header-more"
				onclick={() => (menuOpen = !menuOpen)}
				aria-label="More"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
			>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
					><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle
						cx="18.5"
						cy="12"
						r="1.6"
					/></svg
				>{#if backup?.due}<span class="header-more-dot" aria-label="Backup recommended"></span>{/if}
			</button>
			{#if menuOpen}
				<div class="header-menu" role="menu">
					<button role="menuitem" onclick={() => menuAction(openFilePicker)}
						>{videoSrc ? 'Change video' : 'Open video'}</button
					>
					<button role="menuitem" onclick={() => menuAction(() => (sessionsOpen = true))}
						>Sessions{#if backup?.due}<span class="header-backup-dot"></span>{/if}</button
					>
					<button role="menuitem" onclick={() => menuAction(() => (keybindsOpen = true))}
						>Keyboard shortcuts</button
					>
				</div>
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
		class:has-video={videoSrc}
		class:panel-open={panelOpen && !stacked.current}
		style:--video-aspect={videoAspect ?? undefined}
	>
		{#if !videoSrc}
			<div class="empty">
				<div class="empty-card at-reveal">
					<div class="empty-head">
						<h1 class="empty-title">Measure jump height from video</h1>
						<p class="empty-lede">
							Open a clip of your approach jump and mark three frames. Airtime does the math.
						</p>
					</div>
					{#if pendingDrafts.length}
						<!-- Unsaved work a reload interrupted; reopening the video brings it back. -->
						<ul class="empty-drafts" aria-label="Unsaved marks">
							{#each pendingDrafts.slice(0, 3) as draft (draft.fingerprint)}
								<li class="empty-draft">
									<span class="empty-draft-dot" aria-hidden="true"></span>
									<span class="empty-draft-text">
										<strong>Unsaved marks on {draft.session.media.fileName}</strong>
										<span
											>{countMarks(draft.session.marks.length)} · {formatSavedAt(draft.updatedAt)}.
											Open this video again to pick up where you left off.</span
										>
									</span>
									<button class="link-btn" onclick={() => discardPendingDraft(draft)}
										>Discard</button
									>
								</li>
							{/each}
						</ul>
					{/if}
					<button onclick={openFilePicker} class="dropzone" class:dragging={isDragging}>
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
						<span class="dropzone-text">
							<span class="dropzone-title">{isDragging ? 'Drop to open' : 'Open a jump video'}</span
							>
							<span class="dropzone-sub"
								><span class="pointer-only">Drag a clip here, or browse your files</span><span
									class="touch-only">Choose a clip from your library or files</span
								></span
							>
						</span>
						<span class="btn btn-primary">Choose video</span>
					</button>
					<!-- An approach jump, as the three marks see it: the plant step and landing
					     are both touchdowns (Landing); the takeoff is when the feet leave. -->
					<svg
						class="empty-diagram"
						viewBox="0 14 520 100"
						role="img"
						aria-label="An approach jump: run-up, plant step, takeoff, flight and landing. Contact runs from the plant step to takeoff; flight from takeoff to landing."
					>
						<path class="diagram-ground" d="M16 80H504" />
						<g class="diagram-runup">
							<circle cx="40" cy="80" r="2.5" />
							<circle cx="80" cy="80" r="2.5" />
							<circle cx="118" cy="80" r="2.5" />
							<text x="79" y="108">Run-up</text>
						</g>
						<path class="diagram-flight" d="M226 80C262 14 382 14 418 80" />
						<path class="diagram-span" d="M166 87v4h60v-4" />
						<text class="diagram-span-label" x="196" y="108">Contact</text>
						<text class="diagram-span-label" x="322" y="64">Flight</text>
						<g class="diagram-mark landing">
							<circle cx="166" cy="80" r="6" />
							<text x="166" y="64">1</text>
						</g>
						<g class="diagram-mark takeoff">
							<circle cx="226" cy="80" r="6" />
							<text x="226" y="64">2</text>
						</g>
						<g class="diagram-mark landing">
							<circle cx="418" cy="80" r="6" />
							<text x="418" y="64">3</text>
						</g>
					</svg>
					<ol class="empty-steps">
						<li>
							<span class="empty-step-num">1</span>
							<strong>Plant step</strong>
							<span class="empty-step-text">First frame your plant foot touches the ground.</span>
							<span class="empty-mark landing"
								><span class="sr-only">Mark it with </span>Landing</span
							>
						</li>
						<li>
							<span class="empty-step-num">2</span>
							<strong>Takeoff</strong>
							<span class="empty-step-text">First frame both feet are off the ground.</span>
							<span class="empty-mark takeoff"
								><span class="sr-only">Mark it with </span>Takeoff</span
							>
						</li>
						<li>
							<span class="empty-step-num">3</span>
							<strong>Landing</strong>
							<span class="empty-step-text">First frame your feet touch back down.</span>
							<span class="empty-mark landing"
								><span class="sr-only">Mark it with </span>Landing</span
							>
						</li>
					</ol>
					<p class="empty-result">
						Mark each frame with the button shown. You get contact time, flight time, jump height
						and RSI, and a guide under the video walks you through it.
					</p>
				</div>
				<div class="empty-footer at-reveal" style="--delay: 60ms">
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
					{#if isAppEmpty}
						<span class="empty-import">
							Have a backup? <button class="link-btn" onclick={() => importInput?.click()}
								>Import backup</button
							>
						</span>
					{/if}
				</div>
				<p class="empty-import-message" class:error={importMessage?.error} role="status">
					{importMessage?.text ?? ''}
				</p>
			</div>
		{:else}
			<div class="viewer-column">
				<div
					class="viewer-frame"
					class:landscape={fitLandscape}
					class:chrome-hidden={chromeHidden}
					{@attach singleTap(toggleChrome, CHROME_TAP_IGNORE)}
				>
					<VideoViewer
						bind:videoElement
						{videoSrc}
						{videoFile}
						bind:isPlaying
						bind:currentTime
						bind:duration
						{sourceFrameRate}
						frameTimes={timing.frameTimes}
						{editGap}
						bind:frameRate
						bind:playbackFrameRate
						bind:volume
						bind:isMuted
						bind:zoomLevel
						{playbackRate}
						onFrameRateDetected={() => (frameRateSettled = true)}
						onDurationChange={handleVideoMetadata}
						onError={handleMediaError}
					>
						{#snippet overlay()}
							<HoldCue cue={scrubCue} fillMs={HOLD_MS - HOLD_SHOW_MS} />
						{/snippet}
					</VideoViewer>

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
					<!-- On a phone the dock rests at the bottom under the centred picture, and a tap
					     on the picture hides and shows it, as in iOS Photos (see layout.css). -->
					<div class="player-dock">
						{#if showGuide}
							<MarkingGuide
								{marks}
								{analysis}
								{jumpType}
								frameRate={frameRateKnown ? 'known' : frameRateFailed ? 'failed' : 'detecting'}
								{saveShortcut}
								onHide={() => setGuide(true)}
							/>
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
									markLabels={holdLabels}
									fineTouch={touchScreen.current}
									holdMark={touchScreen.current ? holdMark : null}
									onHold={handleHold}
									onMoveMark={handleMoveMark}
									bind:cue={scrubCue}
								/>

								<div class="control-toolbar">
									<!-- One segmented group behind Takeoff, the frame controls and Landing. -->
									<span class="transport-dock" aria-hidden="true"></span>
									<!-- The context strip under the controls: where, how fast, how loud. -->
									<span class="context-strip" aria-hidden="true"></span>
									<div class="time-readout">
										<span class="time-current">{formatFrameClock(playheadLabel, timing)}</span>
										<span class="time-separator">/</span>
										<span class="time-duration">{formatDuration()}</span>
										<span class="time-frame">frame {playheadLabel + 1}</span>
										{#if !mediaError}<span
												class="time-fps"
												class:clean={sourceFrameRate && !variableFrameRate}
												><span class="fps-dot" class:uncertain={!sourceFrameRate}
												></span>{#if sourceFrameRate && variableFrameRate}
													<span title={VARIABLE_FRAME_RATE}>{sourceFrameRate} fps · variable</span>
												{:else if sourceFrameRate}
													{sourceFrameRate} fps
												{:else if playbackFrameRate}
													<span
														title="Couldn't read the frame rate from the file; estimated from playback"
													>
														~{playbackFrameRate} fps · estimated
													</span>
												{:else if frameRateFailed}
													<span title={FRAME_RATE_FAILED}>Frame rate unknown</span>
												{:else}
													Detecting fps…
												{/if}</span
											>{/if}
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
											class:next={nextMark === 'takeoff'}
											onclick={() => addMark('takeoff')}
											title="Mark takeoff on this frame (T)"
										>
											<span class="mark-action-dot"></span>Takeoff<kbd>T</kbd>
										</button>
										<button
											class="mark-action mark-action-landing"
											class:on-frame={activeMark?.type === 'landing'}
											class:next={nextMark === 'landing'}
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
					canRedo={markFuture.length > 0}
					onSeek={seekToMark}
					onNudge={nudgeMark}
					onRemove={deleteMark}
					onUndo={undoMarks}
					onRedo={redoMarks}
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
