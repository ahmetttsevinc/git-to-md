import { DEFAULT_OPTIONS } from "./format.js";

/**
 * source:
 *   "auto" – REST API on the same GitLab origin, fall back to page scraping
 *   "api"  – REST API only
 *   "dom"  – page scraping only; no extra network requests at all
 */
export const EXTRA_DEFAULTS = Object.freeze({ autoCopy: true, source: "auto" });

export async function loadSettings() {
  const defaults = { ...DEFAULT_OPTIONS, ...EXTRA_DEFAULTS };
  try {
    return { ...defaults, ...(await browser.storage.sync.get(defaults)) };
  } catch {
    return defaults;
  }
}

export function saveSettings(values) {
  return browser.storage.sync.set(values);
}
