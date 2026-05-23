"use client"

import { Compass } from "lucide-react"
import { RefreshShell, CopyButton } from "./refresh-shell"

type AnglesProposal = {
  title: string
  description: string
  hookCategory: string
  openerExamples: string[]
  why: string
}

type Props = {
  selectedClientId: string | null
  selectedClientName: string
  autoStart?: boolean
}

export function AnglesRefresh({ selectedClientId, selectedClientName, autoStart }: Props) {
  return (
    <RefreshShell<AnglesProposal>
      endpoint="/api/pedro/angles-refresh"
      title="Angles refresh"
      description="Pedro leest live Meta performance + branche-patronen en stelt 3-5 nieuwe angles voor om te testen — naast de huidige winnaars."
      selectedClientId={selectedClientId}
      selectedClientName={selectedClientName}
      autoStart={autoStart}
      renderProposals={(env) => (
        <div className="space-y-4">
          {env.proposals.map((p, i) => (
            <div
              key={`${p.title}-${i}`}
              className="rounded-2xl border border-border/60 bg-card p-5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-violet-600 dark:text-violet-400 font-semibold mb-1">
                    <Compass className="h-3 w-3" />
                    Nieuwe angle
                  </div>
                  <div className="font-heading font-semibold text-[15px] tracking-tight">
                    {p.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Hook-categorie: {p.hookCategory}
                  </div>
                </div>
                <CopyButton
                  text={[
                    `Angle: ${p.title}`,
                    `Beschrijving: ${p.description}`,
                    `Hook-categorie: ${p.hookCategory}`,
                    "",
                    "Opener voorbeelden:",
                    ...p.openerExamples.map((o) => `- ${o}`),
                    "",
                    `Waarom: ${p.why}`,
                  ].join("\n")}
                />
              </div>

              <div className="text-sm text-foreground leading-relaxed">{p.description}</div>

              {p.openerExamples.length > 0 && (
                <div className="rounded-lg border border-border/60 bg-background p-3 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                    Opener voorbeelden
                  </div>
                  <ul className="text-sm text-foreground list-disc pl-5 space-y-1">
                    {p.openerExamples.map((o, oi) => <li key={oi}>{o}</li>)}
                  </ul>
                </div>
              )}

              <div className="text-xs text-muted-foreground italic pt-1 border-t border-border/40">
                Waarom: {p.why}
              </div>
            </div>
          ))}
        </div>
      )}
    />
  )
}
