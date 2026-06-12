import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { cachedFetch } from "@/lib/cache"
import { computeAccountStats, scoreAd } from "@/lib/pedro/performance"

/**
 * Pedro vertical winning-patterns library.
 *
 * The agency moat: every Pedro client's winning ads feed a nightly
 * synthesis that produces, per vertical, the top winners + common
 * angles + common hooks + format distribution. Pedro reads this table
 * for cross-client examples instead of fanning out Meta API calls per
 * request.
 *
 * Selection per knowledge/campaigns.md 2026-Q2: CPL-driven. Winners
 * are cheap-CPL relative to their own account-avg with ≥3 leads. Lead-
 * quality-validated winners are the future state - see status note.
 *
 * Vertical normalisation: free-text `brief.sector` → first significant
 * non-stopword token, lowercased. Coarse on purpose so typing variants
 * cluster. Phase 5 todo: structured `clients.vertical` tag replaces
 * this - interface stays the same.
 */

const anthropic = new Anthropic()

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
  "b2b",
  "b2c",
])

/**
 * Reduce a free-text sector to a stable vertical key. Picks the first
 * significant non-stopword token of length ≥ 3, lowercased. Returns
 * empty string if nothing qualifies.
 */
export function normaliseVertical(sector: string): string {
  if (!sector) return ""
  const tokens = sector
    .toLowerCase()
    .replace(/[()/&,\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  return tokens[0] ?? ""
}

export type VerticalWinnerEntry = {
  adName: string
  sourceClientName: string
  sourceSector: string
  cpl: number
  leads: number
  spend: number
  ctr: number
  body: string
  creativeType: "video" | "image" | "dynamic" | "unknown"
}

export type VerticalAnglePattern = {
  angle: string
  frequency: number
  examples: string[]
}

export type VerticalHookPattern = {
  hookType: string
  exampleOpener: string
  frequency: number
}

export type VerticalPatternRow = {
  vertical: string
  sector_aliases: string[]
  top_winners: VerticalWinnerEntry[]
  common_angles: VerticalAnglePattern[]
  common_hooks: VerticalHookPattern[]
  format_distribution: Record<string, number>
  sample_size: number
  client_count: number
  refreshed_at: string
  synthesised_at: string | null
}

function trim(s: string, max: number): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + "…"
}

/**
 * Read patterns for a vertical key. Returns null when not yet computed -
 * caller falls back to live cross-client query.
 */
export async function readVerticalPattern(
  supabase: SupabaseClient,
  vertical: string,
): Promise<VerticalPatternRow | null> {
  if (!vertical) return null
  const { data } = await supabase
    .from("pedro_vertical_patterns")
    .select("*")
    .eq("vertical", vertical)
    .maybeSingle()
  return (data as unknown as VerticalPatternRow | null) ?? null
}

/**
 * Render a vertical pattern as an in-context block for Pedro prompts.
 * Same anonymisation rules as live cross-client examples.
 */
export function renderVerticalPatternBlock(p: VerticalPatternRow): string {
  if (p.top_winners.length === 0) return ""

  const winnerLines = p.top_winners.slice(0, 5).map((w, i) => {
    const cpl = `€${w.cpl.toFixed(2)}`
    return `[Voorbeeld ${i + 1}] CPL ${cpl} · ${w.leads} leads · ${w.creativeType}\nVergelijkbare branche: "${w.sourceSector}"\nAd body:\n${trim(w.body, 500)}`
  })

  const anglesBlock =
    p.common_angles.length > 0
      ? `\nVeelvoorkomende winnende angles in deze branche (over alle klanten):\n${p.common_angles
          .slice(0, 5)
          .map((a) => `- ${a.angle} (${a.frequency} winners)`)
          .join("\n")}`
      : ""

  const hooksBlock =
    p.common_hooks.length > 0
      ? `\nVeelgebruikte hook-patronen:\n${p.common_hooks
          .slice(0, 5)
          .map((h) => `- ${h.hookType}: "${trim(h.exampleOpener, 100)}"`)
          .join("\n")}`
      : ""

  const formatBlock =
    Object.keys(p.format_distribution).length > 0
      ? `\nFormat-verdeling onder winners: ${Object.entries(p.format_distribution)
          .map(([f, pct]) => `${f} ${(pct * 100).toFixed(0)}%`)
          .join(", ")}`
      : ""

  return `\n\n=== BRANCHE-PATRONEN VOOR "${p.vertical}" ===
Synthese van winnende ads van ${p.client_count} RL klanten in dezelfde branche (${p.sample_size} ads, ${p.refreshed_at?.slice(0, 10)} gerefreshed).

GEBRUIK ALS INSPIRATIE - NIET ALS BLAUWDRUK:
- Patroonherkenning is wat hier nuttig is, geen letterlijke kopie.
- Noem NOOIT klantnamen of refereer naar "andere RL klanten" in output.
- CPL-driven selectie (zie knowledge/campaigns.md status note) - zie ze als "goedkoop", niet automatisch "kwalitatief".
${anglesBlock}${hooksBlock}${formatBlock}

Top winners (geanonimiseerd):
${winnerLines.join("\n\n")}
=== EINDE BRANCHE-PATRONEN ===\n`
}

// ──────────────────────────────────────────────────────────────────────
// Computation - used by the nightly cron
// ──────────────────────────────────────────────────────────────────────

type ClientRow = {
  monday_item_id: string
  name: string
  meta_ad_account_id: string | null
  brief_sector: string
}

/**
 * Pull every RL client that has a saved Pedro brief with a sector +
 * a Meta ad account. These are the candidates that contribute winners
 * to the per-vertical library.
 */
async function loadEligibleClients(supabase: SupabaseClient): Promise<ClientRow[]> {
  const { data } = await supabase
    .from("pedro_client_state")
    .select("client_id, brief, clients!inner(name, meta_ad_account_id)")
    .not("brief", "is", null)

  type Raw = {
    client_id: string
    brief: { sector?: string } | null
    clients: { name: string; meta_ad_account_id: string | null }
  }
  const rows = (data ?? []) as unknown as Raw[]

  return rows
    .map((r) => ({
      monday_item_id: r.client_id,
      name: r.clients?.name ?? "?",
      meta_ad_account_id: r.clients?.meta_ad_account_id ?? null,
      brief_sector: r.brief?.sector ?? "",
    }))
    .filter((r) => !!r.meta_ad_account_id && !!r.brief_sector)
}

/**
 * For each client, fetch last-30d Meta ads and return its winners.
 * Cached per ad account so concurrent verticals don't refetch.
 */
async function loadWinnersForClient(client: ClientRow): Promise<VerticalWinnerEntry[]> {
  if (!client.meta_ad_account_id) return []

  const end = new Date().toISOString().slice(0, 10)
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 29)
  const start = startDate.toISOString().slice(0, 10)

  try {
    const ads = await cachedFetch(`pedro_perf_v2_creative_fix:${client.meta_ad_account_id}:${start}:${end}`, () =>
      fetchMetaAdDetails(client.meta_ad_account_id as string, start, end),
    )
    const stats = computeAccountStats(ads)
    const scored = ads.map((a) => scoreAd(a, stats.avgCpl))

    return scored
      .filter((s) => s.verdict === "winner" && s.cpl != null && s.body.length > 20)
      .map((w) => ({
        adName: w.adName,
        sourceClientName: client.name,
        sourceSector: client.brief_sector,
        cpl: w.cpl as number,
        leads: w.leads,
        spend: w.spend,
        ctr: w.ctr,
        body: w.body.replace(/\s+/g, " ").trim().slice(0, 800),
        creativeType: w.creativeType,
      }))
  } catch {
    return []
  }
}

