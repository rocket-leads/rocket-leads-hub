"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Inbox as InboxIcon, History, Users, Archive, Sparkles, Loader2, Download } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { MeetingCard, type ClientOption } from "./meeting-card"
import type { MeetingRow } from "@/lib/meetings/types"

type TabId = "unlinked" | "recent" | "internal" | "archived"

type Props = {
  meetings: MeetingRow[]
  clientNameById: Record<string, string>
  clients: ClientOption[]
  isAdmin?: boolean
}

function isUnlinked(m: MeetingRow): boolean {
  return m.link_status === "unlinked" || m.link_status === "suggested" || m.link_status === "prospect"
}

export function MeetingsView({ meetings, clientNameById, clients, isAdmin = false }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>("unlinked")
  const [matching, startMatch] = useTransition()
  const [backfilling, startBackfill] = useTransition()
  const [matchSummary, setMatchSummary] = useState<string | null>(null)

  function runMatcher() {
    setMatchSummary(null)
    startMatch(async () => {
      try {
        const res = await fetch("/api/meetings/match", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Matcher failed")
        const fromArchive = data.unarchivedAndLinked > 0
          ? ` (${data.unarchivedAndLinked} from archive)`
          : ""
        setMatchSummary(
          `${data.linked} linked${fromArchive} · ${data.suggested} suggested · ${data.unmatched} unmatched`,
        )
        router.refresh()
      } catch (e) {
        setMatchSummary(e instanceof Error ? e.message : "Matcher failed")
      }
    })
  }

  function runBackfill() {
    if (!confirm("Pull last 90 days from Fathom + run matcher? Can take 30-60 seconds.")) return
    setMatchSummary(null)
    startBackfill(async () => {
      try {
        const res = await fetch("/api/admin/fathom-backfill?hours=2160", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Backfill failed")
        setMatchSummary(
          `Backfill: pulled ${data.ingest.fetched} · inserted ${data.ingest.inserted} · ` +
            `skipped ${data.ingest.skipped_team + data.ingest.skipped_sales} · ` +
            `then matcher: ${data.match.linked} linked · ${data.match.suggested} suggested`,
        )
        router.refresh()
      } catch (e) {
        setMatchSummary(e instanceof Error ? e.message : "Backfill failed")
      }
    })
  }

  const buckets = useMemo(() => {
    const unlinked = meetings.filter(isUnlinked)
    const recent = meetings.filter((m) => m.link_status === "linked")
    const internal = meetings.filter((m) => m.link_status === "internal")
    const archived = meetings.filter((m) => m.link_status === "archived")
    return { unlinked, recent, internal, archived }
  }, [meetings])

  const tabs: TopTab<TabId>[] = [
    {
      id: "unlinked",
      label: "Unlinked",
      icon: InboxIcon,
      ...(buckets.unlinked.length > 0 ? { dot: "red" as const } : {}),
    },
    { id: "recent", label: "Recent", icon: History },
    { id: "internal", label: "Internal", icon: Users },
    { id: "archived", label: "Archived", icon: Archive },
  ]

  const visible =
    activeTab === "unlinked"
      ? buckets.unlinked
      : activeTab === "recent"
        ? buckets.recent
        : activeTab === "internal"
          ? buckets.internal
          : buckets.archived

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <TopTabs<TabId> tabs={tabs} value={activeTab} onChange={setActiveTab} />
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <button
              type="button"
              onClick={runBackfill}
              disabled={backfilling || matching}
              title="Pull last 90 days from Fathom + run matcher"
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Backfill 90d
            </button>
          )}
          {activeTab === "unlinked" && buckets.unlinked.length > 0 && (
            <button
              type="button"
              onClick={runMatcher}
              disabled={matching || backfilling}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {matching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Run matcher
            </button>
          )}
        </div>
      </div>

      {matchSummary && (
        <p className="text-[11px] text-muted-foreground">{matchSummary}</p>
      )}

      <p className="text-[11px] text-muted-foreground">
        {activeTab === "unlinked" &&
          `${buckets.unlinked.length} meeting${buckets.unlinked.length === 1 ? "" : "s"} not yet matched to a client. Link manually below or archive if no link is needed.`}
        {activeTab === "recent" &&
          `${buckets.recent.length} linked meeting${buckets.recent.length === 1 ? "" : "s"} in the last 60 days.`}
        {activeTab === "internal" &&
          `${buckets.internal.length} internal RL-team meeting${buckets.internal.length === 1 ? "" : "s"} in the last 60 days.`}
        {activeTab === "archived" &&
          `${buckets.archived.length} archived meeting${buckets.archived.length === 1 ? "" : "s"}. Use Unarchive to restore to triage.`}
      </p>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {activeTab === "unlinked" && "Nothing to triage — all recent meetings are matched."}
            {activeTab === "recent" && "No linked meetings yet."}
            {activeTab === "internal" && "No internal team meetings recorded in the last 60 days."}
            {activeTab === "archived" && "Nothing archived."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => (
            <MeetingCard
              key={m.id}
              meeting={m}
              showClientLink
              clientName={m.client_id ? clientNameById[m.client_id] ?? null : null}
              clients={clients}
            />
          ))}
        </div>
      )}
    </div>
  )
}
