"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import { Mail, Loader2, Send, ChevronDown, Check, Search, User, X } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { EmailComposer } from "./email-composer"

/**
 * "New message" composer — compose a brand-new conversation from scratch,
 * Trengo-style. Uses the same command-palette shell (top-aligned overlay, one
 * fixed panel with a scrolling body) as the global search so it reads as the
 * same product surface. One channel dropdown (WhatsApp + email; medium follows
 * the channel; defaults to the AM's personal channel), a contact-search
 * recipient (email = multiple), then the email composer or a WhatsApp template
 * + variables. Dropdown panels are portaled so they never clip. Roy 2026-07-30.
 */
export type NewMessageChannel = { id: number; name: string; kind: "whatsapp" | "email" }

type WaTemplate = { id: number; title: string; slug: string; message: string; language: string }
type Contact = { id: number; name: string; phone: string | null; email: string | null }
type Medium = "whatsapp" | "email"

function MediumIcon({ kind, className }: { kind: Medium; className?: string }) {
  if (kind === "whatsapp") {
    return (
      <Image
        src="/logos/brands/whatsapp.svg"
        alt=""
        width={16}
        height={16}
        className={cn("h-4 w-4 shrink-0 object-contain", className)}
        unoptimized
      />
    )
  }
  return <Mail className={cn("h-4 w-4 shrink-0 text-blue-500", className)} />
}

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

/** A floating option panel anchored under a trigger, rendered in a portal so
 *  it's never clipped by the dialog's scroll container. */
function FloatingPanel({
  anchorRef,
  open,
  onRequestClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onRequestClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onRequestClose()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, anchorRef, onRequestClose])

  if (!open || !pos || typeof document === "undefined") return null
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 1200 }}
      className="max-h-72 overflow-y-auto rounded-lg border border-[var(--line-strong)] bg-popover p-1 shadow-[var(--shadow-lg)]"
    >
      {children}
    </div>,
    document.body,
  )
}

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
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((o) => o.value === value) ?? null
  return (
    <>
      <button
        ref={btnRef}
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
      <FloatingPanel anchorRef={btnRef} open={open} onRequestClose={() => setOpen(false)}>
        {options.length === 0 && <p className="px-2.5 py-2 text-sm text-muted-foreground">Geen opties</p>}
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
      </FloatingPanel>
    </>
  )
}

