import type { NamedProposal } from "./refresh-naming"

/**
 * Render a Pedro refresh as markdown for the inbox post + Drive export.
 *
 * Same renderer drives both targets so the AM gets identical content
 * whether they open their Hub inbox or the client's Drive folder.
 * Keep this single-purpose: the UI render is a separate React tree,
 * this is for plain-text consumption only.
 *
 * Roy 2026-06-09.
 */

export type CreativesEnvelopeForRender = {
  clientName: string
  window: { start: string; end: string; days: number }
  stats: {
    totalSpend: number
    totalLeads: number
    avgCpl: number | null
    avgCtr: number | null
    winnerCount: number
    loserCount: number
  }
  trend: {
    spendDeltaPct: number | null
    leadsDeltaPct: number | null
    cplDeltaPct: number | null
  }
  summary: string
  proposals: NamedProposal[]
  warnings: string[]
}

function pct(v: number | null): string {
  if (v == null) return "n/a"
  const sign = v >= 0 ? "+" : ""
  return `${sign}${v.toFixed(0)}%`
}

function euro(v: number | null): string {
  if (v == null) return "—"
  return `€${v.toFixed(2)}`
}

export function renderCreativeRefreshMarkdown(
  env: CreativesEnvelopeForRender,
): string {
  const lines: string[] = []
  lines.push(`# Pedro creative refresh — ${env.clientName}`)
  lines.push("")
  lines.push(`**Window:** ${env.window.start} → ${env.window.end} (${env.window.days}d)`)
  lines.push("")
  lines.push(`## Account snapshot`)
  lines.push(`- Spend: €${env.stats.totalSpend.toFixed(0)} (${pct(env.trend.spendDeltaPct)} vs prior ${env.window.days}d)`)
  lines.push(`- Leads: ${env.stats.totalLeads} (${pct(env.trend.leadsDeltaPct)})`)
  lines.push(`- Avg CPL: ${euro(env.stats.avgCpl)} (${pct(env.trend.cplDeltaPct)})`)
  lines.push(`- Winners / losers: ${env.stats.winnerCount} / ${env.stats.loserCount}`)
  lines.push("")

  if (env.summary) {
    lines.push(`## Pedro's read`)
    lines.push(env.summary)
    lines.push("")
  }

  lines.push(`## Proposals`)
  lines.push("")
  for (const [pi, p] of env.proposals.entries()) {
    lines.push(`### ${pi + 1}. Itereren op winner — ${p.basedOnAd.adName}`)
    lines.push(
      `_CPL ${p.basedOnAd.cpl != null ? `€${p.basedOnAd.cpl.toFixed(2)}` : "—"} · Behoud: ${p.preserve.hook} / ${p.preserve.angle} / ${p.preserve.format}_`,
    )
    lines.push("")
    for (const v of p.variants) {
      lines.push(`#### ${v.label}`)
      lines.push("")
      lines.push(`**Ad name (kopieer 1:1 in Meta):**`)
      lines.push("```")
      lines.push(v.adName)
      lines.push("```")
      lines.push("")
      lines.push(`**Hook**`)
      lines.push(v.newHook)
      lines.push("")
      lines.push(`**Script outline**`)
      lines.push(v.scriptOutline)
      lines.push("")
      lines.push(`**Primary copy**`)
      lines.push(v.primaryCopySnippet)
      lines.push("")
      lines.push(`_Waarom: ${v.why}_`)
      lines.push("")
    }
  }

  if (env.warnings.length > 0) {
    lines.push(`## Warnings`)
    for (const w of env.warnings) lines.push(`- ${w}`)
    lines.push("")
  }

  lines.push("---")
  lines.push("")
  lines.push(`_Pedro creative refresh · Rocket Leads Hub_`)
  return lines.join("\n")
}

/** Short title for the inbox post + Drive filename. Includes client +
 *  date + window so it's distinct from sibling refreshes. */
export function renderRefreshTitle(args: {
  clientName: string
  generatedAt: string
  windowDays: number
}): string {
  const date = args.generatedAt.slice(0, 10)
  return `Pedro creative refresh — ${args.clientName} — ${date} (${args.windowDays}d)`
}
