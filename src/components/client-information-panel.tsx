"use client"

import { useState, useEffect, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useHubMutation } from "@/lib/mutations/use-hub-mutation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Check, ChevronDown, Loader2, HelpCircle } from "lucide-react"
import type { MondayClient, MondayUser } from "@/lib/integrations/monday"
import type {
  PersonFieldKey,
  SimpleFieldKey,
} from "@/lib/clients/edit"
import { ConnectedEntity } from "@/components/connected-entity"

type Props = { client: MondayClient }

export function ClientInformationPanel({ client }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Identity">
        <SimpleField
          mondayItemId={client.mondayItemId}
          fieldKey="company_name"
          value={client.companyName || client.name}
          label="Company name"
        />
        <SimpleField
          mondayItemId={client.mondayItemId}
          fieldKey="first_name"
          value={client.firstName}
          label="First name"
        />
      </Section>

      <Section title="Team">
        <PersonField
          mondayItemId={client.mondayItemId}
          fieldKey="account_manager"
          value={client.accountManager}
          label="Account Manager"
        />
        <PersonField
          mondayItemId={client.mondayItemId}
          fieldKey="campaign_manager"
          value={client.campaignManager}
          label="Campaign Manager"
        />
        {client.boardType === "current" && (
          <PersonField
            mondayItemId={client.mondayItemId}
            fieldKey="appointment_setter"
            value={client.appointmentSetter}
            label="Appointment Setter"
            multi
          />
        )}
      </Section>

      <Section title="Financials">
        <SimpleField
          mondayItemId={client.mondayItemId}
          fieldKey="ad_budget"
          value={client.adBudget}
          label="Ad budget (€/month)"
          type="number"
        />
        <SimpleField
          mondayItemId={client.mondayItemId}
          fieldKey="service_fee"
          value={client.serviceFee}
          label="Service fee (€/month)"
          type="number"
        />
      </Section>

      <Section title="Identifiers">
        <ConnectedEntity
          mondayItemId={client.mondayItemId}
          fieldKey="client_board_id"
          value={client.clientBoardId}
          label="Monday client board"
          service="monday-board"
          companyName={client.companyName || client.name}
          help="Per-client lead board. Unblocks: lead counts, UTM table, lead-status sentiment in Watch List + Pedro. Without it, KPIs fall back to Meta-only and Pedro flags missing CRM data."
        />
        <ConnectedEntity
          mondayItemId={client.mondayItemId}
          fieldKey="meta_ad_account_id"
          value={client.metaAdAccountId}
          label="Meta ad account"
          service="meta-ad-account"
          companyName={client.companyName || client.name}
          help="Ad account used for Spend / CPL / CTR / per-ad performance. Unblocks: Campaigns tab, Top Ads, Pedro creative insights. Without it, the Performance Overview shows no ad metrics."
        />
        <ConnectedEntity
          mondayItemId={client.mondayItemId}
          fieldKey="stripe_customer_id"
          value={client.stripeCustomerId}
          label="Stripe customer"
          service="stripe-customer"
          companyName={client.companyName || client.name}
          help="Customer in Stripe used for invoices + payment status. Unblocks: Billing tab, overdue/open invoice banners, finance flows. Without it, the Payment banner stays hidden."
        />
        <ConnectedEntity
          mondayItemId={client.mondayItemId}
          fieldKey="trengo_contact_id"
          value={client.trengoContactId}
          label="Trengo contact"
          service="trengo-contact"
          companyName={client.companyName || client.name}
          help="Trengo contact behind this client. Unblocks: Conversations → Inbox + Timeline, client-sentiment signals in Pedro. Without it, the client's WhatsApp/email threads stay invisible to the Hub."
        />
        <ConnectedEntity
          mondayItemId={client.mondayItemId}
          fieldKey="google_drive_id"
          value={client.googleDriveId}
          label="Google Drive folder"
          service="drive-folder"
          companyName={client.companyName || client.name}
          help="Folder ID where creatives, scripts and assets live. Unblocks: quick-link shortcuts on the client page + Pedro deliverable drop-target. Without it, file pushes from the Hub have nowhere to land."
        />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3 text-foreground/80">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

type SimpleFieldProps = {
  mondayItemId: string
  fieldKey: SimpleFieldKey
  value: string
  label: string
  type?: "text" | "number"
  help?: string
}

function SimpleField({ mondayItemId, fieldKey, value, label, type = "text", help }: SimpleFieldProps) {
  const router = useRouter()
  const [draft, setDraft] = useState(value)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => setDraft(value), [value])

  // CLIENT_DETAIL group invalidates client-detail + clients-overview +
  // watchlist + kpi-summaries - all the surfaces that show this row's
  // Monday data. Central catalogue means a new surface reading
  // `["client-detail", id]` doesn't need to chase down every mutation
  // site to make sure its data updates.
  const mutation = useHubMutation({
    invalidates: ["CLIENT_DETAIL"],
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, value: next }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update")
      }
    },
    onError: () => setDraft(value),
    onSuccess: () => {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
      router.refresh()
      // Broadcast so live Pedro surfaces (ImageSourcesPicker, brand
      // fingerprint preview, etc.) pick up the change without a tab
      // reload. Roy 2026-06-11: koppeling moet real-time werken.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("hub:client-updated", {
            detail: { clientId: mondayItemId, fieldKey },
          }),
        )
      }
    },
  })

  const isDirty = draft !== value
  const canSave = isDirty && !mutation.isPending

  return (
    <div className="grid grid-cols-[160px_1fr_auto] gap-3 items-center">
      <Label className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
        {label}
        {help && (
          <span
            title={help}
            className="inline-flex text-muted-foreground/50 hover:text-muted-foreground cursor-help"
            aria-label={`What does ${label} control?`}
          >
            <HelpCircle className="h-3 w-3" />
          </span>
        )}
      </Label>
      <Input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) mutation.mutate(draft)
          if (e.key === "Escape") setDraft(value)
        }}
        disabled={mutation.isPending}
        className="h-8 text-sm font-mono"
      />
      <div className="flex items-center gap-1.5 min-w-[64px] justify-end">
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {savedFlash && !mutation.isPending && (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        )}
        {canSave && !savedFlash && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => mutation.mutate(draft)}>
            Save
          </Button>
        )}
      </div>
    </div>
  )
}

