"use client"

import { ImageIcon, Copy, Send, Sparkles } from "lucide-react"
import { useState, useCallback } from "react"
import { RefreshShell, CopyButton } from "./refresh-shell"
import { VariantImagePanel } from "./variant-image-panel"
import { PushToMetaModal } from "./push-to-meta-modal"
import { ImageSourcesPicker } from "./image-sources-picker"
import { InlineEditField } from "./inline-edit-field"
import { AdPicker } from "./ad-picker"
import { cn } from "@/lib/utils"

export type CreativeVariant = {
  label: string
  /** Canonical RL ad name - CM copies this 1:1 into Meta. The UTM later
   *  ties incoming leads back to this exact variant so Pedro can learn
   *  which generated creatives worked. Roy 2026-06-09. */
  adName: string
  formatHint: "Photo" | "Video"
  topicLabel: string
  /** Roy 2026-06-11: directe quote uit source primary copy / headline /
   *  description waar deze variant op gebaseerd is. Bewijs van
   *  source-anchoring. Empty voor legacy refreshes. */
  sourceHookQuote?: string
  /** Roy 2026-06-11 v2: 5+ zinsdelen die woord-voor-woord uit de source
   *  komen en die deze variant hergebruikt. Bewijs dat de variant in
   *  dezelfde DNA-box blijft. Empty array voor legacy refreshes. */
  phrasesReused?: string[]
  newHook: string
  scriptOutline: string
  primaryCopySnippet: string
  /** Full ad-copy package (Roy 2026-06-10) - Pedro genereert nu meteen
   *  alle Meta tekstvelden zodat Push-to-Meta een complete dynamic
   *  creative ad kan lanceren zonder handmatige tuning. */
  headline?: string
  altHeadlines?: string[]
  altPrimaryTexts?: string[]
  linkDescription?: string
  /** English visual brief for image-gen. Stored on pedro_variants. */
  imagePrompt?: string
  why: string
  /** From enriched envelope - pedro_variants row id, lets image
   *  generate/upload endpoints target this specific variant. */
  variantId?: string | null
  image?: { hasImage: boolean; provider?: string | null; model?: string | null; generatedAt?: string | null; imagePrompt?: string | null }
}

export type CreativeProposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  preserve: { hook: string; angle: string; format: string }
  variants: CreativeVariant[]
}

/** Single-click copy of the canonical ad name - sits next to the variant
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

/** Per-variant card - Roy 2026-06-10 overhaul:
 *  - Geen Bewerk-modus knop meer. Elk tekstveld is click-to-edit
 *    (InlineEditField) met blur-to-save.
 *  - Script outline en lange Hook display zijn weg - niet nuttig.
 *  - De Hook is hernoemd naar "Tekst op afbeelding" en toont de korte
 *    on-image overlay (= Meta headline) bovenaan. Pedro gebruikt dit
 *    als overlay-tekst in de imagePrompt.
 *  - Push naar Meta zit nu OP variant-niveau - één ad set per variant
 *    met de 3 slots erin. Geen proposal-level bundeling meer.
 */
