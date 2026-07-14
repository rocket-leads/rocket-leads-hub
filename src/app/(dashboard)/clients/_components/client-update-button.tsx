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
import { DismissButton } from "@/components/ui/dismiss-button"
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
 * UX shape: WhatsApp message preview where EVERY field is inline-editable -
 * opener, intro, the 7-day KPI block (incl. numbers), trend sentence,
 * conclusion, actions header, action bullets. The Trengo template's fixed
 * "Hey " prefix and "Groetjes ..." suffix happen at send time and aren't
 * rendered in the dialog, so the AM only sees + edits the {{1}} body.
 *
 * The live preview IS the editor - what you see is exactly what gets sent.
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

export function ChannelPill({
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

// ─── Preview shapes (channel-specific) ───────────────────────────────────

type PreviewProps = {
  parts: EditableParts
  setParts: (next: EditableParts) => void
  inputsDisabled: boolean
}

// ContextNoteCard removed - AMs reported it as noise (always empty, took
// vertical space at the top of the editor). `parts.note` stays on the
// EditableParts shape for backwards-compat with stored drafts but is
// neither rendered nor written to anywhere in the UI.

export function ActionsBlock({ parts, setParts, inputsDisabled }: PreviewProps) {
  return (
    <div>
      {/* Locked header - the approved Trengo template body provides
          "✅ Wat we deze week gaan doen:" above {{5}}, so showing it
          here as muted/select-none keeps the preview faithful to what
          the customer receives and prevents the AM from "editing" a
          string that won't actually change the send. */}
      <p
        className="text-[13px] leading-relaxed text-foreground/50 select-none"
        title="Komt automatisch uit de Trengo template"
      >
        ✅ Wat we deze week gaan doen:
      </p>
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
            <DismissButton
              size="xs"
              onClick={() =>
                setParts({
                  ...parts,
                  actions: parts.actions.filter((_, idx) => idx !== i),
                })
              }
              label="Verwijder"
              stopPropagation={false}
              className={cn(
                "opacity-0 group-hover:opacity-100 transition-all hover:text-red-500",
                inputsDisabled && "opacity-30 pointer-events-none",
              )}
            />
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
  )
}

/** WhatsApp chat-bubble preview for the V2 weekly template
 *  (`rl_weekly_<voornaam>`). All template-body strings ("Hey ", ",",
 *  "📊 Cijfers deze week:", "✅ Wat we deze week gaan doen:", "Groetjes,",
 *  AM name) render as locked muted labels - only the variable content
 *  ({{1}}..{{5}}) is editable. Reads top-to-bottom exactly like what the
 *  customer will receive. */
export function WhatsAppPreview({
  parts,
  setParts,
  inputsDisabled,
  amSignOffName,
  timestamp,
}: PreviewProps & {
  amSignOffName: string
  timestamp: string
}) {
  return (
    // Wallpaper fills the entire middle scroll area (the parent gives us
    // a flex-1 region between header + footer); the bubble floats on it
    // with `ml-auto max-w-[88%]`. `min-h-full` makes the dotted bg fill
    // the pane vertically even when the bubble is short, so there's no
    // empty white strip below.
    <div
      className="px-6 py-5 bg-[#ece5dd] dark:bg-[#1f2733] min-h-full"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)",
        backgroundSize: "16px 16px",
      }}
    >
      <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-md bg-white dark:bg-zinc-900 shadow-sm px-4 py-3 space-y-2 ring-1 ring-black/[0.04]">
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[13px] leading-relaxed text-foreground/50 select-none shrink-0"
            title="Komt automatisch uit de Trengo template"
          >
            Hey
          </span>
          <div className="flex-1 min-w-0">
            <InlineInput
              value={parts.opener}
              onChange={(v) => setParts({ ...parts, opener: v })}
              placeholder="Voornaam"
              disabled={inputsDisabled}
              ariaLabel="Voornaam-regel"
            />
          </div>
          <span
            className="text-[13px] leading-relaxed text-foreground/50 select-none shrink-0"
            title="Komt automatisch uit de Trengo template"
          >
            ,
          </span>
        </div>

        <InlineTextarea
          value={parts.intro}
          onChange={(v) => setParts({ ...parts, intro: v })}
          placeholder="Korte intro…"
          disabled={inputsDisabled}
          ariaLabel="Intro"
        />

        <p
          className="text-[13px] leading-relaxed text-foreground/50 select-none pt-1"
          title="Komt automatisch uit de Trengo template"
        >
          📊 Cijfers deze week:
        </p>

        <InlineTextarea
          value={parts.kpiBlock}
          onChange={(v) => setParts({ ...parts, kpiBlock: v })}
          placeholder="• CPL: €… • Spend: €…"
          disabled={inputsDisabled}
          ariaLabel="KPI block"
        />

        {/* Single conclusion block - was previously split across
            trendSentence + conclusion. Edits go to `conclusion`; the
            trendSentence field stays empty on new composes. */}
        <InlineTextarea
          value={parts.conclusion}
          onChange={(v) => setParts({ ...parts, conclusion: v })}
          placeholder="Conclusie…"
          disabled={inputsDisabled}
          ariaLabel="Conclusie"
        />

        <div className="pt-1">
          <ActionsBlock parts={parts} setParts={setParts} inputsDisabled={inputsDisabled} />
        </div>

        {/* Overdue invoices block - auto-populated by the composer when
            the client has open Stripe invoices past their due date. Each
            invoice ships a hosted Stripe payment URL so the customer can
            settle straight from the WhatsApp message. Editable so the AM
            can strip / shorten per send; empty when nothing's overdue,
            in which case we collapse the row entirely. */}
        {(parts.overdueBlock?.length ?? 0) > 0 && (
          <InlineTextarea
            value={parts.overdueBlock}
            onChange={(v) => setParts({ ...parts, overdueBlock: v })}
            placeholder=""
            disabled={inputsDisabled}
            ariaLabel="Openstaande facturen"
          />
        )}

        {/* Sign-off: template body has "Groetjes,\n<AM>". Two separate
            paragraphs so the line break is unambiguous. */}
        <div className="pt-1 space-y-0">
          <p
            className="text-[13px] leading-relaxed text-foreground/50 select-none"
            title="Komt automatisch uit de Trengo template"
          >
            Groetjes,
          </p>
          <p
            className="text-[13px] leading-relaxed text-foreground/50 select-none"
            title="Komt automatisch uit de Trengo template"
          >
            {amSignOffName}
          </p>
        </div>

        <div className="flex justify-end pt-1">
          <span className="text-[10px] text-foreground/40 tabular-nums">{timestamp}</span>
        </div>
      </div>
    </div>
  )
}

