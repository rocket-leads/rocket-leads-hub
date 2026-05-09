"use client"

import { useState, useMemo } from "react"
import { ChevronDown, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ClientInformationPanel } from "@/components/client-information-panel"
import { mondayStatusToHub, statusLabel, statusTone, type ClientStatus } from "@/lib/clients/status"
import type { MondayClient } from "@/lib/integrations/monday"
import { cn } from "@/lib/utils"

type Props = {
  clients: MondayClient[]
}

/** Tabs shown above the clients list. Onboarding lives on the dedicated
 *  Onboarding view, so we only surface the three "operational" statuses
 *  here — Live is the default because that's what 95% of edits target. */
const STATUS_TABS: ClientStatus[] = ["live", "on_hold", "churned"]

export function ClientsTab({ clients }: Props) {
  const [statusFilter, setStatusFilter] = useState<ClientStatus>("live")
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  // Pre-compute Hub status per client once so the tab counts and the list
  // share the same classification — no chance of a count saying "5 churned"
  // while the list shows 6 due to a re-classification mismatch.
  const withStatus = useMemo(
    () => clients.map((c) => ({ client: c, hubStatus: mondayStatusToHub(c.campaignStatus, c.boardType) })),
    [clients],
  )

  const counts = useMemo(() => {
    const out: Record<ClientStatus, number> = { onboarding: 0, live: 0, on_hold: 0, churned: 0 }
    for (const { hubStatus } of withStatus) {
      if (hubStatus) out[hubStatus]++
    }
    return out
  }, [withStatus])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withStatus
      .filter(({ hubStatus }) => hubStatus === statusFilter)
      .filter(({ client }) => {
        if (!q) return true
        return (
          client.name.toLowerCase().includes(q) ||
          client.firstName.toLowerCase().includes(q) ||
          client.companyName.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => a.client.name.localeCompare(b.client.name))
  }, [withStatus, statusFilter, search])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Clients</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Edit any client&apos;s details — name, IDs, financials, team. Changes write back to Monday and sync to the Hub.
        </p>
      </div>

      {/* Status tabs — default Live so the rolodex of churned clients
          isn't the first thing the admin sees. */}
      <div className="flex items-center gap-1 border-b border-border/40">
        {STATUS_TABS.map((status) => {
          const active = statusFilter === status
          const tone = statusTone(status)
          return (
            <button
              key={status}
              type="button"
              onClick={() => {
                setStatusFilter(status)
                setOpenId(null)
              }}
              className={cn(
                "relative inline-flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
              {statusLabel(status)}
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {counts[status]}
              </span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          )
        })}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      <div className="space-y-2">
        {filtered.map(({ client, hubStatus }) => {
          const isOpen = openId === client.mondayItemId
          const tone = statusTone(hubStatus)

          return (
            <div
              key={client.mondayItemId}
              className="rounded-lg border border-border/60 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : client.mondayItemId)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-medium text-sm truncate">{client.name}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium shrink-0 ${tone.pill}`}
                  >
                    <span className={`h-1 w-1 rounded-full ${tone.dot}`} />
                    {statusLabel(hubStatus)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 shrink-0">
                    {client.boardType}
                  </span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="border-t border-border/50 px-4 py-4 bg-muted/10">
                  <ClientInformationPanel client={client} />
                </div>
              )}
            </div>
          )
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No {statusLabel(statusFilter).toLowerCase()} clients{search ? " matching your search" : ""}.
          </p>
        )}
      </div>
    </div>
  )
}
