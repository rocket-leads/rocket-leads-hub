import { describe, it, expect } from "vitest"
import { t } from "./t"
import { DICTIONARY } from "./dictionary"
import { LOCALES, isLocale, DEFAULT_LOCALE, LOCALE_LABELS } from "./types"
import {
  formatCurrency,
  formatNumber,
  formatDate,
  formatTimeAgo,
} from "./format"
import { aiLanguageDirective } from "@/lib/ai/guardrails"

/**
 * i18n locks: dictionary completeness, placeholder interpolation,
 * formatter sanity, and the AI language directive shape. The
 * dictionary completeness test is the most valuable - without it,
 * adding a new key for one locale and forgetting the other ships
 * silently and the missing-locale users see English fragments.
 */

describe("dictionary completeness", () => {
  it("every entry has a string for every supported locale", () => {
    for (const [key, entry] of Object.entries(DICTIONARY)) {
      for (const locale of LOCALES) {
        expect(typeof entry[locale], `${key}/${locale}`).toBe("string")
        expect(entry[locale].length, `${key}/${locale} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it("LOCALE_LABELS covers every locale", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy()
    }
  })
})

describe("t() - translation lookup", () => {
  it("returns the right string per locale", () => {
    expect(t("nav.clients", "nl")).toBe("Klanten")
    expect(t("nav.clients", "en")).toBe("Clients")
  })

  it("interpolates {placeholder} params", () => {
    expect(t("home.greeting.morning", "nl", { name: "Roy" })).toBe("Goedemorgen, Roy")
    expect(t("home.greeting.morning", "en", { name: "Roy" })).toBe("Good morning, Roy")
  })

  it("interpolates numeric params", () => {
    expect(t("home.kpi.action.delta_pos", "nl", { n: 3 })).toContain("+3")
    expect(t("home.kpi.action.delta_pos", "en", { n: 3 })).toContain("+3")
  })

  it("leaves un-interpolated placeholders intact when params don't include the name", () => {
    // Defensive - avoids accidentally rendering "undefined" if a caller
    // forgets to pass a param.
    const result = t("home.greeting.morning", "nl", {})
    expect(result).toContain("{name}")
  })

  it("returns the literal key for missing entries (never throws)", () => {
    // Cast through unknown to satisfy DictionaryKey typing in the test.
    expect(t("does.not.exist" as unknown as Parameters<typeof t>[0], "nl")).toBe("does.not.exist")
  })
})

describe("isLocale", () => {
  it("accepts each supported locale", () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true)
    }
  })

  it("rejects unknown values", () => {
    expect(isLocale("fr")).toBe(false)
    expect(isLocale("")).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })

  it("DEFAULT_LOCALE is one of the supported locales", () => {
    expect(LOCALES.includes(DEFAULT_LOCALE)).toBe(true)
  })
})

describe("format helpers", () => {
  it("formatCurrency uses Dutch convention for nl", () => {
    const out = formatCurrency(1500, "nl")
    // nl-NL EUR uses non-breaking space and trailing-no-decimals here:
    // we just check the digits and currency symbol are present rather
    // than pinning the exact whitespace, which Intl can change between
    // Node versions.
    expect(out).toContain("1.500")
    expect(out).toContain("€")
  })

  it("formatCurrency uses British convention for en", () => {
    const out = formatCurrency(1500, "en")
    expect(out).toContain("1,500")
    expect(out).toContain("€")
  })

  it("formatNumber respects locale digit grouping", () => {
    expect(formatNumber(1234567, "nl")).toContain("1.234.567")
    expect(formatNumber(1234567, "en")).toContain("1,234,567")
  })

  it("formatDate produces a Dutch weekday name when locale=nl", () => {
    // 2026-05-09 is a Saturday; nl = "zaterdag", en = "Saturday".
    const nlDate = formatDate("2026-05-09T12:00:00Z", "nl")
    const enDate = formatDate("2026-05-09T12:00:00Z", "en")
    expect(nlDate.toLowerCase()).toContain("zaterdag")
    expect(enDate.toLowerCase()).toContain("saturday")
  })

  it("formatTimeAgo uses Dutch suffixes when locale=nl", () => {
    const now = Date.UTC(2026, 4, 9, 12, 0, 0)
    const fiveMinAgo = new Date(now - 5 * 60_000).toISOString()
    expect(formatTimeAgo(fiveMinAgo, "nl", now)).toBe("5m geleden")
    expect(formatTimeAgo(fiveMinAgo, "en", now)).toBe("5m ago")
  })

  it("formatTimeAgo handles 'just now' threshold per locale", () => {
    const now = Date.UTC(2026, 4, 9, 12, 0, 0)
    const recent = new Date(now - 30_000).toISOString()
    expect(formatTimeAgo(recent, "nl", now)).toBe("zojuist")
    expect(formatTimeAgo(recent, "en", now)).toBe("just now")
  })
})

describe("aiLanguageDirective", () => {
  it("instructs Dutch output when locale=nl", () => {
    const directive = aiLanguageDirective("nl")
    expect(directive).toMatch(/Dutch \(Nederlands\)/)
    expect(directive).toMatch(/Window labels stay/)
  })

  it("instructs English output when locale=en", () => {
    const directive = aiLanguageDirective("en")
    expect(directive).toMatch(/Write the entire output in English/)
  })

  it("preserves brand terms across both locales", () => {
    // CPL/CPA/MRR and quoted Monday text shouldn't be translated even
    // when output is otherwise Dutch.
    const nl = aiLanguageDirective("nl")
    expect(nl).toMatch(/CPL/)
    expect(nl).toMatch(/quoted text/)
  })
})
