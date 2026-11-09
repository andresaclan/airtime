import { describe, expect, test } from 'vitest';
import { pictureBox } from './pictureBox';

describe('pictureBox', () => {
	test('a 9:16 phone video in a stretched landscape element keeps its own shape, centred', () => {
		// Safari stretches the element across the space and letterboxes the picture.
		const box = pictureBox(
			{ width: 400, height: 300 },
			{ width: 400, height: 300 },
			{ width: 1080, height: 1920 }
		);
		expect(box.height).toBeCloseTo(300);
		expect(box.width).toBeCloseTo(168.75);
		expect(box.width / box.height).toBeCloseTo(1080 / 1920);
		expect(box.left).toBeCloseTo((400 - 168.75) / 2);
		expect(box.top).toBeCloseTo(0);
	});

	test('a 16:9 video in a tall element is letterboxed top and bottom', () => {
		const box = pictureBox(
			{ width: 390, height: 700 },
			{ width: 390, height: 700 },
			{ width: 1920, height: 1080 }
		);
		expect(box.width).toBeCloseTo(390);
		expect(box.height).toBeCloseTo(219.375);
		expect(box.left).toBeCloseTo(0);
		expect(box.top).toBeCloseTo((700 - 219.375) / 2);
	});

	test('an element already the picture’s shape is centred in a larger container', () => {
		const box = pictureBox(
			{ width: 1000, height: 800 },
			{ width: 450, height: 800 },
			{ width: 1080, height: 1920 }
		);
		expect(box).toEqual({ left: 275, top: 0, width: 450, height: 800 });
	});

	test('before the metadata loads, the element box stands in', () => {
		expect(
			pictureBox({ width: 500, height: 400 }, { width: 300, height: 200 }, { width: 0, height: 0 })
		).toEqual({ left: 100, top: 100, width: 300, height: 200 });
	});
});
