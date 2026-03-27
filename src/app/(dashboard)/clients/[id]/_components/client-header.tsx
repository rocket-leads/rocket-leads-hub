import { Badge } from "@/components/ui/badge"
import type { MondayClient } from "@/lib/monday"
import Link from "next/link"

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "In development": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "On hold": "bg-muted text-muted-foreground",
  Live: "bg-green-500/20 text-green-400 border-green-500/30",
  Churned: "bg-red-500/20 text-red-400 border-red-500/30",
}

type Props = { client: MondayClient }

export function ClientHeader({ client }: Props) {
  return (
    <div className="border-b pb-6 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/clients"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Clients
            </Link>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <h1 className="text-2xl font-bold">{client.name}</h1>
            {client.campaignStatus && (
              <Badge
                variant="outline"
                className={STATUS_COLORS[client.campaignStatus] ?? ""}
              >
                {client.campaignStatus}
              </Badge>
            )}
            <Badge variant="outline" className="text-xs capitalize">
              {client.boardType}
            </Badge>
          </div>
          {client.firstName && (
            <p className="text-muted-foreground mt-1">Contact: {client.firstName}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-6 text-sm">
        {client.accountManager && (
          <div>
            <span className="text-muted-foreground">Account Manager</span>
            <p className="font-medium">{client.accountManager}</p>
          </div>
        )}
        {client.campaignManager && (
          <div>
            <span className="text-muted-foreground">Campaign Manager</span>
            <p className="font-medium">{client.campaignManager}</p>
          </div>
        )}
        {client.adBudget && (
          <div>
            <span className="text-muted-foreground">Ad Budget</span>
            <p className="font-medium">€{Number(client.adBudget).toLocaleString()}</p>
          </div>
        )}
        {client.metaAdAccountId && (
          <div>
            <span className="text-muted-foreground">Meta Ad Account</span>
            <p className="font-medium font-mono text-xs">{client.metaAdAccountId}</p>
          </div>
        )}
        {client.stripeCustomerId && (
          <div>
            <span className="text-muted-foreground">Stripe Customer</span>
            <p className="font-medium font-mono text-xs">{client.stripeCustomerId}</p>
          </div>
        )}
        {client.kickOffDate && (
          <div>
            <span className="text-muted-foreground">Kick-off Date</span>
            <p className="font-medium">{client.kickOffDate}</p>
          </div>
        )}
      </div>
    </div>
  )
}
