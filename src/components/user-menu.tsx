"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import {
  Languages,
  Moon,
  Sun,
  Settings,
  LogOut,
  ChevronsUpDown,
  ZoomIn,
  Minus,
  Plus,
} from "lucide-react"
import { UserAvatar } from "@/components/ui/user-avatar"
import { LOCALES, type Locale, isLocale } from "@/lib/i18n/types"
import { LOCALE_CHANGE_EVENT } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { signOutAction } from "@/lib/auth-actions"
import {
  UI_SCALE_COOKIE,
  UI_SCALE_BASE,
  UI_SCALE_STEP,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  clampScale,
  normalizeScale,
  scaleToPercent,
} from "@/lib/ui-scale"

type Props = {
  initialLocale: Locale
  userName: string
  /** Job-function label shown below the name (e.g. "Owner", "Account
   *  Manager", "Finance"). Replaces the email - Roy preferred role over
   *  contact info per herMon's pattern. */
  userFunction: string
  userInitial: string
  /** Uploaded profile photo (Settings → Me). Null → brand-purple initial. */
  avatarUrl?: string | null
  missingPlatforms: number
  accountTitle: string
}

/**
 * Bottom-left sidebar surface. Collapsed state shows just the avatar +
 * name + email (no toggles cluttering the rail). Click → popover with
 * the four account actions in Roy's preferred order:
 *
 *   1. Dutch (locale cycle)
 *   2. Dark mode (theme toggle)
 *   3. Settings (→ /settings?tab=me)
 *   4. Sign out
 *
 * Why a popover instead of a static stack: the rail is already crowded
 * with nav links + a 240px width budget. Pushing seldom-used controls
 * (you set your locale once, your theme once) behind a click keeps the
 * "operational" surface clean without hiding them somewhere obscure.
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
        className="w-full flex items-center gap-3 px-2 py-2 rounded-xl border border-border/60 bg-card hover:bg-muted/50 transition-colors duration-150 group text-left shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
        title={accountTitle}
      >
        <div className="relative shrink-0">
          {/* Uploaded photo, or a brand-purple initial fallback. */}
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
          <p className="text-sm font-semibold leading-tight truncate text-foreground">
            {userName}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{userFunction}</p>
        </div>
        <ChevronsUpDown className="sidebar-label h-4 w-4 text-muted-foreground/60 shrink-0 group-hover:text-foreground transition-colors" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="min-w-[224px] p-1.5">
        <UserMenuItems initialLocale={initialLocale} />
      </PopoverContent>
    </Popover>
  )
}

function UserMenuItems({ initialLocale }: { initialLocale: Locale }) {
  const router = useRouter()
  const [locale, setLocale] = useState<Locale>(initialLocale)
  const [theme, setTheme] = useState<"light" | "dark">("light")
  const [scale, setScale] = useState<number>(UI_SCALE_BASE)
  const [mounted, setMounted] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    setMounted(true)
    const cookieLocale = readLocaleCookie()
    if (cookieLocale && cookieLocale !== locale) setLocale(cookieLocale)
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light")
    const cookieScale = readScaleCookie()
    if (cookieScale != null) setScale(cookieScale)
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

  // ── Theme toggle ─────────────────────────────────────────────────
  function toggleTheme() {
    const next: "light" | "dark" = theme === "dark" ? "light" : "dark"
    setTheme(next)
    document.documentElement.classList.toggle("dark", next === "dark")
    writeThemeCookie(next)
  }
  const isDark = theme === "dark"
  const ThemeIcon = isDark ? Sun : Moon
  const themeLabel = isDark ? t("theme.light", locale) : t("theme.dark", locale)
  const themeFallback = t("theme.fallback", locale)

  // ── UI zoom (density) ────────────────────────────────────────────
  // Applies live via the --ui-scale custom property (see lib/ui-scale +
  // globals.css) and persists in a cookie so it survives reloads and the
  // server can paint it flash-free.
  function applyScale(next: number) {
    const clamped = clampScale(Number(next.toFixed(2)))
    setScale(clamped)
    document.documentElement.style.setProperty("--ui-scale", String(clamped))
    writeScaleCookie(clamped)
  }
  const scalePct = scaleToPercent(scale)
  const atMinScale = scale <= UI_SCALE_MIN + 1e-9
  const atMaxScale = scale >= UI_SCALE_MAX - 1e-9

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={cycleLocale}
        suppressHydrationWarning
        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground/90 hover:bg-muted/60 transition-colors duration-150"
      >
        <Languages className="h-4 w-4 text-muted-foreground/70" />
        {mounted ? localeLabel : t("locale.label", locale)}
      </button>

      <button
        type="button"
        onClick={toggleTheme}
        suppressHydrationWarning
        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground/90 hover:bg-muted/60 transition-colors duration-150"
      >
        <ThemeIcon className="h-4 w-4 text-muted-foreground/70" />
        {mounted ? themeLabel : themeFallback}
      </button>

      {/* Zoom / display density. Not a nav item - an inline stepper. Clicking
          the percentage resets to 100% (the house default). Buttons live
          inside the popover so it stays open across multiple nudges. */}
      <div className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground/90">
        <ZoomIn className="h-4 w-4 text-muted-foreground/70 shrink-0" />
        <span className="flex-1">{t("zoom.label", locale)}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => applyScale(scale - UI_SCALE_STEP)}
            disabled={atMinScale}
            aria-label={t("zoom.out", locale)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyScale(UI_SCALE_BASE)}
            title={t("zoom.reset", locale)}
            suppressHydrationWarning
            className="w-11 text-center tabular-nums text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {mounted ? `${scalePct}%` : "100%"}
          </button>
          <button
            type="button"
            onClick={() => applyScale(scale + UI_SCALE_STEP)}
            disabled={atMaxScale}
            aria-label={t("zoom.in", locale)}
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <Link
        href="/settings?tab=me"
        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground/90 hover:bg-muted/60 transition-colors duration-150"
      >
        <Settings className="h-4 w-4 text-muted-foreground/70" />
        {t("nav.settings", locale)}
      </Link>

      <div className="my-1 border-t border-border/40" />

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-foreground/90 hover:bg-muted/60 transition-colors duration-150"
        >
          <LogOut className="h-4 w-4 text-muted-foreground/70" />
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

function writeThemeCookie(theme: "light" | "dark") {
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `theme=${theme}; path=/; max-age=${oneYear}; samesite=lax`
}

function readScaleCookie(): number | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${UI_SCALE_COOKIE}=([^;]+)`),
  )
  return match ? normalizeScale(decodeURIComponent(match[1])) : null
}

function writeScaleCookie(scale: number) {
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `${UI_SCALE_COOKIE}=${scale}; path=/; max-age=${oneYear}; samesite=lax`
}
