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

// ─── Preview shapes (channel-specific) ───────────────────────────────────

type PreviewProps = {
  parts: EditableParts
  setParts: (next: EditableParts) => void
  inputsDisabled: boolean
}

/** Free-form context input above the bubble. The AM dictates context here
 *  ("we hebben de drempel verhoogd, daarom is CPL gestegen") and it flows
 *  into the rendered body BEFORE Pedro's conclusion, anchoring the framing
 *  with the AM's first-hand knowledge. White card so it's visually distinct
 *  from the message bubble itself. */
function ContextNoteCard({ parts, setParts, inputsDisabled }: PreviewProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "0px"
    el.style.height = `${Math.max(el.scrollHeight, 48)}px`
  }, [parts.note])

  return (
    <div className="px-6 pt-4">
      <div className="rounded-md border border-border/60 bg-background shadow-sm">
        <div className="px-4 py-2 border-b border-border/40 flex items-center gap-2">
          <Sparkles className="h-3 w-3 text-muted-foreground/60" />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
            Extra context (optioneel)
          </span>
          <span className="text-[10px] text-muted-foreground/40 italic ml-auto">
            verschijnt in het bericht
          </span>
        </div>
        <textarea
          ref={ref}
          value={parts.note}
          onChange={(e) => setParts({ ...parts, note: e.target.value })}
          placeholder="bv. 'we hebben deze week een extra vraag toegevoegd, daarom is CPL gestegen…'"
          disabled={inputsDisabled}
          rows={1}
          className={cn(
            "w-full px-4 py-2.5 bg-transparent border-0 outline-none resize-none",
            "text-sm leading-relaxed text-foreground/90 font-sans",
            "placeholder:text-foreground/30",
            "overflow-hidden",
          )}
        />
      </div>
    </div>
  )
}

function ActionsBlock({
  parts,
  setParts,
  inputsDisabled,
  isV2 = false,
}: PreviewProps & { isV2?: boolean }) {
  return (
    <div>
      {isV2 ? (
        // V2: header is hardcoded in the approved template body
        // ("✅ Wat we deze week gaan doen:") so we render it as a locked
        // visual label instead of an editable input. Avoids the AM thinking
        // they can change it (they can't — Meta approves the template body
        // verbatim) and avoids a double header on send.
        <p
          className="text-[13px] leading-relaxed text-foreground/50 select-none"
          title="Komt automatisch uit de Trengo template"
        >
          ✅ Wat we deze week gaan doen:
        </p>
      ) : (
        <InlineInput
          value={parts.actionsHeader}
          onChange={(v) => setParts({ ...parts, actionsHeader: v })}
          placeholder="✅ Actie-header…"
          disabled={inputsDisabled}
          ariaLabel="Actie-header"
        />
      )}
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
  )
}

/** WhatsApp chat-bubble preview: beige wallpaper, single white bubble on the
 *  right, locked "Hey" prefix + "Groetjes <am>" suffix (from the Trengo HSM
 *  template), all the middle content editable. Short paragraphs, compact
 *  spacing — reads like a real WhatsApp message.
 *
 *  V1 vs V2 layout differences (driven by `isV2`):
 *   - V1: opener placeholder is "Voornaam!" (template body has "Hey {{1}}"
 *     with no trailing punctuation, so AM types the "!"). Sign-off renders
 *     inline as "Groetjes <Naam>".
 *   - V2: opener has a locked "," after the editable name (template body
 *     has "Hey {{1}},"). KPI + actions headers render as fixed labels
 *     because the approved template body provides them verbatim. Sign-off
 *     renders as two lines ("Groetjes," + "<Naam>") to match the multi-line
 *     sign-off baked into the template body. */
