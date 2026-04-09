import type { MondayClient } from "@/lib/integrations/monday"
import Link from "next/link"
import { ArrowLeft, ExternalLink } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ClientSearch } from "@/components/client-search"

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
    <div className="mb-6">
      <div className="flex items-center justify-between mb-5">
        <Link
          href="/clients"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Clients
        </Link>
        <ClientSearch />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-heading font-bold tracking-tight">{client.name}</h1>
            {client.campaignStatus && (
              <Badge variant="outline" className={`text-[11px] ${STATUS_COLORS[client.campaignStatus] ?? ""}`}>
                {client.campaignStatus}
              </Badge>
            )}
          </div>
          {client.firstName && (
            <p className="text-sm text-muted-foreground/50">{client.firstName}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {client.metaAdAccountId && (
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${client.metaAdAccountId.replace("act_", "")}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border/30 bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-border/50 transition-colors"
            >
              Ad Account
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-muted-foreground/40 border-border/30">
            {client.boardType}
          </Badge>
        </div>
      </div>
    </div>
  )
}
