import type { MondayClient } from "@/lib/integrations/monday"
import Link from "next/link"
import { ArrowLeft, ExternalLink, User, Briefcase } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ClientSearch } from "@/components/client-search"

const STATUS_COLORS: Record<string, { badge: string; glow: string }> = {
  "Kick off": { badge: "bg-blue-500/15 text-blue-400 border-blue-500/20", glow: "from-blue-500/[0.03]" },
  "In development": { badge: "bg-amber-500/15 text-amber-400 border-amber-500/20", glow: "from-amber-500/[0.03]" },
  "On hold": { badge: "bg-gray-500/15 text-gray-400 border-gray-500/20", glow: "from-gray-500/[0.02]" },
  Live: { badge: "bg-green-500/15 text-green-400 border-green-500/20", glow: "from-green-500/[0.04]" },
  Churned: { badge: "bg-red-500/15 text-red-400 border-red-500/20", glow: "from-red-500/[0.03]" },
}

function getInitials(name: string): string {
  return name
    .split(/[\s\-&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
}

type Props = { client: MondayClient }

export function ClientHeader({ client }: Props) {
  const status = STATUS_COLORS[client.campaignStatus] ?? null

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

      <div className={`-mx-4 px-4 py-4 rounded-xl bg-gradient-to-r ${status?.glow ?? "from-transparent"} to-transparent`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {/* Avatar */}
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0 shadow-sm shadow-primary/10">
              <span className="text-sm font-heading font-bold text-white tracking-tight">
                {getInitials(client.name)}
              </span>
            </div>

            <div>
              <div className="flex items-center gap-3 mb-1.5">
                <h1 className="text-2xl font-heading font-bold tracking-tight">{client.name}</h1>
                {client.campaignStatus && (
                  <Badge variant="outline" className={`text-[11px] ${status?.badge ?? ""}`}>
                    {client.campaignStatus}
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-muted-foreground/40 border-border/30">
                  {client.boardType}
                </Badge>
              </div>

              {/* Inline meta row */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground/50">
                {client.firstName && (
                  <span>{client.firstName}</span>
                )}
                {client.firstName && (client.accountManager || client.campaignManager) && (
                  <span className="h-3 w-px bg-border/40" />
                )}
                {client.accountManager && (
                  <span className="inline-flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {client.accountManager}
                  </span>
                )}
                {client.campaignManager && (
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="h-3 w-3" />
                    {client.campaignManager}
                  </span>
                )}
              </div>
            </div>
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
          </div>
        </div>
      </div>
    </div>
  )
}
