import { describe, expect, test } from 'vitest';
import { FAST_PX_PER_MS, FINE_PX_PER_FRAME, SLOW_PX_PER_MS, framesPerPx } from './fineScrub';

// A phone's bar, about 340 px wide, and a short clip.
const WIDTH = 340;

describe('framesPerPx', () => {
	test('a slow drag steps a frame every few pixels at any frame rate', () => {
		for (const fps of [30, 60, 240]) {
			expect(1 / framesPerPx(0, fps, fps * 4, WIDTH)).toBeCloseTo(FINE_PX_PER_FRAME, 9);
			expect(1 / framesPerPx(SLOW_PX_PER_MS, fps, fps * 4, WIDTH)).toBeCloseTo(
				FINE_PX_PER_FRAME,
				9
			);
		}
	});

	test('a quick swipe across the bar covers more than a second at any frame rate', () => {
		for (const fps of [30, 60, 120, 240]) {
			const frames = framesPerPx(FAST_PX_PER_MS, fps, fps * 4, WIDTH) * WIDTH;
			expect(frames / fps).toBeGreaterThan(1);
		}
	});

	test('a quick swipe across the bar covers a long clip end to end', () => {
		const frameCount = 60 * 30;
		expect(framesPerPx(2, 30, frameCount, WIDTH) * WIDTH).toBeCloseTo(frameCount, 9);
	});

	test('speeding up never slows the playhead', () => {
		let previous = 0;
		for (let speed = 0; speed <= 1.2; speed += 0.05) {
			const rate = framesPerPx(speed, 240, 960, WIDTH);
			expect(rate).toBeGreaterThanOrEqual(previous);
			previous = rate;
		}
	});

	test('a clip of unknown length still scrubs', () => {
		expect(framesPerPx(FAST_PX_PER_MS, 30, Infinity, WIDTH)).toBeCloseTo(30 / 160, 9);
	});
});
