export const THEME_STORAGE_KEY = "stakd-theme";

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
/** The site is dark-only, so this pins the theme before first paint instead of reading a saved preference. */
export const themeInitScript = `document.documentElement.dataset.theme="dark";`;
