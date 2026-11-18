<script lang="ts">
	import type { Session } from '$lib/session/schema';
	import { latestGroup, sessionSummary, timeDomain, trendGroups } from '$lib/session/trends';

	interface Props {
		sessions: Session[];
		/** Asks for the session's video; its marks come back once the matching file is opened. */
		onOpenSession: (session: Session) => void;
		/** Opens the Saved sessions dialog on its list or its trends. */
		onShowAll: (view: 'list' | 'trends') => void;
	}

	let { sessions, onOpenSession, onShowAll }: Props = $props();

	const RECENT = 4;
	const CHART_HEIGHT = 64;
	const PAD_X = 6;
	const PAD_Y = 8;

	// The jump type trained most recently, and its best flight per session.
	let group = $derived(latestGroup(trendGroups(sessions)));
	let points = $derived(group?.points ?? []);
	let latest = $derived(points.length ? points[points.length - 1] : null);
	let change = $derived.by(() => {
		if (points.length < 2 || !latest) return null;
		return {
			value: Math.round(latest.best.flightMs) - Math.round(points[0].best.flightMs),
			since: points[0].time
		};
	});

	let recent = $derived(
		[...sessions]
			.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt))
			.slice(0, RECENT)
			.map((session) => ({ session, ...sessionSummary(session) }))
	);

	let width = $state(0);
	let dots = $derived.by(() => {
		if (points.length < 2 || width === 0) return [];
		const [start, end] = timeDomain(points);
		const values = points.map((point) => point.best.flightMs);
		const min = Math.min(...values);
		const max = Math.max(...values);
		const span = max - min || 1;
		return points.map((point) => ({
			x: PAD_X + ((point.time - start) / (end - start)) * (width - PAD_X * 2),
			// One value across every session sits mid-height rather than on an edge.
			y:
				max === min
					? CHART_HEIGHT / 2
					: PAD_Y + (1 - (point.best.flightMs - min) / span) * (CHART_HEIGHT - PAD_Y * 2)
		}));
	});
	let line = $derived(
		dots.map((dot, i) => `${i ? 'L' : 'M'}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join('')
	);

	function day(time: number): string {
		return new Date(time).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function recorded(session: Session): string {
		const time = Date.parse(session.recordedAt);
		return Number.isNaN(time) ? 'No date' : day(time);
	}
</script>

{#if latest && group}
	<section class="home-card home-progress" aria-labelledby="home-progress-title">
		<header class="home-card-head">
			<h2 id="home-progress-title">Flight time <span>· {group.label}</span></h2>
			<button class="home-more" onclick={() => onShowAll('trends')}>
				Trends<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
			</button>
		</header>
		<div class="home-progress-body">
			<p class="home-progress-value">
				<span class="home-progress-number">{Math.round(latest.best.flightMs)}</span><span
					class="home-progress-unit">ms</span
				>
			</p>
			<p class="home-progress-note">
				Best jump on {day(latest.time)}{#if change}<span class="home-sep" aria-hidden="true">·</span
					><span class="home-change" class:up={change.value > 0}
						>{change.value > 0 ? '+' : change.value < 0 ? '−' : '±'}{Math.abs(change.value)} ms</span
					>
					since {day(change.since)}{:else}. Save another {group.label.toLowerCase()} session to compare.{/if}
			</p>
		</div>
		{#if points.length > 1}
			<div class="home-chart">
				<!-- Measured inside the padding, so the last dot stays within the card. -->
				<div bind:clientWidth={width}>
					<svg
						width={width || undefined}
						height={CHART_HEIGHT}
						role="img"
						aria-label="Best flight per session, {points.length} sessions from {day(
							points[0].time
						)} to {day(latest.time)}"
					>
						<path class="home-chart-line" d={line} />
						{#each dots as dot, i (i)}
							<circle
								class="home-chart-dot"
								class:last={i === dots.length - 1}
								cx={dot.x}
								cy={dot.y}
								r={i === dots.length - 1 ? 3.5 : 2.25}
							/>
						{/each}
					</svg>
				</div>
				<div class="home-chart-axis" aria-hidden="true">
					<span>{day(points[0].time)}</span><span>{day(latest.time)}</span>
				</div>
			</div>
		{/if}
	</section>
{/if}

<section class="home-card home-recent" aria-labelledby="home-recent-title">
	<header class="home-card-head">
		<h2 id="home-recent-title">Recent sessions</h2>
		<button class="home-more" onclick={() => onShowAll('list')}>
			{sessions.length > RECENT ? `All ${sessions.length}` : 'Sessions'}<svg
				viewBox="0 0 16 16"
				aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
			>
		</button>
	</header>
	<ul>
		{#each recent as { session, jumps, bestFlightMs } (session.id)}
			<li>
				<button
					class="home-session"
					onclick={() => onOpenSession(session)}
					title="View results for {session.title}"
				>
					<span class="home-session-text">
						<span class="home-session-title">{session.title}</span>
						<span class="home-session-meta"
							>Recorded {recorded(session)} · {jumps} jump{jumps === 1 ? '' : 's'}</span
						>
					</span>
					<span class="home-session-best" class:none={bestFlightMs === null}>
						{#if bestFlightMs !== null}{Math.round(bestFlightMs)}<small>ms</small>{:else}—{/if}
					</span>
					<svg class="home-session-chevron" viewBox="0 0 16 16" aria-hidden="true"
						><path d="m6 3.5 4.5 4.5L6 12.5" /></svg
					>
				</button>
			</li>
		{/each}
	</ul>
</section>

<style>
	/* Cards in the family of the first-run card: one border, the elevated surface. */
	.home-card {
		overflow: hidden;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 14px;
		background: hsl(var(--at-bg-elevated));
	}

	.home-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 12px 0 20px;
	}

	.home-card-head h2 {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 600;
	}

	.home-card-head h2 span {
		color: hsl(var(--at-fg-muted));
		font-weight: 500;
	}

	.home-more {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		height: 28px;
		padding: 0 6px 0 8px;
		border: none;
		border-radius: var(--at-radius-sm);
		background: none;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	@media (hover: hover) {
		.home-more:hover {
			background: hsl(var(--at-surface));
			color: hsl(var(--at-fg));
		}
	}

	.home-more svg,
	.home-session-chevron {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.home-progress-body {
		padding: 6px 20px 0;
	}

	.home-progress-value {
		display: flex;
		align-items: baseline;
		gap: 4px;
		margin: 0;
		color: hsl(var(--at-fg));
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}

	.home-progress-number {
		font-size: 44px;
		font-weight: 600;
		letter-spacing: -0.03em;
	}

	.home-progress-unit {
		color: hsl(var(--at-fg-muted));
		font-size: 17px;
		font-weight: 500;
	}

	.home-progress-note {
		margin: 6px 0 0;
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
		line-height: 1.4;
	}

	.home-sep {
		margin-inline: 0.4em;
	}

	/* Brightness, not hue: hue is kept for status. */
	.home-change {
		color: hsl(var(--at-fg-secondary));
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.home-change.up {
		color: hsl(var(--at-fg));
	}

	.home-chart {
		padding: 10px 20px 14px;
	}

	.home-chart svg {
		display: block;
		overflow: visible;
	}

	.home-chart-line {
		fill: none;
		stroke: hsl(var(--at-fg) / 0.35);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}

	.home-chart-dot {
		fill: hsl(var(--at-fg-muted));
	}

	.home-chart-dot.last {
		fill: hsl(var(--at-fg));
	}

	.home-chart-axis {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.home-progress:not(:has(.home-chart)) .home-progress-body {
		padding-bottom: 16px;
	}

	.home-recent ul {
		margin: 8px 0 0;
		padding: 0 0 6px;
		list-style: none;
	}

	/* Dividers inset to the text; each row's hover still runs edge to edge. */
	.home-recent li + li {
		position: relative;
	}

	.home-recent li + li::before {
		content: '';
		position: absolute;
		top: 0;
		right: 20px;
		left: 20px;
		height: 1px;
		background: hsl(var(--at-border));
	}

	.home-session {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 14px 10px 20px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	@media (hover: hover) {
		.home-session:hover {
			background: hsl(var(--at-fg) / 0.035);
		}
	}

	.home-session-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.home-session-title {
		overflow: hidden;
		color: hsl(var(--at-fg));
		font-size: 13px;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.home-session-meta {
		color: hsl(var(--at-fg-muted));
		font-size: 12px;
	}

	.home-session-best {
		flex: 0 0 auto;
		color: hsl(var(--at-fg));
		font-size: 15px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.home-session-best small {
		margin-left: 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.home-session-best.none {
		color: hsl(var(--at-fg-muted));
		font-weight: 500;
	}

	.home-session-chevron {
		flex: 0 0 auto;
		color: hsl(var(--at-fg-muted));
	}

	@media (max-width: 640px) {
		.home-card-head {
			padding: 12px 8px 0 16px;
		}
		.home-progress-body,
		.home-chart {
			padding-inline: 16px;
		}
		.home-recent li + li::before {
			right: 16px;
			left: 16px;
		}
		.home-session {
			min-height: 56px;
			padding: 10px 10px 10px 16px;
		}
	}
</style>
