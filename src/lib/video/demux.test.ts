import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseVideoTrack } from './demux';
import { parseVideoTiming } from './frameRate';
// What ffprobe reports for each fixture's video packets; see fixtures/README.md.
import packets from './fixtures/packets.json';

function fixture(name: string): ArrayBuffer {
	const file = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
	return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('parseVideoTrack', () => {
	test.each(Object.entries(packets))('%s: samples match ffprobe', (name, expected) => {
		const track = parseVideoTrack(fixture(name));
		expect(track).not.toBeNull();
		expect(track!.samples.map((sample) => sample.size)).toEqual(expected.size);
		expect(track!.samples.map((sample) => sample.offset)).toEqual(expected.pos);
		expect(track!.samples.flatMap((sample, i) => (sample.key ? [i] : []))).toEqual(
			expected.keyframes
		);
	});

	test.each(Object.keys(packets))('%s: samples map onto the frame table', (name) => {
		const track = parseVideoTrack(fixture(name))!;
		const timing = parseVideoTiming(fixture(name))!;
		expect(track.frameCount).toBe(timing.frameCount);
		// Every frame that plays comes from exactly one sample.
		const frames = track.samples.map((sample) => sample.frame).filter((frame) => frame >= 0);
		expect([...frames].sort((a, b) => a - b)).toEqual(
			Array.from({ length: timing.frameCount }, (_, k) => k)
		);
		// And in presentation order: a later frame has a later composition time.
		const ctsOfFrame = new Map(track.samples.map((sample) => [sample.frame, sample.cts]));
		for (let k = 1; k < timing.frameCount; k += 1) {
			expect(ctsOfFrame.get(k)!).toBeGreaterThan(ctsOfFrame.get(k - 1)!);
		}
	});

	test('samples hidden by an edit list show no frame', () => {
		const track = parseVideoTrack(fixture('slomo240-preroll.mov'))!;
		expect(track.samples.filter((sample) => sample.frame < 0)).toHaveLength(84 - 61);
	});

	test('H.264: codec string from avcC', () => {
		const track = parseVideoTrack(fixture('bframes.mp4'))!;
		expect(track.codec).toBe('avc1.64000a');
		expect(track.description[0]).toBe(1);
		expect([track.codedWidth, track.codedHeight]).toEqual([16, 16]);
		expect(track.rotation).toBe(0);
	});

	test('HEVC: codec string from hvcC, and the rotation from tkhd', () => {
		const track = parseVideoTrack(fixture('hevc-rotated.mov'))!;
		// Main profile, compatible with Main and Main 10, level 1, progressive and frame-only.
		expect(track.codec).toBe('hvc1.1.6.L30.90');
		expect([track.codedWidth, track.codedHeight]).toEqual([64, 48]);
		// ffmpeg's -display_rotation 90 is counterclockwise: a quarter turn back clockwise.
		expect(track.rotation).toBe(270);
	});

	test('not an MP4', () => {
		expect(parseVideoTrack(new TextEncoder().encode('not a video').buffer)).toBeNull();
	});
});
