"use client"

import { ImageIcon, Copy, Pencil, Check, X, Loader2, Send } from "lucide-react"
import { useState, useCallback } from "react"
import { RefreshShell, CopyButton } from "./refresh-shell"
import { VariantImagePanel } from "./variant-image-panel"
import { PushToMetaModal } from "./push-to-meta-modal"
import { cn } from "@/lib/utils"

type CreativeVariant = {
  label: string
  /** Canonical RL ad name — CM copies this 1:1 into Meta. The UTM later
   *  ties incoming leads back to this exact variant so Pedro can learn
   *  which generated creatives worked. Roy 2026-06-09. */
  adName: string
  formatHint: "Photo" | "Video"
  topicLabel: string
  newHook: string
  scriptOutline: string
  primaryCopySnippet: string
  /** English visual brief for image-gen. Stored on pedro_variants. */
  imagePrompt?: string
  why: string
  /** From enriched envelope — pedro_variants row id, lets image
   *  generate/upload endpoints target this specific variant. */
  variantId?: string | null
  image?: { hasImage: boolean; provider?: string | null; model?: string | null; generatedAt?: string | null; imagePrompt?: string | null }
}

type CreativeProposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  preserve: { hook: string; angle: string; format: string }
  variants: CreativeVariant[]
}

/** Single-click copy of the canonical ad name — sits next to the variant
 *  label so it's the first thing the CM sees. The whole point of this
 *  feature: 1 click → paste into Meta → done. */
function AdNameChip({ adName }: { adName: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(adName)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      title="Klik om te kopiëren naar je klembord"
      className={cn(
        "group inline-flex items-center gap-1.5 max-w-full",
        "rounded-md border px-2 py-1 text-xs font-mono",
        "transition-colors",
        copied
          ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-muted/40 text-foreground hover:bg-muted",
      )}
    >
      <Copy
        className={cn(
          "h-3 w-3 shrink-0",
          copied ? "text-emerald-600" : "text-muted-foreground group-hover:text-foreground",
        )}
      />
      <span className="truncate">{copied ? "Gekopieerd" : adName}</span>
    </button>
  )
}

/** Per-variant card — owns edit-mode state for hook + primary copy so
 *  the CM can tune the variant before regenerating images. Roy
 *  2026-06-09. */
function VariantCard({ variant }: { variant: CreativeVariant }) {
  // Local "live" state that reflects PATCH'd edits. Initial values come
  // from the proposal envelope. Updates persist through PATCH and stay
  // in sync until the user refreshes the whole page.
  const [hook, setHook] = useState(variant.newHook)
  const [primaryCopy, setPrimaryCopy] = useState(variant.primaryCopySnippet)
  const [editing, setEditing] = useState(false)
  const [hookDraft, setHookDraft] = useState(variant.newHook)
  const [copyDraft, setCopyDraft] = useState(variant.primaryCopySnippet)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const startEdit = useCallback(() => {
    setHookDraft(hook)
    setCopyDraft(primaryCopy)
    setSaveError(null)
    setEditing(true)
  }, [hook, primaryCopy])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setSaveError(null)
  }, [])

  const saveEdits = useCallback(async () => {
    if (!variant.variantId) {
      setSaveError("Variant id ontbreekt — refresh de proposals opnieuw.")
      return
    }
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/pedro/variants/${variant.variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hook: hookDraft,
          primaryCopySnippet: copyDraft,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      setHook(hookDraft)
      setPrimaryCopy(copyDraft)
      setEditing(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Opslaan mislukt")
    } finally {
      setSaving(false)
    }
  }, [variant.variantId, saving, hookDraft, copyDraft])

  return (
    <div className="rounded-lg border border-border/60 bg-background p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="font-heading font-semibold text-sm">{variant.label}</div>
        <div className="flex items-center gap-1.5">
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              disabled={!variant.variantId}
              title={variant.variantId ? "Bewerk hook + primary copy" : "Refresh proposals voor bewerk-modus"}
              className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent border-border transition-colors disabled:opacity-40"
            >
              <Pencil className="h-3 w-3" />
              Bewerk
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent border-border transition-colors disabled:opacity-40"
              >
                <X className="h-3 w-3" />
                Annuleer
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={saving}
                className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium border rounded-md bg-primary text-primary-foreground hover:opacity-90 border-transparent transition-opacity disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Opslaan
              </button>
            </>
          )}
          <CopyButton
            text={`Ad name: ${variant.adName}\n\nHook: ${hook}\n\nScript outline:\n${variant.scriptOutline}\n\nPrimary copy:\n${primaryCopy}`}
          />
        </div>
      </div>
      {variant.adName && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Ad name
          </div>
          <AdNameChip adName={variant.adName} />
        </div>
      )}
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
          Hook
        </div>
        {editing ? (
          <textarea
            value={hookDraft}
            onChange={(e) => setHookDraft(e.target.value)}
            rows={2}
            disabled={saving}
            className="w-full text-sm rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
          />
        ) : (
          <div className="text-sm text-foreground">{hook}</div>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
          Script outline
        </div>
        <div className="text-sm text-foreground whitespace-pre-line">{variant.scriptOutline}</div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
          Primary copy
        </div>
        {editing ? (
          <textarea
            value={copyDraft}
            onChange={(e) => setCopyDraft(e.target.value)}
            rows={4}
            disabled={saving}
            className="w-full text-sm rounded-md border border-border bg-background px-2 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 resize-none disabled:opacity-50"
          />
        ) : (
          <div className="text-sm text-foreground">{primaryCopy}</div>
        )}
      </div>
      {saveError && (
        <div className="text-[11px] text-red-600 dark:text-red-400">{saveError}</div>
      )}
      {/* Image generation panel — 3 slots side-by-side per variant.
          Roy 2026-06-09. */}
      <VariantImagePanel
        variantId={variant.variantId ?? null}
        adName={variant.adName}
        initialImagePrompt={variant.image?.imagePrompt ?? variant.imagePrompt ?? null}
        initialHasImage={variant.image?.hasImage ?? false}
      />
      <div className="text-xs text-muted-foreground italic pt-1 border-t border-border/40">
        Waarom: {variant.why}
      </div>
    </div>
  )
}

