// Dutch name particles that shouldn't count as the "last name" initial
// ("Roy van der Harst" → "RH", not "RV"). Shared by every avatar surface.
const SKIP_PARTS = new Set(["van", "de", "der", "den", "het", "ten", "ter"])

/**
 * Two-letter initials for an avatar fallback. First letter of the first word +
 * first letter of the last meaningful word (skipping Dutch particles). Falls
 * back to a single "?" for empty/blank names.
 */
export function getInitials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0][0]?.toUpperCase() ?? ""
  const lastPart = parts.findLast(
    (p) => !SKIP_PARTS.has(p.toLowerCase()) && p !== parts[0],
  )
  const last = lastPart?.[0]?.toUpperCase() ?? ""
  return (first + last) || "?"
}
