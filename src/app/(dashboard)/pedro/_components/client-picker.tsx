"use client"

import { useState, useMemo, useRef, useEffect } from "react"
import { ChevronDown, Search, Sparkles, Check } from "lucide-react"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "../page"

type Props = {
  clients: PedroClient[]
  selectedId: string | null
  onSelect: (clientId: string, clientName: string) => void
  /** Triggered after a client is picked — Pedro should run AI auto-fill. */
  onAutoFill: () => void
  loading?: boolean
  /** When true the AI auto-fill button is hidden — used by the global
   *  Pedro picker at the top of the page where the brief tab handles
   *  auto-fill on its own. */
  hideAutoFill?: boolean
}

/**
 * Searchable combobox that lists every hub client the user can access.
 * Picking a client auto-triggers the AI-brief flow (auto-fill all brief
 * fields from Monday updates + Fathom transcripts + Trengo). The user can
 * still re-trigger via "AI auto-fill" button.
 */
export function ClientPicker({ clients, selectedId, onSelect, onAutoFill, loading, hideAutoFill }: Props) {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => clients.find((c) => c.id === selectedId) ?? null,
    [clients, selectedId],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, query])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  return (
    <div className="flex items-center gap-2">
      <div ref={ref} className="relative flex-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full inline-flex items-center justify-between gap-2 h-9 px-3 text-sm font-medium rounded-md border border-input bg-background text-foreground hover:bg-accent transition-colors"
        >
          <span className={selected ? "text-foreground" : "text-muted-foreground"}>
            {selected ? selected.name : t("pedro.picker.placeholder", locale)}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-popover border border-border rounded-lg shadow-md overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("pedro.picker.search", locale)}
                className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
                style={{
                  border: "none",
                  height: "auto",
                  padding: 0,
                  boxShadow: "none",
                }}
              />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted-foreground">
                  {t("pedro.picker.empty", locale)}
                </div>
              ) : (
                filtered.map((c) => {
                  const isSel = c.id === selectedId
                  // Surface the hub-data signals so the AM can tell duplicate
                  // client rows apart (e.g. two "Financieel Verder"s — one
                  // with a kick-off transcript, one empty).
                  const signals: { label: string; tone: "primary" | "emerald" | "muted" }[] = []
                  if (c.hasSavedCampaign) signals.push({ label: t("pedro.picker.signal.saved", locale), tone: "primary" })
                  if (c.hasEval) signals.push({ label: t("pedro.picker.signal.eval", locale), tone: "emerald" })
                  if (c.hasKickoff) signals.push({ label: t("pedro.picker.signal.kickoff", locale), tone: "emerald" })
                  if (c.meetingCount > 0 && !c.hasEval && !c.hasKickoff) {
                    signals.push({ label: t("pedro.picker.signal.meetings", locale, { n: String(c.meetingCount) }), tone: "muted" })
                  }
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        onSelect(c.id, c.name)
                        setOpen(false)
                        setQuery("")
                      }}
                      className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-foreground truncate">{c.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 shrink-0">
                          {c.boardType === "onboarding" ? t("pedro.picker.onboarding", locale) : t("pedro.picker.live", locale)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {signals.map((s, i) => (
                          <span
                            key={i}
                            className={`text-[9.5px] font-medium px-1.5 py-0.5 rounded uppercase tracking-wide ${
                              s.tone === "primary"
                                ? "bg-primary/10 text-primary"
                                : s.tone === "emerald"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {s.label}
                          </span>
                        ))}
                        {isSel && <Check className="h-3.5 w-3.5 text-primary ml-1" />}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>

      {!hideAutoFill && (
        <button
          type="button"
          onClick={onAutoFill}
          disabled={!selectedId || loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {loading ? t("pedro.picker.autofill.loading", locale) : t("pedro.picker.autofill", locale)}
        </button>
      )}
    </div>
  )
}
