import type { MetaAdDetail } from "@/lib/integrations/meta"

export type AdVerdict = "winner" | "neutral" | "loser"

export type TopAd = {
  adName: string
  spend: number
  leads: number
  /** 0 when there are no leads with spend — UI renders this as "—". */
  cpl: number
  verdict: AdVerdict
}

/**
 * Pure top-ads ranker — shared between `/api/watchlist/[id]/expand` (live) and
 * the cron's per-client pre-bake. Same rules in both surfaces so the cached
 * version is byte-equivalent to a live recompute.
 *
 * Rules:
 *   - Drop ads with spend < €10 (micro-tests skew the account average)
 *   - Verdict is relative to account-avg CPL across ads-with-leads
 *   - Wide neutral band (0.7×–1.4×) keeps the signal honest with small ad sets
 *   - Sort by spend desc, take top 5 — what the user is putting money behind
 */
export function rankTopAds(ads: MetaAdDetail[]): TopAd[] {
  const enriched = ads
    .map((a) => ({
      adName: a.adName,
      spend: a.spend,
      leads: a.leads,
      cpl: a.leads > 0 ? a.spend / a.leads : Infinity,
    }))
    .filter((a) => a.spend >= 10)

  const adsWithLeads = enriched.filter((a) => a.leads > 0)
  const totalSpendWithLeads = adsWithLeads.reduce((s, a) => s + a.spend, 0)
  const totalLeads = adsWithLeads.reduce((s, a) => s + a.leads, 0)
  const accountAvgCpl = totalLeads > 0 ? totalSpendWithLeads / totalLeads : 0

  function verdict(ad: { cpl: number; spend: number; leads: number }): AdVerdict {
    if (ad.leads === 0 && ad.spend >= 50) return "loser"
    if (accountAvgCpl <= 0 || !isFinite(ad.cpl)) return "neutral"
    if (ad.cpl <= 0.7 * accountAvgCpl) return "winner"
    if (ad.cpl >= 1.4 * accountAvgCpl) return "loser"
    return "neutral"
  }

  return enriched
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 5)
    .map((a) => ({
      adName: a.adName,
      spend: a.spend,
      leads: a.leads,
      cpl: isFinite(a.cpl) ? a.cpl : 0,
      verdict: verdict(a),
    }))
}

/** Cache key for the pre-baked topAds per client. */
export function topAdsCacheKey(mondayItemId: string): string {
  return `client_top_ads:${mondayItemId}`
}
