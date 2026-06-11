import type { NextRequest } from "next/server"
import { auth } from "@/lib/auth"

/**
 * Crons normally auth via the Vercel-injected `Authorization: Bearer <CRON_SECRET>`
 * header. We accept an admin session as an alternative so the same route can be
 * fired from an admin's browser (e.g. a "Send now" button in Settings) without
 * standing up a parallel route per notification.
 *
 * When the caller is a logged-in admin, `forcedByAdmin` is true so the handler
 * skips its time-of-day guard automatically - the explicit click IS the consent.
 */
export async function authorizeCronOrAdmin(req: NextRequest): Promise<{
  ok: true
  forcedByAdmin: boolean
} | { ok: false }> {
  const authHeader = req.headers.get("authorization")
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return { ok: true, forcedByAdmin: false }
  }
  const session = await auth()
  if (session && (session.user as { role?: string })?.role === "admin") {
    return { ok: true, forcedByAdmin: true }
  }
  return { ok: false }
}
