"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { MondayClient } from "@/lib/monday"
import type { BillingSummary } from "@/lib/stripe-client"

const ONBOARDING_STATUSES = ["All", "Kick off", "In development", "On hold"]
const CURRENT_STATUSES = ["All", "Live", "On hold", "Churned"]

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "In development": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "On hold": "bg-muted text-muted-foreground",
  Live: "bg-green-500/20 text-green-400 border-green-500/30",
  Churned: "bg-red-500/20 text-red-400 border-red-500/30",
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  complete: "bg-green-500/20 text-green-400 border-green-500/30",
  open: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  overdue: "bg-red-500/20 text-red-400 border-red-500/30",
}

type Props = {
  clients: MondayClient[]
  boardType: "onboarding" | "current"
  billingSummaries?: Record<string, BillingSummary>
}

function uniqueSorted(values: string[]): string[] {
  return ["All", ...Array.from(new Set(values.filter(Boolean))).sort()]
}

function fmt(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}


export function ClientsTable({ clients, boardType, billingSummaries }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [accountManagerFilter, setAccountManagerFilter] = useState("All")
  const [campaignManagerFilter, setCampaignManagerFilter] = useState("All")

  const statuses = boardType === "onboarding" ? ONBOARDING_STATUSES : CURRENT_STATUSES
  const accountManagers = useMemo(() => uniqueSorted(clients.map((c) => c.accountManager)), [clients])
  const campaignManagers = useMemo(() => uniqueSorted(clients.map((c) => c.campaignManager)), [clients])

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.firstName.toLowerCase().includes(search.toLowerCase())
      const matchesStatus = statusFilter === "All" || c.campaignStatus === statusFilter
      const matchesAM = accountManagerFilter === "All" || c.accountManager === accountManagerFilter
      const matchesCM = campaignManagerFilter === "All" || c.campaignManager === campaignManagerFilter
      return matchesSearch && matchesStatus && matchesAM && matchesCM
    })
  }, [clients, search, statusFilter, accountManagerFilter, campaignManagerFilter])

  const colSpan = boardType === "onboarding" ? 8 : 7

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "All")}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountManagerFilter} onValueChange={(v) => setAccountManagerFilter(v ?? "All")}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Account Manager" />
          </SelectTrigger>
          <SelectContent>
            {accountManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campaignManagerFilter} onValueChange={(v) => setCampaignManagerFilter(v ?? "All")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Campaign Manager" />
          </SelectTrigger>
          <SelectContent>
            {campaignManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center text-sm text-muted-foreground">
          {filtered.length} client{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Account Manager</TableHead>
              <TableHead>Campaign Manager</TableHead>
              <TableHead>Status</TableHead>
              {boardType === "onboarding" && <TableHead>Kick-off Date</TableHead>}
              <TableHead>Ad Budget</TableHead>
              <TableHead>Payment Status</TableHead>
              <TableHead>Outstanding</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-muted-foreground">
                  No clients found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((client) => {
                const summary = client.stripeCustomerId ? billingSummaries?.[client.stripeCustomerId] : undefined
                return (
                  <TableRow
                    key={client.mondayItemId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/clients/${client.mondayItemId}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {client.firstName && (
                          <p className="text-sm text-muted-foreground">{client.firstName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{client.accountManager || "—"}</TableCell>
                    <TableCell className="text-sm">{client.campaignManager || "—"}</TableCell>
                    <TableCell>
                      {client.campaignStatus ? (
                        <Badge variant="outline" className={STATUS_COLORS[client.campaignStatus] ?? ""}>
                          {client.campaignStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {boardType === "onboarding" && (
                      <TableCell className="text-sm">{client.kickOffDate || "—"}</TableCell>
                    )}
                    <TableCell className="text-sm">
                      {client.adBudget ? `€${Number(client.adBudget).toLocaleString()}` : "—"}
                    </TableCell>
                    <TableCell>
                      {!client.stripeCustomerId ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : !billingSummaries ? (
                        <span className="text-muted-foreground text-sm">...</span>
                      ) : summary ? (
                        <Badge variant="outline" className={PAYMENT_STATUS_COLORS[summary.status]}>
                          {summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {!client.stripeCustomerId ? (
                        <span className="text-muted-foreground">—</span>
                      ) : !billingSummaries ? (
                        <span className="text-muted-foreground">...</span>
                      ) : summary && summary.outstanding > 0 ? (
                        <span className={summary.status === "overdue" ? "text-red-400" : ""}>{fmt(summary.outstanding)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