export function VariantCard({
  variant,
  clientId,
  refreshId,
  proposalIndex,
  proposalAngle,
  hidePush,
  hideImagePanel,
}: {
  variant: CreativeVariant
  clientId: string | null
  refreshId: string | null
  proposalIndex: number
  proposalAngle: string
  /** Roy 2026-06-12: in de 4-step wizard zit Push naar Meta in Stap 4
   *  (PushMetaStep). Stap 3 (CreativesStep) gebruikt VariantCard alleen
   *  voor edit + image-gen, dus de per-variant Push knop moet weg om
   *  dubbele CTAs te voorkomen. */
  hidePush?: boolean
  /** Roy 2026-06-12 v8: in de 5-step wizard staat image-gen los van
   *  edit copy. Stap 3 (Edit copy) hide het VariantImagePanel; Stap 4
   *  (Genereer creatives) toont 'm. Zo blijven copy + creative-gen
   *  visueel gescheiden. */
  hideImagePanel?: boolean
}) {
  // Local "live" state - InlineEditField writes back via PATCH, success
  // updates these so the rest of the card (e.g. the CopyButton text)
  // stays in sync without a full refresh.
  const [headline, setHeadline] = useState(variant.headline ?? "")
  const [primaryCopy, setPrimaryCopy] = useState(variant.primaryCopySnippet)
  const [altHeadlines, setAltHeadlines] = useState<string[]>(
    variant.altHeadlines && variant.altHeadlines.length > 0
      ? variant.altHeadlines
      : ["", ""],
  )
  const [altPrimaryTexts, setAltPrimaryTexts] = useState<string[]>(
    variant.altPrimaryTexts && variant.altPrimaryTexts.length > 0
      ? variant.altPrimaryTexts
      : ["", ""],
  )
  const [linkDescription, setLinkDescription] = useState(variant.linkDescription ?? "")
  const [pushOpen, setPushOpen] = useState(false)

  const variantId = variant.variantId ?? null
  const editable = !!variantId

  const patchVariant = useCallback(
    async (patch: Record<string, unknown>): Promise<void> => {
      if (!variantId) {
        throw new Error("Variant id ontbreekt - refresh de proposals opnieuw.")
      }
      const res = await fetch(`/api/pedro/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
    },
    [variantId],
  )

  // Per-array helpers that update one slot of the alt arrays and PATCH
  // the whole array (the server treats arrays as atomic).
  const saveAltHeadline = useCallback(
    async (idx: number, next: string) => {
      const updated = [...altHeadlines]
      while (updated.length <= idx) updated.push("")
      updated[idx] = next
      await patchVariant({ altHeadlines: updated })
      setAltHeadlines(updated)
    },
    [altHeadlines, patchVariant],
  )

  const saveAltPrimary = useCallback(
    async (idx: number, next: string) => {
      const updated = [...altPrimaryTexts]
      while (updated.length <= idx) updated.push("")
      updated[idx] = next
      await patchVariant({ altPrimaryTexts: updated })
      setAltPrimaryTexts(updated)
    },
    [altPrimaryTexts, patchVariant],
  )

  // Ensure we always render 2 alt slots even when empty so the CM can
  // type into them. (Pedro generates 2, but if a previous refresh only
  // returned 1, we want the empty slot visible.)
  const altHeadlineSlots = Array.from(
    { length: Math.max(2, altHeadlines.length) },
    (_, i) => altHeadlines[i] ?? "",
  )
  const altPrimarySlots = Array.from(
    { length: Math.max(2, altPrimaryTexts.length) },
    (_, i) => altPrimaryTexts[i] ?? "",
  )

  return (
    <div className="rounded-lg border border-border/60 bg-background p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-heading font-semibold text-sm">{variant.label}</div>
        <div className="flex items-center gap-1.5">
          {/* Per-variant Push-to-Meta - Roy 2026-06-10: één variant =
              één ad set met de 3 image slots als ads. CM kan los kiezen
              welke variant ze willen testen. Verstopt in de wizard-flow
              waar Push een eigen step (Stap 4) is. */}
          {refreshId && variantId && !hidePush && (
            <button
              type="button"
              onClick={() => setPushOpen(true)}
              title="Push deze variant als eigen ad set naar Meta (PAUSED)"
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary/90 text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity"
            >
              <Send className="h-3 w-3" />
              Push naar Meta
            </button>
          )}
          <CopyButton
            text={`Ad name: ${variant.adName}\n\nImage text: ${headline}\n\nPrimary copy:\n${primaryCopy}`}
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

      {/* Bron-hook quote - Roy 2026-06-11: bewijs dat Pedro op een echte
          hook uit de source-copy heeft geanchored ipv een nieuwe angle
          te hallucineren. Toont alleen wanneer Pedro 'm geleverd heeft
          (ad-picker flow). */}
      {variant.sourceHookQuote && variant.sourceHookQuote.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400 font-semibold mb-0.5">
            Bron-hook uit source ad
          </div>
          <div className="text-xs italic text-foreground">
            &ldquo;{variant.sourceHookQuote}&rdquo;
          </div>
        </div>
      )}

      {/* Phrases reused from source - Roy 2026-06-11 v2: harde bewijsvoering
          dat de variant in dezelfde DNA-box blijft. Toont 5+ verbatim
          zinsdelen uit de source. Groen = DNA-trouw. Geen badge = variant
          mist source-anchoring (zou eigenlijk niet moeten voorkomen na
          de prompt-rewrite). */}
      {variant.phrasesReused && variant.phrasesReused.length > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400 font-semibold mb-1">
            Behoudt uit source ({variant.phrasesReused.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {variant.phrasesReused.map((p, i) => (
              <span
                key={i}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30"
              >
                &laquo;{p}&raquo;
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Image text (= Meta headline) - short pijnpunt-vraag die als
          overlay op de afbeelding komt. Bovenaan omdat het de meest
          visueel-zichtbare tekst is. Roy 2026-06-10. */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
          Tekst op afbeelding (Meta headline)
        </div>
        <InlineEditField
          value={headline}
          onSave={async (next) => {
            await patchVariant({ headline: next })
            setHeadline(next)
          }}
          variant="single"
          placeholder="(leeg - klik om tekst voor de afbeelding-overlay te typen)"
          maxLength={80}
          disabled={!editable}
          className="text-sm font-medium"
        />
      </div>

      {/* Primary copy - de body boven de afbeelding. */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
          Primary copy
        </div>
        <InlineEditField
          value={primaryCopy}
          onSave={async (next) => {
            await patchVariant({ primaryCopySnippet: next })
            setPrimaryCopy(next)
          }}
          variant="multi"
          minRows={3}
          placeholder="(leeg - klik om primary text te schrijven)"
          maxLength={1500}
          disabled={!editable}
        />
      </div>

      {/* Meta dynamic creative pool - alt headlines + alt primary texts.
          Pedro genereert 2 van elk; Meta roteert ze samen met de
          primary headline / primary copy. Roy 2026-06-10. */}
      <div className="rounded-md border border-border/60 bg-muted/15 p-2.5 space-y-3">
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold inline-flex items-center gap-1">
          <Sparkles className="h-3 w-3" />
          Meta dynamic creative pool (3 headlines × 3 primary texts)
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
            Alternatieve headlines
          </div>
          {altHeadlineSlots.map((h, i) => (
            <InlineEditField
              key={`ah-${i}`}
              value={h}
              onSave={(next) => saveAltHeadline(i, next)}
              variant="single"
              placeholder={`(alt headline ${i + 1} - klik om te bewerken)`}
              maxLength={80}
              allowEmpty
              disabled={!editable}
              className="text-xs"
            />
          ))}
        </div>

        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
            Alternatieve primary texts
          </div>
          {altPrimarySlots.map((p, i) => (
            <InlineEditField
              key={`ap-${i}`}
              value={p}
              onSave={(next) => saveAltPrimary(i, next)}
              variant="multi"
              minRows={2}
              placeholder={`(alt primary ${i + 1} - klik om te bewerken)`}
              maxLength={1500}
              allowEmpty
              disabled={!editable}
              className="text-xs"
            />
          ))}
        </div>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/60">
            Link description (optioneel)
          </div>
          <InlineEditField
            value={linkDescription}
            onSave={async (next) => {
              await patchVariant({ linkDescription: next })
              setLinkDescription(next)
            }}
            variant="single"
            placeholder="(leeg - optionele korte ondertitel)"
            maxLength={200}
            allowEmpty
            disabled={!editable}
            className="text-xs"
          />
        </div>
      </div>

      {/* Image generation panel - 3 slots side-by-side per variant.
          Roy 2026-06-09. Verstopt in Stap 3 (Edit copy) van de wizard
          waar image-gen pas in Stap 4 gebeurt. */}
      {!hideImagePanel && (
        <VariantImagePanel
          variantId={variantId}
          clientId={clientId}
          adName={variant.adName}
          initialImagePrompt={variant.image?.imagePrompt ?? variant.imagePrompt ?? null}
          initialHasImage={variant.image?.hasImage ?? false}
        />
      )}

      <div className="text-xs text-muted-foreground italic pt-1 border-t border-border/40">
        Waarom: {variant.why}
      </div>

      {/* Push modal scoped to THIS variant - single ad set with up to
          3 ads (the 3 image slots). Roy 2026-06-10. Niet gemount in
          de wizard-flow waar Step 4 z'n eigen push UI heeft. */}
      {refreshId && variantId && clientId && !hidePush && (
        <PushToMetaModal
          open={pushOpen}
          onClose={() => setPushOpen(false)}
          refreshId={refreshId}
          proposalIndex={proposalIndex}
          winnerAdName={variant.adName}
          proposalAngle={proposalAngle}
          variantHeadline={headline}
          clientId={clientId}
          variants={[
            {
              variantId,
              adName: variant.adName,
              label: variant.label,
              topicLabel: variant.topicLabel,
            },
          ]}
        />
      )}
    </div>
  )
}

/** Per-proposal card - Roy 2026-06-10: geen Push-to-Meta knop meer op
 *  dit niveau. Push gaat nu per variant (eigen ad set, eigen ads), zodat
 *  de CM gericht één invalshoek kan testen ipv altijd alle drie. */
function ProposalCard({
  proposal,
  refreshId,
  proposalIndex,
  clientId,
}: {
  proposal: CreativeProposal
  refreshId: string | null
  proposalIndex: number
  clientId: string | null
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
      <div className="mb-4">
        <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400 font-semibold mb-1">
          <ImageIcon className="h-3 w-3" />
          Itereren op winner
        </div>
        <div className="font-heading font-semibold text-[15px] tracking-tight truncate">
          {proposal.basedOnAd.adName}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          CPL {proposal.basedOnAd.cpl != null ? `€${proposal.basedOnAd.cpl.toFixed(2)}` : "-"}
          {" · "}
          Behoud: {proposal.preserve.hook} / {proposal.preserve.angle} / {proposal.preserve.format}
          {" · "}
          <span className="text-muted-foreground/80">Push gebeurt per variant onder de afbeeldingen</span>
        </div>
      </div>

      <div className="space-y-3">
        {proposal.variants.map((v, vi) => (
          <VariantCard
            key={`${v.variantId ?? v.adName}-${vi}`}
            variant={v}
            clientId={clientId}
            refreshId={refreshId}
            proposalIndex={proposalIndex}
            proposalAngle={proposal.preserve.angle}
          />
        ))}
      </div>
    </div>
  )
}

type Props = {
  selectedClientId: string | null
  selectedClientName: string
  autoStart?: boolean
  hideShellHeader?: boolean
}

export function CreativeRefresh({ selectedClientId, selectedClientName, autoStart, hideShellHeader }: Props) {
  return (
    <RefreshShell<CreativeProposal>
      endpoint="/api/pedro/creative-refresh"
      title="Creative refresh"
      selectedClientId={selectedClientId}
      selectedClientName={selectedClientName}
      autoStart={autoStart}
      hideShellHeader={hideShellHeader}
      customInputs={({ generate, loading, hasOutput }) => (
        <AdPicker
          clientId={selectedClientId}
          loading={loading}
          hasOutput={hasOutput}
          onGenerate={async (extra) => {
            await generate(extra)
          }}
        />
      )}
      renderProposals={(env) => (
        <div className="space-y-4">
          {/* Image bronnen picker - keuzeproces VOOR de Genereer-klik.
              Roy 2026-06-10: voorkomt API kosten aan verkeerde Drive
              folders en geeft directe controle over stock content. */}
          <ImageSourcesPicker clientId={selectedClientId} />
          {env.proposals.map((p, i) => (
            <ProposalCard
              key={`${p.basedOnAd.adId}-${i}`}
              proposal={p}
              refreshId={env.refreshId ?? null}
              proposalIndex={i}
              clientId={selectedClientId}
            />
          ))}
        </div>
      )}
    />
  )
}
