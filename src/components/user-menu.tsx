"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Languages, Settings, LogOut, ChevronsUpDown } from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { LOCALES, type Locale, isLocale } from "@/lib/i18n/types"
import { LOCALE_CHANGE_EVENT } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { signOutAction } from "@/lib/auth-actions"

type Props = {
  initialLocale: Locale
  userName: string
  /** Job-function label shown below the name (e.g. "Owner", "Account Manager"). */
  userFunction: string
  userInitial: string
  /** Uploaded profile photo (Settings → Me). Null → brand-purple initial. */
  avatarUrl?: string | null
  missingPlatforms: number
  accountTitle: string
}

/**
 * Bottom-left sidebar account surface. Click the user block → a 187N-styled
 * popover with just three actions (light-only, no theme toggle, no zoom - you
 * zoom with the browser):
 *
 *   1. Language (Nl ↔ En)
 *   2. Settings (→ /settings?tab=me)
 *   3. Sign out
 */
export function UserMenu({
  initialLocale,
  userName,
  userFunction,
  userInitial,
  avatarUrl,
  missingPlatforms,
  accountTitle,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger
        data-user-menu-trigger=""
        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[var(--teal-wash)] transition-colors duration-150 group text-left"
        title={accountTitle}
      >
        <div className="relative shrink-0">
          <UserAvatar
            name={userName || userInitial}
            avatarUrl={avatarUrl}
            size="lg"
            fallbackClassName="bg-primary text-primary-foreground font-semibold"
          />
          {missingPlatforms > 0 && (
            <span
              aria-label={`${missingPlatforms} platform${missingPlatforms === 1 ? "" : "s"} not connected`}
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card"
            />
          )}
        </div>
        <div className="sidebar-label flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold leading-tight truncate text-foreground">
            {userName}
          </p>
          <p className="font-mono text-[10.5px] text-muted-foreground/70 truncate mt-0.5">
            {userFunction}
          </p>
        </div>
        <ChevronsUpDown className="sidebar-label h-4 w-4 text-muted-foreground/60 shrink-0 group-hover:text-foreground transition-colors" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="min-w-[210px] p-1.5">
        <UserMenuItems initialLocale={initialLocale} />
      </PopoverContent>
    </Popover>
  )
}

// Reuse the sidebar's own `.nav-item` (theme.css) so the menu is byte-for-byte
// identical to the nav above it - same 13.5px Schibsted, 17px icons, purple-wash
// hover, r-sm. `.nav-item` is px-based, so it isn't shrunk by --ui-scale the way
// rem utilities are.
const MENU_ITEM = "nav-item w-full text-left"

function UserMenuItems({ initialLocale }: { initialLocale: Locale }) {
  const router = useRouter()
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [mounted, setMounted] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    setMounted(true)
    const cookieLocale = readLocaleCookie()
    if (cookieLocale && cookieLocale !== locale) setLocale(cookieLocale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Locale cycle (Nl ↔ En) ───────────────────────────────────────
  function cycleLocale() {
    const idx = LOCALES.indexOf(locale)
    const next = LOCALES[(idx + 1) % LOCALES.length]
    setLocale(next)
    writeLocaleCookie(next)
    if (typeof document !== "undefined") {
      document.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHANGE_EVENT, { detail: next }))
    }
    try {
      window.localStorage.setItem("rl-locale-marker", String(Date.now()))
    } catch {}
    void fetch("/api/account/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {})
    startTransition(() => router.refresh())
  }
  const targetLocale = LOCALES[(LOCALES.indexOf(locale) + 1) % LOCALES.length]
  const localeLabel =
    targetLocale === "nl" ? t("locale.dutch", locale) : t("locale.english", locale)

  return (
    <div className="flex flex-col">
      <button type="button" onClick={cycleLocale} suppressHydrationWarning className={MENU_ITEM}>
        <Languages />
        {mounted ? localeLabel : t("locale.label", locale)}
      </button>

      <Link href="/settings?tab=me" className={MENU_ITEM}>
        <Settings />
        {t("nav.settings", locale)}
      </Link>

      <div className="my-1 border-t border-border/40" />

      <form action={signOutAction}>
        <button type="submit" className={MENU_ITEM}>
          <LogOut />
          {t("account.sign_out", locale)}
        </button>
      </form>
    </div>
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
