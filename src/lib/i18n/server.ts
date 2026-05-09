import { cookies } from "next/headers"
import { createAdminClient } from "@/lib/supabase/server"
import { DEFAULT_LOCALE, isLocale, type Locale } from "./types"

/**
 * Server-side helpers for resolving locales. The user UI locale is per-
 * user; the AI locale is workspace-wide because the cron writes one set
 * of insights for everyone.
 *
 * Resolution order for the user UI locale:
 *   1. cookie `locale` — set immediately when the user toggles, no
 *      round-trip required. Source of truth for the next render.
 *   2. users.locale column — persisted across browsers / devices. Read
 *      lazily (only when the cookie is missing or the user is signed in).
 *   3. DEFAULT_LOCALE ('nl') — for unauthenticated routes / first paint.
 *
 * Designed to never block a render on Supabase. If the DB read fails we
 * fall back to the cookie or default.
 */

const LOCALE_COOKIE = "locale"

/**
 * Get the locale to render UI in for the current request. Must be called
 * inside a server component / route handler.
 *
 * Pass the optional userId to read the persisted preference from
 * `users.locale` when the cookie is missing — useful on the very first
 * post-login render.
 */
export async function getUserLocale(userId?: string | null): Promise<Locale> {
  const fromCookie = await readLocaleCookie()
  if (fromCookie) return fromCookie

  if (userId) {
    const persisted = await readUserLocale(userId)
    if (persisted) return persisted
  }

  return DEFAULT_LOCALE
}

async function readLocaleCookie(): Promise<Locale | null> {
  try {
    const store = await cookies()
    const value = store.get(LOCALE_COOKIE)?.value
    return isLocale(value) ? value : null
  } catch {
    // Outside a request context — happens during static optimisation.
    return null
  }
}

async function readUserLocale(userId: string): Promise<Locale | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("users")
      .select("locale")
      .eq("id", userId)
      .maybeSingle()
    return isLocale(data?.locale) ? data!.locale : null
  } catch {
    return null
  }
}

/**
 * Workspace-wide locale used by AI prompts. Stored in `settings` under
 * key 'ai_locale'. Default 'nl' so the team's working language drives
 * Pedro's output by default.
 */
export async function getAiLocale(): Promise<Locale> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "ai_locale")
      .maybeSingle()
    const value = (data?.value as { locale?: unknown } | null)?.locale
    return isLocale(value) ? value : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}
