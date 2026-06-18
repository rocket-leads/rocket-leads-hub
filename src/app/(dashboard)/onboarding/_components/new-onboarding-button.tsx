"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Plus, ChevronDown, Check } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import type { MondayUser } from "@/lib/integrations/monday"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

type FormState = {
  name: string
  accountManagerId: number | null
  campaignManagerId: number | null
  firstName: string
  email: string
  phone: string
  adBudget: string
  serviceFee: string
  kickOffDate: string
}

const EMPTY: FormState = {
  name: "",
  accountManagerId: null,
  campaignManagerId: null,
  firstName: "",
  email: "",
  phone: "",
  adBudget: "",
  serviceFee: "",
  kickOffDate: "",
}

/**
 * Top-right action on the Onboarding overview: open a dialog, fill the core
 * client fields, and create a new row on the Monday Onboarding board. On
 * success we jump straight into the wizard for the new client - the cache
 * append in `createOnboardingClient` means it's already loadable.
 */
export function NewOnboardingButton() {
  const router = useRouter()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)

  const usersQuery = useQuery<{ users: MondayUser[] }>({
    queryKey: ["monday-users"],
    queryFn: () => fetch("/api/monday/users").then((r) => r.json()),
    enabled: open,
    staleTime: 15 * 60 * 1000,
  })
  const users = usersQuery.data?.users ?? []

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          accountManagerId: form.accountManagerId ?? undefined,
          campaignManagerId: form.campaignManagerId ?? undefined,
          firstName: form.firstName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          adBudget: form.adBudget || undefined,
          serviceFee: form.serviceFee || undefined,
          kickOffDate: form.kickOffDate || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? t("onboarding.new.error", locale))
      }
      return (await res.json()) as { mondayItemId: string }
    },
    onSuccess: ({ mondayItemId }) => {
      setOpen(false)
      setForm(EMPTY)
      router.push(`/onboarding/${mondayItemId}`)
    },
  })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {t("onboarding.new.button", locale)}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setForm(EMPTY)
            mutation.reset()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("onboarding.new.title", locale)}</DialogTitle>
          <DialogDescription>{t("onboarding.new.desc", locale)}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (form.name.trim() && !mutation.isPending) mutation.mutate()
          }}
          className="grid gap-3.5"
        >
          <Field label={t("onboarding.new.field.name", locale)} required>
            <Input
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("onboarding.new.field.name_ph", locale)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("onboarding.new.field.am", locale)}>
              <PersonField
                users={users}
                loading={usersQuery.isLoading}
                value={form.accountManagerId}
                onChange={(id) => set("accountManagerId", id)}
                placeholder={t("onboarding.new.person_placeholder", locale)}
              />
            </Field>
            <Field label={t("onboarding.new.field.cm", locale)}>
              <PersonField
                users={users}
                loading={usersQuery.isLoading}
                value={form.campaignManagerId}
                onChange={(id) => set("campaignManagerId", id)}
                placeholder={t("onboarding.new.person_placeholder", locale)}
              />
            </Field>
          </div>

          <Field label={t("onboarding.new.field.first_name", locale)}>
            <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("onboarding.new.field.email", locale)}>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </Field>
            <Field label={t("onboarding.new.field.phone", locale)}>
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <Field label={t("onboarding.new.field.ad_budget", locale)}>
              <Input
                inputMode="decimal"
                value={form.adBudget}
                onChange={(e) => set("adBudget", e.target.value)}
              />
            </Field>
            <Field label={t("onboarding.new.field.service_fee", locale)}>
              <Input
                inputMode="decimal"
                value={form.serviceFee}
                onChange={(e) => set("serviceFee", e.target.value)}
              />
            </Field>
          </div>

          <Field label={t("onboarding.new.field.kick_off_date", locale)}>
            <Input
              type="date"
              value={form.kickOffDate}
              onChange={(e) => set("kickOffDate", e.target.value)}
            />
          </Field>

          {mutation.error && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : t("onboarding.new.error", locale)}
            </p>
          )}

          <DialogFooter className="mt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              {t("onboarding.new.cancel", locale)}
            </Button>
            <Button type="submit" disabled={!form.name.trim() || mutation.isPending}>
              {mutation.isPending
                ? t("onboarding.new.creating", locale)
                : t("onboarding.new.create", locale)}
            </Button>
          </DialogFooter>
        </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
    </div>
  )
}

/**
 * Single-select Monday person picker, scoped to the create dialog. Same
 * `/api/monday/users` source as the inline PersonEditCell, but rendered as a
 * full-width labeled field instead of an avatar bubble.
 */
function PersonField({
  users,
  loading,
  value,
  onChange,
  placeholder,
}: {
  users: MondayUser[]
  loading: boolean
  value: number | null
  onChange: (id: number | null) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const selected = users.find((u) => u.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="flex h-10 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3.5 text-sm transition-colors outline-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className={selected ? "" : "text-muted-foreground"}>
          {selected?.name ?? placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) min-w-0 p-1.5 max-h-72 overflow-y-auto">
        {loading && (
          <div className="px-2.5 py-2 text-[12px] text-muted-foreground">…</div>
        )}
        <button
          type="button"
          onClick={() => {
            onChange(null)
            setOpen(false)
          }}
          className="w-full text-left rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors"
        >
          {placeholder}
        </button>
        {users.length > 0 && <div className="my-1 border-t border-border/50" />}
        {users.map((user) => (
          <button
            key={user.id}
            type="button"
            onClick={() => {
              onChange(user.id)
              setOpen(false)
            }}
            className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted transition-colors"
          >
            {user.name}
            {user.id === value && <Check className="h-3.5 w-3.5 text-foreground/70" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
