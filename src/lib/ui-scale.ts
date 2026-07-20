// Per-user UI density.
//
// The whole Hub scales through the `--ui-scale` custom property: globals.css
// sets `html { font-size: calc(100% * var(--ui-scale)) }`, and every Tailwind
// spacing/text/width utility is rem-based, so nudging this one number shrinks
// or grows the entire UI proportionally. We deliberately scale font-size
// rather than using CSS `zoom` so the inbox/chat panes laid out with
// `calc(100vh - …)` keep their heights (zoom would break those).
//
// 0.76 is the house default and reads as "100%" in the picker — the density
// Roy dialled in (2026-07-20: a touch more zoomed-out than the old 0.8 so
// more fits on one screen) — and users nudge up/down from there. Persisted in
// the `ui-scale` cookie so the server can paint the right size on first render
// (no flash) and the choice survives reloads.

export const UI_SCALE_COOKIE = "ui-scale"
export const UI_SCALE_BASE = 0.76 // shown as 100% in the picker
export const UI_SCALE_STEP = 0.08 // one click = 10%
export const UI_SCALE_MIN = 0.56 // 70%
export const UI_SCALE_MAX = 1.28 // 160%

export function clampScale(n: number): number {
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n))
}

/** Parse a cookie value into a valid scale, or null if absent/invalid. */
export function normalizeScale(raw: string | undefined | null): number | null {
  if (!raw) return null
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return null
  return clampScale(n)
}

/** Displayed percentage relative to the house default (base == 100%). */
export function scaleToPercent(scale: number): number {
  return Math.round((scale / UI_SCALE_BASE) * 100)
}
