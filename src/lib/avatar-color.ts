/**
 * Deterministic avatar colour for a person with no uploaded photo. The same
 * name always maps to the same soft tint, so a teammate reads as "the blue
 * one" consistently across the Watch List, Clients table, and anywhere else
 * initials stand in for a face.
 *
 * Tints are `bg-*-100 / text-*-700` pairs - light chip, dark readable initials.
 * (green/emerald/red/rose are remapped to the status palette in globals.css;
 * that's fine - they stay distinct and legible.)
 */
const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
] as const

export function avatarColorClass(name: string | null | undefined): string {
  const s = (name ?? "").trim()
  if (!s) return "bg-muted text-muted-foreground"
  let hash = 0
  for (const ch of s) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}
