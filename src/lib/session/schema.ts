/** A saved marking session for one video. The video itself is never stored. */
import type { Mark } from '$lib/video/marks';

export const SCHEMA_VERSION = 1;

export type FrameRateSource = 'container' | 'playback-estimate' | 'default';

export type SessionMedia = {
	fileName: string;
	mimeType: string;
	sizeBytes: number;
	/** ISO timestamp of the file's last-modified date, a rough stand-in for when it was recorded. */
	lastModified: string;
	durationSeconds: number;
	width: number;
	height: number;
	/** Identifies the file so dropping it in again restores this session. */
	fingerprint: string;
};

export type Session = {
	schemaVersion: typeof SCHEMA_VERSION;
	id: string;
	title: string;
	notes: string;
	createdAt: string;
	updatedAt: string;
	media: SessionMedia;
	frameRate: { value: number; source: FrameRateSource };
	/** Real seconds per media second: 1 for real time, 0.25 for 4× slow motion. */
	timeScale: number;
	marks: Mark[];
};

export const TIME_SCALES = [
	{ value: 1, label: 'Real time' },
	{ value: 0.5, label: '2× slow motion' },
	{ value: 0.25, label: '4× slow motion' },
	{ value: 0.125, label: '8× slow motion' }
] as const;
