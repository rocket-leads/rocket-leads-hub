import type { Locale } from "./types"

/**
 * Locale-aware date / currency / number formatters. Wrappers around
 * `Intl` so callers don't have to thread BCP-47 tags through every
 * render path - pass the Hub's `Locale` and we map to the right tag
 * (and the Dutch € convention) here.
 *
 * Pure functions, safe to call from anywhere.
 */

const BCP47: Record<Locale, string> = {
  nl: "nl-NL",
  en: "en-GB",
}

export function formatCurrency(
  amount: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(BCP47[locale], {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    ...options,
  }).format(amount)
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(BCP47[locale], options).format(value)
}

export function formatDate(
  iso: string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
): string {
  return new Date(iso).toLocaleDateString(BCP47[locale], options)
}

export function formatTime(
  iso: string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  return new Date(iso).toLocaleTimeString(BCP47[locale], options)
}

/**
 * Compact "X ago" used in headers / Pedro stamps. Locale-aware so
 * Dutch users see "11m geleden" instead of "11m ago". Same buckets
 * as the inline implementations being replaced.
 */
export function formatTimeAgo(iso: string, locale: Locale, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  const labels =
    locale === "nl"
      ? { now: "zojuist", min: "m geleden", hour: "u geleden", day: "d geleden" }
      : { now: "just now", min: "m ago", hour: "h ago", day: "d ago" }

  if (ms < 60_000) return labels.now
  if (m < 60) return `${m}${labels.min}`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}${labels.hour}`
  const d = Math.round(h / 24)
  return `${d}${labels.day}`
}
