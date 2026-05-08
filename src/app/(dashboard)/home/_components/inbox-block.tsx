import Link from "next/link"
import { Inbox, ArrowRight, MessageSquare, ListChecks, Bell } from "lucide-react"
import { BlockShell } from "./block-shell"
import type { InboxItem } from "@/types/inbox"

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function kindIcon(kind: InboxItem["kind"]) {
  if (kind === "task") return <ListChecks className="h-3 w-3 text-violet-400" />
  if (kind === "update") return <Bell className="h-3 w-3 text-amber-400" />
  return <MessageSquare className="h-3 w-3 text-muted-foreground/60" />
}

export function InboxBlock({ items, totalCount }: { items: InboxItem[]; totalCount: number }) {
  return (
    <BlockShell
      title="Inbox voor jou"
      icon={<Inbox className="h-4 w-4 text-violet-400" />}
      count={totalCount}
      footerHref="/inbox"
      footerLabel="Open Inbox"
      empty={items.length === 0}
      emptyMessage="Inbox zero — niks toegewezen."
    >
      <ul className="divide-y divide-border/30">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/inbox?id=${item.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
            >
              <span className="mt-1 shrink-0">{kindIcon(item.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                  {item.clientName} · {item.authorName} · {timeAgo(item.createdAt)}
                </p>
                {item.body && (
                  <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-1">{item.body}</p>
                )}
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors mt-1" />
            </Link>
          </li>
        ))}
      </ul>
    </BlockShell>
  )
}
