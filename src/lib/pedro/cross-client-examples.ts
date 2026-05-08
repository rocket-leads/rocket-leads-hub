import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"
import { computeAccountStats, scoreAd } from "@/lib/pedro/performance"
import {
  normaliseVertical,
  readVerticalPattern,
  renderVerticalPatternBlock,
} from "@/lib/pedro/vertical-patterns"

/**
 * Cross-client examples — when Pedro generates angles / scripts / copy
 * for client X in vertical V, pull 3-5 winning ads from OTHER RL clients
 * in the same vertical and feed them as in-context examples. This is the
 * agency moat: every campaign Pedro touches teaches the next one in the
 * same niche.
 *
 * Selection rules per `knowledge/campaigns.md` 2026-Q2 status note: CPL
 * is the primary driver (Monday lead-quality data isn't ready yet). A
 * winner here means cheap-CPL relative to its own account-avg with
 * enough lead volume to be trusted, NOT a leadquality-validated winner.
 *
 * Vertical matching is keyword-overlap on the brief.sector field. Free-
 * text but pragmatic — once we have a structured `clients.vertical` tag
 * (Phase 5 todo), this helper swaps out trivially.
 */

export type CrossClientWinner = {
  /** Source RL client (anonymised in the prompt — Pedro should NEVER
   *  surface the client name to other clients' campaigns). */
  sourceClientName: string
  sourceSector: string
  adName: string
  cpl: number
  leads: number
  spend: number
  ctr: number
  /** Stripped of HTML, trimmed. */
  body: string
  creativeType: "video" | "image" | "dynamic" | "unknown"
}

const STOPWORDS = new Set([
  "en",
  "of",
  "voor",
  "met",
  "zonder",
  "&",
  "/",
  "-",
  "in",
  "de",
  "het",
  "een",
])

/**
 * Tokenise a sector string into lowercase keyword tokens. Drops stopwords
 * and tokens shorter than 3 chars. Used both to index candidate clients
 * and to score similarity to the current client's sector.
 */
function tokenise(sector: string): string[] {
  return sector
    .toLowerCase()
    .replace(/[()/&,\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

function similarity(a: string, b: string): number {
  const tokensA = new Set(tokenise(a))
  const tokensB = new Set(tokenise(b))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let overlap = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) overlap += 1
  }
  // Jaccard-ish — intersection size over min set size so small overlaps
  // on long sectors still count.
  return overlap / Math.min(tokensA.size, tokensB.size)
}

function trim(s: string, max: number): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + "…"
}

/**
 * Load winners from same-vertical clients.
 *
 *  - excludes the current client itself
 *  - requires the candidate to have a meta_ad_account_id + a saved
 *    pedro_client_state row with a brief.sector
 *  - sector similarity ≥ 0.4 (at least one matching token after
 *    stopword filtering, weighted by overlap) — gate is intentionally
 *    loose; we'd rather over-include and let Pedro pick the best
 *  - per candidate: pulls last-30d Meta ads (cachedFetch, 5min), scores
 *    against THAT client's account-avg CPL, takes top-2 winners
 *  - aggregate top N winners across candidates, sorted by lowest CPL
 */
export async function loadCrossClientExamples(
  supabase: SupabaseClient,
  currentClientId: string,
  currentSector: string,
  limit = 5,
): Promise<CrossClientWinner[]> {
  if (!currentSector || tokenise(currentSector).length === 0) return []

  // ── 1. Find candidate clients ──
  // Join pedro_client_state (has brief) with clients (has meta_ad_account_id).
  const { data: candidatesRaw } = await supabase
    .from("pedro_client_state")
    .select(
      "client_id, brief, clients!inner(name, meta_ad_account_id, monday_item_id)",
    )
    .neq("client_id", currentClientId)
    .not("brief", "is", null)

  type CandidateRow = {
    client_id: string
    brief: { sector?: string } | null
    clients: { name: string; meta_ad_account_id: string | null; monday_item_id: string }
  }
  const candidates = (candidatesRaw ?? []) as unknown as CandidateRow[]

  // ── 2. Score sector similarity, keep top matches ──
  const ranked = candidates
    .map((c) => {
      const sector = c.brief?.sector ?? ""
      return {
        clientId: c.client_id,
        clientName: c.clients?.name ?? "?",
        adAccountId: c.clients?.meta_ad_account_id ?? null,
        sector,
        sim: similarity(currentSector, sector),
      }
    })
    .filter((c) => c.sim >= 0.4 && c.adAccountId)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 8) // cap candidates at 8 to keep Meta API load bounded

  if (ranked.length === 0) return []

  // ── 3. For each candidate, pull last-30d Meta ads (cached) ──
  const end = new Date().toISOString().slice(0, 10)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 29)
  const start = startDate.toISOString().slice(0, 10)

  const winners: CrossClientWinner[] = []

  for (const c of ranked) {
    if (!c.adAccountId) continue
    try {
      const ads = await cachedFetch(`pedro_perf:${c.adAccountId}:${start}:${end}`, () =>
        fetchMetaAdDetails(c.adAccountId as string, start, end),
      )
      const stats = computeAccountStats(ads)
      const scored = ads.map((a) => scoreAd(a, stats.avgCpl))
      const candidateWinners = scored
        .filter((s) => s.verdict === "winner" && s.cpl != null && s.body.length > 20)
        .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity))
        .slice(0, 2)

      for (const w of candidateWinners) {
        if (w.cpl == null) continue
        winners.push({
          sourceClientName: c.clientName,
          sourceSector: c.sector,
          adName: w.adName,
          cpl: w.cpl,
          leads: w.leads,
          spend: w.spend,
          ctr: w.ctr,
          body: trim(w.body.replace(/\s+/g, " ").trim(), 600),
          creativeType: w.creativeType,
        })
      }
    } catch {
      // Skip per-candidate failures — don't fail the whole lookup.
    }
  }

  // ── 4. Sort + cap ──
  return winners.sort((a, b) => a.cpl - b.cpl).slice(0, limit)
}

