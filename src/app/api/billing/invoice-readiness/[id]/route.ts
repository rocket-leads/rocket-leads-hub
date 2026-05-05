import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { readCache, writeCache } from "@/lib/cache"
import { fetchItemUpdates, type ItemUpdate, type MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"

const anthropic = new Anthropic()

/**
 * Per-client AI verdict on whether finance should send the next invoice today.
 *
 * Inputs the model considers (cheap/fast Haiku call):
 *   - Recent Monday updates on the client board item (the team's notes /
 *     conversations *about* the client over the last ~21 days). Tone of those
 *     updates is the strongest signal: "klant wil pauzeren", "stuur factuur
 *     niet voor X", "wacht op nieuwe creatives", etc.
 *   - Current Stripe payment state (paid up / open / overdue + outstanding €).
 *     If the client already has unpaid invoices, finance probably wants to
 *     chase those before sending another.
 *   - Campaign status (live / on_hold) + cycle/invoice dates.
 *
 * Verdict shape:
 *   {
 *     verdict: "send" | "check" | "hold",
 *     confidence: 0..100,            // model's certainty
 *     reason: string,                 // 1 sentence, in NL when source is NL
 *     updates: [{ text, createdAt }], // raw updates surfaced inline
 *     computedAt: ISO timestamp,
 *   }
 *
 * Caching: keyed under the `invoice_readiness` cache (a Record<mondayItemId,
 * Verdict>). Each entry stores the latest update date used as input — if the
 * Monday item has a newer update we recompute, otherwise we serve the cached
 * verdict. Pass `?refresh=1` to force a fresh compute regardless.
 */

type AiVerdict = "send" | "check" | "hold"

export type InvoiceReadiness = {
  verdict: AiVerdict
  confidence: number
  reason: string
  updates: ItemUpdate[]
  /** Most recent update date used as input — drives the cache invalidation. */
  lastUpdateAt: string | null
  computedAt: string
}

const CACHE_KEY = "invoice_readiness"
const UPDATE_LOOKBACK_DAYS = 21
const HARD_TTL_MS = 24 * 60 * 60 * 1000 // 24h fallback even when no updates land

async function readMap(): Promise<Record<string, InvoiceReadiness>> {
  return (await readCache<Record<string, InvoiceReadiness>>(CACHE_KEY)) ?? {}
}

async function writeMap(map: Record<string, InvoiceReadiness>): Promise<void> {
  await writeCache(CACHE_KEY, map)
}

const SYSTEM_PROMPT = `Je beoordeelt of een Nederlandstalig marketingbureau (Rocket Leads) vandaag een factuur naar een klant kan sturen.

Output ALTIJD pure JSON in deze exacte vorm:
{ "verdict": "send" | "check" | "hold", "confidence": 0-100, "reason": "<korte zin in NL>" }

DEFAULT POSITIE: "send". De klant staat al in de billing-lijst omdat status = live (of on hold) en de invoice date is bereikt. Tenzij iets in de updates een echte blokkade aangeeft, is "send" het juiste antwoord met hoge confidence (90+).

VERDICT-DEFINITIES:
- "send" — geen blokkades. Status loopt, geen explicit "wacht met factureren" / "pauzeer" / "stop" in de recente updates, geen serieuze openstaande facturen die eerst gechased moeten worden. DIT IS DE STANDAARD. Confidence ≥85 is normaal.
- "check" — finance moet even kijken voor versturen, niet auto-cancelen:
    • Klant heeft expliciet een vraag/twijfel uitgesproken die nog open lijkt
    • 1 openstaande factuur die mogelijk eerst betaald moet worden
    • Recente onduidelijkheid in updates over of de campagne wel/niet doorloopt
    • Update gaf aan "factureer pas na X" en X is nog onduidelijk
- "hold" — DUIDELIJK signaal om NIET te factureren:
    • Update zegt expliciet "wacht met factureren" / "stuur deze factuur niet" / "pauze tot ..."
    • Campagne is gestopt of geannuleerd in een recente update
    • Meerdere overdue facturen openstaand (escalatie eerst)
    • Klant wil opzeggen / heeft opgezegd

INFERENCE-VOORBEELDEN (gebruik dit redeneerpatroon):
1. Status = live, invoice date is vandaag, geen updates in 21 dagen → SEND, confidence 95.
2. Recentste update (2 weken geleden, door account manager): "Campagne gaat 16 april weer live, mag dan ook gefactureerd worden" — vandaag is 16 mei → SEND, confidence 95. De voorwaarde is gerealiseerd, geen latere blokkades.
3. Recentste update (gisteren, door account manager): "Klant wil eerst evaluatie voor we factureren" → HOLD of CHECK afhankelijk van of er een datum is.
4. Recentste update (door Arno, finance): "Wacht met deze factuur tot na de pauze" en geen latere update → HOLD.
5. Status = on hold maar update van vorige week zegt "klant doet weer mee per 1 mei" en datum is voorbij → SEND of CHECK.

AUTHOR-WEGING: Updates van Arno (Finance) over factureren wegen extra zwaar — direct van de factureerder. Updates van account managers (Roel, Danny, Ankie, Mike, etc.) over campagnestatus wegen zwaar voor live/pauze beslissingen. Updates die enkel intern overleg zijn (zonder concreet besluit) zijn lichter.

VRAAG VAN TIJD: Vergelijk update-data met de meegegeven HUIDIGE DATUM. Een instructie van een maand geleden ("wacht tot 1 mei") is achterhaald als 1 mei al voorbij is en er geen tegenbericht is.

CONFIDENCE: hoge confidence (90+) wanneer er een eenduidig signaal is — incl. "geen updates, status live" (default send). Verlaag alleen bij echte ambiguïteit.

REASON: één korte concrete zin (max ~16 woorden), Nederlands. Vermeld de aanleiding én eventueel auteur ("Arno schreef 12 apr: wacht na pauze — nog geen tegenbericht", "Geen updates afgelopen 21d, status live", "Roel meldde 16 apr dat campagne weer draait, geen latere blokkades"). GEEN inleiding, GEEN puntkomma's, geen quotes.

Geen prose buiten de JSON.`

async function classify(input: {
  client: { name: string; status: string }
  updates: ItemUpdate[]
  stripe: BillingSummary | null
  cycleStartDate: string | null
  nextInvoiceDate: string | null
}): Promise<{ verdict: AiVerdict; confidence: number; reason: string }> {
  const updatesBlock =
    input.updates.length > 0
      ? input.updates
          .slice(0, 15)
          .map((u, i) => {
            const author = u.creatorName || "Onbekende auteur"
            const recencyTag = i === 0 ? " · MEEST RECENTE" : ""
            return `[${u.createdAt}] ${author}${recencyTag}\n${u.text}`
          })
          .join("\n---\n")
      : "(geen updates in de afgelopen 21 dagen)"

  const stripeBlock = input.stripe
    ? `status=${input.stripe.status} · outstanding=€${input.stripe.outstanding.toFixed(2)}`
    : "geen Stripe customer gekoppeld"

  // Today's date in YYYY-MM-DD so the model can correctly judge whether a
  // dated instruction in the updates ("wacht tot 1 mei") is still active or
  // already past — matters most for the "campaign goes live again on X" path.
  const today = new Date().toISOString().slice(0, 10)

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            `HUIDIGE DATUM: ${today}`,
            `KLANT: ${input.client.name} (status: ${input.client.status})`,
            `CYCLE START: ${input.cycleStartDate ?? "—"}  ·  INVOICE DATE: ${input.nextInvoiceDate ?? "—"}`,
            `STRIPE: ${stripeBlock}`,
            "",
            "RECENTE MONDAY-UPDATES (nieuwste eerst, met auteur):",
            updatesBlock,
            "",
            "Geef alleen de JSON terug.",
          ].join("\n"),
        },
      ],
    })

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { verdict: "check", confidence: 50, reason: "Klassifier gaf geen geldige JSON terug" }
    }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<{ verdict: AiVerdict; confidence: number; reason: string }>
    const verdict: AiVerdict =
      parsed.verdict === "send" || parsed.verdict === "hold" ? parsed.verdict : "check"
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 50
    const reason = (parsed.reason ?? "").toString().trim() || "Geen toelichting"
    return { verdict, confidence, reason }
  } catch (e) {
    console.error("Invoice readiness classify failed:", e instanceof Error ? e.message : e)
    return { verdict: "check", confidence: 30, reason: "AI-check kon niet draaien — handmatig checken" }
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const refresh = req.nextUrl.searchParams.get("refresh") === "1"

  // Resolve the basic client context from the Monday cache. Cheap; the cache is
  // refreshed every 30 min by cron + on-demand by the Sync from Monday button.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const all = cached ? [...cached.onboarding, ...cached.current] : []
  const client = all.find((c) => c.mondayItemId === mondayItemId)
  if (!client) {
    return NextResponse.json({ error: "Client not in Monday cache" }, { status: 404 })
  }

  // Fetch Monday updates fresh — these change frequently and drive the
  // verdict, so we don't cache the *raw* updates beyond the call.
  const updates = await fetchItemUpdates(mondayItemId, UPDATE_LOOKBACK_DAYS)
  const lastUpdateAt = updates[0]?.createdAt ?? null

  // Cache lookup. Skip when ?refresh=1, or when a newer update has landed
  // since the cached verdict was computed, or when the cache is older than
  // the hard TTL (covers cases where Stripe state changed without any
  // Monday update).
  const map = await readMap()
  const existing = map[mondayItemId]
  const cacheStale =
    !existing ||
    (lastUpdateAt && existing.lastUpdateAt !== lastUpdateAt) ||
    Date.now() - new Date(existing.computedAt).getTime() > HARD_TTL_MS
  if (!refresh && !cacheStale && existing) {
    return NextResponse.json({ ...existing, updates, cached: true })
  }

  const billingCache = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
  const stripe = client.stripeCustomerId ? billingCache[client.stripeCustomerId] ?? null : null

  const result = await classify({
    client: { name: client.name, status: client.campaignStatus },
    updates,
    stripe,
    cycleStartDate: client.cycleStartDate || null,
    nextInvoiceDate: client.nextInvoiceDate || null,
  })

  const readiness: InvoiceReadiness = {
    ...result,
    updates,
    lastUpdateAt,
    computedAt: new Date().toISOString(),
  }
  map[mondayItemId] = readiness
  await writeMap(map)

  return NextResponse.json({ ...readiness, cached: false })
}
