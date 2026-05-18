import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import { readCache } from "@/lib/cache"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

/**
 * Client-facing weekly update generator. Pulls the cached 7d KPI summary +
 * previous-7d baseline + Pedro insight, asks Haiku to draft a short message
 * the AM can edit and send to the client over WhatsApp / email.
 *
 * Tone is intentionally NOT Pedro — Pedro is internal CM voice. This output
 * is what the client reads: friendly, plain Dutch (RL operates in NL/BE), no
 * agency jargon, concrete numbers and 1-2 specific next steps.
 *
 * The send step is a separate endpoint — this one just returns the draft +
 * the detected delivery channel so the composer can render both before the
 * AM hits "send".
 */

export type ClientUpdateChannel = "whatsapp" | "email" | "unknown"

export type ClientUpdateResponse = {
  /** Draft message body the AM will edit + send. Always non-empty: when KPI
   *  data is missing we still emit a short "campaign just started / paused"
   *  template the AM can flesh out manually. */
  message: string
  /** Detected delivery channel from Monday's `contact_channel` column. The
   *  composer renders a WhatsApp/Email pill so the AM sees where the message
   *  will land before sending. */
  channel: ClientUpdateChannel
  /** Raw Monday label that drove the channel detection — surfaced so the
   *  composer can show the user the actual configured value when channel
   *  comes back `unknown`. */
  channelLabel: string
  /** Whether a Trengo contact is linked. The composer disables the Send
   *  button when this is false — we can render a draft, but we can't deliver. */
  trengoContactLinked: boolean
}

/** Map Monday's free-text status label to a delivery-channel category. */
function detectChannel(label: string): ClientUpdateChannel {
  const l = label.toLowerCase()
  if (l.includes("whatsapp") || l.includes("wa") || l.includes("app")) return "whatsapp"
  if (l.includes("email") || l.includes("mail")) return "email"
  return "unknown"
}

type KpiCompactSummary = {
  windowDays: number
  spend: number
  leads: number
  cpl: number
  appointments: number
  prevSpend: number
  prevLeads: number
  prevCpl: number
  prevReliable: boolean
}

/** Pull the cached 7d summary out of the same `kpi_summaries` cache the Watch
 *  List + clients overview render from — guarantees the numbers we ship to
 *  the client match what the AM is looking at in the Hub right now. */
async function loadKpi(mondayItemId: string): Promise<KpiCompactSummary | null> {
  const cache = await readCache<Record<string, KpiSummary>>("kpi_summaries")
  const row = cache?.[mondayItemId]
  if (!row) return null
  // We don't store prev-window leads/spend separately in the summary — only
  // the prev-CPL is kept. Pass 0 for the legs we can't reconstruct; the
  // prompt downgrades to a "no baseline" framing in that case anyway.
  return {
    windowDays: 7,
    spend: row.adSpend,
    leads: row.leads,
    cpl: row.cpl,
    appointments: row.appointments,
    prevSpend: 0,
    prevLeads: 0,
    prevCpl: row.prevCpl,
    prevReliable: row.prevPeriodReliable !== false && row.prevCpl > 0,
  }
}

async function loadPedroConclusion(mondayItemId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("pedro_insights")
    .select("body")
    .eq("monday_item_id", mondayItemId)
    .eq("insight_type", "client_pedro")
    .maybeSingle()
  const parsed = parsePedroBody(data?.body ?? null)
  return parsed?.conclusion ?? null
}

function fmtEur(n: number): string {
  return `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`
}

