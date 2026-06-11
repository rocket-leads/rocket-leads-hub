"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Inbox as InboxIcon, History, Users, Archive, Sparkles, Loader2, Download } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { MeetingCard, type ClientOption } from "./meeting-card"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
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
  const locale = useLocale()
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
    if (!confirm(t("meetings.confirm.backfill", locale))) return
    setMatchSummary(null)
    startBackfill(async () => {
      try {
        const res = await fetch("/api/admin/fathom-backfill?hours=2160", { method: "POST" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Backfill failed")
        const skips: string[] = []
        if (data.ingest.skipped_team > 0) skips.push(`${data.ingest.skipped_team} non-RL team`)
        if (data.ingest.skipped_sales > 0) skips.push(`${data.ingest.skipped_sales} sales`)
        if (data.ingest.deduped > 0) skips.push(`${data.ingest.deduped} already in DB`)
        const skipPart = skips.length > 0 ? ` (${skips.join(", ")})` : ""
        setMatchSummary(
          `Backfill: pulled ${data.ingest.fetched} · inserted ${data.ingest.inserted}${skipPart} · ` +
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
      label: t("meetings.tab.unlinked", locale),
      icon: InboxIcon,
      ...(buckets.unlinked.length > 0 ? { dot: "red" as const } : {}),
    },
    { id: "recent", label: t("meetings.tab.recent", locale), icon: History },
    { id: "internal", label: t("meetings.tab.internal", locale), icon: Users },
    { id: "archived", label: t("meetings.tab.archived", locale), icon: Archive },
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
              title={t("meetings.action.backfill_tooltip", locale)}
              className="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
            >
              {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {t("meetings.action.backfill", locale)}
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
              {t("meetings.action.run_matcher", locale)}
            </button>
          )}
        </div>
      </div>

      {matchSummary && (
        <p className="text-[11px] text-muted-foreground">{matchSummary}</p>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {activeTab === "unlinked" && t("meetings.empty.unlinked", locale)}
            {activeTab === "recent" && t("meetings.empty.recent", locale)}
            {activeTab === "internal" && t("meetings.empty.internal", locale)}
            {activeTab === "archived" && t("meetings.empty.archived", locale)}
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
