import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getBoardConfig } from "@/lib/integrations/monday"
import {
  createMondayWebhook,
  deleteMondayWebhook,
  listMondayWebhooks,
  type MondayWebhook,
  type MondayWebhookEvent,
} from "@/lib/integrations/monday"

/**
 * Admin-only management endpoint for the Monday → Hub real-time sync
 * webhooks. The receiver at `/api/webhooks/monday` handles the events;
 * this route is the install / inspect / repair counterpart.
 *
 * GET → list currently-registered webhooks on both boards (current +
 *       onboarding) so the Settings UI can show "5/5 events registered"
 *       per board.
 * POST → reconcile: for every (board, event) pair we want, register it
 *        if not already present. Idempotent - re-running is safe and
 *        cheap.
 * DELETE ?id=... → drop a specific webhook (used to clean up a stale
 *                  one pointing at an old domain or expired secret).
 *
 * The webhook URL is derived from the incoming request so it always
 * matches the host the admin is currently on (prod / preview) - no
 * env var to keep in sync.
 */

// Every event type we want Monday to push into the Hub's receiver.
// `create_update` is the legacy inbox-mention path (still registered);
// the rest are the new client-mutation sync.
//
// Note: Monday's v2 GraphQL enum uses `create_item` for new-item events;
// `create_pulse` is the deprecated legacy alias and `create_webhook`
// rejects it with `INVALID_ENUM_VALUE`. The receiver still accepts both
// payload type strings for safety.
const TARGET_EVENTS: MondayWebhookEvent[] = [
  "change_column_value",
  "change_name",
  "create_item",
  "item_deleted",
  "create_update",
]

function buildWebhookUrl(req: NextRequest): string | null {
  const secret = process.env.MONDAY_WEBHOOK_SECRET
  if (!secret) return null
  // `req.nextUrl.origin` reflects the host the admin is currently using -
  // e.g. https://hub.rocketleads.com on prod, a *.vercel.app preview URL
  // when poking from a deploy preview. Better than a hardcoded env var
  // because it can't drift.
  return `${req.nextUrl.origin}/api/webhooks/monday?secret=${encodeURIComponent(secret)}`
}

/** Monday only accepts publicly-reachable HTTPS URLs as webhook targets.
 *  Trying to register a `http://localhost:3000` (or any private host) makes
 *  the create_webhook mutation throw - and worse, if combined with the
 *  reset flag, the delete pass goes through FIRST and wipes the good prod
 *  webhooks before the doomed create can even run. Gate both register and
 *  reset behind this check so a stray click from dev can't take production
 *  down. */
function isPublicWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== "https:") return false
    const host = u.hostname
    // Reject obvious private hosts. Production runs on a real domain, so
    // anything matching localhost / 127.0.0.1 / 0.0.0.0 / *.local / *.lan /
    // RFC1918 ranges should not be wired into Monday.
    if (host === "localhost" || host === "0.0.0.0" || host === "127.0.0.1") return false
    if (host.endsWith(".local") || host.endsWith(".lan")) return false
    if (/^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

async function gatherBoards(): Promise<{ onboarding: string; current: string } | null> {
  const config = await getBoardConfig()
  if (!config) return null
  const onboarding = config.onboarding_board_id
  const current = config.current_board_id
  if (!onboarding || !current) return null
  return { onboarding, current }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }
  const boards = await gatherBoards()
  if (!boards) {
    return NextResponse.json({ error: "Board config missing" }, { status: 500 })
  }

  // Per-board list in parallel - Monday's webhooks query is scoped by board.
  const [onboardingWebhooks, currentWebhooks] = await Promise.all([
    listMondayWebhooks(boards.onboarding).catch(() => [] as MondayWebhook[]),
    listMondayWebhooks(boards.current).catch(() => [] as MondayWebhook[]),
  ])

  // Diagnostics for "secret is set in Vercel but the function says it isn't"
  // troubleshooting. Returns metadata only - never the actual secret value -
  // so we can confirm what the running serverless function sees without
  // leaking the credential. Admin-only.
  const rawSecret = process.env.MONDAY_WEBHOOK_SECRET
  const secretLength = rawSecret?.length ?? 0
  const secretConfigured = !!rawSecret && rawSecret.trim().length > 0
  const mondayEnvKeys = Object.keys(process.env)
    .filter((k) => k.toUpperCase().startsWith("MONDAY"))
    .sort()
  const wouldBeUrl = secretConfigured ? buildWebhookUrl(req) : null
  const publicReachable = !!wouldBeUrl && isPublicWebhookUrl(wouldBeUrl)

  return NextResponse.json({
    boards,
    targetEvents: TARGET_EVENTS,
    secretConfigured,
    secretLength,
    mondayEnvKeys,
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
    vercelEnv: process.env.VERCEL_ENV ?? null,
    // Tells the UI to disable register/reset buttons when the current host
    // isn't a public HTTPS URL Monday can call. Prevents the "delete from
    // dev nukes prod webhooks" foot-gun.
    publicReachable,
    currentOrigin: req.nextUrl.origin,
    onboarding: onboardingWebhooks,
    current: currentWebhooks,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }

  const webhookUrl = buildWebhookUrl(req)
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "MONDAY_WEBHOOK_SECRET not set in env - set it before registering." },
      { status: 500 },
    )
  }
  // Guard against running from a non-public host (localhost dev, *.local,
  // private IP). Monday rejects those URLs on create - but the reset path
  // would already have deleted the good prod webhooks by the time we
  // discover this. Refuse loudly instead.
  if (!isPublicWebhookUrl(webhookUrl)) {
    return NextResponse.json(
      {
        error:
          "Refusing to register from a non-public URL - Monday only accepts publicly-reachable HTTPS endpoints. Run this from the production deployment (hub.rocketleads.com), not localhost.",
        attemptedUrl: webhookUrl,
      },
      { status: 400 },
    )
  }
  const boards = await gatherBoards()
  if (!boards) {
    return NextResponse.json({ error: "Board config missing" }, { status: 500 })
  }

  // `?reset=1` mode: delete every existing webhook for our target events on
  // both boards before re-registering. Use when the secret has rotated and
  // old webhooks point at stale URLs that the receiver no longer accepts -
  // a normal Register call would treat them as "exists" and never refresh
  // the URL embedded in Monday's registration.
  const reset = req.nextUrl.searchParams.get("reset") === "1"

  type Result = { boardId: string; event: MondayWebhookEvent; status: "created" | "exists" | "failed" | "deleted"; webhookId?: string; error?: string }
  const results: Result[] = []

  // Reconcile each board independently. Existing-webhook lookup runs once
  // per board so we can compute the "events still missing" set in one shot.
  for (const [label, boardId] of [["onboarding", boards.onboarding], ["current", boards.current]] as const) {
    void label
    let existing: MondayWebhook[] = []
    try {
      existing = await listMondayWebhooks(boardId)
    } catch (e) {
      console.error("[monday-webhooks] list failed for", boardId, e)
    }

    // In reset mode, kill every existing webhook for our target events first
    // so the next create call writes a fresh URL with the current secret.
    if (reset) {
      const toDelete = existing.filter((w) => TARGET_EVENTS.includes(w.event))
      for (const w of toDelete) {
        try {
          await deleteMondayWebhook(w.id)
          results.push({ boardId, event: w.event, status: "deleted", webhookId: w.id })
        } catch (e) {
          results.push({
            boardId,
            event: w.event,
            status: "failed",
            webhookId: w.id,
            error: `delete failed: ${e instanceof Error ? e.message : String(e)}`,
          })
        }
      }
      // Wipe `existing` so the registration pass below treats every target
      // event as missing and re-creates them with the current URL.
      existing = existing.filter((w) => !TARGET_EVENTS.includes(w.event))
    }

    const presentEvents = new Set(
      existing
        // Only count webhooks pointing at OUR URL - a webhook registered
        // against another env (preview vs prod) or to a different consumer
        // is irrelevant for "should we register here?".
        .filter((w) => !w.url || w.url === webhookUrl)
        .map((w) => w.event),
    )

    for (const event of TARGET_EVENTS) {
      if (presentEvents.has(event)) {
        results.push({ boardId, event, status: "exists" })
        continue
      }
      try {
        const webhookId = await createMondayWebhook(boardId, event, webhookUrl)
        results.push({ boardId, event, status: "created", webhookId })
      } catch (e) {
        results.push({
          boardId,
          event,
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  const created = results.filter((r) => r.status === "created").length
  const deleted = results.filter((r) => r.status === "deleted").length
  const failed = results.filter((r) => r.status === "failed").length
  return NextResponse.json({ webhookUrl, reset, created, deleted, failed, results })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return NextResponse.json({ error: "Missing ?id" }, { status: 400 })
  try {
    await deleteMondayWebhook(id)
    return NextResponse.json({ ok: true, deleted: id })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "delete failed" },
      { status: 500 },
    )
  }
}