/**
 * Render winners as an in-context example block for Claude prompts.
 * Returns "" when there are no winners — caller can safely concatenate.
 *
 * Anonymisation: source client names are dropped from the prompt body
 * (Claude only sees them in the role context). Pedro must NEVER name
 * other RL clients in output to a different client's campaign — these
 * are inspiration, not attribution.
 */
export function renderCrossClientExamples(winners: CrossClientWinner[]): string {
  if (winners.length === 0) return ""

  const lines = winners.map((w, i) => {
    const cpl = `€${w.cpl.toFixed(2)}`
    return `[Voorbeeld ${i + 1}] CPL ${cpl} (${w.leads} leads, €${w.spend.toFixed(0)} spend, ${w.ctr.toFixed(2)}% CTR, ${w.creativeType})\nVergelijkbare branche: "${w.sourceSector}"\nAd body:\n${w.body}`
  })

  return `\n\n=== WINNENDE RL ADS UIT ZELFDE BRANCHE ===
Onderstaand zijn ${winners.length} echte winnende ads van andere RL klanten in een vergelijkbare branche, gekozen op basis van laagste CPL t.o.v. hun account-gemiddelde (laatste 30d).

GEBRUIK ALS INSPIRATIE — NIET ALS BLAUWDRUK:
- Patronen herkennen (welke hooks/angles werken in deze niche, welk format) is wat hier nuttig is.
- Letterlijke kopie is verboden — copyright + iedere klant heeft een eigen tone.
- Noem NOOIT klantnamen of refereer naar "andere RL klanten" in je output naar deze klant.
- Lead-quality van deze winners is op CPL-basis, niet op Monday-feedback geverifieerd (zie status note in knowledge/campaigns.md). Zie ze als "goedkoop", niet automatisch "kwalitatief".

${lines.join("\n\n")}
=== EINDE BRANCHE-VOORBEELDEN ===\n`
}

/**
 * Convenience: load + render in one call, with sane defaults.
 *
 * Cache-first: tries the pre-computed `pedro_vertical_patterns` table
 * (refreshed nightly by cron) for instant lookup with synthesised
 * angle/hook patterns layered on top of winners. Falls back to a live
 * Meta query when the patterns table isn't populated for this vertical
 * (e.g. fresh vertical, cron hasn't run yet, or pattern is stale).
 *
 * Server-side use only.
 */
export async function crossClientExamplesBlock(
  supabase: SupabaseClient,
  currentClientId: string,
  currentSector: string,
  limit = 5,
): Promise<string> {
  // ── Path 1: pre-computed pattern (preferred) ──
  const verticalKey = normaliseVertical(currentSector)
  if (verticalKey) {
    const pattern = await readVerticalPattern(supabase, verticalKey).catch(() => null)
    if (pattern && pattern.top_winners.length > 0) {
      // Filter out the current client's own ads from the cached winners
      // (cron is global; per-request we exclude self).
      const ownClient = await supabase
        .from("clients")
        .select("name")
        .eq("monday_item_id", currentClientId)
        .maybeSingle<{ name: string }>()
      const ownName = ownClient.data?.name ?? null
      if (ownName) {
        pattern.top_winners = pattern.top_winners.filter((w) => w.sourceClientName !== ownName)
      }
      if (pattern.top_winners.length > 0) {
        return renderVerticalPatternBlock(pattern)
      }
    }
  }

  // ── Path 2: live fallback ──
  const winners = await loadCrossClientExamples(supabase, currentClientId, currentSector, limit)
  return renderCrossClientExamples(winners)
}
