"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Mail, MessageCircle, Loader2, Send, ChevronDown, Check, Search, User } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { EmailComposer } from "./email-composer"

/**
 * "New message" composer — compose a brand-new conversation from scratch,
 * Trengo-style. Pick a medium (WhatsApp / Email), a channel (defaults to the
 * AM's personal channel), a recipient (searched from Trengo contacts by name,
 * or typed raw), then compose: the full email composer for mail, or a template
 * + variables for WhatsApp. Roy 2026-07-30.
 */
export type NewMessageChannel = { id: number; name: string; kind: "whatsapp" | "email" }

type WaTemplate = { id: number; title: string; slug: string; message: string; language: string }
type Contact = { id: number; name: string; phone: string | null; email: string | null }
type Medium = "whatsapp" | "email"

function countTemplateVariables(message: string): number {
  let max = 0
  const re = /\{\{(\d+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

/** Small 187N dropdown — a bordered trigger + a floating option panel, matching
 *  the channel-tab / composer chrome (no native <select> that clips). */
function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
}: {
  value: T | null
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>
  onChange: (v: T) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])
  const selected = options.find((o) => o.value === value) ?? null
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm transition-colors hover:bg-muted/40 disabled:opacity-50"
      >
        <span className={cn("flex items-center gap-2 truncate", !selected && "text-muted-foreground")}>
          {selected?.icon}
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {options.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">Geen opties</p>
          )}
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted",
                o.value === value && "bg-primary/10 font-medium",
              )}
            >
              {o.icon}
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Recipient picker — search Trengo contacts by name and pick one, or type a
 *  raw phone/email. Shows the medium-appropriate value. */
