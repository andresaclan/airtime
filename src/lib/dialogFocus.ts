const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
		(element) => !element.hidden && element.getClientRects().length > 0
	);
}

/** Focuses the first focusable element in `container`, or the container itself. */
export function focusFirst(container: HTMLElement) {
	(focusableIn(container)[0] ?? container).focus();
}

/**
 * Keeps Tab / Shift+Tab inside `container`. Call it from the dialog's own keydown handler:
 * dialogs block app shortcuts with a capture-phase listener on window that stops propagation,
 * so a listener on the dialog itself would never see the key.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement | null) {
	if (event.key !== 'Tab' || !container) return;

	const items = focusableIn(container);
	if (items.length === 0) {
		event.preventDefault();
		container.focus();
		return;
	}

	const first = items[0];
	const last = items[items.length - 1];
	const active = document.activeElement;
	const inside = active instanceof Node && container.contains(active);

	if (event.shiftKey && (!inside || active === first)) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && (!inside || active === last)) {
		event.preventDefault();
		first.focus();
	}
}

/**
 * Svelte action for a dialog card: moves focus into it on mount and returns focus to the
 * previously focused element on destroy. Give the node `tabindex="-1"` as a fallback target.
 */
export function dialogFocus(node: HTMLElement) {
	const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	focusFirst(node);

	return {
		destroy() {
			if (previous?.isConnected) previous.focus();
		}
	};
}
