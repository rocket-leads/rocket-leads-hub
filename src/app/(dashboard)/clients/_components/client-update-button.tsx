"use client"

import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  MessageSquareText,
  Loader2,
  Send,
  Sparkles,
  Mail,
  MessageCircle,
  AlertCircle,
  Plus,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ClientUpdateResponse } from "@/app/api/clients/[id]/client-update/route"
import {
  renderFromParts,
  type EditableParts,
} from "@/lib/clients/client-update-template"

type Props = {
  mondayItemId: string
  clientName: string
}

/**
 * Trigger + dialog for the weekly client update.
 *
 * UX shape: WhatsApp message preview where EVERY field is inline-editable —
 * opener, intro, the 7-day KPI block (incl. numbers), trend sentence,
 * conclusion, actions header, action bullets. The Trengo template's fixed
 * "Hey " prefix and "Groetjes ..." suffix happen at send time and aren't
 * rendered in the dialog, so the AM only sees + edits the {{1}} body.
 *
 * The live preview IS the editor — what you see is exactly what gets sent.
 * On send we POST the rendered string (output of `renderFromParts(parts)`)
 * which Trengo then wraps in the AM's `rl_universal_<voornaam>` HSM template.
 */
export function ClientUpdateButton({ mondayItemId, clientName }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        title="Genereer en stuur wekelijkse client update"
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 px-2 py-1 text-[11px] font-medium text-violet-500 hover:bg-violet-500/10 hover:border-violet-500/50 transition-colors"
      >
        <MessageSquareText className="h-3 w-3" />
        Update
      </button>
      {open && (
        <ClientUpdateDialog
          mondayItemId={mondayItemId}
          clientName={clientName}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </>
  )
}

// ─── Channel pill ────────────────────────────────────────────────────────

function ChannelPill({
  channel,
  channelLabel,
}: {
  channel: ClientUpdateResponse["channel"]
  channelLabel: string
}) {
  if (channel === "whatsapp") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
        <MessageCircle className="h-3 w-3" />
        WhatsApp
      </Badge>
    )
  }
  if (channel === "email") {
    return (
      <Badge variant="outline" className="gap-1 border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400">
        <Mail className="h-3 w-3" />
        Email
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="gap-1 border-muted-foreground/30 bg-muted/40 text-muted-foreground"
      title={channelLabel ? `Monday contact_channel = "${channelLabel}"` : "Contact channel not set on Monday"}
    >
      <AlertCircle className="h-3 w-3" />
      {channelLabel || "Geen kanaal"}
    </Badge>
  )
}

// ─── Inline editable inputs ──────────────────────────────────────────────

function InlineInput({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full bg-transparent border-0 outline-none p-0 px-1 -mx-1",
        "text-[13px] leading-relaxed text-foreground/90 font-sans",
        "rounded transition-colors",
        "hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]",
        "placeholder:text-foreground/30",
      )}
    />
  )
}

function InlineTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full bg-transparent border-0 outline-none p-0 px-1 -mx-1",
        "text-[13px] leading-relaxed text-foreground/90 font-sans resize-none",
        "rounded transition-colors",
        "hover:bg-foreground/[0.04] focus:bg-foreground/[0.06]",
        "placeholder:text-foreground/30",
        "overflow-hidden",
      )}
    />
  )
}

// ─── Dialog ───────────────────────────────────────────────────────────────

type DialogProps = Props & {
  open: boolean
  onOpenChange: (next: boolean) => void
}

