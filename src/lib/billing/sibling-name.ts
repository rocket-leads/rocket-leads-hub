/**
 * Pick a friendly display label for a set of Monday client rows that all map
 * to the same Stripe customer (e.g. "O2 Plus | B2B" + "O2 Plus | B2C" should
 * collapse to "O2 Plus" wherever they're shown together).
 *
 * Strategy:
 *   1. If all names share a non-trivial common prefix (length ≥ 3 after
 *      trimming trailing separators), use the trimmed prefix.
 *   2. Otherwise fall back to the first name in the list.
 *
 * Strips trailing whitespace and common separators ("|", "-", ":", "·") off
 * the prefix so it doesn't end on a divider character.
 *
 * Used by both the Billing page (Future invoice grouping) and the Past
 * invoices view (so the same Stripe customer reads identically across tabs).
 */
export function combinedClientName(names: string[]): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]

  let prefixLen = 0
  const minLen = Math.min(...names.map((n) => n.length))
  outer: for (let i = 0; i < minLen; i++) {
    const ch = names[0][i]
    for (let j = 1; j < names.length; j++) {
      if (names[j][i] !== ch) break outer
    }
    prefixLen = i + 1
  }
  const prefix = names[0].slice(0, prefixLen).replace(/[\s|\-:·]+$/, "").trim()
  if (prefix.length >= 3) return prefix
  return names[0]
}
