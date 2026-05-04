"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Search, Link2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type ClientOption = {
  monday_item_id: string
  name: string
  monday_board_type: "onboarding" | "current" | string | null
}

type Props = {
  trengoContactId: string
  contactName: string
  onClose: () => void
  onLinked: (mondayItemId: string, clientName: string, backfilled: number) => void
}

/**
 * Dialog launched from the "Unlinked Trengo contact" banner. Shows a typeahead
 * over all clients the user can see, then on Save:
 *   - writes the contact id onto the client's Monday `trengo_contact_id` column,
 *   - backfills every unlinked inbox event for this contact id with the new
 *     client_id and (where applicable) the right AM.
 *
 * Calls back to the parent with the count of rows backfilled so it can show
 * a concrete confirmation toast / message.
 */
export function LinkTrengoContactDialog({ trengoContactId, contactName, onClose, onLinked }: Props) {
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clientsQuery = useQuery<ClientOption[]>({
    queryKey: ["inbox-link-clients"],
    queryFn: () => fetch("/api/clients/search").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const clients = clientsQuery.data ?? []
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients.slice(0, 30)
    return clients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 30)
  }, [clients, search])

  const selectedClient = clients.find((c) => c.monday_item_id === selectedId)

  async function submit() {
    if (!selectedClient) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/inbox/link-trengo-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trengoContactId,
          mondayItemId: selectedClient.monday_item_id,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        backfilled?: number
        error?: string
      }
      if (!res.ok) {
        setError(data.error ?? "Linking failed")
        return
      }
      onLinked(selectedClient.monday_item_id, selectedClient.name, data.backfilled ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Linking failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Trengo contact</DialogTitle>
        </DialogHeader>

        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400/90 leading-snug">
          <p>
            <span className="font-medium">{contactName}</span>{" "}
            <span className="font-mono text-[11px]">({trengoContactId})</span>
          </p>
          <p className="text-amber-600/80 dark:text-amber-400/70 mt-0.5">
            We&apos;ll write this Trengo Contact ID onto the client you pick and
            re-route any past unlinked messages to that client.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="pl-8"
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
          {clientsQuery.isLoading ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {search ? "No clients match." : "No clients available."}
            </p>
          ) : (
            filtered.map((c) => {
              const active = c.monday_item_id === selectedId
              return (
                <button
                  key={c.monday_item_id}
                  type="button"
                  onClick={() => setSelectedId(c.monday_item_id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.name}</span>
                    {c.monday_board_type === "onboarding" && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 shrink-0">
                        onboarding
                      </span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!selectedClient || submitting}>
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Link
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
