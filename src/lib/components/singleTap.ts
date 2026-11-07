import type { Attachment } from 'svelte/attachments';

/** Longest press, and furthest drift, that still counts as a tap. */
const TAP_MS = 300;
const TAP_SLOP_PX = 10;
/** A second tap this soon makes a double tap (the viewer zooms), not two taps. */
const DOUBLE_TAP_MS = 300;

/**
 * Calls `onTap` for a single one-finger tap on the element, as iOS Photos shows and
 * hides its controls. Taps that start inside `ignore` (the controls themselves), drags,
 * pinches and double taps don't count. It waits out the double-tap window first.
 */
export function singleTap(onTap: () => void, ignore: string): Attachment<HTMLElement> {
	return (element) => {
		let start: { x: number; y: number; at: number } | null = null;
		let pending: ReturnType<typeof setTimeout> | undefined;

		function touchStart(event: TouchEvent) {
			// A touch while a tap waits makes a double tap: neither counts.
			const second = pending !== undefined;
			clearTimeout(pending);
			pending = undefined;
			const target = event.target as Partial<Element> | null;
			const ignored = target?.closest?.(ignore);
			if (event.touches.length !== 1 || ignored || second) {
				start = null;
				return;
			}
			const touch = event.touches[0];
			start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp };
		}

		function touchMove(event: TouchEvent) {
			if (!start) return;
			const touch = event.touches[0];
			if (
				event.touches.length !== 1 ||
				Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP_PX
			)
				start = null;
		}

		function touchEnd(event: TouchEvent) {
			const tapped = start && event.touches.length === 0 && event.timeStamp - start.at < TAP_MS;
			start = null;
			if (!tapped) return;
			pending = setTimeout(() => {
				pending = undefined;
				onTap();
			}, DOUBLE_TAP_MS);
		}

		function touchCancel() {
			start = null;
		}

		element.addEventListener('touchstart', touchStart, { passive: true });
		element.addEventListener('touchmove', touchMove, { passive: true });
		element.addEventListener('touchend', touchEnd, { passive: true });
		element.addEventListener('touchcancel', touchCancel, { passive: true });
		return () => {
			clearTimeout(pending);
			element.removeEventListener('touchstart', touchStart);
			element.removeEventListener('touchmove', touchMove);
			element.removeEventListener('touchend', touchEnd);
			element.removeEventListener('touchcancel', touchCancel);
		};
	};
}
