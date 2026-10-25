import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseVideoTiming } from './frameRate';
import {
	clampFrame,
	frameAt,
	frameDurationRange,
	frameLabel,
	frameOfMarkTime,
	frameOfPresentedTime,
	frameSeekTime,
	frameStartTime,
	lastFrameIndex,
	markFrameStart,
	snapToFrameStart,
	type FrameTiming
} from './frames';
import { analyzeMarks, frameOf, markAtFrame, placeMark, type Mark } from './marks';
import { formatTimecode } from './timecode';
// What ffprobe reports for each fixture; see fixtures/README.md.
import ffprobe from './fixtures/ffprobe.json';

const RATES: [string, number][] = [
	['24', 24],
	['25', 25],
	['29.97', 30000 / 1001],
	['29.97 (rounded)', 29.97],
	['30', 30],
	['59.94', 60000 / 1001],
	['59.94 (rounded)', 59.94],
	['60', 60],
	['120', 120],
	['240', 240]
];

// Every frame of a 10-minute clip at the highest rate is plenty to catch float drift.
const frames = (fps: number) => Array.from({ length: Math.ceil(fps * 600) }, (_, k) => k);

describe.each(RATES)('%s fps', (_label, fps) => {
	test('a frame start maps back to its own frame', () => {
		for (const k of frames(fps)) expect(frameAt(frameStartTime(k, fps), fps)).toBe(k);
	});

	test('a seek lands on the frame it was aimed at', () => {
		for (const k of frames(fps)) expect(frameAt(frameSeekTime(k, fps), fps)).toBe(k);
	});

	test('start, middle and end of a frame all map to that frame', () => {
		for (const k of [0, 1, 7, 100, 1799]) {
			expect(frameAt(k / fps, fps)).toBe(k);
			expect(frameAt((k + 0.5) / fps, fps)).toBe(k);
			expect(frameAt((k + 0.99) / fps, fps)).toBe(k);
			expect(frameAt((k + 1) / fps, fps)).toBe(k + 1);
		}
	});

	test('a playhead paused just past halfway stays on the frame shown', () => {
		// Math.round would report k + 1 here.
		expect(frameAt((42 + 0.6) / fps, fps)).toBe(42);
	});

	test('times rounded for export still map to their frame', () => {
		for (const k of frames(fps)) {
			const exported = Math.round(frameStartTime(k, fps) * 1e6) / 1e6;
			expect(frameAt(exported, fps)).toBe(k);
		}
	});

	test('presented media times map to the frame whose seek shows them', () => {
		for (const k of [0, 1, 59, 1000]) {
			expect(frameOfPresentedTime(k / fps, fps)).toBe(k);
			// Browsers report media time to the microsecond.
			expect(frameOfPresentedTime(Math.floor((k / fps) * 1e6) / 1e6, fps)).toBe(k);
		}
	});

	test('the last frame is reachable and a seek to it stays inside the clip', () => {
		const count = Math.round(4 * fps);
		const duration = count / fps;
		const last = lastFrameIndex(duration, fps);
		expect(last).toBe(count - 1);
		expect(frameSeekTime(last, fps, duration)).toBeLessThan(duration);
		expect(frameAt(frameSeekTime(last, fps, duration), fps)).toBe(last);
		expect(clampFrame(last + 1, duration, fps)).toBe(last);
	});

	test('marks are stored at the frame start of the frame on screen', () => {
		const [mark] = placeMark([], 'takeoff', (12 + 0.7) / fps, fps);
		expect(mark.time).toBe(frameStartTime(12, fps));
		expect(frameOf(mark.time, fps)).toBe(12);
	});
});

