"use client"

import { ListTodo, MessageSquare, Check, CalendarClock, CalendarX, CalendarDays, Sun, LayoutList } from "lucide-react"
import { cn } from "@/lib/utils"

export type InternalType = "task" | "update"
export type DeadlineFilter = "all" | "overdue" | "today" | "week" | "none"

const TYPE_META: Record<InternalType, { label: string; icon: typeof ListTodo; dot: string }> = {
  task: { label: "Tasks", icon: ListTodo, dot: "bg-violet-500" },
  update: { label: "Updates", icon: MessageSquare, dot: "bg-sky-500" },
}

const DEADLINE_OPTIONS: Array<{ id: DeadlineFilter; label: string; icon: typeof CalendarDays }> = [
  { id: "all", label: "Any deadline", icon: CalendarDays },
  { id: "overdue", label: "Overdue", icon: CalendarX },
  { id: "today", label: "Due today", icon: Sun },
  { id: "week", label: "Due this week", icon: CalendarClock },
  { id: "none", label: "No deadline", icon: LayoutList },
]

type Props = {
  types: ReadonlySet<InternalType>
  counts: Record<InternalType, number>
  onToggleType: (t: InternalType) => void
  onSelectAllTypes: () => void
  deadline: DeadlineFilter
  onDeadlineChange: (d: DeadlineFilter) => void
}

export function InternalRail({
  types,
  counts,
  onToggleType,
  onSelectAllTypes,
  deadline,
  onDeadlineChange,
}: Props) {
  const allTypes = types.has("task") && types.has("update")
  return (
    <div className="flex flex-col gap-1" role="group" aria-label="Filters">
      <div className="px-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Type</p>
      </div>

      <button
        type="button"
        onClick={onSelectAllTypes}
        aria-pressed={allTypes}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          allTypes ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-[4px] border",
            allTypes ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40",
          )}
        >
          {allTypes && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        All types
      </button>

      {(Object.keys(TYPE_META) as InternalType[]).map((t) => {
        const meta = TYPE_META[t]
        const Icon = meta.icon
        const on = types.has(t)
        const count = counts[t] ?? 0
        return (
          <button
            key={t}
            type="button"
            onClick={() => onToggleType(t)}
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              on ? "bg-muted/70 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-[4px] border shrink-0",
                on ? "bg-foreground/90 border-foreground/90 text-background" : "border-muted-foreground/40",
              )}
            >
              {on && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
            <Icon className="h-4 w-4 shrink-0 opacity-70" />
            <span>{meta.label}</span>
            {count > 0 && <span className="nav-badge ml-auto">{count > 99 ? "99+" : count}</span>}
          </button>
        )
      })}

      <div className="mt-3 px-3">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">Deadline</p>
      </div>

      {DEADLINE_OPTIONS.map((opt) => {
        const Icon = opt.icon
        const active = deadline === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onDeadlineChange(opt.id)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-muted/70 text-foreground font-medium" : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 opacity-70" />
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
