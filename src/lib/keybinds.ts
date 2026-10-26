/** Keyboard shortcuts shown in the keybinds overlay. Keep in sync with the key handlers. */
export type Keybind = { keys: string; action: string };
export type KeybindGroup = { title: string; binds: Keybind[] };

export const KEYBIND_GROUPS: KeybindGroup[] = [
	{
		title: 'Playback',
		binds: [
			{ keys: 'Space / K', action: 'Play / pause' },
			{ keys: ', / .', action: 'Step back / forward one frame' },
			{ keys: 'Shift + ← / →', action: 'Step one frame (arrow keys)' },
			{ keys: '↑ / ↓', action: 'Volume up / down' },
			{ keys: 'R', action: 'Playback speed 1× / ½× / ¼×' },
			{ keys: 'M', action: 'Mute / unmute' }
		]
	},
	{
		title: 'Timeline',
		binds: [
			{ keys: '← / →', action: 'Scrub back / forward (timeline focused)' },
			{ keys: 'Home / End', action: 'Jump to start / end (timeline focused)' }
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
