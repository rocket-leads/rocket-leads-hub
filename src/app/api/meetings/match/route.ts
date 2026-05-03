import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { runMatcherBatch } from "@/lib/meetings/matcher"

export const maxDuration = 60

/**
 * POST /api/meetings/match
 *
 * Runs the auto-matcher across every meeting still flagged 'unlinked'.
 * Used to backfill old meetings after the matcher was deployed and as a
 * "try again" button after adding a new client (so previously-unmatched
 * recordings re-evaluate against the expanded client list).
 *
 * Idempotent: rows that don't match stay 'unlinked' on every run.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  try {
    const result = await runMatcherBatch(supabase)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Matcher failed" },
      { status: 500 },
    )
  }
}
