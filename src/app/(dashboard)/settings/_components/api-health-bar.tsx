"use client"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

type ServiceResult = { ok: boolean; message: string; checkedAt: string }
type HealthData = Record<string, ServiceResult>

const SERVICES = [
  { id: "monday", label: "Monday.com" },
  { id: "meta", label: "Meta" },
  { id: "stripe", label: "Stripe" },
  { id: "trengo", label: "Trengo" },
]

async function fetchHealth(): Promise<HealthData> {
  const res = await fetch("/api/settings/health")
  if (!res.ok) throw new Error("Failed to fetch health")
  return res.json()
}

function StatusPill({ service, data }: { service: { id: string; label: string }; data: ServiceResult | undefined }) {
  if (!data) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        {service.label}
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        data.ok
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      }`}
      title={data.message}
    >
      <span className={`h-2 w-2 rounded-full ${data.ok ? "bg-green-500" : "bg-red-500"}`} />
      {service.label}
    </div>
  )
}

export function ApiHealthBar() {
  const { data, isFetching, dataUpdatedAt, refetch } = useQuery<HealthData>({
    queryKey: ["api-health"],
    queryFn: fetchHealth,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  })

  const lastChecked = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-4 py-3">
      <span className="text-xs font-medium text-muted-foreground mr-1">API Status</span>
      {SERVICES.map((svc) => (
        <StatusPill key={svc.id} service={svc} data={data?.[svc.id]} />
      ))}
      <div className="ml-auto flex items-center gap-2">
        {lastChecked && (
          <span className="text-xs text-muted-foreground">Checked {lastChecked}</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
    </div>
  )
}
