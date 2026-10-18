<script lang="ts">
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import TimingControls from '$lib/components/TimingControls.svelte';
	import TimingDrawer from '$lib/components/TimingDrawer.svelte';
	import { resolve } from '$app/paths';
	import { detectSourceFrameRateFromFile } from '$lib/video/frameRate';

	let videoElement: HTMLVideoElement | null = $state(null);
	let videoSrc: string | null = $state(null);
	let videoFileName: string = $state('');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let frameRate = $state(30);
	let sourceFrameRate: number | null = $state(null);
	let playbackFrameRate: number | null = $state(null);
	let volume = $state(1);
	let isMuted = $state(false);
	let isScrubbing = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);
	let isDragging = $state(false);
	let mediaError = $state(false);

	// Timing mode state
	let timingModeEnabled = $state(false);
	let inPoint: number | null = $state(null);
	let outPoint: number | null = $state(null);
	let timingDrawerOpen = $state(false);

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

		timingModeEnabled = false;
		inPoint = null;
		outPoint = null;
		timingDrawerOpen = false;
		zoomLevel = 1;

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

	function toggleTimingMode() {
		timingModeEnabled = !timingModeEnabled;
		if (!timingModeEnabled) {
			inPoint = null;
			outPoint = null;
		}
	}

	function markInPoint() {
		if (!timingModeEnabled) return;
		inPoint = currentTime;
	}

	function markOutPoint() {
		if (!timingModeEnabled) return;
		if (inPoint !== null && currentTime < inPoint) {
			outPoint = inPoint;
			inPoint = currentTime;
		} else {
			outPoint = currentTime;
		}
	}

	function openTimingDrawer() {
		timingDrawerOpen = true;
	}

	function closeTimingDrawer() {
		timingDrawerOpen = false;
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
		if (!isFinite(seconds) || isNaN(seconds)) return '00:00:00';
		const totalFrames = Math.round(seconds * fps);
		const frameInSecond = totalFrames % Math.round(fps);
		const totalSeconds = Math.floor(seconds);
		const mins = Math.floor(totalSeconds / 60);
		const secs = totalSeconds % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frameInSecond.toString().padStart(2, '0')}`;
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

<div
	class="app-shell flex h-dvh flex-col bg-[hsl(var(--at-bg))]"
	role="application"
	ondragover={handleDragOver}
	ondrop={handleDrop}
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
>
	<header class="app-header">
		<a class="brand-mark" href={resolve('/')} aria-label="Airtime home"
			><span class="brand-glyph">a</span><span>Airtime</span></a
		>
		{#if videoSrc}
			<div class="header-file" title={videoFileName}>
				<span class="header-file-dot"></span>
				<span class="truncate">{videoFileName}</span>
			</div>
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
	</header>
	<!-- Viewing stage -->
	<div
		class="viewer-stage relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
	>
		{#if !videoSrc}
			<!-- Empty state -->
			<button
				onclick={openFilePicker}
				class="empty-state at-reveal cursor-pointer transition-all duration-300 hover:scale-[1.02]"
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
						<span class="viewer-badge-dot"></span>{sourceFrameRate ?? frameRate} fps
					</div>
				{/if}

				<!-- Drag overlay -->
				{#if isDragging}
					<div
						class="absolute inset-0 z-20 flex items-center justify-center bg-[hsl(var(--at-bg)/0.9)] backdrop-blur-sm"
					>
						<div class="text-center">
							<div
								class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[hsl(var(--at-accent)/0.2)]"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-8 w-8 text-[hsl(var(--at-accent))]"
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
			</div>
		{/if}
	</div>

	<!-- Control Bar -->
	{#if videoSrc}
		<div class="control-bar">
			<div class="control-bar-inner">
				<!-- Timeline/Scrubber -->
				<VideoScrubber
					{currentTime}
					{duration}
					{videoElement}
					{inPoint}
					{outPoint}
					{timingModeEnabled}
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
						{timingModeEnabled}
						bind:volume
						bind:isMuted
						onToggleTiming={toggleTimingMode}
						onMarkIn={markInPoint}
						onMarkOut={markOutPoint}
					/>

					<TimingControls
						{timingModeEnabled}
						{inPoint}
						{outPoint}
						{frameRate}
						onToggleTiming={toggleTimingMode}
						onMarkIn={markInPoint}
						onMarkOut={markOutPoint}
						onViewDetails={openTimingDrawer}
					/>
				</div>
			</div>
		</div>
	{/if}

	<!-- Hidden file input -->
	<input
		id="video-file-input"
		bind:this={fileInputRef}
		type="file"
		accept="video/*"
		onchange={handleFileSelect}
		class="sr-only"
	/>

	<!-- Timing Drawer -->
	<TimingDrawer
		isOpen={timingDrawerOpen}
		{inPoint}
		{outPoint}
		{frameRate}
		{videoElement}
		onClose={closeTimingDrawer}
	/>
</div>
