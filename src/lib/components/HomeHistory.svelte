<script lang="ts">
	import type { Session } from '$lib/session/schema';
	import { latestGroup, sessionSummary, timeDomain, trendGroups } from '$lib/session/trends';

	interface Props {
		sessions: Session[];
		/** Opens the session's saved results; no video is needed. */
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
		return Number.isNaN(time) ? 'No date' : `Recorded ${day(time)}`;
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

<section class="home-recent" aria-labelledby="home-recent-title">
	<header class="home-recent-head">
		<h2 id="home-recent-title">Recent sessions</h2>
		<button
			class="home-recent-all"
			aria-label={sessions.length > RECENT
				? `All ${sessions.length} saved sessions`
				: 'Sessions list'}
			onclick={() => onShowAll('list')}
			>{sessions.length > RECENT ? `All ${sessions.length}` : 'Sessions'}</button
		>
	</header>
	<div class="home-recent-legend" aria-hidden="true">Best flight</div>
	<!-- role="list" keeps the list in WebKit's accessibility tree without its bullets. -->
	<ul role="list">
		{#each recent as { session, jumps, bestFlightMs } (session.id)}
			{@const when = recorded(session)}
			{@const count = `${jumps} jump${jumps === 1 ? '' : 's'}`}
			<li>
				<button
					class="home-recent-row"
					onclick={() => onOpenSession(session)}
					title="View results for {session.title}"
					aria-label="View results for {session.title}. {when}, {count}. {bestFlightMs === null
						? 'No best flight'
						: `Best flight ${Math.round(bestFlightMs)} milliseconds`}"
				>
					<span>
						<span class="home-recent-title">{session.title}</span>
						<span class="home-recent-meta">{when} · {count}</span>
					</span>
					<span class="home-recent-value"
						><span class="home-recent-label">Best flight</span
						>{#if bestFlightMs !== null}{Math.round(bestFlightMs)}<span class="home-recent-unit"
								>ms</span
							>{:else}<span class="home-recent-none">None</span>{/if}</span
					>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
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

	.home-more svg {
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

	/* Recent sessions: rows aligned on one Best flight column, which each row
	   labels for itself once the card is too narrow for a shared legend. */
	.home-recent {
		container: home-recent / inline-size;
		padding: 8px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: var(--at-radius-lg);
		background: hsl(var(--at-bg-elevated));
		color: hsl(var(--at-fg));
		line-height: 1.4;
	}

	.home-recent-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 8px;
	}

	.home-recent-head h2 {
		margin: 0;
		color: hsl(var(--at-fg));
		font-size: 1rem;
		font-weight: 500;
		line-height: 1.5;
	}

	/* Preflight already resets button font, colour and background. */
	.home-recent button {
		cursor: pointer;
	}

	.home-recent-all {
		min-width: 44px;
		min-height: 44px;
		padding: 4px 12px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: var(--at-radius);
		color: hsl(var(--at-fg-secondary));
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.home-recent-legend {
		margin: 8px 36px 0 8px;
		color: hsl(var(--at-fg-muted));
		font-size: 0.75rem;
		line-height: 1.3334;
		text-align: right;
	}

	.home-recent ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.home-recent li + li {
		border-top: 1px solid hsl(var(--at-border));
	}

	.home-recent-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto 16px;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 60px;
		padding: 8px;
		border: 0;
		border-radius: var(--at-radius);
		text-align: left;
	}

	.home-recent-title,
	.home-recent-meta {
		display: block;
		overflow-wrap: anywhere;
	}

	.home-recent-title {
		color: hsl(var(--at-fg));
		font-size: 0.875rem;
		font-weight: 500;
		line-height: 1.43;
	}

	.home-recent-meta,
	.home-recent-unit,
	.home-recent-none,
	.home-recent-label {
		color: hsl(var(--at-fg-muted));
		font-size: 0.75rem;
		font-weight: 400;
		line-height: 1.3334;
	}

	.home-recent-meta {
		margin-top: 4px;
	}

	.home-recent-value {
		color: hsl(var(--at-fg));
		font-size: 1rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		text-align: right;
		white-space: nowrap;
	}

	.home-recent-unit {
		margin-left: 4px;
	}

	.home-recent-label {
		display: none;
	}

	.home-recent-row svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: hsl(var(--at-fg-muted));
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (hover: hover) {
		.home-recent button:hover {
			background: hsl(var(--at-surface));
		}
	}

	.home-recent button:active {
		background: hsl(var(--at-surface-hover));
	}

	.home-recent button:focus-visible {
		outline: 2px solid hsl(var(--at-emphasis));
		outline-offset: -2px;
		background: hsl(var(--at-surface));
	}

	@container home-recent (max-width: 20rem) {
		.home-recent-legend {
			display: none;
		}
		.home-recent-row {
			grid-template-columns: minmax(0, 1fr) 16px;
			gap: 4px 8px;
		}
		.home-recent-row svg {
			grid-area: 1 / 2 / 3 / 3;
		}
		.home-recent-value {
			grid-area: 2 / 1;
			text-align: left;
		}
		.home-recent-label {
			display: inline;
			margin-right: 4px;
		}
	}

	@media (forced-colors: active) {
		.home-recent-row svg {
			stroke: ButtonText;
		}
		.home-recent button:hover {
			outline: 1px dashed Highlight;
			outline-offset: -2px;
		}
		.home-recent button:active,
		.home-recent button:focus-visible {
			outline: 2px solid Highlight;
			outline-offset: -2px;
		}
	}

	@media (max-width: 640px) {
		.home-card-head {
			padding: 12px 8px 0 16px;
		}
		.home-progress-body,
		.home-chart {
			padding-inline: 16px;
		}
	}
</style>
