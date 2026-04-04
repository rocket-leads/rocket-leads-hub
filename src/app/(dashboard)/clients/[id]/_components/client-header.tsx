import type { MondayClient } from "@/lib/integrations/monday"
import Link from "next/link"
import { ArrowLeft, User, Briefcase, Wallet, Calendar } from "lucide-react"
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
  const infoItems = [
    client.accountManager && { icon: User, label: "AM", value: client.accountManager },
    client.campaignManager && { icon: Briefcase, label: "CM", value: client.campaignManager },
    client.adBudget && {
      icon: Wallet,
      label: "Budget",
      value: client.adBudget.startsWith("€") ? client.adBudget : `€${Number(client.adBudget).toLocaleString()}`,
    },
    client.kickOffDate && { icon: Calendar, label: "Kick-off", value: client.kickOffDate },
  ].filter(Boolean) as { icon: typeof User; label: string; value: string }[]

  return (
    <div className="mb-8">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors mb-5"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Clients
      </Link>

      <div className="flex items-start justify-between gap-4 mb-5">
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
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-muted-foreground/40 border-border/30 shrink-0">
          {client.boardType}
        </Badge>
      </div>

      {/* Info strip — card style */}
      {infoItems.length > 0 && (
        <div className="flex items-stretch gap-3">
          {infoItems.map(({ icon: Icon, label, value }, i) => (
            <div
              key={label}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg bg-card border border-border/30 ${i === 0 ? "" : ""}`}
            >
              <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 leading-none mb-1">{label}</p>
                <p className="text-sm font-medium tabular-nums leading-none">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
