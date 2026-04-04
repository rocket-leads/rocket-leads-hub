"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

type KpiVisibility = {
  leads: boolean
  appointments: boolean
  deals: boolean
}

type Props = {
  mondayItemId: string
}

const SECTIONS = [
  { key: "leads" as const, label: "Leads", description: "Adspend, Leads, Cost per Lead" },
  { key: "appointments" as const, label: "Appointments", description: "QR%, Booked Appointments, Cost per Booked Appointment, SU%, Taken Appointments, Cost per Taken Appointment" },
  { key: "deals" as const, label: "Deals", description: "Deals, CR%, Cost per Deal, Closed Revenue, ROI" },
]

export function KpiVisibilityToggle({ mondayItemId }: Props) {
  const queryClient = useQueryClient()

  const query = useQuery<{ kpiVisibility: KpiVisibility }>({
    queryKey: ["monday-active", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/monday-active`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: async (kpiVisibility: KpiVisibility) => {
      const r = await fetch(`/api/clients/${mondayItemId}/monday-active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiVisibility }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? "Failed to save")
      return r.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monday-active", mondayItemId] })
    },
  })

  const visibility = query.data?.kpiVisibility ?? { leads: true, appointments: false, deals: false }
  const isLoading = query.isLoading || mutation.isPending

  function toggle(key: keyof KpiVisibility) {
    // Leads is always on
    if (key === "leads") return
    const next = { ...visibility, [key]: !visibility[key] }
    mutation.mutate(next)
  }

  return (
    <div className="space-y-3">
      {SECTIONS.map(({ key, label, description }) => {
        const isOn = visibility[key]
        const isLeads = key === "leads"
        return (
          <div key={key} className="flex items-start gap-3">
            <button
              onClick={() => toggle(key)}
              disabled={isLoading || isLeads}
              className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                isOn ? "bg-green-500" : "bg-muted-foreground/20"
              } ${isLoading || isLeads ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  isOn ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
            <div>
              <span className={`text-sm font-medium ${isOn ? "text-foreground" : "text-muted-foreground/50"}`}>
                {label}
              </span>
              <p className="text-[11px] text-muted-foreground/40">{description}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