function fmtCpl(n: number): string {
  if (!n) return "—"
  return `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildSystemPrompt(channel: ClientUpdateChannel): string {
  const channelHint =
    channel === "email"
      ? "The client reads this in EMAIL — open with a greeting and end with a sign-off. Keep it tight (under 150 words)."
      : channel === "whatsapp"
        ? "The client reads this on WHATSAPP — short greeting, very tight body (under 90 words), no formal sign-off. Avoid markdown; line breaks are fine."
        : "The client reads this in a chat-style channel — keep it short and personal (under 120 words)."
  return [
    "You are a Rocket Leads account manager writing a short weekly update to your client.",
    "Tone: friendly Dutch, direct, results-focused. No agency jargon, no marketing fluff.",
    "ALWAYS write in Dutch. ALWAYS address the client informally (jij/je).",
    "",
    channelHint,
    "",
    "Structure:",
    "1. One-line greeting (e.g. 'Hé {first name},' — use the provided first name).",
    "2. Numbers paragraph: timeframe, ad spend, leads, cost per lead.",
    "3. Vs previous period: one factual line — beter / stabiel / minder, with the % move. Use the prev-7d baseline you receive.",
    "4. Action points: 1-2 concrete next steps (bullets with `-`). What we'll do this coming week to improve / continue.",
    "5. Sign-off if email channel only. Keep it casual.",
    "",
    "Do NOT promise budget increases. Do NOT invent numbers. If a number is 0 or missing in the input, say it plainly ('nog geen leads deze week') instead of fabricating one.",
    "Output the message body only — no preamble, no markdown headings, no quotes around the output.",
  ].join("\n")
}

function buildUserPrompt(args: {
  clientName: string
  firstName: string
  kpi: KpiCompactSummary | null
  pedroConclusion: string | null
}): string {
  const lines: string[] = []
  lines.push(`CLIENT: ${args.clientName}`)
  if (args.firstName) lines.push(`FIRST NAME: ${args.firstName}`)
  lines.push(`TIMEFRAME: afgelopen 7 dagen`)
  if (args.kpi) {
    lines.push(``)
    lines.push(`THIS WEEK (last 7d):`)
    lines.push(`  ad spend: ${fmtEur(args.kpi.spend)}`)
    lines.push(`  leads: ${args.kpi.leads}`)
    lines.push(`  cost per lead: ${fmtCpl(args.kpi.cpl)}`)
    if (args.kpi.appointments > 0) lines.push(`  afspraken: ${args.kpi.appointments}`)
    if (args.kpi.prevReliable && args.kpi.prevCpl > 0) {
      lines.push(``)
      lines.push(`PREVIOUS 7d (baseline):`)
      lines.push(`  cost per lead: ${fmtCpl(args.kpi.prevCpl)}`)
      const cplPct = ((args.kpi.cpl - args.kpi.prevCpl) / args.kpi.prevCpl) * 100
      lines.push(`  CPL move vs prev 7d: ${cplPct > 0 ? "+" : ""}${cplPct.toFixed(0)}%`)
    } else {
      lines.push(``)
      lines.push(`PREVIOUS 7d: not reliable / no baseline yet — skip the comparison line.`)
    }
  } else {
    lines.push(``)
    lines.push(`THIS WEEK: KPI data missing. Probably means no campaign running yet, or a paused account. Write a short check-in, NOT a number-heavy update.`)
  }
  if (args.pedroConclusion) {
    lines.push(``)
    lines.push(`INTERNAL CONTEXT (do NOT quote verbatim, only use for the action points):`)
    lines.push(`  ${args.pedroConclusion}`)
  }
  lines.push(``)
  lines.push(`Write the message body now. Dutch, informal, ready to send.`)
  return lines.join("\n")
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  try {
    const client = await fetchClientById(mondayItemId)
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 })

    const [kpi, pedroConclusion] = await Promise.all([
      loadKpi(mondayItemId),
      loadPedroConclusion(mondayItemId),
    ])

    const channel = detectChannel(client.contactChannel)
    const systemPrompt = buildSystemPrompt(channel)
    const userPrompt = buildUserPrompt({
      clientName: client.companyName || client.name,
      firstName: client.firstName,
      kpi,
      pedroConclusion,
    })

    const anthropic = new Anthropic()
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })
    const message = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""

    return NextResponse.json<ClientUpdateResponse>({
      message: message || fallbackDraft(client.firstName, channel),
      channel,
      channelLabel: client.contactChannel,
      trengoContactLinked: !!client.trengoContactId,
    })
  } catch (e) {
    console.error(
      "[client-update] generation failed:",
      e instanceof Error ? e.message : e,
    )
    const friendly = classifyAnthropicError(e)
    return NextResponse.json(
      { error: friendly.code, message: friendly.message },
      { status: friendly.status },
    )
  }
}

/**
 * Surface Anthropic SDK errors as actionable UI messages instead of raw JSON.
 * Most commonly: API credit balance depleted on the workspace key — distinct
 * from a claude.ai subscription, which doesn't fund API calls.
 */
function classifyAnthropicError(e: unknown): { code: string; message: string; status: number } {
  const raw = e instanceof Error ? e.message : String(e ?? "")
  if (/credit balance is too low|insufficient_quota|out of credit/i.test(raw)) {
    return {
      code: "anthropic_no_credit",
      message:
        "De Anthropic API key heeft geen credits meer (dit is de console.anthropic.com balance, niet je claude.ai abonnement). Top up via console.anthropic.com → Plans & Billing.",
      status: 402,
    }
  }
  if (/401|invalid_api_key|authentication/i.test(raw)) {
    return {
      code: "anthropic_invalid_key",
      message: "De Anthropic API key is ongeldig of ontbreekt. Check .env.local → ANTHROPIC_API_KEY.",
      status: 401,
    }
  }
  if (/rate.?limit|429/i.test(raw)) {
    return {
      code: "anthropic_rate_limited",
      message: "Anthropic API rate-limited — probeer over een minuut opnieuw.",
      status: 429,
    }
  }
  return {
    code: "generation_failed",
    message: raw.slice(0, 200) || "Failed to generate update",
    status: 500,
  }
}

/** Last-resort skeleton if the Anthropic call returns nothing — the AM still
 *  gets an editable starter rather than a blank dialog. */
function fallbackDraft(firstName: string, channel: ClientUpdateChannel): string {
  const greeting = firstName ? `Hé ${firstName},` : "Hé,"
  const closer =
    channel === "email"
      ? "\n\nLaat me weten of je vragen hebt.\n\nGroet,"
      : ""
  return [
    greeting,
    "",
    "Korte update over je campagne van afgelopen week — ik werk de cijfers nu bij. Stuur ik je direct na.",
    closer,
  ]
    .filter(Boolean)
    .join("\n")
}
