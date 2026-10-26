/** Keyboard shortcuts shown in the keybinds overlay. Keep in sync with the key handlers. */
export type Keybind = { keys: string; action: string };
export type KeybindGroup = { title: string; binds: Keybind[] };

export const KEYBIND_GROUPS: KeybindGroup[] = [
	{
		title: 'Playback',
		binds: [
			{ keys: 'Space / K', action: 'Play / pause' },
			{ keys: ', / . or Shift + ← / →', action: 'Step one frame' },
			{ keys: '↑ / ↓', action: 'Volume up / down' },
			{ keys: 'R', action: 'Playback speed 1× / ½× / ¼×' },
			{ keys: 'M', action: 'Mute / unmute' }
		]
	},
	{
		title: 'Timeline',
		binds: [
			{ keys: '← / →', action: 'Scrub back / forward' },
			{ keys: 'Home / End', action: 'Jump to start / end' }
		]
	},
	{
		title: 'Marks',
		binds: [
			{ keys: 'T', action: 'Mark takeoff' },
			{ keys: 'L', action: 'Mark landing' },
			{ keys: '[ / ]', action: 'Previous / next mark' },
			{ keys: 'Backspace / Delete', action: 'Delete mark at playhead' },
			{ keys: 'Ctrl / ⌘ + Z', action: 'Undo mark change' },
			{ keys: 'Ctrl / ⌘ + Shift + Z', action: 'Redo mark change' },
			{ keys: 'A', action: 'Show / hide analysis panel' }
		]
	},
	{
		title: 'General',
		binds: [
			{ keys: 'Ctrl / ⌘ + S', action: 'Save session to this browser' },
			{ keys: '?', action: 'Show / hide keyboard shortcuts' },
			{ keys: 'Esc', action: 'Close this overlay' }
		]
	}
];

/** Macs and iOS devices use ⌘ where other platforms use Ctrl. */
export function isApplePlatform(): boolean {
	if (typeof navigator === 'undefined') return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Shows only this platform's modifier, e.g. "Ctrl / ⌘ + Z" becomes "⌘ + Z" on a Mac. */
export function platformKeys(keys: string): string {
	return keys.replace('Ctrl / ⌘', isApplePlatform() ? '⌘' : 'Ctrl');
}
