import type { MetaAdDetail } from "@/lib/integrations/meta"

/**
 * Pedro performance helpers - categorise ads as winners/losers/neutrals
 * relative to the account's own CPL average. Used by /api/pedro/client-
 * performance to give Claude a clean signal-vs-noise feed for optimisation
 * decisions.
 *
 * Rules per knowledge/campaigns.md:
 *  - Need ≥€10 spend (window) on an ad to judge it - anything less is noise
 *  - Loser by zero-leads: ≥€50 spend, 0 leads (clear waste)
 *  - Winner: CPL ≤ 0.7 × account-avg CPL with ≥3 leads
 *  - Loser: CPL ≥ 1.4 × account-avg CPL OR zero-leads-with-spend
 *  - Wide neutral band so small ad-sets don't get coloured noise
 *
 * NOTE on lead-quality: this file judges ONLY on cost efficiency. Per
 * `knowledge/campaigns.md` the real quality signal is Monday CRM lead
 * feedback per UTM ("geen budget", "niet geïnteresseerd", etc.). That's
 * Phase 3 lead-quality work - a separate fetch from the Monday lead board
 * + grouping by UTM. Until that ships, treat winners as "cheap leads"
 * not "good leads" - the AM/CM still has to verify quality.
 */

export type AdVerdict = "winner" | "loser" | "neutral"

export type ScoredAd = MetaAdDetail & {
  cpl: number | null
  verdict: AdVerdict
  /** Why this verdict - one short sentence the AI can quote. */
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

  if (ad.spend < MIN_SPEND_TO_JUDGE) {
    return {
      ...ad,
      cpl,
      verdict: "neutral",
      reason: `te weinig spend (€${ad.spend.toFixed(2)}) om te oordelen`,
    }
  }

  if (ad.leads === 0 && ad.spend >= MIN_SPEND_FOR_ZERO_LEAD_LOSER) {
    return {
      ...ad,
      cpl,
      verdict: "loser",
      reason: `€${ad.spend.toFixed(0)} spend, 0 leads`,
    }
  }

  if (accountAvgCpl == null) {
    return { ...ad, cpl, verdict: "neutral", reason: "geen baseline (account heeft geen leads)" }
  }

  if (cpl != null && cpl <= accountAvgCpl * WINNER_RATIO && ad.leads >= MIN_LEADS_FOR_WINNER) {
    return {
      ...ad,
      cpl,
      verdict: "winner",
      reason: `CPL €${cpl.toFixed(2)} = ${((cpl / accountAvgCpl) * 100).toFixed(0)}% van account-avg (€${accountAvgCpl.toFixed(2)}), ${ad.leads} leads`,
    }
  }

  if (cpl != null && cpl >= accountAvgCpl * LOSER_RATIO) {
    return {
      ...ad,
      cpl,
      verdict: "loser",
      reason: `CPL €${cpl.toFixed(2)} = ${((cpl / accountAvgCpl) * 100).toFixed(0)}% van account-avg (€${accountAvgCpl.toFixed(2)})`,
    }
  }

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
 * Window-over-window trend. Returns deltas as percentages so callers can
 * flag "+25% spend, -40% leads = bad."
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
 * Compact per-ad table Claude can read - one block per ad with verdict +
 * numbers + the actual primary copy (body) and creative type. The body
 * is the single biggest signal for understanding what the client sells
 * and who they're talking to; without it Pedro has to guess from the
 * ad name alone (which led to the Zumex B2C-smoothie hallucination -
 * Roy flagged 2026-06-09).
 *
 * Body is trimmed to BODY_CHAR_LIMIT to keep prompt cost predictable
 * (~150 tokens per ad worst-case). HTML/whitespace normalised.
 */
// Roy 2026-06-11: bumped van 500 naar 2000. Dynamic creatives kunnen
// nu meerdere bodies bevatten (joined met \n\n in fetchMetaAdDetails) -
// op 500 chars zag Pedro alleen body 1 en miste de rest van de DNA.
const BODY_CHAR_LIMIT = 2000

function normalizeAdBody(body: string | undefined | null): string {
  if (!body) return ""
  return body
    .replace(/<[^>]*>/g, " ") // strip HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_CHAR_LIMIT)
}

/** Optional per-ad visual descriptions, keyed by adId. When passed,
 *  rendered as a "Visual:" line so Pedro knows what's IN the creative
 *  - not just what's written. */
export type AdVisionMap = Map<string, string>

export function renderAdsForPrompt(
  ads: ScoredAd[],
  topN = 12,
  visionByAdId?: AdVisionMap,
): string {
  const sorted = [...ads].sort((a, b) => b.spend - a.spend).slice(0, topN)
  if (sorted.length === 0) return "Geen actieve ads in dit window."
  const blocks = sorted.map((a) => {
    const cpl = a.cpl != null ? `€${a.cpl.toFixed(2)}` : "-"
    const ctr = a.ctr.toFixed(2)
    const body = normalizeAdBody(a.body)
    const creativeType = a.creativeType ?? "unknown"
    const header = `[${a.verdict.toUpperCase().padEnd(7)}] "${a.adName}" (${creativeType}) - €${a.spend.toFixed(0)} spend, ${a.leads} leads, CPL ${cpl}, CTR ${ctr}% - ${a.reason}`
    const lines: string[] = [header]
    // Roy 2026-06-11: dynamic creatives join meerdere titles met \n\n.
    // Bump van 200 naar 800 zodat álle headlines mee gaan.
    if (a.title) lines.push(`  Headline: "${a.title.slice(0, 800)}"`)
    if (body) {
      lines.push(`  Primary copy: "${body}${body.length === BODY_CHAR_LIMIT ? "…" : ""}"`)
    } else {
      lines.push(`  Primary copy: (not available)`)
    }
    if (a.description) lines.push(`  Description: "${a.description.slice(0, 600)}"`)
    if (a.callToActionType) lines.push(`  CTA button: ${a.callToActionType}`)
    if (a.linkUrl) lines.push(`  Landing page: ${a.linkUrl.slice(0, 100)}`)
    if (a.assetFeedSummary) {
      // Dynamic-creative variation pool - indent so the prompt stays readable.
      lines.push(`  Dynamic variations:\n${a.assetFeedSummary.split("\n").map((l) => `    ${l}`).join("\n")}`)
    }
    const vision = visionByAdId?.get(a.adId)
    if (vision) {
      lines.push(`  Visual (Haiku analysis of thumbnail): ${vision}`)
    }
    return lines.join("\n")
  })
  return blocks.join("\n\n")
}
