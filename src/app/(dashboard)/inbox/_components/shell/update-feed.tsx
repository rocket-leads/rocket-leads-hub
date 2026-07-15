"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Circle, User, CircleCheck, Inbox as InboxIcon, Loader2 } from "lucide-react"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import { useLocale } from "@/lib/i18n/client"
import { UpdateCard } from "./update-card"
import type { InternalType, DeadlineFilter } from "./internal-rail"
import type { ReactionSummary } from "@/lib/inbox/reactions"
import type { InboxItem } from "@/types/inbox"

/** Internal ticket state, mirroring the external Open / Assigned / Closed split
 *  so both scopes read identically:
 *   - Open     : untouched (update unread, task open)
 *   - Assigned : picked up (task in_progress)
 *   - Closed   : checked off (update read, task done/cancelled) */
type TicketState = "open" | "assigned" | "closed"
function internalState(item: InboxItem): TicketState {
  if (item.kind === "update") return item.status === "unread" ? "open" : "closed"
  if (item.status === "done" || item.status === "cancelled") return "closed"
  if (item.status === "in_progress") return "assigned"
  return "open"
}

/** Local YYYY-MM-DD for deadline comparisons (client-only, so real Date is fine). */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
function plusDaysStr(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function matchesDeadline(item: InboxItem, deadline: DeadlineFilter, today: string, weekEnd: string): boolean {
  if (deadline === "all") return true
  if (deadline === "none") return !item.dueDate
  if (!item.dueDate) return false
  if (deadline === "overdue") return item.dueDate < today
  if (deadline === "today") return item.dueDate === today
  if (deadline === "week") return item.dueDate >= today && item.dueDate <= weekEnd
  return true
}

type Props = {
  items: InboxItem[]
  currentUserId: string
  types: ReadonlySet<InternalType>
  deadline: DeadlineFilter
  loading: boolean
  onChanged: () => void
}

export function UpdateFeed({ items, currentUserId, types, deadline, loading, onChanged }: Props) {
  const locale = useLocale()
  const [state, setState] = useState<TicketState>("open")
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, ReactionSummary[]>>({})

  const today = todayStr()
  const weekEnd = plusDaysStr(7)

  // Type + deadline scoped set (rail filters); state split happens on top.
  const scoped = useMemo(
    () =>
      items
        .filter((it) => (it.kind === "task" || it.kind === "update") && types.has(it.kind as InternalType))
        .filter((it) => matchesDeadline(it, deadline, today, weekEnd))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items, types, deadline, today, weekEnd],
  )
  const counts = useMemo(() => {
    const c: Record<TicketState, number> = { open: 0, assigned: 0, closed: 0 }
    for (const it of scoped) c[internalState(it)] += 1
    return c
  }, [scoped])
  const visible = useMemo(() => scoped.filter((it) => internalState(it) === state), [scoped, state])

  const filterTabs: TopTab<TicketState>[] = [
    { id: "open", label: "Open", icon: Circle, count: counts.open, accent: "primary" },
    { id: "assigned", label: locale === "nl" ? "Opgepakt" : "Assigned", icon: User, count: counts.assigned },
    { id: "closed", label: locale === "nl" ? "Gesloten" : "Closed", icon: CircleCheck, count: counts.closed },
  ]

  // One bulk reaction fetch for the whole visible page.
  const idsKey = useMemo(() => visible.map((i) => i.id).sort().join(","), [visible])
  const reactionsQuery = useQuery<{ reactions: Record<string, ReactionSummary[]> }>({
    queryKey: ["inbox-reactions", idsKey],
    queryFn: () => fetch(`/api/inbox/reactions?itemIds=${encodeURIComponent(idsKey)}`).then((r) => r.json()),
    enabled: idsKey.length > 0,
    staleTime: 30 * 1000,
  })
  const reactionsMap = useMemo(
    () => ({ ...(reactionsQuery.data?.reactions ?? {}), ...reactionOverrides }),
    [reactionsQuery.data?.reactions, reactionOverrides],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TopTabs tabs={filterTabs} value={state} onChange={setState} />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground/70">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
              <InboxIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">Nothing here</p>
          </div>
        ) : (
          visible.map((item) => (
            <UpdateCard
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              reactions={reactionsMap[item.id] ?? []}
              onReactionsChange={(id, next) => setReactionOverrides((prev) => ({ ...prev, [id]: next }))}
              onChanged={onChanged}
            />
          ))
        )}
      </div>
    </div>
  )
}
