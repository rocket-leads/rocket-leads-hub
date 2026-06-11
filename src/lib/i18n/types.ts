/**
 * Two locales supported. Keep this list small - every locale = a column
 * in the dictionary that needs maintenance. Roy's team is Dutch; English
 * is kept around for external observers / future non-Dutch hires.
 */
export const LOCALES = ["nl", "en"] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = "nl"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/** Human-friendly label per locale, used by the toggle UI. */
export const LOCALE_LABELS: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
}
