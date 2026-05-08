import Link from "next/link"
import { Megaphone, ArrowRight } from "lucide-react"
import { BlockShell } from "./block-shell"

export type PedroProposal = {
  id: string
  title: string
  summary: string | null
  vertical: string | null
  created_at: string
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

export function PedroBlock({
  items,
  totalCount,
}: {
  items: PedroProposal[]
  totalCount: number
}) {
  return (
    <BlockShell
      title="Pedro proposals"
      icon={<Megaphone className="h-4 w-4 text-violet-400" />}
      count={totalCount}
      footerHref="/pedro?tab=knowledge"
      footerLabel="Open Pedro"
      empty={items.length === 0}
      emptyMessage="Niks te reviewen."
    >
      <ul className="divide-y divide-border/30">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/pedro?tab=knowledge&proposalId=${item.id}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                  {item.vertical ? `${item.vertical} · ` : ""}
                  {timeAgo(item.created_at)}
                </p>
                {item.summary && (
                  <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-2">{item.summary}</p>
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