describe('edge cases', () => {
	test('times before zero, NaN and a missing rate map to frame 0', () => {
		expect(frameAt(-0.01, 60)).toBe(0);
		expect(frameAt(Number.NaN, 60)).toBe(0);
		expect(frameAt(1, 0)).toBe(0);
		expect(frameOfPresentedTime(-1, 60)).toBe(0);
	});

	test('a time a hair short of a frame start counts as that frame', () => {
		// Classic float error: 0.1 + 0.2 > 0.3, and 3 * (1/30) < 0.1.
		expect(frameAt(3 * (1 / 30), 30)).toBe(3);
		expect(frameAt(0.30000000000000004, 10)).toBe(3);
		expect(frameAt(1 / 60 - 1e-9, 60)).toBe(1);
	});

	test('a time well before a frame start is still the previous frame', () => {
		expect(frameAt(1 / 60 - 0.01 / 60, 60)).toBe(0);
	});

	test('a duration that is not a whole number of frames keeps its partial last frame', () => {
		// 3.630013 s at 60 fps is 217.8 frames: frames 0..217.
		expect(lastFrameIndex(3.630013, 60)).toBe(217);
		expect(frameSeekTime(217, 60, 3.630013)).toBeLessThanOrEqual(3.630013);
	});

	test('an unknown duration does not clamp', () => {
		expect(lastFrameIndex(Number.NaN, 60)).toBe(Infinity);
		expect(lastFrameIndex(0, 60)).toBe(Infinity);
		expect(lastFrameIndex(Infinity, 60)).toBe(Infinity);
		expect(clampFrame(500, Number.NaN, 60)).toBe(500);
		expect(clampFrame(-3, Number.NaN, 60)).toBe(0);
	});

	test('a seek to a frame before 0 goes to frame 0', () => {
		expect(frameSeekTime(-2, 60)).toBe(0.5 / 60);
	});

	test('snapToFrameStart is idempotent', () => {
		const once = snapToFrameStart(1.2345, 59.94);
		expect(snapToFrameStart(once, 59.94)).toBe(once);
	});

	test('frames 1000s into a 240 fps clip still round-trip', () => {
		const k = 240 * 1000 + 17;
		expect(frameAt(frameStartTime(k, 240), 240)).toBe(k);
		expect(frameAt(frameSeekTime(k, 240), 240)).toBe(k);
	});

	test('the timecode readout shows the frame on screen, not the next one', () => {
		expect(formatTimecode((5 + 0.5) / 60, 60)).toBe('00:00:00:05');
		expect(formatTimecode((5 + 0.9) / 60, 60)).toBe('00:00:00:05');
		expect(formatTimecode(1, 60)).toBe('00:00:01:00');
	});
});

// ---- With a timing table (the time of every frame, read from the file) ----

