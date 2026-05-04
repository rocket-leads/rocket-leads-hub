import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/server"
import { MEETING_ROW_COLUMNS, type MeetingRow } from "@/lib/meetings/types"
import { MeetingsView } from "./_components/meetings-view"

export const dynamic = "force-dynamic"

export default async function MeetingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const supabase = await createAdminClient()

  // Pull a generous window — last 60 days, max 300 rows. The view splits this
  // into Unlinked / Recent / Internal tabs client-side. We don't care about
  // older meetings on the global page; per-client tab shows full history per
  // client.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rawMeetings } = await supabase
    .from("meetings")
    .select(MEETING_ROW_COLUMNS)
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
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
          Meetings
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          Fathom recordings from the Rocket Leads teams. Linked meetings also
          appear on the client&apos;s page.
        </p>
      </div>

      <MeetingsView
        meetings={meetings}
        clientNameById={clientNameById}
        clients={clients}
        isAdmin={isAdmin}
      />
    </div>
  )
}
