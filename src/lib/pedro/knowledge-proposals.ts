import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { promises as fs } from "fs"
import path from "path"
import type { VerticalPatternRow } from "@/lib/pedro/vertical-patterns"

/**
 * Pedro knowledge-base proposal detector.
 *
 * Reads pedro_vertical_patterns. When a pattern in a vertical reaches a
 * convergence threshold (≥5 winners across ≥3 distinct clients), we ask
 * Claude two things:
 *  1. Is this pattern already covered in knowledge/campaigns.md?
 *  2. If not, what's the best addition?
 *
 * If new + meaningful, we insert a row in pedro_knowledge_proposals and
 * create a Hub task for Roy. Roy reviews. Knowledge file edits stay
 * MANUAL - auto-write would let drift accumulate unchecked, and the
 * knowledge file is loaded into every Pedro AI call so a bad addition
 * has agency-wide blast radius.
 *
 * Convergence rules (gentle):
 *  - Pattern (angle or hook) appears in ≥5 winners
 *  - Across ≥3 distinct contributing clients (no single client can
 *    monopolise a "convergence")
 *
 * Proposal dedupe:
 *  - Skip if a 'pending' or 'accepted' proposal exists for the same
 *    (vertical, pattern_type, title) - don't spam the same idea.
 */

const anthropic = new Anthropic()

const MIN_FREQUENCY = 5
const MIN_CONTRIBUTING_CLIENTS = 3

export type ProposalCandidate = {
  vertical: string
  patternType: "angle" | "hook"
  patternKey: string // angle name or hook type
  frequency: number
  contributingClients: number
}

/**
 * Find verticals where convergence thresholds are met. Pure function on
 * the patterns rows - caller handles dedupe vs DB.
 */
export function findCandidates(verticals: VerticalPatternRow[]): ProposalCandidate[] {
  const candidates: ProposalCandidate[] = []

  for (const v of verticals) {
    // Count distinct clients per pattern via the top_winners pool -
    // if Claude says "angle X" 5 times but they all came from one
    // client, that's not convergence, that's one client with a strong
    // pattern.
    const winnerClientNames = new Set(v.top_winners.map((w) => w.sourceClientName))
    const distinctClients = winnerClientNames.size

    for (const angle of v.common_angles) {
      if (
        angle.frequency >= MIN_FREQUENCY &&
        distinctClients >= MIN_CONTRIBUTING_CLIENTS
      ) {
        candidates.push({
          vertical: v.vertical,
          patternType: "angle",
          patternKey: angle.angle,
          frequency: angle.frequency,
          contributingClients: distinctClients,
        })
      }
    }

    for (const hook of v.common_hooks) {
      if (
        hook.frequency >= MIN_FREQUENCY &&
        distinctClients >= MIN_CONTRIBUTING_CLIENTS
      ) {
        candidates.push({
          vertical: v.vertical,
          patternType: "hook",
          patternKey: hook.hookType,
          frequency: hook.frequency,
          contributingClients: distinctClients,
        })
      }
    }
  }

  return candidates
}

/**
 * Read knowledge/campaigns.md from disk. Used to feed Claude so it can
 * judge "is this pattern already covered?". Cached in module memory -
 * the cron is short-lived so cache TTL doesn't matter.
 */
let cachedKnowledge: string | null = null
async function loadCampaignsMd(): Promise<string> {
  if (cachedKnowledge !== null) return cachedKnowledge
  const fullPath = path.join(process.cwd(), "knowledge", "campaigns.md")
  try {
    cachedKnowledge = await fs.readFile(fullPath, "utf-8")
  } catch {
    cachedKnowledge = ""
  }
  return cachedKnowledge
}

type ClaudeProposalOutput = {
  isNew: boolean
  /** Section of campaigns.md to slot into, or "(new section)" */
  targetSection: string
  /** Markdown body to add. */
  suggestedAddition: string
  /** 1-line summary used as the proposal title + task title. */
  summary: string
  /** Why this is worth knowing - one line. */
  rationale: string
}

