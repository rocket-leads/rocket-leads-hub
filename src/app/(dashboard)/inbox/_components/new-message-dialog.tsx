"use client"

import { useMemo, useState } from "react"
import { Mail, MessageCircle, Loader2, Send } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { EmailComposer } from "./email-composer"

/**
 * "New message" composer — compose a brand-new conversation from scratch,
 * Trengo-style: pick a favourite channel (which decides email vs WhatsApp),
 * then fill in the email composer (reused 1:1 from the thread reply UI) or a
 * WhatsApp recipient + template + variables. Roy 2026-07-30.
 */
export type NewMessageChannel = { id: number; name: string; kind: "whatsapp" | "email" }

type WaTemplate = {
  id: number
  title: string
  slug: string
  message: string
  language: string
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
  const [channelId, setChannelId] = useState<number | null>(null)
  const selected = channels.find((c) => c.id === channelId) ?? null

  // Email fields (lifted state EmailComposer reads on submit).
  const [to, setTo] = useState<string[]>([])
  const [subject, setSubject] = useState("")
  const [cc, setCc] = useState<string[]>([])
  const [bcc, setBcc] = useState<string[]>([])
  const [html, setHtml] = useState("")
  const [signature, setSignature] = useState<string | null>(null)

  // WhatsApp fields.
  const [phone, setPhone] = useState("")
  const [templateId, setTemplateId] = useState<number | null>(null)
  const [params, setParams] = useState<string[]>([])

  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Favourites first, then the rest — same "channels you care about up top" idea
  // as the inbox tabs.
  const orderedChannels = useMemo(() => {
    const fav = new Set(favoriteIds)
    return [...channels].sort((a, b) => (fav.has(b.id) ? 1 : 0) - (fav.has(a.id) ? 1 : 0))
  }, [channels, favoriteIds])

  const emailChannels = useMemo(
    () => channels.filter((c) => c.kind === "email").map((c) => ({ id: c.id, name: c.name })),
    [channels],
  )

  const templatesQuery = useQuery<{ templates: WaTemplate[] }>({
    queryKey: ["wa-templates", channelId],
    queryFn: () => fetch(`/api/inbox/wa-templates?channelId=${channelId}`).then((r) => r.json()),
    enabled: open && selected?.kind === "whatsapp" && channelId != null,
  })
  const templates = templatesQuery.data?.templates ?? []
  const selectedTemplate = templates.find((tpl) => tpl.id === templateId) ?? null
  const varCount = selectedTemplate ? countTemplateVariables(selectedTemplate.message) : 0

  function reset() {
    setChannelId(null)
    setTo([])
    setSubject("")
    setCc([])
    setBcc([])
    setHtml("")
    setSignature(null)
    setPhone("")
    setTemplateId(null)
    setParams([])
    setError(null)
  }
  function close(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  async function send() {
    if (!selected) return
    setSending(true)
    setError(null)
    try {
      let payload: Record<string, unknown>
      if (selected.kind === "email") {
        const recipient = to[0]?.trim()
        if (!recipient) throw new Error("Vul een e-mailadres in")
        const fullHtml = signature ? `${html}<br><br>${signature}` : html
        payload = { channelId: selected.id, kind: "email", to: recipient, subject, html: fullHtml }
      } else {
        if (!phone.trim()) throw new Error("Vul een telefoonnummer in")
        if (!selectedTemplate) throw new Error("Kies een WhatsApp-template")
        payload = {
          channelId: selected.id,
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
      close(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verzenden mislukt")
    } finally {
      setSending(false)
    }
  }

  const canSend =
    !!selected &&
    (selected.kind === "email"
      ? to[0]?.trim() && (html.trim() || subject.trim())
      : phone.trim() && selectedTemplate)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nieuw bericht</DialogTitle>
        </DialogHeader>

        {/* Channel picker — favourites first; the icon signals email vs WhatsApp. */}
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/50">
            Kies een kanaal
          </p>
          <div className="flex flex-wrap gap-1.5">
            {orderedChannels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setChannelId(c.id)
                  setTemplateId(null)
                  setParams([])
                  setError(null)
                }}
                className={cn(
                  "chip h-9",
                  channelId === c.id
                    ? "bg-muted border-foreground/60 font-semibold text-foreground ring-2 ring-inset ring-foreground/45"
                    : "text-foreground/70",
                )}
              >
                {c.kind === "whatsapp" ? (
                  <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Mail className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="max-w-[160px] truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>

        {selected?.kind === "email" && (
          <EmailComposer
            fromChannelId={selected.id}
            onFromChannelChange={(id) => setChannelId(id)}
            emailChannels={emailChannels}
            threadKey=""
            to={to}
            onToChange={setTo}
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

        {selected?.kind === "whatsapp" && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Telefoonnummer</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+31 6 12345678"
                disabled={sending}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <select
                value={templateId ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value)
                  setTemplateId(Number.isFinite(id) && id > 0 ? id : null)
                  const tpl = templates.find((t) => t.id === id)
                  setParams(Array(tpl ? countTemplateVariables(tpl.message) : 0).fill(""))
                }}
                disabled={sending || templatesQuery.isLoading}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="">
                  {templatesQuery.isLoading ? "Templates laden…" : "Kies een template…"}
                </option>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.title} ({tpl.language})
                  </option>
                ))}
              </select>
            </div>
            {selectedTemplate && (
              <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2.5 text-xs leading-relaxed text-foreground/80">
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

        {error && <p className="text-xs text-red-500">{error}</p>}

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
