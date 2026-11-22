/**
 * Runs the web app's own TypeScript on the shared fixtures and writes what it computes to
 * Tests/AirtimeKitTests/golden.json. The Swift tests check the port against it, so the two
 * apps can't drift apart silently. Regenerate with `bun macos/scripts/golden.ts` from the repo
 * root whenever the web app's frame, mark or export logic changes.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVideoTiming, readMoov } from '../../src/lib/video/frameRate';
import { fingerprintFile } from '../../src/lib/session/fingerprint';
import { analyzeMarks, groupJumps, type Mark } from '../../src/lib/video/marks';
import { jumpUnits } from '../../src/lib/video/jumpUnits';
import { markAction } from '../../src/lib/video/guide';
import { buildExport, parseImport } from '../../src/lib/session/exportFile';
import { trendGroups } from '../../src/lib/session/trends';
import type { JumpType } from '../../src/lib/session/schema';

const root = join(import.meta.dir, '../..');
const dirs = ['src/lib/video/fixtures', 'tests/frame-stepping/fixtures'];

const videos: Record<string, unknown> = {};
for (const dir of dirs) {
	for (const name of readdirSync(join(root, dir)).filter((n) => /\.(mp4|mov)$/i.test(n))) {
		const path = join(root, dir, name);
		const file = new File([readFileSync(path)], name);
		const moov = await readMoov(file);
		const timing = moov ? parseVideoTiming(moov) : null;
		videos[`${dir}/${name}`] = {
			fingerprint: await fingerprintFile(file),
			timing: timing && {
				fps: timing.fps,
				measuredFps: timing.measuredFps,
				variableFrameRate: timing.variableFrameRate,
				editGap: timing.editGap,
				frameTimes: timing.frameTimes
			}
		};
	}
}

// Deterministic pseudo-random mark sequences, on a few timings, for every jump type.
let seed = 42;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const vfr = videos['src/lib/video/fixtures/vfr-dropped.mp4'] as {
	timing: { fps: number; frameTimes: number[] };
};
const timings = [
	{ name: 'rate30', timing: 30 },
	{ name: 'rate240', timing: 240 },
	{ name: 'vfr', timing: { fps: vfr.timing.fps, frameTimes: vfr.timing.frameTimes } }
];
const jumpTypes: (JumpType | null)[] = ['approach', 'drop-jump', 'repeat-hops', null];
const markCases = [];
for (let n = 0; n < 160; n += 1) {
	const t = timings[n % timings.length];
	const jumpType = jumpTypes[Math.floor(n / timings.length) % jumpTypes.length];
	const frames = typeof t.timing === 'number' ? 120 : t.timing.frameTimes.length;
	const count = Math.floor(random() * 9);
	const used = new Set<number>();
	const marks: Mark[] = [];
	for (let i = 0; i < count; i += 1) {
		const frame = Math.floor(random() * frames);
		if (used.has(frame)) continue;
		used.add(frame);
		const time = typeof t.timing === 'number' ? frame / t.timing : t.timing.frameTimes[frame];
		marks.push({ id: `m${i}`, type: random() < 0.5 ? 'takeoff' : 'landing', time });
	}
	marks.sort((a, b) => a.time - b.time);
	const analysis = analyzeMarks(marks, t.timing, 0.5, jumpType);
	const grouped = groupJumps(marks, analysis);
	const probe = Math.floor(random() * frames);
	markCases.push({
		timing: t.name,
		jumpType,
		marks,
		intervals: analysis.intervals.map((i) => ({
			kind: i.kind,
			from: i.from.id,
			to: i.to.id,
			seconds: i.seconds,
			realSeconds: i.realSeconds,
			frames: i.frames
		})),
		outOfSequence: [...analysis.outOfSequence].sort(),
		jumps: grouped.jumps.map((j) => j.takeoff.id),
		unpaired: grouped.unpairedMarks.map((m) => m.id),
		units: jumpUnits(marks, analysis).map((u) => ({
			id: u.id,
			plant: u.plant?.id ?? null,
			takeoff: u.takeoff?.id ?? null,
			landing: u.landing?.id ?? null
		})),
		probe,
		action: markAction(marks, probe, t.timing, jumpType)
	});
}

const fixture = readFileSync(join(root, 'src/lib/session/fixtures/export-v3.json'), 'utf8');
const sessions = parseImport(fixture);
const exported = buildExport(sessions);
const trends = trendGroups(sessions).map((g) => ({
	jumpType: g.jumpType,
	label: g.label,
	showContact: g.showContact,
	points: g.points.map((p) => ({ id: p.session.id, best: p.best, jumps: p.jumps }))
}));

writeFileSync(
	join(import.meta.dir, '../Tests/AirtimeKitTests/golden.json'),
	JSON.stringify(
		{ videos, markCases, export: { ...exported, exportedAt: null }, trends },
		null,
		'\t'
	) + '\n'
);
console.log(`videos ${Object.keys(videos).length}, mark cases ${markCases.length}`);
