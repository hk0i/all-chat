/** Stable fallback hue for authors without a platform-provided color (EDD §4.1). */
export function hashColor(name: string): string {
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	return `hsl(${((hash % 360) + 360) % 360}, 60%, 60%)`;
}