/** Email composer preview: free-text. Email has no Meta-approved template
 *  wrapper, so unlike WhatsApp there are NO locked headers, NO comma-after-
 *  opener, NO multi-line sign-off baked in - the AM types the whole body.
 *
 *  On mount, `parts` is pre-seeded by composeInitialParts with a sensible
 *  starting draft (greeting + intro + KPI block + conclusion + actions +
 *  sign-off) all rendered into the single body textarea. The AM tweaks
 *  freely from there.
 */
export function EmailPreview({ parts, setParts, inputsDisabled }: PreviewProps) {
  // One concatenated string the textarea binds to. We keep the underlying
  // EditableParts split for the send path (subject is separate; body uses
  // renderFromParts on read), but the AM sees + edits a single body.
  const body = useMemo(() => {
    const blocks: string[] = []
    if (parts.opener?.trim()) blocks.push(parts.opener.trim())
    if (parts.intro?.trim()) blocks.push(parts.intro.trim())
    if (parts.kpiBlock?.trim()) blocks.push(parts.kpiBlock.trim())
    if (parts.conclusion?.trim()) blocks.push(parts.conclusion.trim())
    const validActions = (parts.actions ?? []).map((a) => a.trim()).filter(Boolean)
    if (validActions.length > 0) {
      const lines: string[] = []
      if (parts.actionsHeader?.trim()) lines.push(parts.actionsHeader.trim())
      for (const a of validActions) lines.push(`• ${a}`)
      blocks.push(lines.join("\n"))
    }
    // Overdue invoices block - payment links appear before the sign-off
    // so the call-to-action reads as the closing CTA.
    if (parts.overdueBlock?.trim()) blocks.push(parts.overdueBlock.trim())
    if (parts.signOff?.trim()) blocks.push(parts.signOff.trim())
    return blocks.join("\n\n").trim()
  }, [parts])

  // Auto-resize so the body grows with content. Capped to 70vh so a very
  // long draft scrolls inside the editor instead of pushing the footer
  // off-screen.
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(el.scrollHeight, 360)}px`
  }, [body])

  return (
    <div className="px-6 py-5 bg-muted/30 dark:bg-zinc-900/40 min-h-full">
      <div className="max-w-3xl mx-auto rounded-lg border border-border/60 bg-background shadow-sm overflow-hidden">
        {/* Subject row - sticks at top with a thin border, like a real
            email composer. */}
        <div className="border-b border-border/60 px-5 py-3 flex items-center gap-3">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium shrink-0 w-20">
            Onderwerp
          </span>
          <input
            type="text"
            value={parts.subject}
            onChange={(e) => setParts({ ...parts, subject: e.target.value })}
            placeholder="Wekelijkse update…"
            disabled={inputsDisabled}
            aria-label="Onderwerp"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none p-0 text-sm font-medium text-foreground placeholder:text-foreground/30"
          />
        </div>

        {/* Body - single free-text textarea. Edits are stored entirely on
            `parts.conclusion`; opener/intro/kpiBlock/actions/signOff +
            overdueBlock all get blanked so renderFromParts emits exactly
            what the AM typed (any overdue payment links the composer
            seeded will already be merged into `body` here and end up
            inside the conclusion). For the send, `conclusion` becomes
            the whole email body. */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) =>
            setParts({
              ...parts,
              opener: "",
              intro: "",
              kpiBlock: "",
              conclusion: e.target.value,
              actionsHeader: "",
              actions: [],
              signOff: "",
              overdueBlock: "",
            })
          }
          disabled={inputsDisabled}
          placeholder="Typ je email…"
          aria-label="Email body"
          className={cn(
            "w-full px-5 py-4 bg-transparent border-0 outline-none resize-none",
            "text-sm leading-relaxed text-foreground/90 font-sans",
            "placeholder:text-foreground/30",
            "min-h-[360px] max-h-[70vh] overflow-y-auto",
          )}
        />
      </div>
    </div>
  )
}

// ─── Dialog ───────────────────────────────────────────────────────────────

type DialogProps = Props & {
  open: boolean
  onOpenChange: (next: boolean) => void
}

export function ClientUpdateDialog({
  mondayItemId,
  clientName,
  open,
  onOpenChange,
}: DialogProps) {
  const queryClient = useQueryClient()
  const [parts, setParts] = useState<EditableParts | null>(null)
  const [channel, setChannel] = useState<ClientUpdateResponse["channel"]>("unknown")
  const [channelLabel, setChannelLabel] = useState("")
  const [trengoLinked, setTrengoLinked] = useState(false)
  const [waTemplateName, setWaTemplateName] = useState<string | null>(null)
  const [recipientEmail, setRecipientEmail] = useState<string | null>(null)
  const [recipientPhone, setRecipientPhone] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [testMode, setTestMode] = useState(false)
  // Ad-hoc test recipients - persisted in localStorage so the AM doesn't
  // have to retype each session, but never stored server-side (there's
  // no per-user "test contact" setting any more). The dialog renders an
  // email OR phone input depending on the channel of the current send.
  const [testEmail, setTestEmail] = useState("")
  const [testPhone, setTestPhone] = useState("")
  useEffect(() => {
    if (typeof window === "undefined") return
    setTestEmail(window.localStorage.getItem("hub:test:email") ?? "")
    setTestPhone(window.localStorage.getItem("hub:test:phone") ?? "")
  }, [])
  useEffect(() => {
    if (typeof window === "undefined") return
    if (testEmail) window.localStorage.setItem("hub:test:email", testEmail)
  }, [testEmail])
  useEffect(() => {
    if (typeof window === "undefined") return
    if (testPhone) window.localStorage.setItem("hub:test:phone", testPhone)
  }, [testPhone])

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
      // Parts are already V2-shape (composeInitialParts emits them that
      // way for the WhatsApp path: no leading KPI header, no editable
      // actionsHeader, opener without trailing "!"). The template
      // provides every surrounding string the AM sees as locked muted
      // labels in the preview.
      setParts(data.parts)
      setChannel(data.channel)
      setChannelLabel(data.channelLabel)
      setTrengoLinked(data.trengoContactLinked)
      setWaTemplateName(data.whatsappTemplateName)
      setRecipientEmail(data.recipientEmail)
      setRecipientPhone(data.recipientPhone)
    },
    onError: (e: Error) => setGenerateError(e.message),
  })

  const send = useMutation({
    mutationFn: async (payload: {
      message: string
      subject?: string
      /** Full editable parts - the server uses these for V2 multi-variable
       *  template sends (`rl_weekly_<voornaam>`) when the feature
       *  flag is on. Ignored on V1 path. */
      parts?: EditableParts
      /** Test mode: swap recipient with the ad-hoc email/phone supplied
       *  below. Body/template/channel stay real - only the destination
       *  is replaced. */
      test?: boolean
      /** Ad-hoc test recipients. Email is required for an email-channel
       *  send, phone for a WhatsApp send. */
      testEmail?: string
      testPhone?: string
    }) => {
      setSendError(null)
      const res = await fetch(`/api/clients/${mondayItemId}/send-client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        throw new Error(err.message ?? err.error ?? "Failed to send")
      }
      return res.json()
    },
    onSuccess: () => {
      setSent(true)
      // Refresh the "Client update" column so the row flips to the green
      // "Deze week verstuurd" state immediately after send.
      void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
      setTimeout(() => onOpenChange(false), 1200)
    },
    onError: (e: Error) => setSendError(e.message),
  })

  useEffect(() => {
    if (!open) return
    // Compose the weekly update fresh on open via /client-update (same
    // KPI + Pedro + Stripe + channel pipeline the cron used to run). The
    // weekly window is last week's already-completed range, so a fresh
    // build always reflects the right data.
    if (!generate.data && !generate.isPending) generate.mutate()
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

  // The Trengo template's sign-off uses the AM's first name. We derive
  // it from the slug, stripping both the `rl_(weekly|universal)_`
  // prefix AND any version suffix like `_2` (added by re-approvals
  // when Meta flagged the first version). Capitalised for readability;
  // falls back to "…" when no template is resolved yet so the muted
  // line still has shape.
  const amSignOffName = useMemo(() => {
    if (!waTemplateName) return "…"
    const slug = waTemplateName
      .replace(/^rl_(weekly|universal)_/i, "")
      .replace(/_\d+$/, "")
      .trim()
    if (!slug) return "…"
    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }, [waTemplateName])

  const isLoading = generate.isPending
  const isSending = send.isPending
  const inputsDisabled = isSending || sent
  const isEmail = channel === "email"

  // For WhatsApp the AM's HSM template is required (Meta won't accept free
  // text outside the 24h window, and we route ALL outbound via template).
  // For email no template is needed - Trengo handles the email channel
  // server-side once we have a Trengo contact.
  // Test mode adds its own gate: the ad-hoc destination input must be
  // filled before we let the send fire - server would reject otherwise
  // with a less friendly 400.
  const testRecipientReady = !testMode || (isEmail ? !!testEmail.trim() : !!testPhone.trim())
  const canSend =
    !!previewText.trim() &&
    !inputsDisabled &&
    trengoLinked &&
    (isEmail || !!waTemplateName) &&
    testRecipientReady

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

        {testMode && parts && (
          <div className="mx-6 mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-2">
            <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
              <strong>Test mode</strong> - bericht gaat naar het ingevulde adres hieronder, niet naar de klant. FROM channel, template en body blijven realistisch.
            </p>
            <div className="flex items-center gap-2">
              <label className="text-[10px] uppercase tracking-wider text-amber-700/70 dark:text-amber-400/70 font-medium shrink-0 w-16">
                {channel === "email" ? "To (email)" : "To (phone)"}
              </label>
              {channel === "email" ? (
                <input
                  type="email"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="jij@rocketleads.com"
                  className="flex-1 text-xs px-2 py-1.5 rounded-md border border-amber-500/30 bg-background outline-none focus:border-amber-500"
                />
              ) : (
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder="+31612345678"
                  className="flex-1 text-xs px-2 py-1.5 rounded-md border border-amber-500/30 bg-background outline-none focus:border-amber-500 font-mono"
                />
              )}
            </div>
            <p className="text-[10px] text-amber-700/60 dark:text-amber-400/60">
              Opgeslagen in je browser - hoef je niet opnieuw te typen.
            </p>
          </div>
        )}

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
            {isEmail ? (
              <EmailPreview
                parts={parts}
                setParts={setParts}
                inputsDisabled={inputsDisabled}
              />
            ) : (
              <WhatsAppPreview
                parts={parts}
                setParts={setParts}
                inputsDisabled={inputsDisabled}
                amSignOffName={amSignOffName}
                timestamp={timestamp}
              />
            )}

            <div className="px-6 pb-2 space-y-1.5">
              {isEmail ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Verzonden als email via Trengo, met onderwerp en sign-off zoals hierboven.
                </p>
              ) : waTemplateName ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Verzonden via WhatsApp template{" "}
                  <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
                    {waTemplateName}
                  </code>
                </p>
              ) : (
                <p className="text-xs text-amber-500">
                  Kan WhatsApp template niet afleiden uit users.name. Verwacht{" "}
                  <code className="rounded bg-muted/60 px-1 font-mono text-[10px]">
                    rl_weekly_&lt;voornaam&gt;
                  </code>{" "}
                  - check Settings &rarr; Users.
                </p>
              )}
              {/* Recipient verification - shows the actual email/phone the
                  send is going to, resolved from the linked Trengo contact.
                  Suppressed in test mode (banner above already explains
                  where it goes). */}
              {!testMode && trengoLinked && (isEmail ? recipientEmail : recipientPhone) && (
                <p className="text-[11px] text-muted-foreground/70">
                  Naar:{" "}
                  <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
                    {isEmail ? recipientEmail : recipientPhone}
                  </code>
                </p>
              )}
              {!trengoLinked && (
                <p className="text-xs text-amber-500">
                  Geen Trengo contact gekoppeld op deze klant, versturen is niet mogelijk.
                </p>
              )}
              {sendError && <p className="text-xs text-red-500">{sendError}</p>}
              {sent && (
                <p className="text-xs text-emerald-500">
                  {testMode ? "Test bericht verzonden ✓" : "Bericht verzonden ✓"}
                </p>
              )}
            </div>
          </>
        ) : null}

        <DialogFooter className="px-6 pb-6 flex items-center justify-between gap-3 sm:justify-between">
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              disabled={inputsDisabled}
              className="h-3.5 w-3.5 rounded border-border accent-amber-500"
            />
            Send as test (to me)
          </label>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSending}>
              Annuleren
            </Button>
            <Button
              onClick={() =>
                send.mutate({
                  message: previewText,
                  subject: isEmail ? parts?.subject?.trim() || undefined : undefined,
                  // Ship the editable parts too so the server can derive V2
                  // template variables. Server ignores this when V2 flag is
                  // off or when channel is email.
                  parts: parts ?? undefined,
                  test: testMode || undefined,
                  testEmail: testMode && isEmail ? testEmail.trim() : undefined,
                  testPhone: testMode && !isEmail ? testPhone.trim() : undefined,
                })
              }
              disabled={!canSend}
              className={cn("gap-1.5", testMode && "bg-amber-500 hover:bg-amber-600 text-white")}
            >
              {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {testMode ? "Test verstuur" : "Verstuur"}
              {!testMode && channel === "whatsapp" && " via WhatsApp"}
              {!testMode && channel === "email" && " via email"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
