"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FilePlus, Search, Loader2, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CreateInvoiceDialog } from "./create-invoice-dialog"

/**
 * Global "New invoice" entry point (top-right on the Billing page). Lets
 * finance invoice ANY client without hunting for its row - pick a client from
 * search, then the same create-invoice dialog opens (one-off or monthly, with
 * line items, pro-rata and discounts). Ideal for ad-hoc one-offs like a content
 * shoot. Reuses the per-row CreateInvoiceDialog unchanged.
 */
type SearchResult = { mondayItemId: string; name: string; status: string | null }

type Seed = {
  mondayItemId: string
  name: string
  stripeCustomerId: string | null
  cycleStartDate: string | null
  fee: number
  adBudget: number
  usesRocketLeadsAdAccount: boolean
}

export function GlobalCreateInvoice() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seed, setSeed] = useState<Seed | null>(null)

  const clientsQuery = useQuery<SearchResult[]>({
    queryKey: ["client-search-all"],
    queryFn: async () => {
      const r = await fetch("/api/clients/search")
      if (!r.ok) throw new Error("Client search failed")
      return r.json()
    },
    enabled: pickerOpen,
    staleTime: 60 * 1000,
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = clientsQuery.data ?? []
    return (q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list).slice(0, 60)
  }, [clientsQuery.data, query])

  async function pick(mondayItemId: string) {
    setLoadingId(mondayItemId)
    setError(null)
    try {
      const r = await fetch(`/api/clients/${mondayItemId}/invoice-seed`)
      const data = (await r.json().catch(() => ({}))) as { ok?: boolean; seed?: Seed; error?: string }
      if (!r.ok || !data.ok || !data.seed) {
        setError(data.error ?? "Failed to load client")
        setLoadingId(null)
        return
      }
      const s = data.seed
      if (!s.stripeCustomerId) {
        setError(`${s.name} has no Stripe customer linked. Link one on the client's Billing tab first.`)
        setLoadingId(null)
        return
      }
      setSeed(s)
      setPickerOpen(false)
      setQuery("")
      setLoadingId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load client")
      setLoadingId(null)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => { setError(null); setPickerOpen(true) }}>
        <FilePlus className="h-3.5 w-3.5" />
        New invoice
      </Button>

      <Dialog open={pickerOpen} onOpenChange={(o) => { if (!o) { setPickerOpen(false); setQuery("") } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New invoice - pick a client</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
              <Input
                autoFocus
                placeholder="Search clients…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-md border border-border/60 divide-y divide-border/40">
              {clientsQuery.isLoading ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2 w-full justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading clients…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No clients match.</div>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.mondayItemId}
                    type="button"
                    disabled={loadingId !== null}
                    onClick={() => pick(c.mondayItemId)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <span className="truncate">{c.name}</span>
                    <span className="shrink-0 inline-flex items-center gap-2">
                      {c.status && (
                        <span className="text-[11px] text-muted-foreground/70 capitalize">{c.status.replace("_", " ")}</span>
                      )}
                      {loadingId === c.mondayItemId && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {seed && seed.stripeCustomerId && (
        <CreateInvoiceDialog
          mondayItemId={seed.mondayItemId}
          stripeCustomerId={seed.stripeCustomerId}
          clientName={seed.name}
          fee={seed.fee}
          adBudget={seed.adBudget}
          usesRocketLeadsAdAccount={seed.usesRocketLeadsAdAccount}
          cycleStartDate={seed.cycleStartDate}
          onClose={() => setSeed(null)}
        />
      )}
    </>
  )
}