type SynthesisResult = {
  common_angles: VerticalAnglePattern[]
  common_hooks: VerticalHookPattern[]
}

/**
 * Claude reads winning-ad bodies and synthesises common angles + hooks.
 * Returns empty-arrays on any failure - top_winners + format_dist are
 * still saved independently so the table stays useful.
 */
async function synthesisePatterns(
  vertical: string,
  winners: VerticalWinnerEntry[],
): Promise<SynthesisResult> {
  if (winners.length < 3) {
    return { common_angles: [], common_hooks: [] }
  }

  const sample = winners.slice(0, 12).map((w, i) => `[Ad ${i + 1}, CPL €${w.cpl.toFixed(2)}, ${w.creativeType}]\n${w.body}`).join("\n\n---\n\n")

  const prompt = `Je bent Pedro, senior campaign manager bij Rocket Leads. Onderstaand zijn winnende ads (lage CPL t.o.v. account-gemiddelde) uit de "${vertical}" branche, van verschillende RL klanten in deze niche. Synthetiseer welke patronen herhaaldelijk werken.

${sample}

ALLEEN JSON output (geen markdown, geen code fences):

{
  "common_angles": [
    { "angle": "naam van de angle in NL (bv. 'subsidie-savings', 'voor/na transformatie')", "frequency": <aantal ads dat deze angle gebruikt>, "examples": ["1-3 korte zinnen uit de ads die deze angle illustreren"] }
  ],
  "common_hooks": [
    { "hookType": "categorie van de hook (bv. 'pijnpunt-opener', 'fake-news contrarian', 'ROI-claim')", "exampleOpener": "een echte opener-zin uit de ads die het patroon vangt", "frequency": <aantal ads> }
  ]
}

Genereer 3-6 angles en 3-6 hook-patronen. Wees specifiek met namen, niet generiek. Geen klantnamen noemen.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    })
    const raw = message.content[0]?.type === "text" ? message.content[0].text : ""
    const cleaned = raw.replace(/```json|```/g, "").trim()
    const parsed = JSON.parse(cleaned) as SynthesisResult
    return {
      common_angles: Array.isArray(parsed.common_angles) ? parsed.common_angles.slice(0, 6) : [],
      common_hooks: Array.isArray(parsed.common_hooks) ? parsed.common_hooks.slice(0, 6) : [],
    }
  } catch {
    return { common_angles: [], common_hooks: [] }
  }
}

export type RefreshResult = {
  vertical: string
  sample_size: number
  client_count: number
  hadSynthesis: boolean
}

/**
 * Refresh patterns for ALL verticals. Used by the nightly cron.
 *
 * Strategy:
 *  1. Pull eligible clients (have brief.sector + ad account)
 *  2. Group by normalised vertical
 *  3. For each vertical: collect winners across members, run synthesis,
 *     upsert into pedro_vertical_patterns
 *
 * Best-effort per vertical - failures don't poison the batch.
 */
export async function refreshAllVerticalPatterns(
  supabase: SupabaseClient,
): Promise<RefreshResult[]> {
  const clients = await loadEligibleClients(supabase)
  if (clients.length === 0) return []

  // Group by normalised vertical
  const grouped = new Map<string, ClientRow[]>()
  for (const c of clients) {
    const key = normaliseVertical(c.brief_sector)
    if (!key) continue
    const arr = grouped.get(key) ?? []
    arr.push(c)
    grouped.set(key, arr)
  }

  const results: RefreshResult[] = []
  for (const [vertical, members] of grouped.entries()) {
    if (members.length < 1) continue

    // Collect winners for all members in parallel
    const allWinnersByClient = await Promise.all(members.map((m) => loadWinnersForClient(m)))
    const allWinners = allWinnersByClient.flat()

    // Sort + cap top winners per vertical
    const topWinners = allWinners.sort((a, b) => a.cpl - b.cpl).slice(0, 15)

    // Format distribution
    const formatCounts = new Map<string, number>()
    for (const w of topWinners) {
      formatCounts.set(w.creativeType, (formatCounts.get(w.creativeType) ?? 0) + 1)
    }
    const total = topWinners.length || 1
    const formatDistribution: Record<string, number> = {}
    for (const [f, c] of formatCounts) {
      formatDistribution[f] = Math.round((c / total) * 100) / 100
    }

    // Synthesise (Claude) - best effort
    const synthesised = await synthesisePatterns(vertical, topWinners)
    const hadSynthesis = synthesised.common_angles.length > 0 || synthesised.common_hooks.length > 0

    const sectorAliases = Array.from(new Set(members.map((m) => m.brief_sector))).slice(0, 8)
    const clientCount = new Set(allWinners.map((w) => w.sourceClientName)).size

    try {
      await supabase.from("pedro_vertical_patterns").upsert(
        {
          vertical,
          sector_aliases: sectorAliases,
          top_winners: topWinners,
          common_angles: synthesised.common_angles,
          common_hooks: synthesised.common_hooks,
          format_distribution: formatDistribution,
          sample_size: topWinners.length,
          client_count: clientCount,
          refreshed_at: new Date().toISOString(),
          synthesised_at: hadSynthesis ? new Date().toISOString() : null,
        },
        { onConflict: "vertical" },
      )
    } catch (e) {
      console.error("Pedro vertical patterns: upsert failed for", vertical, e)
    }

    results.push({
      vertical,
      sample_size: topWinners.length,
      client_count: clientCount,
      hadSynthesis,
    })
  }

  return results
}
