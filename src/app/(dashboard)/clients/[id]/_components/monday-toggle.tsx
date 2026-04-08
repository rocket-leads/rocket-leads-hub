"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

type Props = {
  mondayItemId: string
}

export function MondayToggle({ mondayItemId }: Props) {
  const queryClient = useQueryClient()

  const query = useQuery<{ mondayActive: boolean }>({
    queryKey: ["monday-active", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/monday-active`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: (mondayActive: boolean) =>
      fetch(`/api/clients/${mondayItemId}/monday-active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mondayActive }),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["monday-active", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["monday-active-map"] })
    },
  })

  const isActive = query.data?.mondayActive ?? false
  const isLoading = query.isLoading || mutation.isPending

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40">CRM</span>
      <button
        onClick={() => mutation.mutate(!isActive)}
        disabled={isLoading}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${
          isActive ? "bg-green-500" : "bg-muted-foreground/20"
        } ${isLoading ? "opacity-50" : ""}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
            isActive ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
      <span className={`text-[11px] ${isActive ? "text-green-500" : "text-muted-foreground/40"}`}>
        {isActive ? "Active" : "Off"}
      </span>
    </div>
  )
}
