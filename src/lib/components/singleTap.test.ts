import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { singleTap } from './singleTap';

type Point = { clientX: number; clientY: number };

/** A stand-in for the viewer frame: touch events with just the fields singleTap reads. */
function setup() {
	const element = new EventTarget() as unknown as HTMLElement;
	const onTap = vi.fn();
	const detach = singleTap(onTap, '.ignored')(element);
	let now = 0;
	function send(type: string, touches: Point[], after = 0) {
		now += after;
		const event = new Event(type);
		Object.defineProperty(event, 'touches', { value: touches });
		Object.defineProperty(event, 'timeStamp', { value: now });
		element.dispatchEvent(event);
	}
	function tap(at: Point = { clientX: 100, clientY: 100 }) {
		send('touchstart', [at]);
		send('touchend', [], 80);
	}
	return { onTap, detach, send, tap };
}

describe('singleTap', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('reports a tap once the double-tap window has passed', () => {
		const { onTap, tap } = setup();
		tap();
		expect(onTap).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(onTap).toHaveBeenCalledTimes(1);
	});

	it('ignores a double tap, which zooms the viewer', () => {
		const { onTap, tap } = setup();
		tap();
		vi.advanceTimersByTime(120);
		tap();
		vi.advanceTimersByTime(1000);
		expect(onTap).not.toHaveBeenCalled();
	});

	it('ignores a drag and a long press', () => {
		const { onTap, send } = setup();
		send('touchstart', [{ clientX: 100, clientY: 100 }]);
		send('touchmove', [{ clientX: 130, clientY: 100 }], 20);
		send('touchend', [], 40);
		send('touchstart', [{ clientX: 100, clientY: 100 }], 1000);
		send('touchend', [], 600);
		vi.advanceTimersByTime(1000);
		expect(onTap).not.toHaveBeenCalled();
	});

	it('ignores a pinch', () => {
		const { onTap, send } = setup();
		const a = { clientX: 100, clientY: 100 };
		const b = { clientX: 200, clientY: 200 };
		send('touchstart', [a]);
		send('touchstart', [a, b], 10);
		send('touchend', [a], 40);
		send('touchend', [], 10);
		vi.advanceTimersByTime(1000);
		expect(onTap).not.toHaveBeenCalled();
	});

	it('drops a waiting tap when detached', () => {
		const { onTap, tap, detach } = setup();
		tap();
		detach?.();
		vi.advanceTimersByTime(1000);
		expect(onTap).not.toHaveBeenCalled();
	});
});
