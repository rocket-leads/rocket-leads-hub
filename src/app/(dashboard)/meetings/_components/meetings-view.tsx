"use client"

import { useMemo, useState } from "react"
import { Inbox as InboxIcon, History, Users } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { MeetingCard } from "./meeting-card"
import type { MeetingRow } from "@/lib/meetings/types"

type TabId = "unlinked" | "recent" | "internal"

type Props = {
  meetings: MeetingRow[]
  clientNameById: Record<string, string>
}

function isUnlinked(m: MeetingRow): boolean {
  return m.link_status === "unlinked" || m.link_status === "suggested" || m.link_status === "prospect"
}

export function MeetingsView({ meetings, clientNameById }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("unlinked")

  const buckets = useMemo(() => {
    const unlinked = meetings.filter(isUnlinked)
    const recent = meetings.filter((m) => m.link_status === "linked")
    const internal = meetings.filter((m) => m.link_status === "internal")
    return { unlinked, recent, internal }
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
  ]

  const visible =
    activeTab === "unlinked" ? buckets.unlinked : activeTab === "recent" ? buckets.recent : buckets.internal

  return (
    <div className="space-y-6">
      <TopTabs<TabId> tabs={tabs} value={activeTab} onChange={setActiveTab} />

      <p className="text-[11px] text-muted-foreground">
        {activeTab === "unlinked" &&
          `${buckets.unlinked.length} meeting${buckets.unlinked.length === 1 ? "" : "s"} not yet matched to a client. The matcher (C.5.b) will auto-link these once it ships.`}
        {activeTab === "recent" &&
          `${buckets.recent.length} linked meeting${buckets.recent.length === 1 ? "" : "s"} in the last 60 days.`}
        {activeTab === "internal" &&
          `${buckets.internal.length} internal RL-team meeting${buckets.internal.length === 1 ? "" : "s"} in the last 60 days.`}
      </p>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {activeTab === "unlinked" && "Nothing to triage — all recent meetings are matched."}
            {activeTab === "recent" && "No linked meetings yet. Once the matcher ships and pairs recordings to clients, they'll show here."}
            {activeTab === "internal" && "No internal team meetings recorded in the last 60 days."}
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
            />
          ))}
        </div>
      )}
    </div>
  )
}
