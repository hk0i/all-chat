import type { Theme } from './theme';

/**
 * Author name colors come from the platform (raw hex, user-picked — can be
 * anything, including near-white) or our own hash fallback (fixed HSL
 * lightness tuned for dark backgrounds). Neither is safe on a light
 * background as-is. Real chat clients (Twitch's own web client included)
 * clamp the lightness of the *displayed* color to the current background
 * rather than storing two colors — same color identity, adjusted for
 * legibility.
 */

interface Hsl {
	h: number;
	s: number;
	l: number;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL_RE = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i;

function hexToHsl(hex: string): Hsl {
	const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
	const r = parseInt(full.slice(1, 3), 16) / 255;
	const g = parseInt(full.slice(3, 5), 16) / 255;
	const b = parseInt(full.slice(5, 7), 16) / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;

	if (max === min) return { h: 0, s: 0, l: l * 100 };

	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	switch (max) {
		case r:
			h = (g - b) / d + (g < b ? 6 : 0);
			break;
		case g:
			h = (b - r) / d + 2;
			break;
		default:
			h = (r - g) / d + 4;
	}
	return { h: h * 60, s: s * 100, l: l * 100 };
}

function parseColor(color: string): Hsl | undefined {
	const hslMatch = HSL_RE.exec(color);
	if (hslMatch) return { h: Number(hslMatch[1]), s: Number(hslMatch[2]), l: Number(hslMatch[3]) };
	if (HEX_RE.test(color)) return hexToHsl(color);
	return undefined;
}

/** Lightness range that stays legible against each theme's background. */
const LIGHTNESS_RANGE: Record<Theme, [number, number]> = {
	dark: [45, 75],
	light: [25, 50]
};

/**
 * Same hue/saturation, lightness clamped to stay readable on `theme`'s
 * background. Falls back to the input unchanged if it isn't hex or hsl().
 */
export function readableColor(color: string, theme: Theme): string {
	const hsl = parseColor(color);
	if (!hsl) return color;
	const [min, max] = LIGHTNESS_RANGE[theme];
	const l = Math.min(max, Math.max(min, hsl.l));
	return `hsl(${hsl.h}, ${hsl.s}%, ${l}%)`;
}
