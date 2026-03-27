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

const ONBOARDING_STATUSES = ["All", "Kick off", "In development", "On hold"]
const CURRENT_STATUSES = ["All", "Live", "On hold", "Churned"]

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "In development": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "On hold": "bg-muted text-muted-foreground",
  Live: "bg-green-500/20 text-green-400 border-green-500/30",
  Churned: "bg-red-500/20 text-red-400 border-red-500/30",
}

type Props = {
  clients: MondayClient[]
  boardType: "onboarding" | "current"
}

export function ClientsTable({ clients, boardType }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")

  const statuses = boardType === "onboarding" ? ONBOARDING_STATUSES : CURRENT_STATUSES

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.firstName.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === "All" || c.campaignStatus === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [clients, search, statusFilter])

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "All")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={boardType === "onboarding" ? 6 : 5} className="text-center py-12 text-muted-foreground">
                  No clients found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((client) => (
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
                      <Badge
                        variant="outline"
                        className={STATUS_COLORS[client.campaignStatus] ?? ""}
                      >
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
