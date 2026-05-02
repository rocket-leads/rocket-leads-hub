"use client"

import { useState, useMemo } from "react"
import { ChevronDown, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ClientInformationPanel } from "@/components/client-information-panel"
import { mondayStatusToHub, STATUS_LABELS, STATUS_TONES } from "@/lib/clients/status"
import type { MondayClient } from "@/lib/integrations/monday"

type Props = {
  clients: MondayClient[]
}

export function ClientsTab({ clients }: Props) {
  const [search, setSearch] = useState("")
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.firstName.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q),
    )
  }, [clients, search])

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.name.localeCompare(b.name)),
    [filtered],
  )

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium mb-1">Clients</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Edit any client&apos;s details — name, IDs, financials, team. Changes write back to Monday and sync to the Hub.
        </p>
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
        {sorted.map((client) => {
          const isOpen = openId === client.mondayItemId
          const hubStatus = mondayStatusToHub(client.campaignStatus, client.boardType)
          const tone = STATUS_TONES[hubStatus]

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
                    {STATUS_LABELS[hubStatus]}
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
        {sorted.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">No clients found</p>
        )}
      </div>
    </div>
  )
}
