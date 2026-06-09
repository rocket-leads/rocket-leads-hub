"use client"

import { ImageIcon, Copy } from "lucide-react"
import { useState } from "react"
import { RefreshShell, CopyButton } from "./refresh-shell"
import { VariantImagePanel } from "./variant-image-panel"
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
            <div
              key={`${p.basedOnAd.adId}-${i}`}
              className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]"
            >
              <div className="flex items-start justify-between mb-4 gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-sky-600 dark:text-sky-400 font-semibold mb-1">
                    <ImageIcon className="h-3 w-3" />
                    Itereren op winner
                  </div>
                  <div className="font-heading font-semibold text-[15px] tracking-tight truncate">
                    {p.basedOnAd.adName}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    CPL {p.basedOnAd.cpl != null ? `€${p.basedOnAd.cpl.toFixed(2)}` : "—"}
                    {" · "}
                    Behoud: {p.preserve.hook} / {p.preserve.angle} / {p.preserve.format}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {p.variants.map((v, vi) => (
                  <div key={vi} className="rounded-lg border border-border/60 bg-background p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-heading font-semibold text-sm">{v.label}</div>
                      <CopyButton
                        text={`Ad name: ${v.adName}\n\nHook: ${v.newHook}\n\nScript outline:\n${v.scriptOutline}\n\nPrimary copy:\n${v.primaryCopySnippet}`}
                      />
                    </div>
                    {v.adName && (
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                          Ad name
                        </div>
                        <AdNameChip adName={v.adName} />
                      </div>
                    )}
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                        Hook
                      </div>
                      <div className="text-sm text-foreground">{v.newHook}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                        Script outline
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-line">{v.scriptOutline}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                        Primary copy
                      </div>
                      <div className="text-sm text-foreground">{v.primaryCopySnippet}</div>
                    </div>
                    {/* Image generation panel — sits between copy and "Waarom".
                        Sluit de loop tussen Pedro's text proposal en de
                        echte ad creative. Roy 2026-06-09. */}
                    <VariantImagePanel
                      variantId={v.variantId ?? null}
                      adName={v.adName}
                      initialImagePrompt={v.image?.imagePrompt ?? v.imagePrompt ?? null}
                      initialImage={
                        v.image
                          ? {
                              hasImage: v.image.hasImage,
                              provider: v.image.provider,
                              model: v.image.model,
                              generatedAt: v.image.generatedAt,
                            }
                          : undefined
                      }
                    />
                    <div className="text-xs text-muted-foreground italic pt-1 border-t border-border/40">
                      Waarom: {v.why}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    />
  )
}
