import type { MetaAdDetail } from "@/lib/integrations/meta"

/**
 * Pedro performance helpers — categorise ads as winners/losers/neutrals
 * relative to the account's own CPL average. Used by /api/pedro/client-
 * performance to give Claude a clean signal-vs-noise feed for optimisation
 * decisions.
 *
 * Rules per knowledge/campaigns.md:
 *  - Need ≥€10 spend (30d) on an ad to judge it — anything less is noise
 *  - Loser by zero-leads: ≥€50 spend, 0 leads (clear waste)
 *  - Winner: CPL ≤ 0.7 × account-avg CPL with ≥3 leads
 *  - Loser: CPL ≥ 1.4 × account-avg CPL OR zero-leads-with-spend
 *  - Wide neutral band so small ad-sets don't get coloured noise
 *
 * NOTE on lead-quality: this file judges ONLY on cost efficiency. Per
 * `knowledge/campaigns.md` the real quality signal is Monday CRM lead
 * feedback per UTM ("geen budget", "niet geïnteresseerd", etc.). That's
 * Phase 3 lead-quality work — a separate fetch from the Monday lead board
 * + grouping by UTM. Until that ships, treat winners as "cheap leads"
 * not "good leads" — the AM/CM still has to verify quality.
 */

export type AdVerdict = "winner" | "loser" | "neutral"

export type ScoredAd = MetaAdDetail & {
  cpl: number | null
  verdict: AdVerdict
  /** Why this verdict — one short sentence the AI can quote. */
  reason: string
}

const MIN_SPEND_TO_JUDGE = 10
const MIN_SPEND_FOR_ZERO_LEAD_LOSER = 50
const MIN_LEADS_FOR_WINNER = 3
const WINNER_RATIO = 0.7
const LOSER_RATIO = 1.4

export function computeAccountStats(ads: MetaAdDetail[]) {
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0)
  const totalLeads = ads.reduce((s, a) => s + a.leads, 0)
  const totalImpressions = ads.reduce((s, a) => s + a.impressions, 0)
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0)
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : null
  return {
    totalSpend,
    totalLeads,
    totalImpressions,
    totalClicks,
    avgCpl,
    avgCtr,
    avgCpc,
    activeAdCount: ads.filter((a) => a.spend >= MIN_SPEND_TO_JUDGE).length,
  }
}

export function scoreAd(
  ad: MetaAdDetail,
  accountAvgCpl: number | null,
): ScoredAd {
  const cpl = ad.leads > 0 ? ad.spend / ad.leads : null

  // Below the noise floor — never call it winner/loser
  if (ad.spend < MIN_SPEND_TO_JUDGE) {
    return {
      ...ad,
      cpl,
      verdict: "neutral",
      reason: `te weinig spend (€${ad.spend.toFixed(2)}) om te oordelen`,
    }
  }

  // Zero-lead waste — clear loser regardless of account avg
  if (ad.leads === 0 && ad.spend >= MIN_SPEND_FOR_ZERO_LEAD_LOSER) {
    return {
      ...ad,
      cpl,
      verdict: "loser",
      reason: `€${ad.spend.toFixed(0)} spend, 0 leads`,
    }
  }

  // Without a baseline, fall back to neutral (single-ad accounts can't be ranked relatively)
  if (accountAvgCpl == null) {
    return { ...ad, cpl, verdict: "neutral", reason: "geen baseline (account heeft geen leads)" }
  }

  // Winner: cheap + enough volume to trust
  if (cpl != null && cpl <= accountAvgCpl * WINNER_RATIO && ad.leads >= MIN_LEADS_FOR_WINNER) {
    return {
      ...ad,
      cpl,
      verdict: "winner",
      reason: `CPL €${cpl.toFixed(2)} = ${((cpl / accountAvgCpl) * 100).toFixed(0)}% van account-avg (€${accountAvgCpl.toFixed(2)}), ${ad.leads} leads`,
    }
  }

  // Loser: expensive
  if (cpl != null && cpl >= accountAvgCpl * LOSER_RATIO) {
    return {
      ...ad,
      cpl,
      verdict: "loser",
      reason: `CPL €${cpl.toFixed(2)} = ${((cpl / accountAvgCpl) * 100).toFixed(0)}% van account-avg (€${accountAvgCpl.toFixed(2)})`,
    }
  }

  // Within neutral band
  return {
    ...ad,
    cpl,
    verdict: "neutral",
    reason:
      cpl != null
        ? `CPL €${cpl.toFixed(2)} binnen ruisband (avg €${accountAvgCpl.toFixed(2)})`
        : "te weinig leads voor verdict",
  }
}

/**
 * Window-over-window trend (e.g. last 7d vs prior 7d). Returns deltas as
 * percentages so the UI / Claude can flag "+25% spend, -40% leads = bad."
 */
export function computeTrend(
  current: { totalSpend: number; totalLeads: number; avgCpl: number | null },
  prior: { totalSpend: number; totalLeads: number; avgCpl: number | null },
) {
  const pct = (curr: number, prev: number): number | null => {
    if (prev <= 0) return null
    return ((curr - prev) / prev) * 100
  }
  return {
    spendDeltaPct: pct(current.totalSpend, prior.totalSpend),
    leadsDeltaPct: pct(current.totalLeads, prior.totalLeads),
    cplDeltaPct:
      current.avgCpl != null && prior.avgCpl != null && prior.avgCpl > 0
        ? ((current.avgCpl - prior.avgCpl) / prior.avgCpl) * 100
        : null,
  }
}

/**
 * Compact per-ad table Claude can read quickly — one line per ad with
 * verdict + key numbers. Sorted by spend desc so the highest-impact ads
 * lead. Truncates to top N to keep prompt token cost predictable.
 */
export function renderAdsForPrompt(ads: ScoredAd[], topN = 12): string {
  const sorted = [...ads].sort((a, b) => b.spend - a.spend).slice(0, topN)
  if (sorted.length === 0) return "Geen actieve ads in dit window."
  const lines = sorted.map((a) => {
    const cpl = a.cpl != null ? `€${a.cpl.toFixed(2)}` : "—"
    const ctr = a.ctr.toFixed(2)
    return `[${a.verdict.toUpperCase().padEnd(7)}] "${a.adName}" — €${a.spend.toFixed(0)} spend, ${a.leads} leads, CPL ${cpl}, CTR ${ctr}% — ${a.reason}`
  })
  return lines.join("\n")
}
