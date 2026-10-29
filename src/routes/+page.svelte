<script lang="ts">
	// The time tool: open a clip, set an in and an out point, read the time between
	// them. It shares the player with the full app at /alpha, and keeps nothing:
	// reloading or opening another video starts over.
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import KeybindsDialog from '$lib/components/KeybindsDialog.svelte';
	import TimerReadout from '$lib/components/TimerReadout.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { innerHeight, innerWidth } from 'svelte/reactivity/window';
	import { resolve } from '$app/paths';
	import { TIMER_KEYBIND_GROUPS } from '$lib/keybinds';
	import { detectSourceTimingFromFile } from '$lib/video/frameRate';
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
	import { analyzeMarks, frameOf, markAtFrame, removeMark, type Mark } from '$lib/video/marks';
	import { POINT_LABELS, findPoint, pointOf, setPoint, type TimerPoint } from '$lib/video/timer';

	let videoElement: HTMLVideoElement | null = $state(null);
	let videoSrc: string | null = $state(null);
	let videoFileName: string = $state('');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let frameRate = $state(30);
	let sourceFrameRate: number | null = $state(null);
	// The time of every frame, read from the file (see the full app's page).
	let frameTimes: number[] | null = $state.raw(null);
	let variableFrameRate = $state(false);
	let playbackFrameRate: number | null = $state(null);
	let sourceFrameRateChecked = $state(false);
	let frameRateSettled = $state(false);
	// Points snap to frames, so they can only be set once the frame rate is read or measured.
	let frameRateKnown = $derived(Boolean(sourceFrameRate || playbackFrameRate));
	let frameRateFailed = $derived(frameRateSettled && sourceFrameRateChecked && !frameRateKnown);
	let playbackRate = $state(1);
	let volume = $state(1);
	let isMuted = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);
	let isDragging = $state(false);
	let mediaError = $state(false);
	let videoFile: File | null = $state.raw(null);
	let keybindsOpen = $state(false);
	let notice: string | null = $state(null);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;

	// The in and out points, stored as marks so the shared timeline can draw them.
	let marks: Mark[] = $state([]);
	let timeScale = $state(1);
	let zoomLevel = $state(1);
	let activeVideoLoadId = $state(0);

	let timing: FrameTiming = $derived({
		fps: frameRate,
		frameTimes: sourceFrameRate ? frameTimes : null
	});
	let intervals = $derived(analyzeMarks(marks, timing, timeScale).intervals);
	let activeMark = $derived(markAtFrame(marks, currentTime, timing));
	let activePoint = $derived(activeMark ? pointOf(activeMark) : null);
	// The point still to set gets the outlined button, as the next step does in the full app.
	let nextPoint: TimerPoint | null = $derived.by(() => {
		if (!frameRateKnown) return null;
		if (!findPoint(marks, 'in')) return 'in';
		if (!findPoint(marks, 'out')) return 'out';
		return null;
	});

	// Below 900px the readout and controls stack under the video (see layout.css). A
	// landscape video is sized to fit when the controls still fit underneath it.
	const stacked = new MediaQuery('(max-width: 900px) and (min-height: 501px)');
	let videoAspect: number | null = $state(null);
	// Header, stage padding, readout band and control bar, roughly.
	const STACKED_CHROME_PX = 320;
	let fitLandscape = $derived.by(() => {
		if (!stacked.current || !((videoAspect ?? 0) > 1)) return false;
		const width = innerWidth.current ?? 0;
		const height = innerHeight.current ?? 0;
		return width / videoAspect! <= height - STACKED_CHROME_PX;
	});

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
		activeVideoLoadId += 1;
		const loadId = activeVideoLoadId;

		if (videoSrc) {
			videoElement?.pause();
		}

		videoSrc = URL.createObjectURL(file);
		videoFile = file;
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
		timeScale = 1;
		zoomLevel = 1;
		videoAspect = null;

		void detectSourceTimingFromFile(file)
			.then((detected) => {
				if (loadId !== activeVideoLoadId) return;
				const detectedFps = detected?.fps ?? null;
				sourceFrameRate = detectedFps;
				frameTimes = detected?.frameTimes ?? null;
				variableFrameRate = detected?.variableFrameRate ?? false;
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

	const VARIABLE_FRAME_RATE =
		"This video's frames aren't evenly spaced (variable frame rate). Stepping follows " +
		'its real frames, and times use their actual times';

	const FRAME_RATE_FAILED =
		"This video can't be timed: its frame rate couldn't be read or measured";

	$effect(() => {
		if (frameRateFailed) showNotice(FRAME_RATE_FAILED);
	});

	/** Says why not when the frame rate isn't known yet, or never will be. */
	function canMark(): boolean {
		if (frameRateKnown) return true;
		showNotice(frameRateFailed ? FRAME_RATE_FAILED : 'Detecting the frame rate…');
		return false;
	}

	async function markPoint(point: TimerPoint) {
		if (!videoElement || !canMark()) return;
		const loadId = activeVideoLoadId;
		// Setting a point while playing would land between frames; pause on the frame
		// instead, and use the frame left on screen.
		if (!videoElement.paused) videoElement.pause();
		const frame = await settledDisplayedFrame(videoElement, timing);
		if (loadId !== activeVideoLoadId) return;
		marks = setPoint(marks, point, frameStartTime(frame, timing), timing);
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

	function handleKeyDown(event: KeyboardEvent) {
		const target = event.target;
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
			event.metaKey ||
			event.ctrlKey ||
			(target instanceof HTMLElement &&
				(target.isContentEditable || target.closest('input, textarea, select')))
		) {
			return;
		}
		const key = event.key.toLowerCase();
		if (key === 'i' || key === 'o') {
			event.preventDefault();
			void markPoint(key === 'i' ? 'in' : 'out');
		} else if ((key === 'backspace' || key === 'delete') && activeMark) {
			event.preventDefault();
			marks = removeMark(marks, activeMark.id);
		} else if (key === '[' || key === ']') {
			event.preventDefault();
			seekAdjacentMark(key === ']' ? 1 : -1);
		} else if (key === 'r') {
			event.preventDefault();
			cyclePlaybackRate();
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;
		if (keybindsOpen) return;

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
		videoAspect = video.videoWidth / video.videoHeight;
	}

	function handleMediaError() {
		mediaError = true;
		isPlaying = false;
	}

	function openFilePicker() {
		fileInputRef?.click();
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
	<title>{videoSrc ? `${videoFileName} · Airtime` : 'Airtime'}</title>
</svelte:head>

<!-- Drag and drop is handled on the window so the app shell stays a plain, non-interactive element. -->
<svelte:window
	onkeydown={handleKeyDown}
	ondragover={handleDragOver}
	ondrop={handleDrop}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
/>

<KeybindsDialog
	isOpen={keybindsOpen}
	onClose={() => (keybindsOpen = false)}
	groups={TIMER_KEYBIND_GROUPS}
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
				</div>
			{/if}
		</div>
		<div class="header-actions">
			<button
				class="btn btn-icon header-wide"
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
				onclick={openFilePicker}
				class="btn btn-icon"
				class:header-open-empty={!videoSrc}
				aria-label={videoSrc ? 'Change video' : 'Open video'}
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
		</div>
		<div class="app-notice" class:visible={notice} role="status">{notice ?? ''}</div>
	</header>
	<!-- Viewing stage -->
	<div
		class="viewer-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
		class:overflow-y-auto={!videoSrc}
		class:has-video={videoSrc}
		style:--video-aspect={videoAspect ?? undefined}
	>
		{#if !videoSrc}
			<div class="empty">
				<div class="empty-card at-reveal">
					<div class="empty-head">
						<h1 class="empty-title">Time anything on video</h1>
						<p class="empty-lede">Open a clip and mark a start and an end frame.</p>
					</div>
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
							<span class="dropzone-title">{isDragging ? 'Drop to open' : 'Open a video'}</span>
							<span class="dropzone-sub"
								><span class="pointer-only">Drag a clip here, or browse your files</span><span
									class="touch-only">Choose a clip from your library or files</span
								></span
							>
						</span>
						<span class="btn btn-primary">Choose video</span>
					</button>
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
				</div>
			</div>
		{:else}
			<div class="viewer-column">
				<div class="viewer-frame" class:landscape={fitLandscape}>
					<VideoViewer
						bind:videoElement
						{videoSrc}
						{videoFile}
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
					{/if}

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
					{#if !mediaError}
						<TimerReadout
							{marks}
							{timing}
							frameRate={frameRateKnown ? 'known' : frameRateFailed ? 'failed' : 'detecting'}
							bind:timeScale
							onSeek={seekToMark}
							onClear={() => (marks = [])}
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
								{intervals}
								activeMarkId={activeMark?.id ?? null}
								markLabels={POINT_LABELS}
							/>

							<div class="control-toolbar">
								<span class="transport-dock" aria-hidden="true"></span>
								<span class="context-strip" aria-hidden="true"></span>
								<div class="time-readout">
									<span class="time-current">{formatFrameClock(playheadLabel, timing)}</span>
									<span class="time-separator">/</span>
									<span class="time-duration">{formatDuration()}</span>
									<span class="time-frame">frame {playheadLabel + 1}</span>
									{#if !mediaError}<span class="time-fps"
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

								<!-- The in point takes the left slot and the out point the right. -->
								<div class="mark-actions">
									<button
										class="mark-action mark-action-takeoff"
										class:on-frame={activePoint === 'in'}
										class:next={nextPoint === 'in'}
										onclick={() => markPoint('in')}
										title="Set the in point on this frame (I)"
									>
										<span class="mark-action-dot"></span>In<kbd>I</kbd>
									</button>
									<button
										class="mark-action mark-action-landing"
										class:on-frame={activePoint === 'out'}
										class:next={nextPoint === 'out'}
										onclick={() => markPoint('out')}
										title="Set the out point on this frame (O)"
									>
										<span class="mark-action-dot"></span>Out<kbd>O</kbd>
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		{/if}
	</div>

	<input
		id="video-file-input"
		bind:this={fileInputRef}
		type="file"
		accept="video/*"
		onchange={handleFileSelect}
		class="sr-only"
	/>
</div>