function ContactSearch({
  medium,
  query,
  onQueryChange,
  onPickContact,
  onSubmitRaw,
}: {
  medium: Medium
  query: string
  onQueryChange: (v: string) => void
  onPickContact: (c: Contact) => void
  onSubmitRaw: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounced(query, 250)

  const q = useQuery<{ contacts: Contact[] }>({
    queryKey: ["contact-search", medium, debounced],
    queryFn: () =>
      fetch(`/api/inbox/contact-search?kind=${medium}&q=${encodeURIComponent(debounced)}`).then((r) =>
        r.json(),
      ),
    enabled: open,
    staleTime: 30_000,
  })
  const contacts = q.data?.contacts ?? []

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">
        {medium === "whatsapp" ? "Naar (naam of telefoonnummer)" : "Naar (naam of e-mailadres)"}
      </label>
      <div ref={wrapRef} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
        <Input
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              onSubmitRaw()
              setOpen(false)
            }
          }}
          placeholder={medium === "whatsapp" ? "Zoek contact of +31 6…" : "Zoek contact of naam@bedrijf.nl"}
          className="pl-9"
        />
      </div>
      <FloatingPanel anchorRef={wrapRef} open={open} onRequestClose={() => setOpen(false)}>
        {q.isLoading && (
          <p className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Zoeken…
          </p>
        )}
        {!q.isLoading && contacts.length === 0 && (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            Geen contacten — typ het {medium === "whatsapp" ? "nummer" : "adres"} en druk op Enter.
          </p>
        )}
        {contacts.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onPickContact(c)
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
      </FloatingPanel>
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
  const defaultsQuery = useQuery<{ email: number | null; whatsapp: number | null }>({
    queryKey: ["inbox-default-channels"],
    queryFn: () => fetch("/api/inbox/default-channels").then((r) => r.json()),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  const [channelId, setChannelId] = useState<number | null>(null)
  const selectedChannel = channels.find((c) => c.id === channelId) ?? null
  const medium: Medium = selectedChannel?.kind ?? "email"

  const [search, setSearch] = useState("")
  const [waPhone, setWaPhone] = useState("")
  const [emailTo, setEmailTo] = useState<string[]>([])

  const [subject, setSubject] = useState("")
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [html, setHtml] = useState("")
  const [signature, setSignature] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState<number | null>(null)
  const [params, setParams] = useState<string[]>([])

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orderedChannels = useMemo(() => {
    const fav = new Set(favoriteIds)
    return [...channels].sort((a, b) => {
      const fd = (fav.has(b.id) ? 1 : 0) - (fav.has(a.id) ? 1 : 0)
      if (fd !== 0) return fd
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.name.localeCompare(b.name)
    })
  }, [channels, favoriteIds])

  const initedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      initedRef.current = false
      return
    }
    if (initedRef.current || defaultsQuery.isLoading) return
    initedRef.current = true
    const d = defaultsQuery.data
    const pick =
      channels.find((c) => c.id === d?.email)?.id ??
      channels.find((c) => c.id === d?.whatsapp)?.id ??
      orderedChannels[0]?.id ??
      null
    setChannelId(pick)
  }, [open, defaultsQuery.isLoading, defaultsQuery.data, channels, orderedChannels])

  const templatesQuery = useQuery<{ templates: WaTemplate[] }>({
    queryKey: ["wa-templates", channelId],
    queryFn: () => fetch(`/api/inbox/wa-templates?channelId=${channelId}`).then((r) => r.json()),
    enabled: open && medium === "whatsapp" && channelId != null,
  })
  const templates = templatesQuery.data?.templates ?? []
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId) ?? null
  const varCount = selectedTemplate ? countTemplateVariables(selectedTemplate.message) : 0

  function addEmail(addr: string) {
    const a = addr.trim()
    if (!a) return
    setEmailTo((prev) => (prev.includes(a) ? prev : [...prev, a]))
    setSearch("")
  }

  function reset() {
    initedRef.current = false
    setSearch("")
    setWaPhone("")
    setEmailTo([])
    setSubject("")
    setCc([])
    setBcc([])
    setHtml("")
    setSignature(null)
    setTemplateId(null)
    setParams([])
    setError(null)
  }
  function close() {
    reset()
    onOpenChange(false)
  }

  // Escape closes; lock body scroll while open — matching the command palette.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close()
    }
    document.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function send() {
    if (!channelId) {
      setError("Kies een kanaal")
      return
    }
    setSending(true)
    setError(null)
    try {
      let payload: Record<string, unknown>
      if (medium === "email") {
        const extra = search.includes("@") ? [search.trim()] : []
        const recipients = Array.from(new Set([...emailTo, ...extra])).filter(Boolean)
        if (recipients.length === 0) throw new Error("Kies of typ minimaal één e-mailadres")
        const fullHtml = signature ? `${html}<br><br>${signature}` : html
        payload = {
          channelId,
          kind: "email",
          to: recipients[0],
          cc: [...cc, ...recipients.slice(1)],
          bcc,
          subject,
          html: fullHtml,
        }
      } else {
        const phone = (waPhone || search).trim()
        if (!phone) throw new Error("Kies of typ een telefoonnummer")
        if (!selectedTemplate) throw new Error("Kies een WhatsApp-template")
        payload = {
          channelId,
          kind: "whatsapp",
          to: phone,
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
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt")
    } finally {
      setSending(false)
    }
  }

  const emailReady = emailTo.length > 0 || search.includes("@")
  const canSend =
    !!channelId &&
    (medium === "email"
      ? emailReady && (html.trim() || subject.trim())
      : (waPhone || search).trim() && !!selectedTemplate)

  if (!open) return null

  return (
    <div className="cmd-overlay open" onMouseDown={close}>
      <div
        className="cmd-panel"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Nieuw bericht"
      >
        {/* Header — mirrors the command palette's search bar chrome. */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-base font-semibold">Nieuw bericht</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Sluiten"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrolling body. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Kanaal</label>
            <Dropdown<number>
              value={channelId}
              onChange={(id) => {
                setChannelId(id)
                setTemplateId(null)
                setParams([])
                setError(null)
              }}
              placeholder="Kies kanaal"
              options={orderedChannels.map((c) => ({
                value: c.id,
                label: c.name,
                icon: <MediumIcon kind={c.kind} />,
              }))}
            />
          </div>

          {channelId != null && (
            <ContactSearch
              medium={medium}
              query={search}
              onQueryChange={setSearch}
              onPickContact={(c) => {
                if (medium === "whatsapp") {
                  setWaPhone(c.phone ?? "")
                  setSearch(c.phone ?? "")
                } else if (c.email) {
                  addEmail(c.email)
                }
              }}
              onSubmitRaw={() => {
                if (medium === "whatsapp") {
                  setWaPhone(search.trim())
                } else if (search.includes("@")) {
                  addEmail(search)
                }
              }}
            />
          )}

          {medium === "email" && channelId != null && (
            <EmailComposer
              fromChannelId={channelId}
              onFromChannelChange={setChannelId}
              emailChannels={channels.filter((c) => c.kind === "email").map((c) => ({ id: c.id, name: c.name }))}
              threadKey=""
              to={emailTo}
              onToChange={setEmailTo}
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

          {medium === "whatsapp" && channelId != null && (
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
        </div>

        {/* Footer actions. */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-5 py-3.5">
          <Button variant="outline" onClick={close} disabled={sending}>
            Annuleren
          </Button>
          <Button onClick={send} disabled={sending || !canSend}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Versturen
          </Button>
        </div>
      </div>
    </div>
  )
}
