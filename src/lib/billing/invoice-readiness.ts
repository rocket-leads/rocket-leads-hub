import Anthropic from "@anthropic-ai/sdk"
import { readCache, writeCache } from "@/lib/cache"
import { fetchItemUpdates, type ItemUpdate, type MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"

const anthropic = new Anthropic()

export type AiVerdict = "send" | "check" | "hold" | "error"

export type InvoiceReadiness = {
  verdict: AiVerdict
  confidence: number
  reason: string
  updates: ItemUpdate[]
  /** Most recent update date used as input - drives cache invalidation. */
  lastUpdateAt: string | null
  computedAt: string
}

export const READINESS_CACHE_KEY = "invoice_readiness"
export const UPDATE_LOOKBACK_DAYS = 21
export const HARD_TTL_MS = 24 * 60 * 60 * 1000

export async function readReadinessMap(): Promise<Record<string, InvoiceReadiness>> {
  const raw = (await readCache<Record<string, InvoiceReadiness>>(READINESS_CACHE_KEY)) ?? {}
  // Legacy entries (pre-error-verdict) used verdict="check" + confidence=30
  // for failed AI calls - promote them to the new "error" verdict at read
  // time so the UI doesn't keep showing fake low-confidence verdicts until
  // the cron repopulates the cache.
  for (const id in raw) {
    const r = raw[id]
    if (
      r.verdict === "check" &&
      r.confidence <= 30 &&
      r.reason.startsWith("AI-check kon niet draaien")
    ) {
      raw[id] = { ...r, verdict: "error", confidence: 0 }
    }
  }
  return raw
}

export async function writeReadinessMap(map: Record<string, InvoiceReadiness>): Promise<void> {
  await writeCache(READINESS_CACHE_KEY, map)
}

const SYSTEM_PROMPT = `Je beoordeelt of een Nederlandstalig marketingbureau (Rocket Leads) vandaag een factuur naar een klant kan sturen.

Output ALTIJD pure JSON in deze exacte vorm:
{ "verdict": "send" | "check" | "hold", "confidence": 0-100, "reason": "<korte zin in NL>" }

DEFAULT POSITIE: "send". De klant staat al in de billing-lijst omdat status = live (of on hold) en de invoice date is bereikt. Tenzij iets in de updates een echte blokkade aangeeft, is "send" het juiste antwoord met hoge confidence (90+).

VERDICT-DEFINITIES:
- "send" - geen blokkades. Status loopt, geen explicit "wacht met factureren" / "pauzeer" / "stop" in de recente updates, geen serieuze openstaande facturen die eerst gechased moeten worden. DIT IS DE STANDAARD. Confidence ≥85 is normaal.
- "check" - finance moet even kijken voor versturen, niet auto-cancelen:
    • Klant heeft expliciet een vraag/twijfel uitgesproken die nog open lijkt
    • 1 openstaande factuur die mogelijk eerst betaald moet worden
    • Recente onduidelijkheid in updates over of de campagne wel/niet doorloopt
    • Update gaf aan "factureer pas na X" en X is nog onduidelijk
- "hold" - DUIDELIJK signaal om NIET te factureren:
    • Update zegt expliciet "wacht met factureren" / "stuur deze factuur niet" / "pauze tot ..."
    • Campagne is gestopt of geannuleerd in een recente update
    • Meerdere overdue facturen openstaand (escalatie eerst)
    • Klant wil opzeggen / heeft opgezegd

INFERENCE-VOORBEELDEN (gebruik dit redeneerpatroon):
1. Status = live, invoice date is vandaag, geen updates in 21 dagen → SEND, confidence 95.
2. Recentste update (2 weken geleden, door account manager): "Campagne gaat 16 april weer live, mag dan ook gefactureerd worden" - vandaag is 16 mei → SEND, confidence 95. De voorwaarde is gerealiseerd, geen latere blokkades.
3. Recentste update (gisteren, door account manager): "Klant wil eerst evaluatie voor we factureren" → HOLD of CHECK afhankelijk van of er een datum is.
4. Recentste update (door Arno, finance): "Wacht met deze factuur tot na de pauze" en geen latere update → HOLD.
5. Status = on hold maar update van vorige week zegt "klant doet weer mee per 1 mei" en datum is voorbij → SEND of CHECK.

AUTHOR-WEGING: Updates van Arno (Finance) over factureren wegen extra zwaar - direct van de factureerder. Updates van account managers (Roel, Danny, Ankie, Mike, etc.) over campagnestatus wegen zwaar voor live/pauze beslissingen. Updates die enkel intern overleg zijn (zonder concreet besluit) zijn lichter.

VRAAG VAN TIJD: Vergelijk update-data met de meegegeven HUIDIGE DATUM. Een instructie van een maand geleden ("wacht tot 1 mei") is achterhaald als 1 mei al voorbij is en er geen tegenbericht is.

CONFIDENCE: hoge confidence (90+) wanneer er een eenduidig signaal is - incl. "geen updates, status live" (default send). Verlaag alleen bij echte ambiguïteit.

REASON: één korte concrete zin (max ~16 woorden), Nederlands. Vermeld de aanleiding én eventueel auteur ("Arno schreef 12 apr: wacht na pauze - nog geen tegenbericht", "Geen updates afgelopen 21d, status live", "Roel meldde 16 apr dat campagne weer draait, geen latere blokkades"). GEEN inleiding, GEEN puntkomma's, geen quotes.

Geen prose buiten de JSON.`

export async function classifyInvoiceReadiness(input: {
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
            `CYCLE START: ${input.cycleStartDate ?? "-"}  ·  INVOICE DATE: ${input.nextInvoiceDate ?? "-"}`,
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
      console.error("Invoice readiness classify: model returned non-JSON output:", text.slice(0, 200))
      return { verdict: "error", confidence: 0, reason: "Model gaf geen geldige JSON terug - opnieuw proberen" }
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
    return { verdict: "error", confidence: 0, reason: "AI-check kon niet draaien - opnieuw proberen" }
  }
}

/**
 * End-to-end compute of one client's readiness: pulls Monday updates, looks up
 * the Stripe summary, classifies, returns the entry. Caller is responsible for
 * persisting it into the cache map.
 */
export async function computeReadinessForClient(client: MondayClient): Promise<InvoiceReadiness> {
  const updates = await fetchItemUpdates(client.mondayItemId, UPDATE_LOOKBACK_DAYS)
  const lastUpdateAt = updates[0]?.createdAt ?? null
  const billingCache = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
  const stripe = client.stripeCustomerId ? billingCache[client.stripeCustomerId] ?? null : null

  const result = await classifyInvoiceReadiness({
    client: { name: client.name, status: client.campaignStatus },
    updates,
    stripe,
    cycleStartDate: client.cycleStartDate || null,
    nextInvoiceDate: client.nextInvoiceDate || null,
  })

  return {
    ...result,
    updates,
    lastUpdateAt,
    computedAt: new Date().toISOString(),
  }
}
