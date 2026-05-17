<script lang="ts">
	interface Props {
		isOpen: boolean;
		inPoint: number | null;
		outPoint: number | null;
		frameRate: number;
		videoElement: HTMLVideoElement | null;
		onClose?: () => void;
	}

	let {
		isOpen,
		inPoint,
		outPoint,
		frameRate,
		videoElement,
		onClose
	} = $props<Props>();

	let inThumbnailCanvas: HTMLCanvasElement | null = $state(null);
	let outThumbnailCanvas: HTMLCanvasElement | null = $state(null);
	let inThumbnailReady = $state(false);
	let outThumbnailReady = $state(false);

	let frameCount = $derived(
		inPoint !== null && outPoint !== null ? Math.round((outPoint - inPoint) * frameRate) : null
	);

	let durationMs = $derived(
		inPoint !== null && outPoint !== null ? (outPoint - inPoint) * 1000 : null
	);

	function formatTimeWithFrames(seconds: number, fps: number): string {
		if (!isFinite(seconds) || isNaN(seconds)) return '00:00:00';
		const totalFrames = Math.round(seconds * fps);
		const frameInSecond = totalFrames % Math.round(fps);
		const totalSeconds = Math.floor(seconds);
		const mins = Math.floor(totalSeconds / 60);
		const secs = totalSeconds % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frameInSecond.toString().padStart(2, '0')}`;
	}

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
				const canvasWidth = 240;
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
		if (event.key === 'Escape' && isOpen) {
			onClose?.();
		}
	}

	function handleBackdropKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			handleBackdropClick(event as unknown as MouseEvent);
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if isOpen}
	<div
		class="drawer-backdrop"
		onclick={handleBackdropClick}
		role="dialog"
		aria-modal="true"
		aria-label="Timing details"
		tabindex="-1"
		onkeydown={handleBackdropKeyDown}
	>
		<div class="drawer-content pb-safe">
			<!-- Handle -->
			<div class="drawer-handle"></div>

			<!-- Header -->
			<div class="drawer-header">
				<h2 class="drawer-title">Timing Details</h2>
				<button class="close-btn" onclick={onClose} aria-label="Close">
					<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			<!-- Thumbnails -->
			<div class="thumbnails">
				<!-- In point -->
				<div class="thumbnail-card">
					<div class="thumbnail-badge thumbnail-badge-in">IN</div>
					<div class="thumbnail-frame" class:ready={inThumbnailReady}>
						{#if inPoint !== null}
							<canvas bind:this={inThumbnailCanvas}></canvas>
						{:else}
							<span class="thumbnail-empty">Not set</span>
						{/if}
					</div>
					<div class="thumbnail-time">
						{inPoint !== null ? formatTimeWithFrames(inPoint, frameRate) : '--:--:--'}
					</div>
				</div>

				<!-- Arrow and stats -->
				<div class="stats-center">
					{#if frameCount !== null && durationMs !== null}
						<svg class="stats-arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="5" y1="12" x2="19" y2="12" />
							<polyline points="12 5 19 12 12 19" />
						</svg>
						<div class="stats-values">
							<div class="stat-item">
								<span class="stat-value">{frameCount}</span>
								<span class="stat-label">frames</span>
							</div>
							<div class="stat-item">
								<span class="stat-value">{durationMs.toFixed(1)}</span>
								<span class="stat-label">ms</span>
							</div>
						</div>
					{:else}
						<span class="stats-empty">Set both points to see duration</span>
					{/if}
				</div>

				<!-- Out point -->
				<div class="thumbnail-card">
					<div class="thumbnail-badge thumbnail-badge-out">OUT</div>
					<div class="thumbnail-frame" class:ready={outThumbnailReady}>
						{#if outPoint !== null}
							<canvas bind:this={outThumbnailCanvas}></canvas>
						{:else}
							<span class="thumbnail-empty">Not set</span>
						{/if}
					</div>
					<div class="thumbnail-time">
						{outPoint !== null ? formatTimeWithFrames(outPoint, frameRate) : '--:--:--'}
					</div>
				</div>
			</div>

			<!-- Keyboard hints -->
			<div class="hints">
				<span class="hint"><kbd>I</kbd> Mark In</span>
				<span class="hint"><kbd>O</kbd> Mark Out</span>
				<span class="hint"><kbd>Esc</kbd> Close</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: hsl(var(--at-bg) / 0.85);
		backdrop-filter: blur(12px);
		z-index: 100;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		animation: fadeIn 200ms ease-out;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.drawer-content {
		width: 100%;
		max-width: 560px;
		max-height: 85vh;
		background: hsl(var(--at-bg-elevated));
		border-radius: 24px 24px 0 0;
		padding: 8px 24px 28px;
		animation: slideUp 300ms cubic-bezier(0.32, 0.72, 0, 1);
		overflow-y: auto;
	}

	@keyframes slideUp {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	.drawer-handle {
		width: 40px;
		height: 4px;
		background: hsl(var(--at-fg) / 0.15);
		border-radius: 2px;
		margin: 0 auto 12px;
	}

	.drawer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.drawer-title {
		font-size: 18px;
		font-weight: 700;
		color: hsl(var(--at-fg));
		margin: 0;
	}

	.close-btn {
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: hsl(var(--at-fg-muted));
		cursor: pointer;
		border-radius: 10px;
		transition: all 150ms ease;
	}

	.close-btn:hover {
		background: hsl(var(--at-fg) / 0.08);
		color: hsl(var(--at-fg));
	}

	.thumbnails {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 20px;
		margin-bottom: 24px;
	}

	.thumbnail-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		flex: 1;
		max-width: 180px;
	}

	.thumbnail-badge {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 1px;
		padding: 4px 12px;
		border-radius: 100px;
	}

	.thumbnail-badge-in {
		background: hsl(var(--at-in) / 0.15);
		color: hsl(var(--at-in));
	}

	.thumbnail-badge-out {
		background: hsl(var(--at-out) / 0.15);
		color: hsl(var(--at-out));
	}

	.thumbnail-frame {
		width: 100%;
		aspect-ratio: 16 / 9;
		background: hsl(var(--at-bg));
		border: 2px solid hsl(var(--at-border));
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		opacity: 0.5;
		transition: opacity 200ms ease;
	}

	.thumbnail-frame.ready {
		opacity: 1;
	}

	.thumbnail-card:first-child .thumbnail-frame {
		border-color: hsl(var(--at-in) / 0.5);
	}

	.thumbnail-card:last-child .thumbnail-frame {
		border-color: hsl(var(--at-out) / 0.5);
	}

	.thumbnail-frame canvas {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.thumbnail-empty {
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}

	.thumbnail-time {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 14px;
		font-weight: 600;
		color: hsl(var(--at-fg));
	}

	.stats-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 0 12px;
		min-width: 80px;
	}

	.stats-arrow {
		width: 24px;
		height: 24px;
		color: hsl(var(--at-accent));
	}

	.stats-values {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.stat-item {
		text-align: center;
	}

	.stat-value {
		display: block;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 22px;
		font-weight: 700;
		color: hsl(var(--at-accent));
		line-height: 1;
	}

	.stat-label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: hsl(var(--at-fg-muted));
	}

	.stats-empty {
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
		text-align: center;
	}

	.hints {
		display: flex;
		justify-content: center;
		gap: 20px;
		padding-top: 20px;
		border-top: 1px solid hsl(var(--at-border));
	}

	.hint {
		font-size: 12px;
		color: hsl(var(--at-fg-muted));
	}

	.hint kbd {
		display: inline-block;
		padding: 3px 7px;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 10px;
		font-weight: 600;
		background: hsl(var(--at-surface));
		border: 1px solid hsl(var(--at-border));
		border-radius: 5px;
		margin-right: 6px;
	}

	@media (max-width: 480px) {
		.drawer-content {
			padding: 8px 16px 24px;
		}

		.thumbnails {
			flex-direction: column;
			gap: 16px;
		}

		.thumbnail-card {
			max-width: 200px;
		}

		.stats-center {
			flex-direction: row;
			gap: 20px;
		}

		.stats-arrow {
			transform: rotate(90deg);
		}

		.stats-values {
			flex-direction: row;
			gap: 20px;
		}

		.hints {
			flex-wrap: wrap;
			gap: 12px;
		}
	}
</style>
