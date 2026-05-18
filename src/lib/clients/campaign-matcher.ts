/**
 * Auto-matcher for campaigns running through the shared Rocket Leads ad account.
 *
 * Per the campaigns naming convention (knowledge/campaigns.md):
 *   `RL | {country} | {initials} | {company name} | {LF/LP}`
 *
 * The shared RL account hosts campaigns for many clients at once, so a
 * blanket auto-select would pull every other client's spend into one client's
 * KPIs. Instead, we look at the campaign name and try to identify which
 * client it belongs to — only auto-assigning when we hit a high-confidence
 * match (≥0.95). Anything else stays unselected for the user to decide.
 */

export type MatcherClient = { id: string; name: string }
export type MatchResult = { clientId: string; confidence: number }

/**
 * Rocket Leads-built campaigns always carry "RL" in the name — the standard is
 * `RL | NL | RV | Acme | LP` but field tolerance allows variants like `RL|NL|...`,
 * `RL_NL_...`, or just a leading `RL ` prefix. We match RL as a whole-word token,
 * case-insensitively, so a campaign called "Rolex" doesn't accidentally qualify
 * but "rl | nl | dv | client | lf" does.
 *
 * Used by the campaigns endpoint to gate auto-select: only campaigns we built
 * get auto-tracked, client-built campaigns stay unselected.
 */
export function hasRlPrefix(campaignName: string): boolean {
  return /\bRL\b/i.test(campaignName)
}

const COMPANY_SUFFIXES = /\b(b\.?v\.?|n\.?v\.?|ltd\.?|inc\.?|gmbh|s\.?a\.?|llc|holding|group)\b/g

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function matchRocketLeadsCampaign(
  campaignName: string,
  candidates: MatcherClient[],
): MatchResult | null {
  const normalizedCampaign = normalize(campaignName)
  if (!normalizedCampaign) return null

  // Skip empty/short names — would substring-match anything.
  const norms = candidates
    .map((c) => ({ id: c.id, norm: normalize(c.name) }))
    .filter((c) => c.norm.length >= 3)
  if (norms.length === 0) return null

  // 1. Exact match on the 4th pipe-segment (company name slot).
  const segments = campaignName.split("|").map((s) => s.trim())
  if (segments.length >= 4) {
    const companySegment = normalize(segments[3])
    if (companySegment) {
      const exact = norms.find((c) => c.norm === companySegment)
      if (exact) return { clientId: exact.id, confidence: 0.99 }
    }
  }

  // 2. Word-boundary substring match — full normalized client name appears
  //    somewhere in the normalized campaign name. Reject if multiple
  //    candidates match (ambiguous).
  const matches = norms.filter((c) =>
    new RegExp(`\\b${escapeRegex(c.norm)}\\b`).test(normalizedCampaign),
  )
  if (matches.length === 1) return { clientId: matches[0].id, confidence: 0.95 }

  // 3. Token-overlap fallback for multi-word names. When the campaign carries
  //    only part of the client name ("RL | NL | RV | Inland | LF" for client
  //    "Inland Invest") strict substring fails, but a strong partial token
  //    overlap is still a useful signal — surfaced as a suggestion (<0.95)
  //    rather than auto-assigned. Confidence scales with the ratio of matched
  //    tokens; only the clear winner among candidates is returned.
  const partials = norms
    .map((c) => {
      const tokens = c.norm.split(/\s+/).filter((t) => t.length >= 3)
      if (tokens.length < 2) return null
      const matched = tokens.filter((t) =>
        new RegExp(`\\b${escapeRegex(t)}\\b`).test(normalizedCampaign),
      ).length
      const ratio = matched / tokens.length
      if (ratio < 0.5) return null
      // 0.7 (50% tokens) → 0.9 (100% tokens, but not as a contiguous phrase).
      return { id: c.id, confidence: 0.7 + 0.2 * (ratio - 0.5) / 0.5 }
    })
    .filter((c): c is { id: string; confidence: number } => c !== null)
    .sort((a, b) => b.confidence - a.confidence)

  if (partials.length === 1) return { clientId: partials[0].id, confidence: partials[0].confidence }
  if (partials.length >= 2 && partials[0].confidence - partials[1].confidence >= 0.1) {
    return { clientId: partials[0].id, confidence: partials[0].confidence }
  }

  return null
}
