/** Keyboard shortcuts shown in the keybinds overlay. Keep in sync with the key handlers. */
export type Keybind = { keys: string; action: string };
export type KeybindGroup = { title: string; binds: Keybind[] };

export const KEYBIND_GROUPS: KeybindGroup[] = [
	{
		title: 'Playback',
		binds: [
			{ keys: 'Space / K', action: 'Play / pause' },
			{ keys: ', / .', action: 'Step back / forward a frame' },
			{ keys: 'Shift + ← / →', action: 'Step a frame (arrow keys)' },
			{ keys: '↑ / ↓', action: 'Volume up / down' },
			{ keys: 'R', action: 'Playback speed 1× / ½× / ¼×' },
			{ keys: 'Shift + M', action: 'Mute / unmute' }
		]
	},
	{
		title: 'Timeline',
		binds: [
			{ keys: '← / →', action: 'Scrub back / forward' },
			{ keys: 'Home / End', action: 'Go to start / end' }
		]
	},
	{
		title: 'Marks',
		binds: [
			{ keys: 'M', action: 'Mark the step the Mark button names' },
			{ keys: 'T', action: 'Mark a takeoff' },
			{ keys: 'L', action: 'Mark a touchdown or landing' },
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

// Some Safari native input paths expose Cocoa's arrow control characters in
// KeyboardEvent.key. Normalize once at the input boundary, without UA sniffing.
const ARROW_KEYS: Readonly<Record<string, string>> = {
	'\u001c': 'ArrowLeft',
	'\u001d': 'ArrowRight',
	'\u001e': 'ArrowUp',
	'\u001f': 'ArrowDown'
};

export function keyboardKey(key: string): string {
	return ARROW_KEYS[key] ?? key;
}
