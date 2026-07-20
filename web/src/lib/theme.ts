/**
 * Theme resolution (EDD §5): explicit toggle (localStorage) → ?theme= URL
 * param → prefers-color-scheme → dark. The inline script in app.html applies
 * the initial value before first paint; this module handles later toggles.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'allchat:theme';

export function currentTheme(): Theme {
	return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme: Theme): void {
	document.documentElement.dataset.theme = theme;
	localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(): Theme {
	const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
	setTheme(next);
	return next;
}
