"use client"

import { useState, useEffect, useMemo } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Check } from "lucide-react"
import type { MondayUser } from "@/lib/integrations/monday"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

const SKIP_PARTS = new Set(["van", "de", "der", "den", "het", "ten", "ter"])

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return ""
  const first = parts[0][0]?.toUpperCase() ?? ""
  const lastPart = parts.findLast((p) => !SKIP_PARTS.has(p.toLowerCase()) && p !== parts[0])
  const last = lastPart?.[0]?.toUpperCase() ?? ""
  return first + last
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
]

function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

type Props = {
  mondayItemId: string
  fieldKey: "account_manager" | "campaign_manager" | "appointment_setter"
  /** Current display value from Monday — comma-separated for multi-person columns. */
  value: string
  /** When true, allows multi-select (e.g. appointment_setter). */
  multi?: boolean
}

export function PersonEditCell({ mondayItemId, fieldKey, value, multi = false }: Props) {
  const router = useRouter()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [optimisticValue, setOptimisticValue] = useState(value)

  useEffect(() => setOptimisticValue(value), [value])

  const usersQuery = useQuery<{ users: MondayUser[] }>({
    queryKey: ["monday-users"],
    queryFn: () => fetch("/api/monday/users").then((r) => r.json()),
    enabled: open,
    staleTime: 15 * 60 * 1000,
  })

  const mutation = useMutation({
    mutationFn: async (personIds: number[]) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, personIds }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update assignment")
      }
    },
    onError: () => setOptimisticValue(value),
    onSuccess: () => router.refresh(),
  })

  const currentNames = useMemo(
    () =>
      optimisticValue
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean),
    [optimisticValue],
  )

  function isSelected(user: MondayUser) {
    return currentNames.includes(user.name)
  }

  function handleSelect(user: MondayUser) {
    const allUsers = usersQuery.data?.users ?? []
    if (multi) {
      const nextNames = isSelected(user)
        ? currentNames.filter((n) => n !== user.name)
        : [...currentNames, user.name]
      const nextIds = allUsers.filter((u) => nextNames.includes(u.name)).map((u) => u.id)
      setOptimisticValue(nextNames.join(", "))
      mutation.mutate(nextIds)
    } else {
      setOptimisticValue(user.name)
      mutation.mutate([user.id])
      setOpen(false)
    }
  }

  function handleClear() {
    setOptimisticValue("")
    mutation.mutate([])
    setOpen(false)
  }

  const display = optimisticValue
  const primaryName = display.split(",")[0]?.trim() ?? ""

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className="flex justify-start w-full hover:opacity-80 transition-opacity outline-none"
        title={display || t("clients.cell.click_to_assign", locale)}
      >
        {primaryName ? (
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(primaryName)}`}
          >
            {getInitials(primaryName)}
          </span>
        ) : (
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium bg-muted/60 text-muted-foreground/60 border border-dashed border-border/60">
            +
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="min-w-56 p-1.5 max-h-72 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {usersQuery.isLoading && (
          <div className="px-2.5 py-2 text-[12px] text-muted-foreground">{t("clients.cell.loading_users", locale)}</div>
        )}
        {usersQuery.error && (
          <div className="px-2.5 py-2 text-[12px] text-destructive">{t("clients.cell.load_users_failed", locale)}</div>
        )}
        {usersQuery.data?.users && (
          <>
            <button
              type="button"
              disabled={mutation.isPending || currentNames.length === 0}
              onClick={handleClear}
              className="w-full text-left rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              {t("clients.cell.clear", locale)}
            </button>
            <div className="my-1 border-t border-border/50" />
            {usersQuery.data.users.map((user) => (
              <button
                key={user.id}
                type="button"
                disabled={mutation.isPending}
                onClick={() => handleSelect(user)}
                className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted transition-colors disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${avatarColor(user.name)}`}
                  >
                    {getInitials(user.name)}
                  </span>
                  {user.name}
                </span>
                {isSelected(user) && <Check className="h-3.5 w-3.5 text-foreground/70" />}
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
