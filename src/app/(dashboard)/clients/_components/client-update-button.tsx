"use client"

import { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { MessageSquareText, Loader2, Send, Sparkles, Mail, MessageCircle, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ClientUpdateResponse } from "@/app/api/clients/[id]/client-update/route"

type Props = {
  mondayItemId: string
  clientName: string
}

/**
 * Trigger + dialog combo for sending the AI-drafted weekly client update.
 *
 * Opens a dialog, fetches the AI draft (POST /client-update), shows the
 * detected delivery channel (WhatsApp / Email), lets the AM edit, then sends
 * via the existing Trengo reply pipeline (POST /send-client-update).
 *
 * Rendered as a column on the clients overview — small "Update" button with
 * an inline channel hint so the AM can tell at a glance whether sending will
 * route through WhatsApp or email before they even click.
 */
export function ClientUpdateButton({ mondayItemId, clientName }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Row click navigates to the client — stop here so we open the dialog instead.
          e.stopPropagation()
          setOpen(true)
        }}
        title="Generate + send weekly client update"
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

function ChannelPill({ channel, channelLabel }: { channel: ClientUpdateResponse["channel"]; channelLabel: string }) {
  if (channel === "whatsapp") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        <MessageCircle className="h-3 w-3" />
        WhatsApp
      </Badge>
    )
  }
  if (channel === "email") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
      >
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

type DialogProps = Props & {
  open: boolean
  onOpenChange: (next: boolean) => void
}

function ClientUpdateDialog({ mondayItemId, clientName, open, onOpenChange }: DialogProps) {
  const [draft, setDraft] = useState("")
  const [channel, setChannel] = useState<ClientUpdateResponse["channel"]>("unknown")
  const [channelLabel, setChannelLabel] = useState("")
  const [trengoLinked, setTrengoLinked] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Generate the draft on mount of the dialog body. Stays uncontrolled from
  // the parent — the parent only flips `open`. Re-opening generates a fresh
  // draft each time so the AM always sees the latest 7d numbers.
  const generate = useMutation({
    mutationFn: async () => {
      setGenerateError(null)
      const res = await fetch(`/api/clients/${mondayItemId}/client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        // Prefer the friendly `message` field our route now returns; fall back
        // to `error` for older shapes / unexpected paths.
        throw new Error(err.message ?? err.error ?? "Failed to generate update")
      }
      return (await res.json()) as ClientUpdateResponse
    },
    onSuccess: (data) => {
      setDraft(data.message)
      setChannel(data.channel)
      setChannelLabel(data.channelLabel)
      setTrengoLinked(data.trengoContactLinked)
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
      // Auto-close after a short success state so the AM gets immediate feedback
      // without having to click away.
      setTimeout(() => onOpenChange(false), 1200)
    },
    onError: (e: Error) => setSendError(e.message),
  })

  // Kick the generation once on first open. useMutation has no side-effect-on-mount
  // helper, so wire it through useEffect.
  useEffect(() => {
    if (open && !generate.data && !generate.isPending) {
      generate.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isLoading = generate.isPending
  const isSending = send.isPending
  const canSend = !!draft.trim() && !isSending && !sent && trengoLinked

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-400" />
                Client update — {clientName}
              </DialogTitle>
              <DialogDescription>
                AI-gegenereerd op basis van de laatste 7d KPI's. Pas aan en verstuur.
              </DialogDescription>
            </div>
            <ChannelPill channel={channel} channelLabel={channelLabel} />
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Pedro schrijft je update…
          </div>
        ) : generateError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 space-y-2">
            <p className="text-xs text-red-500 leading-relaxed">{generateError}</p>
            {/no credits|console\.anthropic/i.test(generateError) && (
              <a
                href="https://console.anthropic.com/settings/billing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex text-[11px] font-medium text-red-500 underline hover:text-red-600"
              >
                Open Anthropic billing →
              </a>
            )}
          </div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              className="w-full resize-y rounded-md border border-border bg-background p-3 text-sm leading-relaxed font-sans focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              disabled={isSending || sent}
            />
            {!trengoLinked && (
              <p className="text-xs text-amber-500">
                Geen Trengo contact gekoppeld op deze klant — versturen is niet mogelijk.
              </p>
            )}
            {sendError && (
              <p className="text-xs text-red-500">{sendError}</p>
            )}
            {sent && (
              <p className="text-xs text-emerald-500">Bericht verzonden ✓</p>
            )}
          </>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Annuleren
          </Button>
          <Button
            onClick={() => send.mutate(draft)}
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
