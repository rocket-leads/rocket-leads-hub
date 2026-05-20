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
 *        if not already present. Idempotent — re-running is safe and
 *        cheap.
 * DELETE ?id=... → drop a specific webhook (used to clean up a stale
 *                  one pointing at an old domain or expired secret).
 *
 * The webhook URL is derived from the incoming request so it always
 * matches the host the admin is currently on (prod / preview) — no
 * env var to keep in sync.
 */

// Every event type we want Monday to push into the Hub's receiver.
// `create_update` is the legacy inbox-mention path (still registered);
// the rest are the new client-mutation sync.
const TARGET_EVENTS: MondayWebhookEvent[] = [
  "change_column_value",
  "change_name",
  "create_pulse",
  "item_deleted",
  "create_update",
]

function buildWebhookUrl(req: NextRequest): string | null {
  const secret = process.env.MONDAY_WEBHOOK_SECRET
  if (!secret) return null
  // `req.nextUrl.origin` reflects the host the admin is currently using —
  // e.g. https://hub.rocketleads.com on prod, a *.vercel.app preview URL
  // when poking from a deploy preview. Better than a hardcoded env var
  // because it can't drift.
  return `${req.nextUrl.origin}/api/webhooks/monday?secret=${encodeURIComponent(secret)}`
}

async function gatherBoards(): Promise<{ onboarding: string; current: string } | null> {
  const config = await getBoardConfig()
  if (!config) return null
  const onboarding = config.onboarding_board_id
  const current = config.current_board_id
  if (!onboarding || !current) return null
  return { onboarding, current }
}

export async function GET() {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }
  const boards = await gatherBoards()
  if (!boards) {
    return NextResponse.json({ error: "Board config missing" }, { status: 500 })
  }

  // Per-board list in parallel — Monday's webhooks query is scoped by board.
  const [onboardingWebhooks, currentWebhooks] = await Promise.all([
    listMondayWebhooks(boards.onboarding).catch(() => [] as MondayWebhook[]),
    listMondayWebhooks(boards.current).catch(() => [] as MondayWebhook[]),
  ])

  return NextResponse.json({
    boards,
    targetEvents: TARGET_EVENTS,
    secretConfigured: !!process.env.MONDAY_WEBHOOK_SECRET,
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
      { error: "MONDAY_WEBHOOK_SECRET not set in env — set it before registering." },
      { status: 500 },
    )
  }
  const boards = await gatherBoards()
  if (!boards) {
    return NextResponse.json({ error: "Board config missing" }, { status: 500 })
  }

  type Result = { boardId: string; event: MondayWebhookEvent; status: "created" | "exists" | "failed"; webhookId?: string; error?: string }
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
    const presentEvents = new Set(
      existing
        // Only count webhooks pointing at OUR URL — a webhook registered
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
  const failed = results.filter((r) => r.status === "failed").length
  return NextResponse.json({ webhookUrl, created, failed, results })
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
