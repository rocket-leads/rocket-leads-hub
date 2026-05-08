import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchClientById } from "@/lib/integrations/monday"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { pastContextForStage } from "@/lib/pedro/past-campaigns"

/**
 * Pedro evaluation-meeting digest. When a Fathom evaluation meeting is
 * ingested, Pedro reads the transcript against the client's existing
 * Pedro state (brief, latest refresh) and decides whether anything in the
 * conversation warrants a campaign update.
 *
 * Critical design point: Claude is the GATE. If the eval is a routine
 * "everything's fine" check-in, it returns `actionable: false` and the
 * caller skips task creation. This keeps the team from drowning in low-
 * signal Pedro pings — only meaningful pivots, complaints, ICP shifts,
 * pricing changes, and explicit client requests make it through.
 *
 * Used by the eval auto-trigger (Fathom webhook → Pedro evaluates →
 * conditional inbox task to CM).
 */

const anthropic = new Anthropic()

export type EvalChangeCategory =
  | "icp_shift"
  | "new_pain"
  | "new_objection"
  | "pricing"
  | "scope"
  | "client_request"
  | "performance_feedback"
  | "satisfaction"
  | "other"

export type EvalSuggestedAction =
  | "brief_update"
  | "new_angle"
  | "creative_refresh"
  | "copy_refresh"
  | "lead_form_change"
  | "client_check_in"
  | "no_action"

export type EvalDigest = {
  /** Hard gate: when false, the caller skips task creation entirely. */
  actionable: boolean
  /** Severity drives task priority + UI emphasis. */
  severity: "high" | "medium" | "low"
  /** 1-sentence overview in Dutch. Always present. */
  summary: string
  /** Concrete changes Pedro detected, each with implication. */
  changes: Array<{
    category: EvalChangeCategory
    detail: string
    implication: string
  }>
  /** What Pedro recommends the CM does next. */
  suggestedAction: EvalSuggestedAction
  /** Long-form rationale (stored, not always shown). */
  reasoning: string
}

const NULL_DIGEST: EvalDigest = {
  actionable: false,
  severity: "low",
  summary: "Pedro vond geen actiepunten in deze eval — routine check-in.",
  changes: [],
  suggestedAction: "no_action",
  reasoning: "",
}

function trim(s: string | null | undefined, max: number): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + "…"
}

type MeetingForDigest = {
  id: string
  client_id: string | null
  scheduled_at: string | null
  title: string | null
  summary: string | null
  transcript: string | null
}

type StateForDigest = {
  brief: Record<string, string> | null
  creatives: { refreshes?: Array<{ generatedAt: string; summary: string }> } | null
  updated_at: string
}

