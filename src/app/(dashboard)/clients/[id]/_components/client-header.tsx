import type { MondayClient } from "@/lib/monday"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "In development": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "On hold": "bg-gray-500/20 text-gray-400 border-gray-500/30",
  Live: "bg-green-500/20 text-green-400 border-green-500/30",
  Churned: "bg-red-500/20 text-red-400 border-red-500/30",
}

type Props = { client: MondayClient }

export function ClientHeader({ client }: Props) {
  return (
    <div className="mb-6">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Clients
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-heading font-bold tracking-tight">{client.name}</h1>
            {client.campaignStatus && (
              <Badge variant="outline" className={STATUS_COLORS[client.campaignStatus] ?? ""}>
                {client.campaignStatus}
              </Badge>
            )}
            <Badge variant="outline" className="capitalize text-muted-foreground">
              {client.boardType}
            </Badge>
          </div>
          {client.firstName && (
            <p className="text-sm text-muted-foreground">Contact: {client.firstName}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        {client.accountManager && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Account Manager</p>
            <p className="font-medium">{client.accountManager}</p>
          </div>
        )}
        {client.campaignManager && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Campaign Manager</p>
            <p className="font-medium">{client.campaignManager}</p>
          </div>
        )}
        {client.adBudget && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Ad Budget</p>
            <p className="font-medium">€{Number(client.adBudget).toLocaleString()}</p>
          </div>
        )}
        {client.kickOffDate && (
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Kick-off Date</p>
            <p className="font-medium">{client.kickOffDate}</p>
          </div>
        )}
      </div>
    </div>
  )
}