async function askClaudeForProposal(
  candidate: ProposalCandidate,
  vertical: VerticalPatternRow,
  campaignsMd: string,
): Promise<ClaudeProposalOutput | null> {
  const winnerExcerpts = vertical.top_winners
    .slice(0, 6)
    .map(
      (w, i) =>
        `[Winner ${i + 1}, CPL €${w.cpl.toFixed(2)}, ${w.creativeType}] sector="${w.sourceSector}"\n${w.body.slice(0, 350)}`,
    )
    .join("\n\n")

  const prompt = `Je bent Pedro, senior campaign manager bij Rocket Leads. Een patroon convergeert in vertical "${candidate.vertical}":

PATROON: ${candidate.patternType} - "${candidate.patternKey}"
- Voorkomend in ${candidate.frequency} winnende ads
- Across ${candidate.contributingClients} verschillende klanten in dezelfde branche

WINNER VOORBEELDEN:
${winnerExcerpts}

HUIDIGE knowledge/campaigns.md (verkort):
${campaignsMd.slice(0, 15000)}

OPDRACHT:
1. Beoordeel: staat dit patroon AL voldoende beschreven in knowledge/campaigns.md? "Voldoende" = een AI agent die de file leest zou dit patroon herkennen en toepassen voor een vergelijkbare klant.
2. Zo nee: stel een toevoeging voor. Concreet, 3-8 regels markdown. Citeer 1-2 voorbeeld-zinnen uit de winners. Match de bestaande stijl van knowledge/campaigns.md.
3. Identificeer de beste sectie om in te voegen. Bestaande secties zijn bv. "Marketing Angles Framework", "Video Scripts & Hooks", "Angles per branche". Of "(nieuwe sectie)" als niets past.

ALLEEN JSON output (geen markdown wrapper, geen code fences):

{
  "isNew": true|false,
  "targetSection": "naam van sectie OF '(nieuwe sectie)'",
  "suggestedAddition": "complete markdown blok klaar om te plakken",
  "summary": "1-line beschrijving van het patroon (max 80 chars)",
  "rationale": "1 zin in NL - waarom Roy dit zou willen toevoegen"
}

Belangrijk:
- Wees STRENG met "isNew=true". Als knowledge/campaigns.md het patroon al noemt, ook impliciet, → isNew=false.
- "suggestedAddition" moet drop-in plakbaar zijn - geen placeholder, geen "[VUL IN]".
- Géén klantnamen. Géén refereren naar specifieke RL klanten.
- Match Nederlandse stijl van campaigns.md.`

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    })
    const raw = message.content[0]?.type === "text" ? message.content[0].text : ""
    const cleaned = raw.replace(/```json|```/g, "").trim()
    return JSON.parse(cleaned) as ClaudeProposalOutput
  } catch {
    return null
  }
}

/**
 * Find the campaign-manager-like admin user - used as the assignee for
 * knowledge proposal review tasks. Falls back to the first admin found.
 */
async function findReviewerUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("id, email")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string; email: string }>()
  return data?.id ?? null
}

export type ProposalRunResult = {
  candidates: number
  created: number
  skippedExisting: number
  skippedAlreadyCovered: number
}