function WhatsAppPreview({
  parts,
  setParts,
  inputsDisabled,
  amSignOffName,
  timestamp,
  isV2 = false,
}: PreviewProps & {
  amSignOffName: string
  timestamp: string
  isV2?: boolean
}) {
  return (
    <div
      className="px-6 py-6 bg-[#ece5dd] dark:bg-[#1f2733]"
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
              placeholder={isV2 ? "Voornaam" : "Voornaam!"}
              disabled={inputsDisabled}
              ariaLabel="Voornaam-regel"
            />
          </div>
          {isV2 && (
            // Locked "," — V2 template body is "Hey {{1}}," so the comma is
            // added by Meta on render. Showing it here keeps the preview
            // faithful to what the customer receives.
            <span
              className="text-[13px] leading-relaxed text-foreground/50 select-none shrink-0"
              title="Komt automatisch uit de Trengo template"
            >
              ,
            </span>
          )}
        </div>

        <InlineTextarea
          value={parts.intro}
          onChange={(v) => setParts({ ...parts, intro: v })}
          placeholder="Korte intro…"
          disabled={inputsDisabled}
          ariaLabel="Intro"
        />

        {isV2 && (
          // V2: locked "📊 Cijfers deze week:" label sits above the editable
          // KPI bullets. The kpiBlock value has already had its V1 header
          // line stripped by reshapeForV2 in the dialog, so the textarea
          // below shows only bullets.
          <p
            className="text-[13px] leading-relaxed text-foreground/50 select-none pt-1"
            title="Komt automatisch uit de Trengo template"
          >
            📊 Cijfers deze week:
          </p>
        )}

        <InlineTextarea
          value={parts.kpiBlock}
          onChange={(v) => setParts({ ...parts, kpiBlock: v })}
          placeholder={isV2 ? "• CPL: €… • Spend: €…" : "📊 KPI block…"}
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

        {/* AM's dictated context — only renders in the bubble when non-empty
            (the input itself lives in the Card above the bubble). Same field,
            two views: edit there, preview here. */}
        {parts.note?.trim() && (
          <p className="text-[13px] leading-relaxed text-foreground/90 px-1 -mx-1 whitespace-pre-wrap">
            {parts.note}
          </p>
        )}

        <InlineTextarea
          value={parts.conclusion}
          onChange={(v) => setParts({ ...parts, conclusion: v })}
          placeholder="Conclusie…"
          disabled={inputsDisabled}
          ariaLabel="Conclusie"
        />

        <div className="pt-1">
          <ActionsBlock
            parts={parts}
            setParts={setParts}
            inputsDisabled={inputsDisabled}
            isV2={isV2}
          />
        </div>

        {isV2 ? (
          // V2 sign-off matches the approved template body: "Groetjes," on
          // its own line, then the AM's name on the next line. Render as
          // two separate <p>s so the line break is unambiguous (vs relying
          // on \n inside one span).
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
        ) : (
          <p
            className="text-[13px] leading-relaxed text-foreground/50 select-none pt-1"
            title="Komt automatisch uit de Trengo template"
          >
            Groetjes {amSignOffName}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <span className="text-[10px] text-foreground/40 tabular-nums">{timestamp}</span>
        </div>
      </div>
    </div>
  )
}

/** Email composer preview: looks like a real email client, not a chat bubble.
 *  Subject field at the top, white body area with generous paragraph spacing,
 *  full greeting + sign-off baked into the body (email has no template wrapper).
 *  All fields editable. */
function EmailPreview({ parts, setParts, inputsDisabled }: PreviewProps) {
  return (
    <div className="px-6 py-4 bg-muted/20 dark:bg-zinc-900/40">
      <div className="rounded-lg border border-border/60 bg-background shadow-sm overflow-hidden">
        {/* Subject row — sticks at top, separated by a thin border like a
            real email composer. */}
        <div className="border-b border-border/40 px-4 py-2.5 flex items-baseline gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium shrink-0 w-16">
            Onderwerp
          </span>
          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={parts.subject}
              onChange={(e) => setParts({ ...parts, subject: e.target.value })}
              placeholder="Wekelijkse update…"
              disabled={inputsDisabled}
              aria-label="Onderwerp"
              className="w-full bg-transparent border-0 outline-none p-0 text-sm font-medium text-foreground leading-snug placeholder:text-foreground/30"
            />
          </div>
        </div>

        {/* Body area with email-style spacing (space-y-4 instead of 2) so
            paragraphs breathe like an email, not a chat. */}
        <div className="px-5 py-4 space-y-4">
          <InlineInput
            value={parts.opener}
            onChange={(v) => setParts({ ...parts, opener: v })}
            placeholder="Hé Voornaam,"
            disabled={inputsDisabled}
            ariaLabel="Begroeting"
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

          {parts.trendSentence?.trim() ? (
            <InlineTextarea
              value={parts.trendSentence}
              onChange={(v) => setParts({ ...parts, trendSentence: v })}
              placeholder="(geen trend zin)"
              disabled={inputsDisabled}
              ariaLabel="Trend"
            />
          ) : (
            // Hide the trend slot when empty in email mode — emails read
            // better without a 1-line stub between paragraphs.
            <button
              type="button"
              onClick={() => setParts({ ...parts, trendSentence: " " })}
              disabled={inputsDisabled}
              className="text-[11px] text-muted-foreground/40 hover:text-muted-foreground italic"
            >
              + Trend zin toevoegen
            </button>
          )}

          {/* AM-dictated context paragraph. Editing happens in the Card above
              the bubble; here it just renders in place so the email preview
              shows the full body including the context. */}
          {parts.note?.trim() && (
            <p className="text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {parts.note}
            </p>
          )}

          <InlineTextarea
            value={parts.conclusion}
            onChange={(v) => setParts({ ...parts, conclusion: v })}
            placeholder="Conclusie…"
            disabled={inputsDisabled}
            ariaLabel="Conclusie"
          />

          <ActionsBlock parts={parts} setParts={setParts} inputsDisabled={inputsDisabled} />

          <InlineTextarea
            value={parts.signOff}
            onChange={(v) => setParts({ ...parts, signOff: v })}
            placeholder="Groetjes,&#10;…"
            disabled={inputsDisabled}
            ariaLabel="Afsluiter"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Dialog ───────────────────────────────────────────────────────────────

/** Subset of WeeklyUpdateDraftListItem the dialog actually needs to skip
 *  the generate fetch. Kept inline here (not imported from the route) so
 *  the dialog stays decoupled from the list endpoint's response shape and
 *  can be hydrated by any caller — queue overlay, mass-send tool, etc. */
export type ClientUpdateDraftSeed = {
  draftId: string
  parts: EditableParts
  channel: "whatsapp" | "email" | "unknown"
  templateVersion: 1 | 2
  templateName: string | null
}

type DialogProps = Props & {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Pre-generated draft (from the Monday cron) — when present, the dialog
   *  skips its own /client-update POST and renders from this seed
   *  immediately. On successful send, also PATCHes the draft to
   *  status='sent' so it disappears from the queue. */
  draftSeed?: ClientUpdateDraftSeed
  /** Optional callback fired after a draft-backed send completes (sent
   *  OR dismissed) so the parent can refresh its queue list. */
  onDraftResolved?: () => void
}

/** Reshape the server-generated parts so they line up with what the V2
 *  approved template body provides verbatim. Called once when the dialog
 *  loads under V2 mode; subsequent edits run on the already-reshaped state.
 *
 *   - opener: strip trailing "!" so the locked "," in the preview lines up
 *     with the template's "Hey {{1}}," construction.
 *   - kpiBlock: drop the leading "📊 KPI deze week:" line (or any non-bullet
 *     leading line) — the template's own "📊 Cijfers deze week:" sits
 *     above on render, so keeping the AM-generated header would double up.
 *   - actionsHeader: blank it. Template fixes the actions header. The
 *     dialog hides the editable input when V2 anyway.
 */
function reshapeForV2(parts: EditableParts): EditableParts {
  const lines = (parts.kpiBlock ?? "").split("\n")
  const firstBulletIdx = lines.findIndex((l) => /^\s*[•\-*]/.test(l))
  const kpiBulletsOnly =
    firstBulletIdx === -1 ? parts.kpiBlock : lines.slice(firstBulletIdx).join("\n")
  return {
    ...parts,
    opener: (parts.opener ?? "").replace(/[!?.,;:]+$/, "").trim(),
    kpiBlock: kpiBulletsOnly,
    actionsHeader: "",
  }
}

export function ClientUpdateDialog({
  mondayItemId,
  clientName,
  open,
  onOpenChange,
  draftSeed,
  onDraftResolved,
}: DialogProps) {
  const queryClient = useQueryClient()
  const [parts, setParts] = useState<EditableParts | null>(null)
  const [channel, setChannel] = useState<ClientUpdateResponse["channel"]>("unknown")
  const [channelLabel, setChannelLabel] = useState("")
  const [trengoLinked, setTrengoLinked] = useState(false)
  const [waTemplateName, setWaTemplateName] = useState<string | null>(null)
  const [waTemplateSource, setWaTemplateSource] = useState<ClientUpdateResponse["whatsappTemplateSource"]>("none")
  /** 1 = V1 universal single-var (legacy). 2 = V2 multi-var weekly-update.
   *  Drives the WhatsApp preview layout (locked headers + multi-line
   *  sign-off when V2). Null when channel is email. */
  const [templateVersion, setTemplateVersion] = useState<1 | 2 | null>(null)
  /** Server-side explanation of why V1 fallback is active (or no template
   *  at all). Shown as an inline diagnostic so the AM can self-fix without
   *  digging through Vercel logs. */
  const [templateVersionReason, setTemplateVersionReason] = useState<string | null>(null)
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
      // V2 mode reshapes the parts so the editable surface matches what the
      // approved template body provides: strip the "!" from the opener
      // (template adds ","), drop the leading "📊 KPI…" header line from
      // kpiBlock (template adds "📊 Cijfers deze week:"), and blank the
      // editable actionsHeader (template adds "✅ Wat we deze week gaan
      // doen:"). signOff stays empty for WA in both V1 and V2 since the
      // template always provides the closing line.
      const reshaped =
        data.templateVersion === 2 ? reshapeForV2(data.parts) : data.parts
      setParts(reshaped)
      setChannel(data.channel)
      setChannelLabel(data.channelLabel)
      setTrengoLinked(data.trengoContactLinked)
      setWaTemplateName(data.whatsappTemplateName)
      setWaTemplateSource(data.whatsappTemplateSource)
      setTemplateVersion(data.templateVersion)
      setTemplateVersionReason(data.templateVersionReason)
    },
    onError: (e: Error) => setGenerateError(e.message),
  })

  const send = useMutation({
    mutationFn: async (payload: {
      message: string
      subject?: string
      /** Full editable parts — the server uses these for V2 multi-variable
       *  template sends (`rl_weekly_<voornaam>`) when the feature
       *  flag is on. Ignored on V1 path. */
      parts?: EditableParts
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
    onSuccess: async (data) => {
      setSent(true)
      void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
      // Draft-backed send → mark the draft consumed so it leaves the queue.
      // Fire-and-forget: a flake here shouldn't roll back the visible
      // "Sent" state, the cron is idempotent so worst case the draft
      // reappears next Monday.
      if (draftSeed?.draftId) {
        try {
          await fetch(`/api/weekly-update-drafts/${draftSeed.draftId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "sent",
              sentMessageId: (data as { outboundMsgId?: string })?.outboundMsgId,
            }),
          })
        } catch {
          // swallowed — see fire-and-forget comment above
        }
        void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
        onDraftResolved?.()
      }
      setTimeout(() => onOpenChange(false), 1200)
    },
    onError: (e: Error) => setSendError(e.message),
  })

  useEffect(() => {
    if (!open) return
    // Draft-backed open: hydrate state from the seed and skip the fetch.
    // The seed comes from the Monday cron's pre-composed parts, which were
    // generated using the SAME pipeline as /client-update would run now,
    // so re-fetching would just produce identical data (assuming same
    // KPI/Pedro cache state). The reshape was already applied at cron time
    // when templateVersion === 2, so we use parts verbatim here.
    if (draftSeed && !parts) {
      setParts(draftSeed.parts)
      setChannel(draftSeed.channel)
      setChannelLabel(draftSeed.channel === "email" ? "Email" : "WhatsApp")
      // Cron only generates drafts for Live + Trengo-linked clients, so
      // by construction the contact is always linked when seeded.
      setTrengoLinked(true)
      setWaTemplateName(draftSeed.templateName)
      // Draft templates always come from Trengo auto-discovery (the cron
      // doesn't read users.whatsapp_template_name overrides).
      setWaTemplateSource("trengo_auto")
      setTemplateVersion(draftSeed.templateVersion)
      setTemplateVersionReason(null)
      return
    }
    if (!draftSeed && !generate.data && !generate.isPending) generate.mutate()
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

  // The Trengo template's sign-off uses the AM's first name (e.g. "Groetjes
  // Roel"). We derive it from the slug `rl_universal_<voornaam>` OR
  // `rl_weekly_<voornaam>` so the preview matches what the customer
  // actually receives without an extra Trengo round-trip. Capitalised for
  // readability; falls back to "…" when no template is resolved yet so the
  // muted line still has shape.
  const amSignOffName = useMemo(() => {
    if (!waTemplateName) return "…"
    const slug = waTemplateName.replace(/^rl_(weekly|universal)_/i, "").trim()
    if (!slug) return "…"
    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }, [waTemplateName])
  const isV2 = templateVersion === 2

  const isLoading = generate.isPending
  const isSending = send.isPending
  const inputsDisabled = isSending || sent
  const isEmail = channel === "email"
  // For WhatsApp the AM's HSM template is required (Meta won't accept free
  // text outside the 24h window, and we route ALL outbound via template).
  // For email no template is needed — Trengo handles the email channel
  // server-side once we have a Trengo contact.
  const canSend = !!previewText.trim() && !inputsDisabled && trengoLinked && (isEmail || !!waTemplateName)

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
            <ContextNoteCard
              parts={parts}
              setParts={setParts}
              inputsDisabled={inputsDisabled}
            />
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
                isV2={isV2}
              />
            )}

            <div className="px-6 pb-2 space-y-1.5">
              {isEmail ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Verzonden als email via Trengo, met onderwerp en sign-off zoals hierboven.
                </p>
              ) : waTemplateName ? (
                <>
                  <p className="text-[11px] text-muted-foreground/70">
                    Verzonden via WhatsApp template{" "}
                    <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">
                      {waTemplateName}
                    </code>
                    <span
                      className={cn(
                        "ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium",
                        isV2
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {isV2 ? "V2" : "V1"}
                    </span>
                    {waTemplateSource === "trengo_auto" && (
                      <span className="ml-1 text-muted-foreground/50">(uit Trengo)</span>
                    )}
                  </p>
                  {templateVersionReason && (
                    <p className="text-[11px] text-amber-500/90 italic leading-relaxed">
                      Waarom V1? {templateVersionReason}
                    </p>
                  )}
                </>
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
          <Button
            onClick={() =>
              send.mutate({
                message: previewText,
                subject: isEmail ? parts?.subject?.trim() || undefined : undefined,
                // Ship the editable parts too so the server can derive V2
                // template variables. Server ignores this when V2 flag is
                // off or when channel is email.
                parts: parts ?? undefined,
              })
            }
            disabled={!canSend}
            className="gap-1.5"
          >
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
