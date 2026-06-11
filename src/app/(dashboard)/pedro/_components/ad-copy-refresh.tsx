"use client"

import { Megaphone } from "lucide-react"
import { RefreshShell, CopyButton } from "./refresh-shell"

type AdCopyVariant = {
  label: string
  primaryText: string
  headline: string
  description: string
  why: string
}

type AdCopyProposal = {
  basedOnAd: { adId: string; adName: string; cpl: number | null; verdict: string }
  preserve: { hook: string; angle: string; format: string }
  variants: AdCopyVariant[]
}

type Props = {
  selectedClientId: string | null
  selectedClientName: string
  autoStart?: boolean
}

export function AdCopyRefresh({ selectedClientId, selectedClientName, autoStart }: Props) {
  return (
    <RefreshShell<AdCopyProposal>
      endpoint="/api/pedro/ad-copy-refresh"
      title="Ad copy refresh"
      description="Voor elke winner schrijft Pedro 3 nieuwe primary text + headline + description varianten - zelfde angle, frisse executie voor de feed."
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
                  <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400 font-semibold mb-1">
                    <Megaphone className="h-3 w-3" />
                    Copy op winner
                  </div>
                  <div className="font-heading font-semibold text-[15px] tracking-tight truncate">
                    {p.basedOnAd.adName}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    CPL {p.basedOnAd.cpl != null ? `€${p.basedOnAd.cpl.toFixed(2)}` : "-"}
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
                        text={`Primary:\n${v.primaryText}\n\nHeadline: ${v.headline}\nDescription: ${v.description}`}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                        Primary text
                      </div>
                      <div className="text-sm text-foreground whitespace-pre-line leading-relaxed">{v.primaryText}</div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                          Headline
                        </div>
                        <div className="text-sm text-foreground">{v.headline}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
                          Description
                        </div>
                        <div className="text-sm text-foreground">{v.description}</div>
                      </div>
                    </div>
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
