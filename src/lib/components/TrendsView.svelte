<script lang="ts">
	import type { Session } from '$lib/session/schema';
	import {
		latestGroup,
		TREND_RANGES,
		timeDomain,
		timeTicks,
		trendGroups,
		valueTicks,
		withinMonths,
		type TrendGroup,
		type TrendPoint
	} from '$lib/session/trends';

	interface Props {
		sessions: Session[];
		currentSessionId: string | null;
		/** Asks for the session's video, as Open… in the list does. */
		onOpen: (session: Session) => void;
	}

	let { sessions, currentSessionId, onOpen }: Props = $props();

	type Kind = 'flight' | 'contact';
	type Dot = { x: number; y: number };
	type Series = {
		kind: Kind;
		height: number;
		ticks: { value: number; y: number }[];
		path: string;
		/** One per point; null where the best jump has no value (a jump without a contact). */
		best: (Dot | null)[];
		jumps: Dot[];
		latest: number | null;
		change: { value: number; since: number } | null;
	};

	const PAD_LEFT = 34;
	const PAD_RIGHT = 10;
	const PAD_TOP = 8;
	const X_AXIS = 22;
	const FLIGHT_HEIGHT = 168;
	const CONTACT_HEIGHT = 128;

	// Ranges count back from when the view opened.
	const now = new Date();

	let groups = $derived(trendGroups(sessions));
	let chosenType: TrendGroup['jumpType'] | 'latest' = $state('latest');
	let group = $derived(
		groups.find((candidate) => candidate.jumpType === chosenType) ?? latestGroup(groups)
	);
	let rangeMonths: number | null = $state(null);
	let everyJump = $state(true);
	let points = $derived(group ? withinMonths(group.points, rangeMonths, now) : []);
	let selectedId: string | null = $state(null);
	let selectedIndex = $derived.by(() => {
		const index = points.findIndex((point) => point.session.id === selectedId);
		return index === -1 ? points.length - 1 : index;
	});
	let selected = $derived(points[selectedIndex] as TrendPoint | undefined);
	let showContact = $derived(
		!!group?.showContact &&
			points.some((point) => point.jumps.some((jump) => jump.contactMs !== null))
	);

	let width = $state(0);
	let domain = $derived(points.length ? timeDomain(points) : [0, 1]);
	let plotWidth = $derived(Math.max(0, width - PAD_LEFT - PAD_RIGHT));
	let xOf = $derived(
		(time: number) => PAD_LEFT + ((time - domain[0]) / (domain[1] - domain[0])) * plotWidth
	);
	let xTicks = $derived(
		points.length ? timeTicks(domain[0], domain[1], Math.max(2, Math.floor(plotWidth / 56))) : []
	);
	// Without a contact panel below, the flight panel carries the date axis.
	let flight = $derived(series('flight', FLIGHT_HEIGHT, showContact ? PAD_TOP / 2 : X_AXIS));
	let contact = $derived(showContact ? series('contact', CONTACT_HEIGHT, X_AXIS) : null);

	function bestValue(point: TrendPoint, kind: Kind): number | null {
		return kind === 'flight' ? point.best.flightMs : point.best.contactMs;
	}

	function jumpValues(point: TrendPoint, kind: Kind): number[] {
		return point.jumps.flatMap((jump) => {
			const value = kind === 'flight' ? jump.flightMs : jump.contactMs;
			return value === null ? [] : [value];
		});
	}

	function series(kind: Kind, height: number, bottom: number): Series {
		// The axis covers every jump, so switching to best jumps only doesn't rescale it.
		const values = points.flatMap((point) => jumpValues(point, kind));
		const ticks = valueTicks(Math.min(...values), Math.max(...values));
		const low = ticks[0];
		const high = ticks[ticks.length - 1];
		const yOf = (value: number) =>
			PAD_TOP + (1 - (value - low) / (high - low)) * (height - PAD_TOP - bottom);
		const best = points.map((point) => {
			const value = bestValue(point, kind);
			return value === null ? null : { x: xOf(point.time), y: yOf(value) };
		});
		const drawn = best.filter((dot) => dot !== null);
		const charted = points.flatMap((point) => {
			const value = bestValue(point, kind);
			return value === null ? [] : [{ value, time: point.time }];
		});
		const first = charted[0];
		const last = charted[charted.length - 1];
		return {
			kind,
			height,
			ticks: ticks.map((value) => ({ value, y: yOf(value) })),
			path: drawn
				.map((dot, i) => `${i ? 'L' : 'M'}${dot.x.toFixed(1)},${dot.y.toFixed(1)}`)
				.join(''),
			best,
			jumps: points.flatMap((point) =>
				jumpValues(point, kind).map((value) => ({ x: xOf(point.time), y: yOf(value) }))
			),
			latest: last ? last.value : null,
			change:
				charted.length > 1
					? { value: Math.round(last.value) - Math.round(first.value), since: first.time }
					: null
		};
	}

	function pick(event: PointerEvent) {
		if (!points.length) return;
		const left = (event.currentTarget as Element).getBoundingClientRect().left;
		const px = event.clientX - left;
		let nearest = 0;
		points.forEach((point, i) => {
			if (Math.abs(xOf(point.time) - px) < Math.abs(xOf(points[nearest].time) - px)) nearest = i;
		});
		selectedId = points[nearest].session.id;
	}

	let plot: HTMLElement | null = $state(null);

	/**
	 * Arrow keys on the chart step through sessions. The dialog calls this from its own
	 * capture-phase key handler, since keys never reach elements inside it.
	 */
	export function handleKey(event: KeyboardEvent): boolean {
		if (!plot || !(event.target instanceof Node) || !plot.contains(event.target)) return false;
		const last = points.length - 1;
		const next =
			event.key === 'ArrowLeft'
				? selectedIndex - 1
				: event.key === 'ArrowRight'
					? selectedIndex + 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? last
							: null;
		if (next === null) return false;
		const point = points[Math.max(0, Math.min(last, next))];
		if (point) selectedId = point.session.id;
		return true;
	}

	// Whole milliseconds: one frame is several ms, so tenths would be false precision.
	function ms(value: number): string {
		return `${Math.round(value)}`;
	}

	function signed(value: number): string {
		return value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';
	}

	function day(time: number, withYear = false): string {
		return new Date(time).toLocaleDateString(undefined, {
			day: 'numeric',
			month: 'short',
			...(withYear ? { weekday: 'short', year: 'numeric' } : {})
		});
	}

	function pointLabel(point: TrendPoint): string {
		const contactText =
			showContact && point.best.contactMs !== null
				? `, contact ${ms(point.best.contactMs)} ms`
				: '';
		return `${day(point.time, true)}: flight ${ms(point.best.flightMs)} ms${contactText}`;
	}
