import { redirect } from '@sveltejs/kit';

// The full app moved from /alpha to /; old links and home-screen icons land there.
export function load() {
	redirect(308, '/');
}