export async function generateEvalDigest(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<{ digest: EvalDigest; meta: { clientId: string; clientName: string; meetingTitle: string | null; scheduledAt: string | null } } | null> {
  // ── 1. Load the meeting ──
  const { data: meetingRaw } = await supabase
    .from("meetings")
    .select("id, client_id, scheduled_at, title, summary, transcript")
    .eq("id", meetingId)
    .maybeSingle()
  const meeting = meetingRaw as MeetingForDigest | null
  if (!meeting || !meeting.client_id) return null

  // ── 2. Load client + Pedro state ──
  const [client, stateRaw] = await Promise.all([
    fetchClientById(meeting.client_id).catch(() => null),
    supabase
      .from("pedro_client_state")
      .select("brief, creatives, updated_at")
      .eq("client_id", meeting.client_id)
      .order("campaign_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!client) return null

  const state = (stateRaw.data ?? null) as StateForDigest | null

  // ── 3. Compose the prompt ──
  const briefBlock = state?.brief
    ? `Sector: ${state.brief.sector || "—"}
Doelgroep: ${state.brief.doel || "—"}
Pijnpunten: ${state.brief.pijn || "—"}
Aanbod: ${state.brief.aanbod || "—"}
USPs: ${state.brief.usps || "—"}
Hooks: ${state.brief.hooksAM || "—"}`
    : "(Pedro heeft nog geen brief voor deze klant — eval is dan automatisch actionable: brief moet alsnog worden gemaakt)"

  const refreshes = state?.creatives?.refreshes ?? []
  const latestRefresh = refreshes[0]
  const refreshBlock = latestRefresh
    ? `Laatste refresh-ronde (${latestRefresh.generatedAt?.slice(0, 10) ?? "?"}): ${latestRefresh.summary}`
    : "Geen eerdere refresh-rondes."

  const transcriptBlock = meeting.transcript
    ? `Transcript (eerste 9000 chars):\n${trim(meeting.transcript, 9000)}`
    : "(Geen transcript beschikbaar — werk met de samenvatting)"

  const summaryBlock = meeting.summary ? `Fathom-samenvatting:\n${trim(meeting.summary, 1500)}` : ""

  const pastBrief = await pastContextForStage(meeting.client_id, "brief", 1).catch(() => "")

  const prompt = `Jij bent Pedro, senior campaign manager bij Rocket Leads. Een evaluatie-meeting met een bestaande klant is net afgelopen. Lees het transcript + samenvatting tegen de huidige campagne-state, en bepaal of er iets is veranderd dat de campagne moet bijsturen.

KLANT: ${client.companyName || client.name} (Monday item ${meeting.client_id})
EVAL DATUM: ${meeting.scheduled_at?.slice(0, 10) ?? "?"} — ${meeting.title || ""}

HUIDIGE PEDRO BRIEF:
${briefBlock}

CAMPAGNE CONTEXT:
${refreshBlock}
${pastBrief}

EVAL CONTENT:
${summaryBlock}
${transcriptBlock}

OPDRACHT:
Bepaal of deze eval iets onthult dat actie vereist. Wees STRENG met de gate:
- Als de eval een routine check-in is ("alles loopt goed", "geen klachten", "dezelfde aanpak voortzetten") → actionable: false. Geen valse alarmen.
- Als er WEL iets nieuws is dat de campagne raakt — ICP shift, nieuwe pijnpunt, nieuwe objection van leads, prijswijziging, scope-change, expliciete klant-request, performance-klacht, sterk positief signaal — actionable: true.

Categories die als actionable gelden:
- icp_shift: Klant heeft nu een ander ideaal-profiel dan in de brief staat
- new_pain: Leads/markt brengt een pijnpunt naar boven dat de huidige creatives niet adressen
- new_objection: Sales/setters horen een nieuw bezwaar dat copy moet adresseren
- pricing: Aanbod of tarieven zijn gewijzigd sinds de brief
- scope: Service is uitgebreid/ingekrompen
- client_request: Klant heeft expliciet iets gevraagd (nieuwe angle, copy-refresh, etc.)
- performance_feedback: Klant noemt specifiek dat iets niet werkt of juist heel goed werkt
- satisfaction: Sterke tevredenheid of ontevredenheid die tone of campagne moet beïnvloeden
- other: Iets anders dat Pedro moet doorgeven

ALLEEN JSON output (geen markdown, geen code fences), exact dit format:

{
  "actionable": true|false,
  "severity": "high" | "medium" | "low",
  "summary": "1 zin in NL — kort en concreet, zelfs als actionable=false",
  "changes": [
    {
      "category": "icp_shift" | "new_pain" | "new_objection" | "pricing" | "scope" | "client_request" | "performance_feedback" | "satisfaction" | "other",
      "detail": "wat specifiek is veranderd of opgemerkt — citeer concrete zinnen uit transcript indien mogelijk",
      "implication": "wat Pedro/CM concreet moet doen of overwegen"
    }
  ],
  "suggestedAction": "brief_update" | "new_angle" | "creative_refresh" | "copy_refresh" | "lead_form_change" | "client_check_in" | "no_action",
  "reasoning": "2-3 zinnen waarom je deze severity en suggestedAction hebt gekozen — niet voor de UI, wel voor audit/debugging"
}

Belangrijk:
- Als de huidige Pedro brief nog leeg is (zie boven), is actionable per definitie true en suggestedAction "brief_update".
- Wees specifiek in 'detail' — generieke uitspraken zijn waardeloos. Citeer wat de klant of AM letterlijk zei als dat helpt.
- Als de eval geen transcript heeft, baseer je op de samenvatting maar verlaag severity naar max "medium" (minder zekerheid).
- Geen datums of deadlines in output tenzij expliciet in de eval genoemd.
- Tone of voice: direct, Nederlands, geen marketing-fluff.`

  // ── 4. Call Claude ──
  let raw = ""
  try {
    const system = await loadPedroSystemPrompt()
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  } catch (e) {
    console.error("Pedro eval-digest: Claude call failed", e)
    return null
  }

  // ── 5. Parse JSON, normalise to safe shape ──
  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: Partial<EvalDigest>
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    console.error("Pedro eval-digest: invalid JSON", cleaned.slice(0, 300))
    return null
  }

  const digest: EvalDigest = {
    ...NULL_DIGEST,
    ...parsed,
    actionable: Boolean(parsed.actionable),
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
  }

  return {
    digest,
    meta: {
      clientId: meeting.client_id,
      clientName: client.companyName || client.name,
      meetingTitle: meeting.title,
      scheduledAt: meeting.scheduled_at,
    },
  }
}