function fixtureTiming(name: string): FrameTiming {
	const bytes = Uint8Array.from(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
	const timing = parseVideoTiming(bytes.buffer as ArrayBuffer);
	if (!timing) throw new Error(`${name} did not parse`);
	return { fps: timing.fps, frameTimes: timing.frameTimes };
}

const truth = ffprobe as Record<string, { frameTimes: number[] }>;
const FIXTURES = Object.keys(truth);

/**
 * What a browser does: shows the last frame that starts at or before the playhead,
 * or the first frame before it starts, and reports its media time.
 */
function presentedAt(timing: FrameTiming, time: number): number {
	const times = timing.frameTimes!;
	let shown = times[0];
	for (const start of times) if (start <= time) shown = start;
	return shown;
}

/** Steps from frame 0 to the end the way the app does; returns every frame shown. */
function stepThrough(timing: FrameTiming, duration: number, mediaTimeError = 0): number[] {
	const visited = [0];
	let frame = 0;
	for (let guard = 0; guard < 10_000; guard += 1) {
		const next = clampFrame(frame + 1, duration, timing);
		if (next === frame) break;
		const seek = frameSeekTime(next, timing, duration);
		const shown = frameOfPresentedTime(presentedAt(timing, seek) + mediaTimeError, timing);
		// trackPresentedFrames would correct the playhead if these disagreed.
		expect(frameAt(seek, timing)).toBe(shown);
		visited.push(shown);
		frame = shown;
	}
	return visited;
}

/** 240 fps slots with bursts of dropped pairs, like an iPhone clip averaging ~177 fps. */
function droppedSlotTimes(frames: number): number[] {
	const times: number[] = [];
	let slot = 0;
	for (let k = 0; k < frames; k += 1) {
		times.push(slot / 240);
		// After every third frame in frames 6-60 and 120-200, skip two slots.
		const inBurst = (k >= 6 && k < 60) || (k >= 120 && k < 200);
		slot += inBurst && k % 3 === 0 ? 3 : 1;
	}
	return times;
}

describe.each(FIXTURES)('%s with its timing table', (name) => {
	const timing = fixtureTiming(name);
	const times = timing.frameTimes!;
	const last = times.length - 1;
	const expected = truth[name].frameTimes;

	test('frame index is the table index', () => {
		for (let k = 0; k <= last; k += 1) {
			expect(frameStartTime(k, timing)).toBe(times[k]);
			expect(frameAt(times[k], timing)).toBe(k);
			// ffprobe prints microseconds, so its times can sit a hair before the frame start.
			expect(frameOfMarkTime(expected[k], timing)).toBe(k);
		}
	});

	test('a seek lands strictly inside the frame it was aimed at', () => {
		for (let k = 0; k <= last; k += 1) {
			const seek = frameSeekTime(k, timing);
			expect(seek).toBeGreaterThan(times[k]);
			if (k < last) expect(seek).toBeLessThan(times[k + 1]);
			expect(frameAt(seek, timing)).toBe(k);
			expect(frameOfPresentedTime(presentedAt(timing, seek), timing)).toBe(k);
		}
	});

	test('presented media times map to their frame despite float error', () => {
		for (let k = 0; k <= last; k += 1) {
			expect(frameOfPresentedTime(expected[k], timing)).toBe(k);
			expect(frameOfPresentedTime(times[k] + 1e-5, timing)).toBe(k);
			expect(frameOfPresentedTime(times[k] - 1e-5, timing)).toBe(k);
		}
	});

	test('stepping forward visits every frame in order', () => {
		const visited = stepThrough(timing, Number.NaN);
		expect(visited).toEqual(times.map((_, k) => k));
	});

	test('the last frame is the last table entry, whatever the duration says', () => {
		for (const duration of [Number.NaN, 0, times[last] - 0.01, times[last] + 1]) {
			expect(lastFrameIndex(duration, timing)).toBe(last);
			expect(clampFrame(last + 3, duration, timing)).toBe(last);
			expect(clampFrame(-1, duration, timing)).toBe(0);
		}
		// With the true duration the seek stays inside the clip.
		const duration = times[last] + 1 / timing.fps;
		expect(frameSeekTime(last, timing, duration)).toBeLessThan(duration);
		expect(frameSeekTime(last, timing, duration)).toBeGreaterThan(times[last]);
	});

	test('marks saved before the table map to the frame the app showed for them', () => {
		// The old app stored round(mediaTime × fps) / fps for the frame on screen.
		const fps = timing.fps;
		for (let k = 0; k <= last; k += 1) {
			const saved = Math.round(times[k] * fps) / fps;
			expect(frameAt((Math.round(saved * fps) + 0.5) / fps, timing)).toBe(k);
			expect(frameOfMarkTime(saved, timing)).toBe(k);
		}
	});

	test('exports, which only know the rate, give a mark its grid frame', () => {
		for (let k = 0; k <= last; k += 1) {
			expect(frameOfMarkTime(times[k], timing.fps)).toBe(Math.round(times[k] * timing.fps));
			if (!name.startsWith('vfr') && !name.startsWith('empty')) {
				expect(frameOfMarkTime(times[k], timing.fps)).toBe(k);
			}
		}
	});

	test('the first frame is labelled 0', () => {
		expect(frameLabel(0, timing)).toBe(0);
		expect(formatTimecode(times[0], timing)).toMatch(/^00:00:00[:;]000?$/);
	});
});

describe('variable frame rate: vfr-dropped.mp4 (frames 5-7 of 30 fps dropped)', () => {
	const timing = fixtureTiming('vfr-dropped.mp4');

	test('the gap belongs to the frame before it', () => {
		// Frame 4 starts at 4/30 and lasts until frame 5 at 8/30.
		for (const time of [5 / 30, 6 / 30, 7 / 30, 8 / 30 - 0.001])
			expect(frameAt(time, timing)).toBe(4);
		expect(frameAt(8 / 30, timing)).toBe(5);
		expect(frameSeekTime(4, timing)).toBeCloseTo(6 / 30, 9);
	});

	test('timecodes follow real time and skip the dropped frames', () => {
		expect(frameLabel(4, timing)).toBe(4);
		expect(frameLabel(5, timing)).toBe(8);
		expect(formatTimecode(frameSeekTime(5, timing), timing)).toBe('00:00:00:08');
	});

	test('the frame range covers the gap', () => {
		const [shortest, longest] = frameDurationRange(timing)!;
		expect(shortest).toBeCloseTo(1 / 30, 4);
		expect(longest).toBeCloseTo(4 / 30, 4);
	});

	test('marks saved on the 30 fps grid map to the frame that was shown', () => {
		// Before the table, the app sought to (k + 0.5) / 30 and stored k / 30. In the gap
		// that showed frame 4.
		for (const k of [4, 5, 6, 7]) expect(frameOfMarkTime(k / 30, timing)).toBe(4);
		expect(frameOfMarkTime(8 / 30, timing)).toBe(5);
		expect(frameOfMarkTime(11 / 30, timing)).toBe(8);
	});

	test('marks are stored at real frame starts and durations use them', () => {
		let marks: Mark[] = [];
		marks = placeMark(marks, 'takeoff', frameSeekTime(3, timing), timing);
		marks = placeMark(marks, 'landing', frameSeekTime(6, timing), timing);
		expect(marks.map((mark) => mark.time)).toEqual([timing.frameTimes![3], timing.frameTimes![6]]);
		const [flight] = analyzeMarks(marks, timing).intervals;
		expect(flight.frames).toBe(3);
		// 3 frames, but 6 frame slots of real time: 0.1 s to 0.3 s.
		expect(flight.seconds).toBeCloseTo(0.2, 6);
		expect(markAtFrame(marks, frameSeekTime(6, timing), timing)?.type).toBe('landing');
		expect(markAtFrame(marks, frameSeekTime(5, timing), timing)).toBeUndefined();
	});

	test('a mark saved on a grid slot is measured from the frame it refers to', () => {
		// Takeoff saved in the gap at 6/30 (frame 4, which starts at 4/30).
		const marks: Mark[] = [
			{ id: 'a', type: 'takeoff', time: 6 / 30 },
			{ id: 'b', type: 'landing', time: 9 / 30 }
		];
		expect(markFrameStart(6 / 30, timing)).toBeCloseTo(4 / 30, 6);
		const [flight] = analyzeMarks(marks, timing).intervals;
		expect(flight.frames).toBe(2);
		expect(flight.seconds).toBeCloseTo(5 / 30, 6);
	});
});

describe('240 fps with dropped slots (like an iPhone clip averaging ~177 fps)', () => {
	const timing: FrameTiming = { fps: 240, frameTimes: droppedSlotTimes(424) };
	const times = timing.frameTimes!;
	const duration = times.at(-1)! + 1 / 240;

	test('stepping visits every frame, even with WebKit-sized media time error', () => {
		const all = times.map((_, k) => k);
		expect(stepThrough(timing, duration)).toEqual(all);
		expect(stepThrough(timing, duration, 3e-6)).toEqual(all);
		expect(stepThrough(timing, duration, -3e-6)).toEqual(all);
	});

	test('the old 1/240 grid would seek into gaps', () => {
		// Frame 7 starts 3 slots after frame 6: (7 + 0.5) / 240 still shows frame 6.
		expect(times[7] - times[6]).toBeCloseTo(3 / 240, 9);
		expect(frameAt((7 + 0.5) / 240, timing)).toBe(6);
		expect(frameSeekTime(7, timing)).toBeGreaterThan(times[7]);
	});

	test('stepping backward visits every frame', () => {
		let frame = times.length - 1;
		while (frame > 0) {
			const next = clampFrame(frame - 1, duration, timing);
			const shown = frameOfPresentedTime(
				presentedAt(timing, frameSeekTime(next, timing, duration)),
				timing
			);
			expect(shown).toBe(frame - 1);
			frame = shown;
		}
	});
});

describe('marks saved before the table, on timestamps rounded to 600 ticks/s', () => {
	// 240 fps at 600 ticks/s: frames 2 and 3 ticks long, so frame k can start up to
	// 0.83 ms after k / 240.
	const timing = fixtureTiming('slomo240-ts600.mov');

	test('k / 240 maps to frame k, as the old seek to (k + 0.5) / 240 showed', () => {
		const late = timing.frameTimes!.findIndex((time, k) => time > k / 240 + 1e-6);
		expect(late).toBeGreaterThan(0);
		// Flooring the time alone would give the previous frame.
		expect(frameAt(late / 240, timing)).toBe(late - 1);
		for (let k = 0; k < timing.frameTimes!.length; k += 1) {
			expect(frameOfMarkTime(k / 240, timing)).toBe(k);
		}
	});
});

describe('slow motion with a visible 30 fps pre-roll', () => {
	// 22 frames at 30 fps, then 240 fps, as iPhones record slow motion.
	const frameTimes = [
		...Array.from({ length: 22 }, (_, k) => k / 30),
		...Array.from({ length: 60 }, (_, k) => 22 / 30 + k / 240)
	];
	const timing: FrameTiming = { fps: 240, frameTimes };

	test('each pre-roll frame is one step', () => {
		expect(stepThrough(timing, Number.NaN)).toEqual(frameTimes.map((_, k) => k));
		expect(frameAt(0.5 / 30, timing)).toBe(0);
		expect(frameAt(21.9 / 30, timing)).toBe(21);
		expect(frameAt(22 / 30 + 1.5 / 240, timing)).toBe(23);
	});
});

describe('without a table', () => {
	test('a timing object with no times behaves like the bare rate', () => {
		for (const frameTimes of [null, undefined, []]) {
			const timing: FrameTiming = { fps: 60, frameTimes };
			expect(frameAt(1.25, timing)).toBe(frameAt(1.25, 60));
			expect(frameSeekTime(75, timing, 3)).toBe(frameSeekTime(75, 60, 3));
			expect(frameOfPresentedTime(1.25, timing)).toBe(75);
			expect(lastFrameIndex(3, timing)).toBe(179);
			expect(frameOfMarkTime(1.25, timing)).toBe(75);
			expect(markFrameStart(1.2501, timing)).toBe(1.2501);
			expect(frameLabel(75, timing)).toBe(75);
			expect(frameDurationRange(timing)).toBeNull();
		}
	});
});
