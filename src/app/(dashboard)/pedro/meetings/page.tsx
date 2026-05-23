import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import { MEETING_ROW_COLUMNS, type MeetingRow } from "@/lib/meetings/types"
import { MeetingsView } from "./_components/meetings-view"
import { PageHeader } from "@/components/ui/page-header"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export const dynamic = "force-dynamic"

export default async function MeetingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const supabase = await createAdminClient()
  const locale = await getUserLocale(session.user.id)

  // Pull a generous window — last 60 days, max 300 rows. The view splits this
  // into Unlinked / Recent / Internal tabs client-side. We don't care about
  // older meetings on the global page; per-client tab shows full history per
  // client.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rawMeetings } = await supabase
    .from("meetings")
    .select(MEETING_ROW_COLUMNS)
    // Sales calls are ingested for the Targets dashboard insight loop but
    // hidden from the team meetings overview — they aren't actionable as
    // "linked client meetings".
    .neq("meeting_type", "sales")
    .gte("scheduled_at", cutoff)
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(300)

  const meetings = (rawMeetings ?? []) as MeetingRow[]

  // Pull every client (id + name) so the manual link picker can search the
  // full set, not just the ones that already have a meeting attached.
  const { data: allClients } = await supabase
    .from("clients")
    .select("monday_item_id, name")
    .order("name", { ascending: true })

  const clients = (allClients ?? []).map((c) => ({ id: c.monday_item_id, name: c.name }))
  const clientNameById = Object.fromEntries(clients.map((c) => [c.id, c.name]))
  const isAdmin = session.user.role === "admin"

  return (
    <div>
      <PageHeader
        title={t("meetings.title", locale)}
        subtitle={t("meetings.subtitle", locale)}
      />

      <MeetingsView
        meetings={meetings}
        clientNameById={clientNameById}
        clients={clients}
        isAdmin={isAdmin}
      />
    </div>
  )
}
