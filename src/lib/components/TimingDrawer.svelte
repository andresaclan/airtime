<script lang="ts">
	interface Props {
		isOpen: boolean;
		inPoint: number | null;
		outPoint: number | null;
		frameRate: number;
		videoElement: HTMLVideoElement | null;
		onClose?: () => void;
	}

	let { isOpen, inPoint, outPoint, frameRate, videoElement, onClose }: Props = $props();

	// Canvas refs for thumbnails
	let inThumbnailCanvas: HTMLCanvasElement | null = $state(null);
	let outThumbnailCanvas: HTMLCanvasElement | null = $state(null);
	let inThumbnailReady = $state(false);
	let outThumbnailReady = $state(false);

	// Calculate frame count and duration
	let frameCount = $derived(
		inPoint !== null && outPoint !== null ? Math.round((outPoint - inPoint) * frameRate) : null
	);

	let durationMs = $derived(
		inPoint !== null && outPoint !== null ? (outPoint - inPoint) * 1000 : null
	);

	// Format time with frame number (MM:SS:ff)
	function formatTimeWithFrames(seconds: number, fps: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '00:00:00';

		const totalFrames = Math.round(seconds * fps);
		const frameInSecond = totalFrames % Math.round(fps);
		const totalSeconds = Math.floor(seconds);
		const mins = Math.floor(totalSeconds / 60);
		const secs = totalSeconds % 60;

		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frameInSecond.toString().padStart(2, '0')}`;
	}

	// Generate thumbnail when in/out points change
	$effect(() => {
		if (inPoint !== null && videoElement && inThumbnailCanvas && isOpen) {
			inThumbnailReady = false;
			generateThumbnail(inPoint, inThumbnailCanvas).then(() => {
				inThumbnailReady = true;
			});
		}
	});

	$effect(() => {
		if (outPoint !== null && videoElement && outThumbnailCanvas && isOpen) {
			outThumbnailReady = false;
			generateThumbnail(outPoint, outThumbnailCanvas).then(() => {
				outThumbnailReady = true;
			});
		}
	});

	async function generateThumbnail(time: number, canvas: HTMLCanvasElement): Promise<void> {
		if (!videoElement || !videoElement.src) return;

		const tempVideo = document.createElement('video');
		tempVideo.src = videoElement.src;
		tempVideo.muted = true;
		tempVideo.preload = 'auto';
		tempVideo.crossOrigin = 'anonymous';

		try {
			await new Promise<void>((resolve, reject) => {
				tempVideo.onloadeddata = () => resolve();
				tempVideo.onerror = () => reject(new Error('Failed to load video'));
				setTimeout(() => reject(new Error('Timeout')), 5000);
			});

			tempVideo.currentTime = time;

			await new Promise<void>((resolve, reject) => {
				tempVideo.onseeked = () => resolve();
				tempVideo.onerror = () => reject(new Error('Failed to seek'));
				setTimeout(() => reject(new Error('Seek timeout')), 5000);
			});

			const ctx = canvas.getContext('2d');
			if (ctx && tempVideo.videoWidth > 0 && tempVideo.videoHeight > 0) {
				const aspectRatio = tempVideo.videoWidth / tempVideo.videoHeight;
				const canvasWidth = 200;
				const canvasHeight = Math.round(canvasWidth / aspectRatio);

				canvas.width = canvasWidth;
				canvas.height = canvasHeight;

				ctx.drawImage(tempVideo, 0, 0, canvasWidth, canvasHeight);
			}
		} catch (error) {
			console.warn('Failed to generate thumbnail:', error);
		} finally {
			tempVideo.src = '';
			tempVideo.remove();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			onClose?.();
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			onClose?.();
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Drawer backdrop and container -->
{#if isOpen}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="drawer-backdrop"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && onClose?.()}
		role="dialog"
		aria-modal="true"
		aria-label="Timing details"
		tabindex="-1"
	>
		<div class="drawer-container">
			<!-- Drawer header -->
			<div class="drawer-header">
				<h2 class="drawer-title">Timing Details</h2>
				<button class="at-btn at-btn-icon close-btn" onclick={onClose} aria-label="Close drawer">
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

			<!-- Thumbnail comparison -->
			<div class="thumbnails-row">
				<!-- In point thumbnail -->
				<div class="thumbnail-card thumbnail-in">
					<div class="thumbnail-label">IN</div>
					<div class="thumbnail-wrapper" class:thumbnail-ready={inThumbnailReady}>
						{#if inPoint !== null}
							<canvas bind:this={inThumbnailCanvas} class="thumbnail-canvas"></canvas>
						{:else}
							<div class="thumbnail-placeholder">
								<span>Not set</span>
							</div>
						{/if}
					</div>
					<div class="thumbnail-time">
						{inPoint !== null ? formatTimeWithFrames(inPoint, frameRate) : '--:--:--'}
					</div>
				</div>

				<!-- Arrow / difference indicator -->
				<div class="difference-indicator">
					{#if frameCount !== null && durationMs !== null}
						<div class="diff-arrow">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								class="h-6 w-6"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
							>
								<line x1="5" y1="12" x2="19" y2="12" />
								<polyline points="12 5 19 12 12 19" />
							</svg>
						</div>
						<div class="diff-stats">
							<div class="diff-stat">
								<span class="diff-value">{frameCount}</span>
								<span class="diff-label">frames</span>
							</div>
							<div class="diff-stat">
								<span class="diff-value">{durationMs.toFixed(1)}</span>
								<span class="diff-label">ms</span>
							</div>
						</div>
					{:else}
						<div class="diff-placeholder">
							<span class="at-text-muted">Set both points</span>
						</div>
					{/if}
				</div>

				<!-- Out point thumbnail -->
				<div class="thumbnail-card thumbnail-out">
					<div class="thumbnail-label">OUT</div>
					<div class="thumbnail-wrapper" class:thumbnail-ready={outThumbnailReady}>
						{#if outPoint !== null}
							<canvas bind:this={outThumbnailCanvas} class="thumbnail-canvas"></canvas>
						{:else}
							<div class="thumbnail-placeholder">
								<span>Not set</span>
							</div>
						{/if}
					</div>
					<div class="thumbnail-time">
						{outPoint !== null ? formatTimeWithFrames(outPoint, frameRate) : '--:--:--'}
					</div>
				</div>
			</div>

			<!-- Keyboard shortcuts hint -->
			<div class="shortcuts-hint">
				<span><kbd>I</kbd> Mark In</span>
				<span><kbd>O</kbd> Mark Out</span>
				<span><kbd>Esc</kbd> Close</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: hsl(0 0% 0% / 0.6);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
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

	.drawer-container {
		width: 100%;
		max-width: 600px;
		max-height: 80vh;
		background: hsl(var(--at-surface));
		border: 1px solid hsl(var(--at-border));
		border-bottom: none;
		padding: 20px;
		animation: slideUp 200ms ease-out;
		overflow-y: auto;
	}

	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
	}

	.drawer-title {
		font-size: 16px;
		font-weight: 700;
		color: hsl(var(--at-fg));
		margin: 0;
	}

	.close-btn {
		width: 36px;
		height: 36px;
		padding: 6px;
	}

	.thumbnails-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 16px;
		margin-bottom: 20px;
	}

	.thumbnail-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		flex: 1;
		max-width: 200px;
	}

	.thumbnail-label {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 1px;
		text-transform: uppercase;
		padding: 4px 12px;
		border: 1px solid;
	}

	.thumbnail-in .thumbnail-label {
		color: hsl(var(--at-success));
		border-color: hsl(var(--at-success));
		background: hsl(var(--at-success) / 0.1);
	}

	.thumbnail-out .thumbnail-label {
		color: hsl(var(--at-error));
		border-color: hsl(var(--at-error));
		background: hsl(var(--at-error) / 0.1);
	}

	.thumbnail-wrapper {
		width: 100%;
		aspect-ratio: 16 / 9;
		background: hsl(var(--at-bg));
		border: 2px solid hsl(var(--at-border));
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.5;
		transition: opacity 200ms ease;
	}

	.thumbnail-wrapper.thumbnail-ready {
		opacity: 1;
	}

	.thumbnail-in .thumbnail-wrapper {
		border-color: hsl(var(--at-success));
	}

	.thumbnail-out .thumbnail-wrapper {
		border-color: hsl(var(--at-error));
	}

	.thumbnail-canvas {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.thumbnail-placeholder {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.thumbnail-time {
		font-family: ui-monospace, monospace;
		font-size: 14px;
		font-weight: 600;
		color: hsl(var(--at-fg));
	}

	.difference-indicator {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0 8px;
		min-width: 80px;
	}

	.diff-arrow {
		color: hsl(var(--at-accent));
	}

	.diff-stats {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.diff-stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}

	.diff-value {
		font-family: ui-monospace, monospace;
		font-size: 18px;
		font-weight: 700;
		color: hsl(var(--at-accent));
	}

	.diff-label {
		font-size: 10px;
		font-weight: 600;
		color: hsl(var(--at-fg-muted));
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.diff-placeholder {
		text-align: center;
		font-size: 12px;
	}

	.shortcuts-hint {
		display: flex;
		justify-content: center;
		gap: 20px;
		padding-top: 16px;
		border-top: 1px solid hsl(var(--at-border));
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}

	.shortcuts-hint kbd {
		display: inline-block;
		padding: 2px 6px;
		font-family: ui-monospace, monospace;
		font-size: 11px;
		background: hsl(var(--at-bg));
		border: 1px solid hsl(var(--at-border));
		margin-right: 4px;
	}

	/* Responsive: stack on very small screens */
	@media (max-width: 480px) {
		.thumbnails-row {
			flex-direction: column;
			gap: 20px;
		}

		.thumbnail-card {
			max-width: 160px;
		}

		.difference-indicator {
			flex-direction: row;
			gap: 16px;
		}

		.diff-arrow {
			transform: rotate(90deg);
		}

		.diff-stats {
			flex-direction: row;
			gap: 16px;
		}
	}
</style>
