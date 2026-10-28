/** A saved marking session for one video. The video itself is never stored. */
import type { Mark } from '$lib/video/marks';

export const SCHEMA_VERSION = 5;

/**
 * `default` means 30 fps was assumed because the frame rate couldn't be read or measured.
 * Only older versions of Airtime did that; it now refuses to mark such videos.
 */
export type FrameRateSource = 'container' | 'playback-estimate' | 'default';

export type JumpType = 'approach' | 'drop-jump' | 'repeat-hops';

/** In menu order. Every type has a meaningful contact: an approach jump's is its plant step. */
export const JUMP_TYPES: readonly { value: JumpType; label: string }[] = [
	{ value: 'approach', label: 'Approach' },
	{ value: 'drop-jump', label: 'Drop jump' },
	{ value: 'repeat-hops', label: 'Repeat hops' }
];

export const DEFAULT_JUMP_TYPE: JumpType = 'approach';

export type SessionMedia = {
	fileName: string;
	mimeType: string;
	sizeBytes: number;
	/** ISO timestamp of the file's last-modified date; the initial recorded date. */
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
	/**
	 * One per session. `null` until the athlete sets one: sessions saved before jump types
	 * existed, or with a type that's no longer offered.
	 */
	jumpType: JumpType | null;
	createdAt: string;
	updatedAt: string;
	/** ISO timestamp of when the video was filmed, as corrected by the athlete. */
	recordedAt: string;
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