function ContactSearch({
  medium,
  selected,
  onSelect,
  rawValue,
  onRawChange,
}: {
  medium: Medium
  selected: Contact | null
  onSelect: (c: Contact | null) => void
  rawValue: string
  onRawChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const debounced = useDebounced(rawValue, 250)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const query = useQuery<{ contacts: Contact[] }>({
    queryKey: ["contact-search", medium, debounced],
    queryFn: () =>
      fetch(
        `/api/inbox/contact-search?kind=${medium}&q=${encodeURIComponent(debounced)}`,
      ).then((r) => r.json()),
    enabled: open,
    staleTime: 30_000,
  })
  const contacts = query.data?.contacts ?? []

  return (
    <div ref={ref} className="relative flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {medium === "whatsapp" ? "Naar (naam of telefoonnummer)" : "Naar (naam of e-mailadres)"}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={rawValue}
          onChange={(e) => {
            onRawChange(e.target.value)
            if (selected) onSelect(null)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={medium === "whatsapp" ? "Zoek contact of +31 6…" : "Zoek contact of naam@bedrijf.nl"}
          className="pl-9"
        />
      </div>
      {open && (rawValue.trim().length > 0 || contacts.length > 0) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          {query.isLoading && (
            <p className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Zoeken…
            </p>
          )}
          {!query.isLoading && contacts.length === 0 && (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              Geen contacten gevonden — je kunt het {medium === "whatsapp" ? "nummer" : "adres"} ook direct typen.
            </p>
          )}
          {contacts.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onSelect(c)
                onRawChange(medium === "whatsapp" ? c.phone ?? "" : c.email ?? "")
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <User className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {medium === "whatsapp" ? c.phone : c.email}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function NewMessageDialog({
  open,
  onOpenChange,
  channels,
  favoriteIds,
  onSent,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  channels: NewMessageChannel[]
  favoriteIds: number[]
  onSent: () => void
}) {
  const waChannels = useMemo(() => channels.filter((c) => c.kind === "whatsapp"), [channels])
  const emailChannels = useMemo(() => channels.filter((c) => c.kind === "email"), [channels])

  // The AM's personal channels → default selection.
  const defaultsQuery = useQuery<{ email: number | null; whatsapp: number | null }>({
    queryKey: ["inbox-default-channels"],
    queryFn: () => fetch("/api/inbox/default-channels").then((r) => r.json()),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const [medium, setMedium] = useState<Medium>("email")
  const [channelId, setChannelId] = useState<number | null>(null)

  // Recipient
  const [contact, setContact] = useState<Contact | null>(null)
  const [rawRecipient, setRawRecipient] = useState("")

  // Email composer state
  const [subject, setSubject] = useState("")
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [html, setHtml] = useState("")
  const [signature, setSignature] = useState<string | null>(null)

  // WhatsApp state
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [params, setParams] = useState<string[]>([])

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mediumChannels = medium === "whatsapp" ? waChannels : emailChannels
  // Order: favourites first.
  const orderedChannels = useMemo(() => {
    const fav = new Set(favoriteIds)
    return [...mediumChannels].sort((a, b) => (fav.has(b.id) ? 1 : 0) - (fav.has(a.id) ? 1 : 0))
  }, [mediumChannels, favoriteIds])

  // Initialise medium + channel once defaults + channels are ready.
  const initedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      initedRef.current = false
      return
    }
    if (initedRef.current) return
    if (defaultsQuery.isLoading) return
    initedRef.current = true
    const d = defaultsQuery.data
    // Prefer the medium whose personal channel exists; else whichever we have.
    const startMedium: Medium =
      d?.email && emailChannels.length > 0
        ? "email"
        : d?.whatsapp && waChannels.length > 0
          ? "whatsapp"
          : emailChannels.length > 0
            ? "email"
            : "whatsapp"
    setMedium(startMedium)
    const pool = startMedium === "whatsapp" ? waChannels : emailChannels
    const preferred = startMedium === "whatsapp" ? d?.whatsapp : d?.email
    setChannelId(pool.find((c) => c.id === preferred)?.id ?? pool[0]?.id ?? null)
  }, [open, defaultsQuery.isLoading, defaultsQuery.data, emailChannels, waChannels])

  // When medium changes, pick that medium's personal channel (or first).
  function switchMedium(next: Medium) {
    setMedium(next)
    setContact(null)
    setRawRecipient("")
    setTemplateId(null)
    setParams([])
    setError(null)
    const pool = next === "whatsapp" ? waChannels : emailChannels
    const preferred = next === "whatsapp" ? defaultsQuery.data?.whatsapp : defaultsQuery.data?.email
    setChannelId(pool.find((c) => c.id === preferred)?.id ?? pool[0]?.id ?? null)
  }

  const templatesQuery = useQuery<{ templates: WaTemplate[] }>({
    queryKey: ["wa-templates", channelId],
    queryFn: () => fetch(`/api/inbox/wa-templates?channelId=${channelId}`).then((r) => r.json()),
    enabled: open && medium === "whatsapp" && channelId != null,
  })
  const templates = templatesQuery.data?.templates ?? []
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId) ?? null
  const varCount = selectedTemplate ? countTemplateVariables(selectedTemplate.message) : 0

  function reset() {
    initedRef.current = false
    setContact(null)
    setRawRecipient("")
    setSubject("")
    setCc([])
    setBcc([])
    setHtml("")
    setSignature(null)
    setTemplateId(null)
    setParams([])
    setError(null)
  }
  function close(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  async function send() {
    if (!channelId) {
      setError("Kies een kanaal")
      return
    }
    setSending(true)
    setError(null)
    try {
      const recipient = (contact
        ? medium === "whatsapp"
          ? contact.phone
          : contact.email
        : rawRecipient
      )?.trim()
      let payload: Record<string, unknown>
      if (medium === "email") {
        if (!recipient) throw new Error("Kies of typ een e-mailadres")
        const fullHtml = signature ? `${html}<br><br>${signature}` : html
        payload = { channelId, kind: "email", to: recipient, subject, html: fullHtml }
      } else {
        if (!recipient) throw new Error("Kies of typ een telefoonnummer")
        if (!selectedTemplate) throw new Error("Kies een WhatsApp-template")
        payload = {
          channelId,
          kind: "whatsapp",
          to: recipient,
          templateName: selectedTemplate.slug || selectedTemplate.title,
          templateParams: params.slice(0, varCount),
        }
      }
      const res = await fetch("/api/inbox/new-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; needsConnect?: string }
      if (!res.ok) {
        throw new Error(
          data.needsConnect
            ? "Verbind eerst Trengo in je account-instellingen."
            : data.error ?? `Verzenden mislukt (${res.status})`,
        )
      }
      onSent()
      close(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt")
    } finally {
      setSending(false)
    }
  }

  const hasRecipient = !!(contact
    ? medium === "whatsapp"
      ? contact.phone
      : contact.email
    : rawRecipient.trim())
  const canSend =
    !!channelId &&
    hasRecipient &&
    (medium === "email" ? html.trim() || subject.trim() : !!selectedTemplate)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] w-full overflow-y-auto p-6 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Nieuw bericht</DialogTitle>
        </DialogHeader>

        {/* Medium + channel selectors, side by side. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Type</label>
            <Dropdown<Medium>
              value={medium}
              onChange={switchMedium}
              placeholder="Kies type"
              options={[
                { value: "email", label: "E-mail", icon: <Mail className="h-4 w-4" /> },
                { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle className="h-4 w-4" /> },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Kanaal</label>
            <Dropdown<number>
              value={channelId}
              onChange={setChannelId}
              placeholder="Kies kanaal"
              options={orderedChannels.map((c) => ({
                value: c.id,
                label: c.name,
                icon:
                  c.kind === "whatsapp" ? (
                    <MessageCircle className="h-4 w-4" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  ),
              }))}
            />
          </div>
        </div>

        {/* Recipient */}
        <ContactSearch
          medium={medium}
          selected={contact}
          onSelect={setContact}
          rawValue={rawRecipient}
          onRawChange={setRawRecipient}
        />

        {/* Composer */}
        {medium === "email" && channelId != null && (
          <EmailComposer
            fromChannelId={channelId}
            onFromChannelChange={setChannelId}
            emailChannels={emailChannels.map((c) => ({ id: c.id, name: c.name }))}
            threadKey=""
            to={
              contact?.email
                ? [contact.email]
                : rawRecipient.includes("@")
                  ? [rawRecipient.trim()]
                  : []
            }
            onToChange={(v) => setRawRecipient(v[0] ?? "")}
            mode="forward"
            subject={subject}
            onSubjectChange={setSubject}
            cc={cc}
            onCcChange={setCc}
            bcc={bcc}
            onBccChange={setBcc}
            htmlBody={html}
            onHtmlBodyChange={setHtml}
            onSignatureChange={setSignature}
            disabled={sending}
          />
        )}

        {medium === "whatsapp" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <Dropdown<number>
                value={templateId}
                onChange={(id) => {
                  setTemplateId(id)
                  const tpl = templates.find((t) => t.id === id)
                  setParams(Array(tpl ? countTemplateVariables(tpl.message) : 0).fill(""))
                }}
                placeholder={templatesQuery.isLoading ? "Templates laden…" : "Kies een template…"}
                options={templates.map((tpl) => ({ value: tpl.id, label: `${tpl.title} (${tpl.language})` }))}
              />
            </div>
            {selectedTemplate && (
              <div className="whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-foreground/80">
                {selectedTemplate.message}
              </div>
            )}
            {Array.from({ length: varCount }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{`Variabele {{${i + 1}}}`}</label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) =>
                    setParams((prev) => {
                      const next = [...prev]
                      next[i] = e.target.value
                      return next
                    })
                  }
                  disabled={sending}
                />
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={() => close(false)} disabled={sending}>
            Annuleren
          </Button>
          <Button onClick={send} disabled={sending || !canSend}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Versturen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
