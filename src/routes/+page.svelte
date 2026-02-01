<script lang="ts">
	import { browser } from '$app/environment';
	import VideoViewer from '$lib/components/VideoViewer.svelte';
	import VideoScrubber from '$lib/components/VideoScrubber.svelte';
	import VideoControls from '$lib/components/VideoControls.svelte';
	import TimingControls from '$lib/components/TimingControls.svelte';
	import TimingDrawer from '$lib/components/TimingDrawer.svelte';

	let videoElement: HTMLVideoElement | null = $state(null);
	let videoSrc: string | null = $state(null);
	let videoFileName: string = $state('');
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let frameRate = $state(30);
	let volume = $state(1);
	let isMuted = $state(false);
	let isScrubbing = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);
	let isDragging = $state(false);
	let isDarkMode = $state(true);

	// Timing mode state
	let timingModeEnabled = $state(false);
	let inPoint: number | null = $state(null);
	let outPoint: number | null = $state(null);
	let timingDrawerOpen = $state(false);

	// Zoom state
	let zoomLevel = $state(1);
	let videoViewerRef: { resetZoom: () => void; zoomIn: () => void; zoomOut: () => void } | null =
		$state(null);

	// Initialize dark mode from system preference
	$effect(() => {
		if (browser) {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			isDarkMode = prefersDark;
			updateDarkMode(isDarkMode);
		}
	});

	function updateDarkMode(dark: boolean) {
		if (browser) {
			document.documentElement.classList.toggle('dark', dark);
		}
	}

	function toggleDarkMode() {
		isDarkMode = !isDarkMode;
		updateDarkMode(isDarkMode);
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) {
			loadVideoFile(file);
		}
	}

	function loadVideoFile(file: File) {
		// Revoke previous URL to free memory
		if (videoSrc) {
			URL.revokeObjectURL(videoSrc);
		}

		videoSrc = URL.createObjectURL(file);
		videoFileName = file.name;
		currentTime = 0;
		duration = 0;
		frameRate = 30;

		// Reset timing state on new video
		timingModeEnabled = false;
		inPoint = null;
		outPoint = null;
		timingDrawerOpen = false;

		// Reset zoom on new video
		zoomLevel = 1;
	}

	// Timing mode functions
	function toggleTimingMode() {
		timingModeEnabled = !timingModeEnabled;
		if (!timingModeEnabled) {
			// Clear points when disabling timing mode
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
		outPoint = currentTime;
	}

	function clearTimingPoints() {
		inPoint = null;
		outPoint = null;
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

		const file = event.dataTransfer?.files?.[0];
		if (file && file.type.startsWith('video/')) {
			loadVideoFile(file);
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		isDragging = false;
	}

	function openFilePicker() {
		fileInputRef?.click();
	}

	function formatTime(seconds: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '00:00';

		const hrs = Math.floor(seconds / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		const secs = Math.floor(seconds % 60);

		if (hrs > 0) {
			return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
		}
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>Airtime - Video Viewer</title>
	<meta
		name="viewport"
		content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
	/>
</svelte:head>

<div
	class="flex h-dvh flex-col"
	style="background: hsl(var(--at-bg))"
	ondrop={handleDrop}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	role="application"
>
	<!-- Header -->
	<header
		class="at-reveal flex shrink-0 items-center justify-between px-3 py-1.5"
		style="background: hsl(var(--at-bg))"
	>
		<h1 class="text-sm font-bold tracking-tight" style="color: hsl(var(--at-fg))">AIRTIME</h1>
		<div class="flex items-center gap-1">
			<!-- Open file button -->
			<button
				onclick={openFilePicker}
				class="at-btn at-btn-icon-sm at-btn-ghost"
				aria-label="Open video file"
				title="Open video file (or drag & drop)"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-4 w-4"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
				</svg>
			</button>
			<!-- Dark mode toggle -->
			<button
				onclick={toggleDarkMode}
				class="at-btn at-btn-icon-sm at-btn-ghost"
				aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
				title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
			>
				{#if isDarkMode}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path
							d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
							stroke="currentColor"
							stroke-width="2"
							fill="none"
							stroke-linecap="round"
						/>
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-4 w-4"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
					</svg>
				{/if}
			</button>
		</div>
	</header>

	<!-- Video Display Area -->
	<div class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-4 py-4">
		{#if !videoSrc}
			<!-- Empty state with drop zone -->
			<button
				onclick={openFilePicker}
				class="at-reveal at-card flex h-full w-full max-w-md flex-col items-center justify-center gap-5 border-2 border-dashed p-8 transition-all duration-200"
				style="--delay: 90ms; border-color: {isDragging
					? 'hsl(var(--at-accent))'
					: 'hsl(var(--at-border))'}; background: {isDragging
					? 'hsl(var(--at-accent) / 0.08)'
					: 'hsl(var(--at-surface))'}"
			>
				<div
					class="flex h-20 w-20 items-center justify-center rounded-2xl"
					style="background: hsl(var(--at-accent) / 0.1)"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="h-10 w-10"
						fill="none"
						viewBox="0 0 24 24"
						stroke="hsl(var(--at-accent))"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="1.5"
							d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
						/>
					</svg>
				</div>
				<div class="text-center">
					<p class="text-lg font-semibold" style="color: hsl(var(--at-fg))">
						{isDragging ? 'Drop video here' : 'Select a video'}
					</p>
					<p class="at-text-muted mt-2 text-sm">Tap to browse or drag & drop</p>
				</div>
			</button>
		{:else}
			<VideoViewer
				bind:this={videoViewerRef}
				bind:videoElement
				{videoSrc}
				bind:isPlaying
				bind:currentTime
				bind:duration
				bind:frameRate
				bind:volume
				bind:isMuted
				bind:zoomLevel
			/>

			<!-- Drag overlay when video is loaded -->
			{#if isDragging}
				<div
					class="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
					style="background: hsl(var(--at-accent) / 0.2)"
				>
					<div
						class="rounded-2xl px-6 py-4"
						style="background: hsl(var(--at-surface)); box-shadow: 0 8px 32px hsl(var(--at-shadow) / 0.2)"
					>
						<p class="text-lg font-semibold" style="color: hsl(var(--at-fg))">
							Drop to replace video
						</p>
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Controls Section -->
	<div class="at-bottom-sheet pb-safe shrink-0" style="background: hsl(var(--at-surface))">
		<!-- Bottom sheet handle -->
		<div class="at-bottom-sheet-handle"></div>

		{#if videoSrc}
			<!-- Video filename and time display -->
			<div
				class="at-reveal flex items-center justify-center gap-3 px-4 pt-1 pb-2"
				style="--delay: 0ms"
			>
				<span class="at-text-muted truncate text-xs font-medium" style="max-width: 35%">
					{videoFileName}
				</span>
				<span class="at-text-muted text-xs">|</span>
				<span class="font-mono text-sm font-medium" style="color: hsl(var(--at-fg))">
					{formatTime(currentTime)} / {formatTime(duration)}
				</span>
				<span class="at-badge at-badge-accent">
					{frameRate}fps
				</span>
			</div>
		{/if}

		<!-- Scrubber -->
		<VideoScrubber
			{currentTime}
			{duration}
			{videoElement}
			{inPoint}
			{outPoint}
			{timingModeEnabled}
			bind:isScrubbing
		/>

		<!-- Play controls -->
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

		<!-- Timing controls -->
		{#if videoSrc}
			<TimingControls
				{timingModeEnabled}
				{inPoint}
				{outPoint}
				{currentTime}
				{frameRate}
				onToggleTiming={toggleTimingMode}
				onMarkIn={markInPoint}
				onMarkOut={markOutPoint}
				onClear={clearTimingPoints}
				onViewDetails={openTimingDrawer}
			/>
		{/if}
	</div>

	<!-- Hidden file input -->
	<input
		bind:this={fileInputRef}
		type="file"
		accept="video/*"
		onchange={handleFileSelect}
		class="hidden"
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
