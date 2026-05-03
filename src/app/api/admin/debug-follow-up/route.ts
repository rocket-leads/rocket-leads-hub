import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards } from "@/lib/integrations/monday"

/**
 * Throwaway diagnostic — dumps every unique value of the `followUpStatus`
 * column across all clients, with counts and sample client names. Used to
 * audit what the actual labels in Monday look like so the seed matcher can
 * be built against real data instead of guesses.
 *
 * Admin-only. Safe to delete once the matcher is correct.
 */
async function run() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Always live — the cron cache may be missing recently-added MondayClient
  // fields, which would silently hide whatever bug we're trying to debug.
  const data = await fetchBothBoards()
  const clients = [...data.onboarding, ...data.current]

  const buckets = new Map<string, { count: number; samples: string[] }>()
  for (const c of clients) {
    const key = c.followUpStatus || "(empty)"
    const bucket = buckets.get(key) ?? { count: 0, samples: [] }
    bucket.count++
    if (bucket.samples.length < 3) bucket.samples.push(c.name)
    buckets.set(key, bucket)
  }

  const summary = Array.from(buckets.entries())
    .map(([label, { count, samples }]) => ({ label, count, samples }))
    .sort((a, b) => b.count - a.count)

  // Also surface the specific client Roy mentioned so we can see exactly what
  // got read from Monday vs what the matcher decided.
  const varel = clients.find((c) => /varel/i.test(c.name))

  return NextResponse.json({
    totalClients: clients.length,
    uniqueLabels: summary,
    varelDebug: varel
      ? {
          name: varel.name,
          followUpStatus: varel.followUpStatus,
          followUpFee: varel.followUpFee,
          serviceFee: varel.serviceFee,
          adBudget: varel.adBudget,
        }
      : null,
  })
}

export const GET = run
export const POST = run
export const maxDuration = 60
