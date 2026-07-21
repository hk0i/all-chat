/**
 * Copies text to the clipboard, falling back for non-secure contexts.
 * `navigator.clipboard` only exists in secure contexts (https or localhost)
 * and can be permission-denied even there — reaching the app over plain
 * http on a LAN IP (a normal self-hosted setup) lands in the fallback,
 * where the deprecated `execCommand` path still works.
 */
export async function copyToClipboard(text: string): Promise<void> {
	try {
		if (!navigator.clipboard?.writeText) throw new Error('clipboard API unavailable');
		await navigator.clipboard.writeText(text);
	} catch {
		const textarea = document.createElement('textarea');
		textarea.value = text;
		document.body.appendChild(textarea);
		textarea.select();
		document.execCommand('copy');
		textarea.remove();
	}
}
