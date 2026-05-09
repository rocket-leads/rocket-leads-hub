import { DICTIONARY, type DictionaryKey } from "./dictionary"
import type { Locale } from "./types"

/**
 * Translate a dictionary key into the requested locale, with optional
 * `{name}`-style placeholder interpolation.
 *
 * Pure function — no DB / cookie / I/O. Caller resolves the locale and
 * passes it in. That keeps `t()` callable from server components, client
 * components, AI prompt builders, and tests with the same signature.
 *
 * Missing keys never throw. They return the literal key string and log
 * once in dev so the missing translation is obvious in the rendered UI
 * without the bug taking down the whole page.
 */
export function t(
  key: DictionaryKey,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const entry = DICTIONARY[key]
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[i18n] missing dictionary entry: ${key}`)
    }
    return key
  }
  const raw = entry[locale] ?? entry.nl ?? key

  if (!params) return raw

  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value == null ? match : String(value)
  })
}
