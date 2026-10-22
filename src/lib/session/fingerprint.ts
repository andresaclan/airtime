const SAMPLE_BYTES = 1024 * 1024;

/**
 * Cheap identity for a video file: SHA-256 over its size plus the first and last
 * 1 MB, so multi-GB files don't need to be read in full. Without `crypto.subtle`
 * (non-secure contexts) it falls back to name, size and modified time.
 */
export async function fingerprintFile(file: File): Promise<string> {
	if (typeof crypto === 'undefined' || !crypto.subtle) {
		return `meta:${file.name}:${file.size}:${file.lastModified}`;
	}
	const head = file.slice(0, SAMPLE_BYTES);
	const tail = file.slice(Math.max(SAMPLE_BYTES, file.size - SAMPLE_BYTES));
	const bytes = await new Blob([String(file.size), head, tail]).arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0'));
	return `sha256:${hex.join('')}`;
}
