"use client"

import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  TrendingUp,
  PowerOff,
  CreditCard,
  Inbox,
  ChevronRight,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type {
  OptimizeSuggestion,
  OptimizeSuggestionsResponse,
} from "@/app/api/pedro/optimize-suggestions/route"

/**
 * Action Needed strip at the top of Pedro Optimize.
 *
 * Fetches the current user's accessible Watch List "Action" clients,
 * ranked by severity, and renders them as a horizontal scrollable row of
 * chip-cards. Click on a chip = select that client in the Optimize app
 * (parent's `onSelect` updates URL + localStorage exactly the same way
 * the ClientPicker dropdown does).
 *
 * Roy's framing 2026-06-09: "ik wil dat ik gelijk kan zien - dit zijn
 * klanten waar geoptimaliseerd moet worden, waar nieuwe creatives
 * gemaakt moeten worden, en dat je die daar dan kan selecteren."
 *
 * Empty state: no suggestions == "alles loopt" (genuinely good news);
 * we show a calm green confirmation rather than hiding the strip, so
 * the CM knows the system checked.
 *
 * Selected client gets a ring + tinted background so the CM sees which
 * chip is currently active - matters when bouncing between Optimize
 * tabs (Angles / Scripts / Creatives / Ad Copy) without losing
 * orientation.
 */

const SIGNAL_META: Record<
  OptimizeSuggestion["signalKind"],
  { icon: typeof AlertTriangle; tone: string; label: string }
> = {
  billing: {
    icon: CreditCard,
    tone: "text-red-600 dark:text-red-400",
    label: "Betaalfout",
  },
  live_but_dark: {
    icon: PowerOff,
    tone: "text-orange-600 dark:text-orange-400",
    label: "Live + 0 spend",
  },
  no_leads: {
    icon: AlertTriangle,
    tone: "text-amber-600 dark:text-amber-400",
    label: "0 leads",
  },
  cpl_spike: {
    icon: TrendingUp,
    tone: "text-rose-600 dark:text-rose-400",
    label: "CPL spike",
  },
  other: {
    icon: AlertTriangle,
    tone: "text-amber-600 dark:text-amber-400",
    label: "Action",
  },
}

type Props = {
  selectedClientId: string | null
  onSelect: (clientId: string) => void
}

export function OptimizeSuggestions({ selectedClientId, onSelect }: Props) {
  // Short stale window so the strip reflects the latest cron tick within
  // a couple minutes without hammering Supabase on every render.
  const query = useQuery<OptimizeSuggestionsResponse>({
    queryKey: ["pedro-optimize-suggestions"],
    queryFn: () => fetch("/api/pedro/optimize-suggestions").then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: true,
  })

  if (query.isLoading) {
    return (
      <div className="mb-4">
        <Header count={null} />
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[78px] w-[240px] shrink-0 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const suggestions = query.data?.suggestions ?? []

  if (suggestions.length === 0) {
    return (
      <div className="mb-4">
        <Header count={0} />
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Geen klanten in Action Needed - alles loopt. Kies hieronder zelf een
          klant om te optimaliseren.
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4">
      <Header count={suggestions.length} />
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:thin]">
        {suggestions.map((s) => (
          <SuggestionChip
            key={s.clientId}
            suggestion={s}
            selected={selectedClientId === s.clientId}
            onClick={() => onSelect(s.clientId)}
          />
        ))}
      </div>
    </div>
  )
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-xs">
      <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="font-medium text-foreground/80">
        Action Needed bij jouw klanten
      </span>
      {count != null && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {count}
        </span>
      )}
      <span className="text-muted-foreground/60">
        - klik om direct te gaan optimaliseren
      </span>
    </div>
  )
}

function SuggestionChip({
  suggestion,
  selected,
  onClick,
}: {
  suggestion: OptimizeSuggestion
  selected: boolean
  onClick: () => void
}) {
  const meta = SIGNAL_META[suggestion.signalKind]
  const Icon = meta.icon
  const daysLabel =
    suggestion.daysInBucket == null
      ? null
      : suggestion.daysInBucket === 0
        ? "vandaag"
        : suggestion.daysInBucket === 1
          ? "1 dag"
          : `${suggestion.daysInBucket} dagen`

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group shrink-0 w-[260px] text-left rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-all",
        "hover:shadow-md hover:-translate-y-px",
        selected
          ? "border-primary ring-2 ring-primary/30 bg-primary/[0.04]"
          : "border-border hover:border-border/80",
      )}
      title={suggestion.insight}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.tone)} />
            <span className={cn("text-[10px] font-semibold uppercase tracking-wide", meta.tone)}>
              {meta.label}
            </span>
            {daysLabel && (
              <span className="text-[10px] text-muted-foreground/70 ml-auto shrink-0">
                {daysLabel}
              </span>
            )}
          </div>
          <div className="font-medium text-sm truncate">{suggestion.name}</div>
          <div className="text-[11px] leading-snug text-muted-foreground line-clamp-2 mt-0.5">
            {suggestion.insight}
          </div>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 mt-1 transition-transform",
            selected
              ? "text-primary translate-x-0.5"
              : "text-muted-foreground/40 group-hover:translate-x-0.5",
          )}
        />
      </div>
    </button>
  )
}
