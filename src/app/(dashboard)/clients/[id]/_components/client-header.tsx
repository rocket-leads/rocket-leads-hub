import type { MondayClient } from "@/lib/integrations/monday"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "In development": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "On hold": "bg-gray-500/15 text-gray-400 border-gray-500/20",
  Live: "bg-green-500/15 text-green-400 border-green-500/20",
  Churned: "bg-red-500/15 text-red-400 border-red-500/20",
}

type Props = { client: MondayClient }

export function ClientHeader({ client }: Props) {
  return (
    <div className="mb-8">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Clients
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="text-2xl font-heading font-bold tracking-tight">{client.name}</h1>
            {client.campaignStatus && (
              <Badge variant="outline" className={STATUS_COLORS[client.campaignStatus] ?? ""}>
                {client.campaignStatus}
              </Badge>
            )}
          </div>
          {client.firstName && (
            <p className="text-sm text-muted-foreground/60">{client.firstName}</p>
          )}
        </div>
      </div>

      {/* Info strip */}
      <div className="flex items-center gap-8">
        {client.accountManager && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1">AM</p>
            <p className="text-sm font-medium">{client.accountManager}</p>
          </div>
        )}
        {client.campaignManager && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1">CM</p>
            <p className="text-sm font-medium">{client.campaignManager}</p>
          </div>
        )}
        {client.adBudget && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1">Budget</p>
            <p className="text-sm font-medium tabular-nums">{client.adBudget.startsWith("€") ? client.adBudget : `€${Number(client.adBudget).toLocaleString()}`}</p>
          </div>
        )}
        {client.kickOffDate && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1">Kick-off</p>
            <p className="text-sm font-medium">{client.kickOffDate}</p>
          </div>
        )}
        <div className="ml-auto">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-muted-foreground/50 border-border/30">
            {client.boardType}
          </Badge>
        </div>
      </div>
    </div>
  )
}
