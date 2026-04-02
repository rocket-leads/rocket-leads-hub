"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Settings2, ChevronDown, ChevronRight, RotateCcw } from "lucide-react"

const COLUMN_FIELDS = [
  { key: "date_created", label: "Date Created" },
  { key: "date_appointment", label: "Date Appointment" },
  { key: "lead_status", label: "Lead Status" },
  { key: "lead_status_2", label: "Lead Status 2" },
  { key: "deal_value", label: "Deal Value" },
  { key: "utm", label: "UTM" },
  { key: "date_deal", label: "Date Deal" },
] as const

type Props = {
  mondayItemId: string
}

export function ColumnOverrides({ mondayItemId }: Props) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const query = useQuery<{ overrides: Record<string, string> | null }>({
    queryKey: ["column-overrides", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/column-overrides`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const [localOverrides, setLocalOverrides] = useState<Record<string, string>>({})
  const hasOverrides = query.data?.overrides && Object.keys(query.data.overrides).length > 0

  // Sync local state when data loads
  const currentOverrides = { ...(query.data?.overrides ?? {}), ...localOverrides }

  const mutation = useMutation({
    mutationFn: (overrides: Record<string, string> | null) =>
      fetch(`/api/clients/${mondayItemId}/column-overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["column-overrides", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["kpis", mondayItemId] })
      setLocalOverrides({})
    },
  })

  function handleChange(key: string, value: string) {
    setLocalOverrides((prev) => {
      const next = { ...prev }
      if (value === "") {
        delete next[key]
      } else {
        next[key] = value
      }
      return next
    })
  }

  function handleSave() {
    const merged = { ...(query.data?.overrides ?? {}), ...localOverrides }
    // Remove empty values
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(merged)) {
      if (v) cleaned[k] = v
    }
    mutation.mutate(Object.keys(cleaned).length > 0 ? cleaned : null)
  }

  function handleReset() {
    mutation.mutate(null)
    setLocalOverrides({})
  }

  const isDirty = Object.keys(localOverrides).length > 0

  return (
    <div className="rounded-lg bg-muted/30 dark:bg-white/[0.03]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted/50"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>Board Column IDs</span>
        {hasOverrides && (
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary" />
        )}
        <span className="ml-auto">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/20 pt-3">
          <p className="text-[11px] text-muted-foreground/60">
            Override default Monday column IDs for this client. Leave empty to use the global default from Settings.
          </p>

          <div className="grid grid-cols-2 gap-2">
            {COLUMN_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1 block">
                  {label}
                </label>
                <input
                  placeholder="Default"
                  value={currentOverrides[key] ?? ""}
                  onChange={(e) => handleChange(key, e.target.value)}
                  className="w-full h-8 rounded-md bg-muted/40 dark:bg-white/5 border-0 px-2.5 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!isDirty || mutation.isPending}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isDirty
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              }`}
            >
              {mutation.isPending ? "Saving..." : "Save"}
            </button>
            {hasOverrides && (
              <button
                onClick={handleReset}
                disabled={mutation.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to defaults
              </button>
            )}
            {mutation.isSuccess && !isDirty && (
              <span className="text-[11px] text-green-500">Saved</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