export async function runKnowledgeProposalScan(
  supabase: SupabaseClient,
): Promise<ProposalRunResult> {
  const result: ProposalRunResult = {
    candidates: 0,
    created: 0,
    skippedExisting: 0,
    skippedAlreadyCovered: 0,
  }

  // 1. Load all vertical patterns
  const { data: verticalsRaw } = await supabase
    .from("pedro_vertical_patterns")
    .select("*")
  const verticals = (verticalsRaw ?? []) as unknown as VerticalPatternRow[]
  if (verticals.length === 0) return result

  // 2. Find candidates
  const candidates = findCandidates(verticals)
  result.candidates = candidates.length
  if (candidates.length === 0) return result

  // 3. Load knowledge file once
  const campaignsMd = await loadCampaignsMd()

  // 4. Per candidate: dedupe → ask Claude → maybe insert
  const reviewerId = await findReviewerUserId(supabase)

  for (const c of candidates) {
    // Dedupe: skip if a pending or accepted proposal already exists for
    // (vertical, pattern_type, patternKey via title-prefix match).
    // Title format below uses patternKey as suffix so we match by ilike.
    const { data: existing } = await supabase
      .from("pedro_knowledge_proposals")
      .select("id, status")
      .eq("vertical", c.vertical)
      .eq("pattern_type", c.patternType)
      .in("status", ["pending", "accepted"])
      .ilike("title", `%${c.patternKey}%`)
      .limit(1)
      .maybeSingle()

    if (existing) {
      result.skippedExisting += 1
      continue
    }

    const vertical = verticals.find((v) => v.vertical === c.vertical)
    if (!vertical) continue

    const proposal = await askClaudeForProposal(c, vertical, campaignsMd)
    if (!proposal) continue
    if (!proposal.isNew) {
      result.skippedAlreadyCovered += 1
      continue
    }

    // Compose the markdown body that lives in pedro_knowledge_proposals
    // + becomes the body of the inbox task.
    const body = [
      `**Pedro detecteerde een convergerend patroon in vertical "${c.vertical}".**`,
      "",
      `- Type: ${c.patternType}`,
      `- Patroon: **${c.patternKey}**`,
      `- Voorkomend in ${c.frequency} winnende ads, across ${c.contributingClients} klanten`,
      "",
      `**Pedro's rationale:** ${proposal.rationale}`,
      "",
      `**Voorgestelde sectie:** ${proposal.targetSection}`,
      "",
      "**Voorgestelde toevoeging:**",
      "",
      "```markdown",
      proposal.suggestedAddition,
      "```",
      "",
      "_Knowledge-base edits zijn handmatig - Roy reviewed → kopieer de bovenstaande markdown handmatig in `knowledge/campaigns.md` als hij akkoord is. Daarna mark deze proposal als `accepted` via de Settings → Pedro tab._",
    ].join("\n")

    // Insert proposal
    const { data: inserted } = await supabase
      .from("pedro_knowledge_proposals")
      .insert({
        vertical: c.vertical,
        pattern_type: c.patternType,
        title: `${c.patternType === "angle" ? "Angle" : "Hook"}: ${c.patternKey} (${c.vertical})`,
        proposal_body: body,
        evidence: {
          frequency: c.frequency,
          contributingClients: c.contributingClients,
          targetSection: proposal.targetSection,
          summary: proposal.summary,
        },
        status: "pending",
      })
      .select("id")
      .single<{ id: string }>()

    if (!inserted) continue

    // Create review task in inbox_events
    if (reviewerId) {
      try {
        const { data: task } = await supabase
          .from("inbox_events")
          .insert({
            kind: "task",
            client_id: null,
            author_id: null,
            assignee_id: reviewerId,
            title: `Pedro knowledge proposal: ${proposal.summary}`,
            body: `${body}\n\n[→ Review in Settings → Pedro](/settings)`,
            status: "open",
            priority: "low",
            source: "automation",
            source_ref: {
              kind: "pedro_knowledge_proposal",
              proposalId: inserted.id,
              vertical: c.vertical,
              patternType: c.patternType,
            },
          })
          .select("id")
          .single<{ id: string }>()

        if (task?.id) {
          await supabase
            .from("pedro_knowledge_proposals")
            .update({ inbox_task_id: task.id })
            .eq("id", inserted.id)
        }
      } catch {
        // Non-fatal - proposal exists in pedro_knowledge_proposals
      }
    }

    result.created += 1
  }

  return result
}
