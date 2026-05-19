"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Languages } from "lucide-react"
import { LOCALES, type Locale, isLocale } from "@/lib/i18n/types"
import { LOCALE_CHANGE_EVENT } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

type Props = {
  /** Initial locale, resolved server-side. Used for the first paint so
   *  the button label is correct without a client round-trip. */
  initialLocale: Locale
}

/**
 * Sidebar locale switcher. Cycles between the supported locales; for
 * just two (nl ↔ en) the cycle reads as a clean toggle. If we ever add
 * a third locale this becomes a quick rotate.
 *
 * Cookie-first like ThemeToggle — write the cookie immediately so the
 * next render picks it up without waiting for the DB update. The DB
 * update keeps the preference cross-browser / cross-device but isn't
 * on the critical path.
 *
 * Calls router.refresh() after the swap so server components re-render
 * with the new cookie value (sidebar nav, Home page, etc).
 */
export function LocaleToggle({ initialLocale }: Props) {
  const router = useRouter()
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [mounted, setMounted] = useState(false)
  const [pending, startTransition] = useTransition()

  // Hydrate from cookie when mounted (in case server and client diverged
  // — e.g. user toggled in another tab).
  useEffect(() => {
    setMounted(true)
    const cookieLocale = readLocaleCookie()
    if (cookieLocale && cookieLocale !== locale) setLocale(cookieLocale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cycle() {
    const idx = LOCALES.indexOf(locale)
    const next = LOCALES[(idx + 1) % LOCALES.length]
    setLocale(next)
    writeLocaleCookie(next)
    // Broadcast to every client component using `useLocale()` so they re-render
    // with the new locale immediately — without this the kolomheaders, KPI cards,
    // and other client surfaces stay on the previous locale until the page is
    // hard-refreshed.
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHANGE_EVENT, { detail: next }))
    }
    // Cross-tab signal — storage events only fire in OTHER tabs of the same
    // origin. Writing a throwaway marker lets useLocale() in those tabs pick
    // up the cookie change without needing a focus/refresh.
    try {
      window.localStorage.setItem("rl-locale-marker", String(Date.now()))
    } catch {}
    // Persist to DB — fire-and-forget, the cookie is the source of truth
    // for the next render anyway.
    void fetch("/api/account/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {})
    // Re-render server components with the new cookie.
    startTransition(() => router.refresh())
  }

  // The label shows the locale you'd switch TO — that's the affordance,
  // not the current state. Mirrors how the dark/light toggle reads.
  const targetLocale = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]
  const targetLabel =
    targetLocale === "nl"
      ? t("locale.dutch", locale)
      : t("locale.english", locale)

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={pending}
      aria-label={t("locale.label", locale)}
      title={t("locale.label", locale)}
      suppressHydrationWarning
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all disabled:opacity-50"
    >
      <Languages className="h-3.5 w-3.5" />
      {mounted ? targetLabel : t("locale.label", locale)}
    </button>
  )
}

function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/)
  if (!match) return null
  const value = decodeURIComponent(match[1])
  return isLocale(value) ? value : null
}

function writeLocaleCookie(locale: Locale) {
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `locale=${locale}; path=/; max-age=${oneYear}; samesite=lax`
}