/** Per-proposal card — owns Push-to-Meta modal state so each proposal
 *  has its own batch launch flow. Roy 2026-06-09. */
function ProposalCard({
  proposal,
  refreshId,
  proposalIndex,
}: {
  proposal: CreativeProposal
  refreshId: string | null
  proposalIndex: number
}) {
  const [pushOpen, setPushOpen] = useState(false)
  const hasVariantsWithIds = proposal.variants.some((v) => v.variantId)
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400 font-semibold mb-1">
            <ImageIcon className="h-3 w-3" />
            Itereren op winner
          </div>
          <div className="font-heading font-semibold text-[15px] tracking-tight truncate">
            {proposal.basedOnAd.adName}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            CPL {proposal.basedOnAd.cpl != null ? `€${proposal.basedOnAd.cpl.toFixed(2)}` : "—"}
            {" · "}
            Behoud: {proposal.preserve.hook} / {proposal.preserve.angle} / {proposal.preserve.format}
          </div>
        </div>
        {/* Push-to-Meta knop op proposal-niveau: opent modal met variant ×
            slot multi-select. Disabled tot we een refreshId + variantIds
            hebben (legacy refreshes hebben geen ids). */}
        <button
          type="button"
          onClick={() => setPushOpen(true)}
          disabled={!refreshId || !hasVariantsWithIds}
          title={
            !refreshId
              ? "Refresh moet eerst persist'ed zijn"
              : !hasVariantsWithIds
                ? "Refresh proposals opnieuw om variant-ids te krijgen"
                : "Push variants naar Meta als nieuwe ad set (PAUSED)"
          }
          className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          <Send className="h-3.5 w-3.5" />
          Push naar Meta
        </button>
      </div>

      <div className="space-y-3">
        {proposal.variants.map((v, vi) => (
          <VariantCard key={`${v.variantId ?? v.adName}-${vi}`} variant={v} />
        ))}
      </div>

      {refreshId && (
        <PushToMetaModal
          open={pushOpen}
          onClose={() => setPushOpen(false)}
          refreshId={refreshId}
          proposalIndex={proposalIndex}
          winnerAdName={proposal.basedOnAd.adName}
          variants={proposal.variants.map((v) => ({
            variantId: v.variantId ?? null,
            adName: v.adName,
            label: v.label,
            topicLabel: v.topicLabel,
          }))}
        />
      )}
    </div>
  )
}

type Props = {
  selectedClientId: string | null
  selectedClientName: string
  autoStart?: boolean
}

export function CreativeRefresh({ selectedClientId, selectedClientName, autoStart }: Props) {
  return (
    <RefreshShell<CreativeProposal>
      endpoint="/api/pedro/creative-refresh"
      title="Creative refresh"
      description="Pedro leest live Meta performance, vindt winners en stelt 3 iteraties per winner voor — zelfde DNA, frisse executie."
      selectedClientId={selectedClientId}
      selectedClientName={selectedClientName}
      autoStart={autoStart}
      renderProposals={(env) => (
        <div className="space-y-4">
          {env.proposals.map((p, i) => (
            <ProposalCard
              key={`${p.basedOnAd.adId}-${i}`}
              proposal={p}
              refreshId={env.refreshId ?? null}
              proposalIndex={i}
            />
          ))}
        </div>
      )}
    />
  )
}
