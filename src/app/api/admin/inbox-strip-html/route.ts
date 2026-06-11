import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { stripHtml } from "@/lib/html"

/**
 * One-shot cleanup: re-strips HTML from `inbox_events` rows that were
 * ingested before the Monday webhook started stripping at write-time.
 *
 * Targets rows where `title` or `body` still contains tag markup (`<…>`).
 * Idempotent - re-running on already-clean rows is a no-op. Admin-only.
 */
export async function POST() {
  return run()
}

export async function GET() {
  return run()
}

async function run() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const supabase = await createAdminClient()

  // Pull anything that looks HTML-tainted. ilike `%<%` catches `<p>`, `<a `,
  // `<br`, etc. - same heuristic for both columns.
  const { data, error } = await supabase
    .from("inbox_events")
    .select("id, title, body")
    .or("title.ilike.%<%,body.ilike.%<%")
    .limit(2000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let updated = 0
  let skipped = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const row of data ?? []) {
    const cleanTitleFull = stripHtml(row.title)
    const cleanTitle =
      cleanTitleFull.length > 100 ? cleanTitleFull.slice(0, 100) + "…" : cleanTitleFull
    const cleanBody = row.body ? stripHtml(row.body) : null

    if (cleanTitle === row.title && cleanBody === row.body) {
      skipped++
      continue
    }

    const { error: upErr } = await supabase
      .from("inbox_events")
      .update({ title: cleanTitle, body: cleanBody })
      .eq("id", row.id)

    if (upErr) {
      failures.push({ id: row.id, error: upErr.message })
    } else {
      updated++
    }
  }

  return NextResponse.json({
    scanned: data?.length ?? 0,
    updated,
    skipped,
    failed: failures.length,
    failures,
  })
}

export const maxDuration = 60