</script>

{#snippet panel(data: Series, xAxis: boolean)}
	<div class="trends-panel-head">
		<span class="trends-panel-name"
			><span class="trends-swatch {data.kind}"></span>{data.kind === 'flight'
				? 'Flight time'
				: 'Contact time'}</span
		>
		{#if data.latest !== null}
			<span class="trends-panel-value">
				<b>{ms(data.latest)}<small>ms</small></b>
				{#if data.change}<span class="trends-change"
						>{signed(data.change.value)} since {day(data.change.since)}</span
					>{/if}
			</span>
		{/if}
	</div>
	<svg
		class="trends-svg {data.kind}"
		{width}
		height={data.height}
		viewBox="0 0 {width} {data.height}"
		aria-hidden="true"
		onpointermove={pick}
		onpointerdown={pick}
	>
		{#each data.ticks as tick (tick.value)}
			<line class="trends-grid" x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={tick.y} y2={tick.y} />
			<text class="trends-tick" x={PAD_LEFT - 6} y={tick.y + 3.5} text-anchor="end"
				>{tick.value}</text
			>
		{/each}
		{#if xAxis}
			<line
				class="trends-axis"
				x1={PAD_LEFT}
				x2={width - PAD_RIGHT}
				y1={data.height - X_AXIS}
				y2={data.height - X_AXIS}
			/>
			{#each xTicks as tick (tick.time)}
				<text class="trends-tick" x={xOf(tick.time)} y={data.height - 6} text-anchor="middle"
					>{tick.label}</text
				>
			{/each}
		{/if}
		{#if selected}
			<line
				class="trends-cursor"
				x1={xOf(selected.time)}
				x2={xOf(selected.time)}
				y1={PAD_TOP - 4}
				y2={data.height - (xAxis ? X_AXIS : 0)}
			/>
		{/if}
		{#if everyJump}
			{#each data.jumps as dot, i (i)}
				<circle class="trends-jump" cx={dot.x} cy={dot.y} r="2.5" />
			{/each}
		{/if}
		<path class="trends-line" d={data.path} />
		{#each data.best as dot, i (i)}
			{#if dot}
				<circle
					class="trends-dot"
					class:active={i === selectedIndex}
					cx={dot.x}
					cy={dot.y}
					r={i === selectedIndex ? 5.5 : 3.5}
				/>
			{/if}
		{/each}
	</svg>
{/snippet}

<div class="trends">
	{#if !group}
		<div class="trends-empty">
			<p class="trends-empty-title">Nothing to chart yet</p>
			<p>
				Trends show each saved session's best jump on the date it was recorded. Save a session with
				at least one takeoff and landing to start.
			</p>
		</div>
	{:else}
		<div class="trends-controls">
			{#if groups.length > 1}
				<div class="trends-toggles" role="group" aria-label="Jump type">
					{#each groups as candidate (candidate.jumpType)}
						<button
							aria-pressed={candidate === group}
							onclick={() => {
								chosenType = candidate.jumpType;
								selectedId = null;
							}}>{candidate.label}<small>{candidate.points.length}</small></button
						>
					{/each}
				</div>
			{:else}
				<span class="trends-type">{group.label}<small>{group.points.length}</small></span>
			{/if}
		</div>
		<div class="trends-controls">
			<div class="trends-toggles" role="group" aria-label="Jumps shown">
				<button aria-pressed={!everyJump} onclick={() => (everyJump = false)}>Best jump</button>
				<button aria-pressed={everyJump} onclick={() => (everyJump = true)}>Every jump</button>
			</div>
			<div class="trends-toggles" role="group" aria-label="Date range">
				{#each TREND_RANGES as range (range.label)}
					<button
						aria-pressed={rangeMonths === range.months}
						onclick={() => {
							rangeMonths = range.months;
							selectedId = null;
						}}>{range.label}</button
					>
				{/each}
			</div>
		</div>

		{#if points.length === 0}
			<div class="trends-empty">
				<p>
					No {group.label.toLowerCase()} sessions in the last {rangeMonths === 12
						? 'year'
						: `${rangeMonths} months`}.
				</p>
				<button class="link-btn" onclick={() => (rangeMonths = null)}>Show all</button>
			</div>
		{:else}
			<div
				class="trends-plot"
				bind:this={plot}
				bind:clientWidth={width}
				role="slider"
				tabindex="0"
				aria-label="Session"
				aria-valuemin={1}
				aria-valuemax={points.length}
				aria-valuenow={selectedIndex + 1}
				aria-valuetext={selected ? pointLabel(selected) : undefined}
			>
				{#if width > 0}
					{@render panel(flight, !showContact)}
					{#if contact}{@render panel(contact, true)}{/if}
				{/if}
			</div>

			{#if selected}
				<div class="trends-detail">
					<div class="trends-detail-head">
						<span class="trends-detail-date">{day(selected.time, true)}</span>
						<span class="trends-detail-title">{selected.session.title}</span>
						{#if selected.session.id === currentSessionId}
							<span class="trends-current">Current</span>
						{:else}
							<button
								class="text-btn"
								onclick={() => selected && onOpen(selected.session)}
								title="Choose {selected.session.media.fileName} to reopen its marks">Open…</button
							>
						{/if}
					</div>
					<div class="trends-detail-values">
						<span
							><span class="trends-swatch flight"></span>Flight
							<b>{ms(selected.best.flightMs)}</b> ms</span
						>
						{#if showContact}
							<span
								><span class="trends-swatch contact"></span>Contact
								<b>{selected.best.contactMs === null ? '—' : ms(selected.best.contactMs)}</b> ms</span
							>
						{/if}
						<span><b>{selected.best.heightCm.toFixed(1)}</b> cm</span>
						{#if selected.jumps.length > 1}
							<span class="trends-detail-count">best of {selected.jumps.length} jumps</span>
						{/if}
					</div>
				</div>
			{/if}

			<!-- A table can't shrink to sr-only's 1px, so a wrapper hides it. -->
			<div class="sr-only">
				<table>
					<caption>{group.label}: best jump per session</caption>
					<thead>
						<tr>
							<th scope="col">Recorded</th>
							<th scope="col">Session</th>
							<th scope="col">Flight (ms)</th>
							{#if showContact}<th scope="col">Contact (ms)</th>{/if}
							<th scope="col">Height (cm)</th>
						</tr>
					</thead>
					<tbody>
						{#each points as point (point.session.id)}
							<tr>
								<td>{day(point.time, true)}</td>
								<td>{point.session.title}</td>
								<td>{ms(point.best.flightMs)}</td>
								{#if showContact}<td
										>{point.best.contactMs === null ? '—' : ms(point.best.contactMs)}</td
									>{/if}
								<td>{point.best.heightCm.toFixed(1)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* The takeoff and landing hues, darkened so lines and dots sit evenly on the dark surface. */
	.trends {
		--trend-flight: hsl(168 76% 37%);
		--trend-contact: hsl(31 72% 47%);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.trends-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 16px;
	}

	.trends-toggles {
		display: flex;
		gap: 14px;
	}

	.trends-toggles button,
	.trends-type {
		min-height: 28px;
		padding: 0;
		border: none;
		background: none;
		color: hsl(var(--at-fg-muted));
		font: inherit;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
	}

	.trends-type {
		display: inline-flex;
		align-items: center;
		color: hsl(var(--at-fg));
		cursor: default;
	}

	.trends-toggles button:hover {
		color: hsl(var(--at-fg-secondary));
	}

	.trends-toggles button[aria-pressed='true'] {
		color: hsl(var(--at-fg));
		box-shadow: inset 0 -1px 0 hsl(var(--at-fg) / 0.85);
	}

	.trends-toggles small,
	.trends-type small {
		margin-left: 4px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.trends-plot {
		display: flex;
		flex-direction: column;
		margin: 0 -4px;
		padding: 0 4px;
		border-radius: 8px;
		outline: none;
	}

	.trends-plot:focus-visible {
		box-shadow: 0 0 0 2px hsl(var(--at-accent) / 0.6);
	}

	.trends-panel-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin-top: 6px;
		color: hsl(var(--at-fg-secondary));
		font-size: 12px;
	}

	.trends-panel-value b {
		color: hsl(var(--at-fg));
		font-size: 17px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.trends-panel-value small {
		margin-left: 2px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-weight: 500;
	}

	.trends-change {
		margin-left: 6px;
		color: hsl(var(--at-fg-muted));
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.trends-swatch {
		display: inline-block;
		width: 10px;
		height: 2px;
		margin-right: 6px;
		border-radius: 1px;
		vertical-align: middle;
	}

	.trends-swatch.flight,
	.trends-svg.flight {
		--series: var(--trend-flight);
	}

	.trends-swatch.contact,
	.trends-svg.contact {
		--series: var(--trend-contact);
	}

	.trends-swatch {
		background: var(--series);
	}

	.trends-svg {
		display: block;
		overflow: visible;
		/* Vertical drags still scroll the dialog; horizontal ones scrub through sessions. */
		touch-action: pan-y;
		cursor: crosshair;
	}

	.trends-grid {
		stroke: hsl(var(--at-fg) / 0.22);
		stroke-dasharray: 1 4;
	}

	.trends-axis {
		stroke: hsl(var(--at-border-hover));
	}

	.trends-tick {
		fill: hsl(var(--at-fg-muted));
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.trends-cursor {
		stroke: hsl(var(--at-fg) / 0.3);
	}

	.trends-jump {
		fill: var(--series);
		opacity: 0.38;
	}

	.trends-line {
		fill: none;
		stroke: var(--series);
		stroke-width: 2;
		stroke-linejoin: round;
	}

	.trends-dot {
		fill: var(--series);
		stroke: hsl(var(--at-popover));
		stroke-width: 2;
	}

	.trends-detail {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: 10px;
		background: hsl(var(--at-surface));
		font-size: 12px;
	}

	.trends-detail-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
	}

	.trends-detail-date {
		flex: 0 0 auto;
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.trends-detail-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: hsl(var(--at-fg-muted));
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.trends-current {
		flex: 0 0 auto;
		padding: 2px 7px;
		border: 1px solid hsl(var(--at-border-hover));
		border-radius: 6px;
		color: hsl(var(--at-fg-secondary));
		font-size: 11px;
		font-weight: 500;
	}

	.trends-detail-values {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		color: hsl(var(--at-fg-secondary));
		font-variant-numeric: tabular-nums;
	}

	.trends-detail-values b {
		color: hsl(var(--at-fg));
		font-weight: 600;
	}

	.trends-detail-count {
		color: hsl(var(--at-fg-muted));
	}

	.text-btn {
		flex: 0 0 auto;
		height: 30px;
		margin: -4px -6px -4px 0;
		padding: 0 10px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: hsl(var(--at-fg-secondary));
		font: inherit;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
	}

	.text-btn:hover {
		background: hsl(var(--at-surface-hover));
		color: hsl(var(--at-fg));
	}

	.trends-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 32px 0;
		color: hsl(var(--at-fg-muted));
		font-size: 13px;
		text-align: center;
	}

	.trends-empty-title {
		color: hsl(var(--at-fg));
		font-size: 14px;
		font-weight: 600;
	}

	.link-btn {
		padding: 0;
		border: none;
		background: none;
		color: hsl(var(--at-accent-hover));
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	@media (pointer: coarse) {
		.trends-toggles button,
		.text-btn {
			min-height: 44px;
		}
	}
</style>
