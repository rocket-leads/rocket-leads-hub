import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchAllItems, getToken as getMondayToken } from "@/lib/integrations/monday"
import { cachedFetch } from "@/lib/cache"

/**
 * Active closers + their Slack mapping. Returns the merged list the
 * NotificationsTab needs: `[{ name, slackId | null }]`.
 *
 * Why client-side: the underlying `fetchAllItems("3762696870")` paginates
 * the whole targets board (1000s of leads, 200 per page → 5-10 round-trips
 * → 5-10s cold). When that ran inside /settings page SSR the entire
 * Settings load blocked on it, including the Board Config tab where the
 * Monday-webhooks register button lives. NotificationsTab now fetches
 * this on mount via useQuery instead, so opening Settings is fast and
 * closers populate in the background only when that tab is opened.
 *
 * Cache: 1h TTL via `cachedFetch` on the names half. Slack mappings come
 * from a cheap Supabase select on every request (the table is tiny).
 */
export async function GET() {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }

  try {
    const supabase = await createAdminClient()
    const [names, { data: slackRows }] = await Promise.all([
      cachedFetch<string[]>(
        "targets_closer_names",
        async () => {
          const token = await getMondayToken()
          const items = await fetchAllItems("3762696870", token)
          const cutoff = new Date()
          cutoff.setUTCDate(cutoff.getUTCDate() - 60)
          const cutoffIso = cutoff.toISOString().slice(0, 10)
          const set = new Set<string>()
          for (const item of items) {
            const wie = item.column_values.find((c) => c.id === "wie_")?.text?.trim()
            if (!wie) continue
            const created = item.column_values.find((c) => c.id === "datum_created")?.text ?? ""
            const createdDate = created.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
            if (createdDate && createdDate >= cutoffIso) set.add(wie)
          }
          return Array.from(set).sort()
        },
        60 * 60 * 1000,
      ),
      supabase
        .from("closer_slack_mappings")
        .select("monday_person_name, slack_user_id"),
    ])

    const slackById: Record<string, string> = {}
    for (const row of slackRows ?? []) slackById[row.monday_person_name] = row.slack_user_id

    const closers = names.map((name) => ({ name, slackId: slackById[name] ?? null }))
    return NextResponse.json({ closers })
  } catch (e) {
    console.error("[admin/closer-names] fetch failed:", e instanceof Error ? e.message : e)
    return NextResponse.json({ closers: [] as Array<{ name: string; slackId: string | null }> })
  }
}