type PersonFieldProps = {
  mondayItemId: string
  fieldKey: PersonFieldKey
  value: string
  label: string
  multi?: boolean
}

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

function PersonField({ mondayItemId, fieldKey, value, label, multi = false }: PersonFieldProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
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
    mutationFn: async ({ personIds, personNames }: { personIds: number[]; personNames: string[] }) => {
      // personNames go alongside the IDs so the server can patch the
      // cache directly with the display value we know was selected,
      // without paying Monday's read-after-write eventual-consistency
      // window (which was the root cause of the "springt naar
      // unassigned" jump-back).
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, personIds, personNames }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update assignment")
      }
    },
    onError: () => setOptimisticValue(value),
    onSuccess: () => {
      // Same as SimpleField - the slide-over caches client data via React
      // Query, so router.refresh() alone won't flip the panel to the new
      // value. Invalidate the cached detail + overview so the next render
      // reads fresh data from Monday.
      void queryClient.invalidateQueries({ queryKey: ["client-detail", mondayItemId] })
      void queryClient.invalidateQueries({ queryKey: ["clients-overview"] })
      router.refresh()
    },
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
      mutation.mutate({ personIds: nextIds, personNames: nextNames })
    } else {
      setOptimisticValue(user.name)
      mutation.mutate({ personIds: [user.id], personNames: [user.name] })
      setOpen(false)
    }
  }

  function handleClear() {
    setOptimisticValue("")
    mutation.mutate({ personIds: [], personNames: [] })
    setOpen(false)
  }

  return (
    <div className="grid grid-cols-[160px_1fr_auto] gap-3 items-center">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="h-8 px-3 inline-flex items-center justify-between gap-2 rounded-md border border-border bg-background hover:bg-muted/50 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <span className="inline-flex items-center gap-2 truncate">
            {currentNames.length > 0 ? (
              <>
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${avatarColor(currentNames[0])}`}
                >
                  {getInitials(currentNames[0])}
                </span>
                <span className="truncate">{currentNames.join(", ")}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        </PopoverTrigger>
        <PopoverContent className="min-w-64 p-1.5 max-h-72 overflow-y-auto">
          {usersQuery.isLoading && (
            <div className="px-2.5 py-2 text-[12px] text-muted-foreground">Loading users...</div>
          )}
          {usersQuery.error && (
            <div className="px-2.5 py-2 text-[12px] text-destructive">Failed to load users</div>
          )}
          {usersQuery.data?.users && (
            <>
              <button
                type="button"
                disabled={mutation.isPending || currentNames.length === 0}
                onClick={handleClear}
                className="w-full text-left rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                Clear
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
      <div className="flex items-center min-w-[64px] justify-end">
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}
