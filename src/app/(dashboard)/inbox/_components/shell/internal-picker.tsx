"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { InternalRail, type InternalType, type DeadlineFilter } from "./internal-rail"

/**
 * Compact Type/Deadline selector that folds the old internal rail into the
 * thread-list header — the 2-column 187N layout (list + docked detail), no
 * separate rail column. The trigger summarises the active filters; the dropdown
 * holds the full Type + Deadline controls (the existing InternalRail verbatim).
 * Mirrors the ChannelPicker on the external side. Roy 2026-07-24.
 */
const DEADLINE_LABEL: Record<DeadlineFilter, string> = {
  all: "Any deadline",
  overdue: "Overdue",
  today: "Due today",
  week: "Due this week",
  none: "No deadline",
}

type Props = {
  types: ReadonlySet<InternalType>
  counts: Record<InternalType, number>
  deadline: DeadlineFilter
  onToggleType: (t: InternalType) => void
  onSelectAllTypes: () => void
  onDeadlineChange: (d: DeadlineFilter) => void
}

export function InternalPicker({
  types,
  counts,
  deadline,
  onToggleType,
  onSelectAllTypes,
  onDeadlineChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const hasTask = types.has("task")
  const hasUpdate = types.has("update")
  const typeLabel = hasTask && hasUpdate ? "All types" : hasTask ? "Tasks" : hasUpdate ? "Updates" : "No types"
  const label = deadline === "all" ? typeLabel : `${typeLabel} · ${DEADLINE_LABEL[deadline]}`
  const count = (hasTask ? counts.task : 0) + (hasUpdate ? counts.update : 0)

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:border-foreground/20"
      >
        <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
        {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-lg">
          <InternalRail
            types={types}
            counts={counts}
            onToggleType={onToggleType}
            onSelectAllTypes={onSelectAllTypes}
            deadline={deadline}
            onDeadlineChange={onDeadlineChange}
          />
        </div>
      )}
    </div>
  )
}