function ClientUpdateDialog({ mondayItemId, clientName, open, onOpenChange }: DialogProps) {
  const queryClient = useQueryClient()
  const [parts, setParts] = useState<EditableParts | null>(null)
  const [channel, setChannel] = useState<ClientUpdateResponse["channel"]>("unknown")
  const [channelLabel, setChannelLabel] = useState("")
  const [trengoLinked, setTrengoLinked] = useState(false)
  const [waTemplateName, setWaTemplateName] = useState<string | null>(null)
  const [waTemplateSource, setWaTemplateSource] = useState<ClientUpdateResponse["whatsappTemplateSource"]>("none")
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const generate = useMutation({
    mutationFn: async () => {
      setGenerateError(null)
      const res = await fetch(`/api/clients/${mondayItemId}/client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(err.message ?? err.error ?? "Failed to generate update")
      }
      return (await res.json()) as ClientUpdateResponse
    },
    onSuccess: (data) => {
      setParts(data.parts)
      setChannel(data.channel)
      setChannelLabel(data.channelLabel)
      setTrengoLinked(data.trengoContactLinked)
      setWaTemplateName(data.whatsappTemplateName)
      setWaTemplateSource(data.whatsappTemplateSource)
    },
    onError: (e: Error) => setGenerateError(e.message),
  })

  const send = useMutation({
    mutationFn: async (message: string) => {
      setSendError(null)
      const res = await fetch(`/api/clients/${mondayItemId}/send-client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(err.message ?? err.error ?? "Failed to send")
      }
      return res.json()
    },
    onSuccess: () => {
      setSent(true)
      void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
      setTimeout(() => onOpenChange(false), 1200)
    },
    onError: (e: Error) => setSendError(e.message),
  })

  useEffect(() => {
    if (open && !generate.data && !generate.isPending) generate.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const previewText = useMemo(() => {
    if (!parts) return ""
    return renderFromParts(parts)
  }, [parts])

  const timestamp = useMemo(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }, [open])

  const isLoading = generate.isPending
  const isSending = send.isPending
  const inputsDisabled = isSending || sent
  const canSend = !!previewText.trim() && !inputsDisabled && trengoLinked && !!waTemplateName

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[92vw] max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                Client update, {clientName}
              </DialogTitle>
            </div>
            <ChannelPill channel={channel} channelLabel={channelLabel} />
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Update klaarzetten…
          </div>
        ) : generateError ? (
          <div className="mx-6 mb-6 rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-500 leading-relaxed">{generateError}</p>
          </div>
        ) : parts ? (
          <>
            {/* WhatsApp wallpaper + bubble. Every field is editable. */}
            <div
              className="px-6 py-6 bg-[#ece5dd] dark:bg-[#1f2733]"
              style={{
                backgroundImage:
                  "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)",
                backgroundSize: "16px 16px",
              }}
            >
              <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-white dark:bg-zinc-900 shadow-sm px-4 py-3 space-y-2 ring-1 ring-black/[0.04]">
                <InlineInput
                  value={parts.opener}
                  onChange={(v) => setParts({ ...parts, opener: v })}
                  placeholder="Voornaam!"
                  disabled={inputsDisabled}
                  ariaLabel="Voornaam-regel"
                />

                <InlineTextarea
                  value={parts.intro}
                  onChange={(v) => setParts({ ...parts, intro: v })}
                  placeholder="Korte intro…"
                  disabled={inputsDisabled}
                  ariaLabel="Intro"
                />

                <InlineTextarea
                  value={parts.kpiBlock}
                  onChange={(v) => setParts({ ...parts, kpiBlock: v })}
                  placeholder="📊 KPI block…"
                  disabled={inputsDisabled}
                  ariaLabel="KPI block"
                />

                <InlineTextarea
                  value={parts.trendSentence}
                  onChange={(v) => setParts({ ...parts, trendSentence: v })}
                  placeholder="(geen trend zin)"
                  disabled={inputsDisabled}
                  ariaLabel="Trend"
                />

                <InlineTextarea
                  value={parts.conclusion}
                  onChange={(v) => setParts({ ...parts, conclusion: v })}
                  placeholder="Conclusie…"
                  disabled={inputsDisabled}
                  ariaLabel="Conclusie"
                />

                {/* Action header + bullets grouped together. */}
                <div className="pt-1">
                  <InlineInput
                    value={parts.actionsHeader}
                    onChange={(v) => setParts({ ...parts, actionsHeader: v })}
                    placeholder="✅ Actie-header…"
                    disabled={inputsDisabled}
                    ariaLabel="Actie-header"
                  />
                  <ul className="space-y-0.5 mt-0.5">
                    {parts.actions.map((a, i) => (
                      <li key={i} className="group flex items-start gap-2">
                        <span className="text-foreground/70 text-[13px] leading-relaxed select-none pt-0">
                          •
                        </span>
                        <div className="flex-1 min-w-0">
                          <InlineTextarea
                            value={a}
                            onChange={(v) => {
                              const next = [...parts.actions]
                              next[i] = v
                              setParts({ ...parts, actions: next })
                            }}
                            disabled={inputsDisabled}
                            ariaLabel={`Actie ${i + 1}`}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setParts({
                              ...parts,
                              actions: parts.actions.filter((_, idx) => idx !== i),
                            })
                          }
                          disabled={inputsDisabled}
                          title="Verwijder"
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-red-500 transition-all p-0.5 disabled:opacity-30 shrink-0"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {parts.actions.length < 5 && !inputsDisabled && (
                    <button
                      type="button"
                      onClick={() => setParts({ ...parts, actions: [...parts.actions, ""] })}
                      className="mt-1 ml-4 inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Actie toevoegen
                    </button>
                  )}
                </div>

                <div className="flex justify-end pt-1">
                  <span className="text-[10px] text-foreground/40 tabular-nums">{timestamp}</span>
                </div>
              </div>

              {/* Single subtle hint OUTSIDE the bubble: explains what the
                  Trengo template wraps so the AM knows greeting + sign-off
                  aren't part of what they edit. Sits below the bubble, no
                  visual conflict with the message preview itself. */}
              <p className="ml-auto max-w-[88%] mt-2 text-[10px] text-foreground/50 italic">
                Trengo template plakt automatisch <code className="not-italic font-mono text-foreground/60">Hey&nbsp;…</code> ervoor en <code className="not-italic font-mono text-foreground/60">Groetjes&nbsp;{waTemplateName?.replace(/^rl_universal_/, "") || "…"}</code> eronder.
              </p>
            </div>

            <div className="px-6 pb-2 space-y-1.5">
              {waTemplateName ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Verzonden via WhatsApp template{" "}
                  <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
                    {waTemplateName}
                  </code>
                  {waTemplateSource === "trengo_auto" && (
                    <span className="ml-1 text-muted-foreground/50">(uit Trengo)</span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-amber-500">
                  Geen WhatsApp template gevonden in Trengo voor jouw account. Verifieer dat{" "}
                  <code className="rounded bg-muted/60 px-1 font-mono text-[10px]">
                    rl_universal_&lt;voornaam&gt;
                  </code>{" "}
                  bestaat en goedgekeurd is, of stel 'm handmatig in via Settings → Users.
                </p>
              )}
              {!trengoLinked && (
                <p className="text-xs text-amber-500">
                  Geen Trengo contact gekoppeld op deze klant, versturen is niet mogelijk.
                </p>
              )}
              {sendError && <p className="text-xs text-red-500">{sendError}</p>}
              {sent && <p className="text-xs text-emerald-500">Bericht verzonden ✓</p>}
            </div>
          </>
        ) : null}

        <DialogFooter className="px-6 pb-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending}>
            Annuleren
          </Button>
          <Button onClick={() => send.mutate(previewText)} disabled={!canSend} className="gap-1.5">
            {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Verstuur
            {channel === "whatsapp" && " via WhatsApp"}
            {channel === "email" && " via email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
