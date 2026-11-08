<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';

	// File-input automation must wait for client handlers, not just SSR markup.
	onMount(() => {
		document.documentElement.dataset.airtimeReady = 'true';
		return () => {
			delete document.documentElement.dataset.airtimeReady;
		};
	});

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=JetBrains+Mono:wght@500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>
{@render children()}
