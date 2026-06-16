import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getVariantImageBytes } from "@/lib/integrations/pedro-image-storage"
import {
  fetchAdSetTemplate,
  uploadAdImage,
  createAdSet,
  createAdCreative,
  createAd,
  assertWriteScopes,
  summariseTemplate,
} from "@/lib/integrations/meta-write"
import {
  fetchMetaAdDetails,
  fetchCampaignAdSets,
  fetchAdNamesInAccount,
} from "@/lib/integrations/meta"
import { getMaxAdNumberByFormat, formatAdName, type AdFormatHint } from "@/lib/pedro/refresh-naming"
import { logWatchlistAction } from "@/lib/watchlist/log-action"
import { readCache } from "@/lib/cache"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

/**
 * POST /api/pedro/proposals/[refreshId]/[proposalIndex]/push-to-meta
 *  body: { variants: [{ variantId, slotPosition }] }
 *
 * Orchestreert de volledige "Push to Meta" flow voor één proposal:
 *
 *   1. Resolve client + facebook_page_id + ad account
 *   2. Resolve winner uit envelope → campaign_id + adset_id
 *   3. fetchAdSetTemplate(winner.adsetId) → clone-template config
 *   4. Compute fresh sequential ad numbers per (variant × slot) selection
 *      (Photo X | topic, Photo X+1 | topic, …) so multi-slot ships don't collide
 *   5. Generate new ad set name (LF | Open targeting | DD/MM)
 *   6. createAdSet(campaign, name, template) → ad_set_id (PAUSED)
 *   7. Per selected (variant × slot):
 *      a. read image bytes from Supabase Storage
 *      b. uploadAdImage → image_hash
 *      c. createAdCreative(image_hash + body + title + page + cta + link)
 *      d. createAd(ad_set, creative, canonical name) → ad_id (PAUSED)
 *      e. stamp meta_* columns op pedro_variant_images row
 *   8. Return per-slot result (succes/fout) zodat de UI per-slot badges toont
 *
 * Partial failure handling: als 2 van 3 ads succes en 1 mislukt, returnt
 * de endpoint 207-equivalent (200 met `partialFailure: true`) zodat de
 * UI kan tonen wat wel/niet ging. Echte hard fails (token scope, page
 * id, ad set create) returnen wel non-2xx.
 *
 * Roy 2026-06-09.
 */

export const maxDuration = 180

type Body = {
  variants?: Array<{ variantId?: string; slotPosition?: number }>
  /** Optional override for the new ad set's name. Default = NT |
   *  {{angle from proposal.preserve.angle}}. CM types this in the
   *  modal before launch so they can match it to the headline/angle
   *  the variants share. Roy 2026-06-10. */
  adsetName?: string
  /** Optional override for the new ad set's daily budget in EUROS
   *  (we convert to cents before sending to Meta). When omitted we
   *  inherit the winner's adset budget (default behavior). */
  dailyBudgetEuros?: number
  /** Roy 2026-06-11: manual template-source override. When the snapshot
   *  path fails (winner ad + ad set both gone from Meta), the CM picks
   *  any ad set from the account via /api/pedro/template-candidates and
   *  we use that as the clone source instead. Skips the snapshot
   *  resolution and uses these IDs directly. */
  overrideTemplate?: {
    adsetId: string
    adsetName?: string
    campaignId: string
    campaignName?: string
    pageId: string
    instagramActorId?: string
    leadGenFormId?: string
    linkUrl?: string
    callToActionType?: string
    templateAdId?: string
    templateAdName?: string
  }
  /** Roy 2026-06-14: inline retry overrides — the CM can tweak these
   *  in the modal after a Meta failure and push again without leaving.
   *  Each is optional; absent = inherit from winner template. */
  /** Wipe all targeting (geo/age/gender/interests/audiences). Let Meta
   *  Advantage+ pick the audience from scratch. Useful when winner's
   *  targeting references a deleted custom audience or expired filter. */
  stripTargeting?: boolean
  /** Override bid_strategy (e.g. "LOWEST_COST_WITHOUT_CAP",
   *  "LOWEST_COST_WITH_BID_CAP", "COST_CAP", "LOWEST_COST_WITH_MIN_ROAS"). */
  bidStrategy?: string
  /** Override optimization_goal (e.g. "OFFSITE_CONVERSIONS",
   *  "LINK_CLICKS", "LEAD_GENERATION", "IMPRESSIONS"). */
  optimizationGoal?: string
  /** Roy 2026-06-15: CM-provided landing page URL. For "Landing page
   *  conversions" winners the Marketing API sometimes returns an empty
   *  linkUrl even when the ad has a real landing page (creative type
   *  variant Meta API doesn't fully expose). When this is set, it wins
   *  over the resolved winnerLive.linkUrl so the new ads route to the
   *  right destination. */
  linkUrl?: string
}

/** Hints we attach to error responses so the modal knows which input
 *  to highlight + what to suggest. Roy 2026-06-14. */
type ParamHint = {
  /** The field the CM can change in the modal to retry.
   *  - `daily_budget` → highlight the budget input
   *  - `adset_name` → highlight the name input
   *  - `targeting` → suggest stripTargeting toggle
   *  - `bid_strategy` → suggest bid strategy dropdown
   *  - `optimization_goal` → suggest optimization goal dropdown */
  field: "daily_budget" | "adset_name" | "targeting" | "bid_strategy" | "optimization_goal"
  /** Optional suggested value (e.g. a budget number Meta hinted at). */
  suggested?: string | number
  /** One-line CM-facing reason ("Daily budget too low — Meta vereist
   *  minimaal €5/dag voor dit accent type"). */
  reason: string
}

/** Extract a ParamHint from a Meta error message + the original payload.
 *  Best-effort pattern match — runs on the verbose Dutch error string
 *  the API builds + the raw Meta `error_user_msg` when available.
 *
 *  Roy 2026-06-14: short-circuit when the actual error is Lead Gen TOS.
 *  Otherwise we'd fire false targeting / bid / optimization hints which
 *  send the CM down the wrong rabbit hole. */
function extractParamHints(rawMessage: string): ParamHint[] {
  const lc = rawMessage.toLowerCase()
  // Lead Gen TOS is its own fix path — no inline override helps.
  if (
    lc.includes("terms of service not accepted") ||
    lc.includes("lead generation terms") ||
    lc.includes("lead ads terms") ||
    lc.includes("leadgen tos")
  ) {
    return []
  }
  // object_story_spec / creative failures are downstream of createAdSet —
  // ad-set override dropdowns won't help. Roy 2026-06-14.
  if (lc.includes("object_story_spec") || lc.includes("object story spec")) {
    return []
  }
  const hints: ParamHint[] = []
  // Budget — Meta usually says "daily budget too low/high" or names a
  // minimum / maximum. Try to extract the number.
  if (
    lc.includes("daily budget") ||
    lc.includes("dagbudget") ||
    lc.includes("minimum daily") ||
    lc.includes("minimum budget")
  ) {
    const euros = rawMessage.match(/€\s*([0-9]+(?:[.,][0-9]+)?)/)?.[1]
    const cents = rawMessage.match(/\b([0-9]+)\s*cents?\b/i)?.[1]
    const usd = rawMessage.match(/\$\s*([0-9]+(?:[.,][0-9]+)?)/)?.[1]
    const suggested =
      euros ?? (cents ? String(Math.ceil(Number(cents) / 100)) : usd) ?? undefined
    hints.push({
      field: "daily_budget",
      suggested,
      reason: lc.includes("too high") || lc.includes("maximum")
        ? `Daily budget te hoog volgens Meta. ${suggested ? `Suggestie: max €${suggested}.` : "Verlaag het bedrag."}`
        : `Daily budget te laag of botst met de campagne. ${suggested ? `Suggestie: minimaal €${suggested}.` : "Verhoog het bedrag of probeer een ander getal."}`,
    })
  }
  // Targeting / audience
  if (
    lc.includes("targeting") ||
    lc.includes("audience") ||
    lc.includes("custom_audiences") ||
    lc.includes("geo_locations") ||
    lc.includes("specs.targeting")
  ) {
    hints.push({
      field: "targeting",
      reason:
        "Winner's targeting is door Meta afgewezen — kan een verlopen custom audience, ontoegankelijke lookalike, of ongeldige geo-target zijn. Probeer 'Targeting strippen' aan zodat Meta Advantage+ de doelgroep kiest.",
    })
  }
  // Bid strategy
  if (lc.includes("bid_strategy") || lc.includes("bidstrategy") || lc.includes("bid strategy")) {
    hints.push({
      field: "bid_strategy",
      reason:
        "Bid strategy is niet (langer) geldig voor deze campagne — kies een andere strategie hieronder.",
    })
  }
  // Optimization goal
  if (
    lc.includes("optimization_goal") ||
    lc.includes("optimization goal") ||
    lc.includes("optimisation goal") ||
    lc.includes("doelstelling") ||
    lc.includes("optimisatie")
  ) {
    hints.push({
      field: "optimization_goal",
      reason:
        "Optimization goal botst met de campagne (objective / destination_type). Kies een andere goal hieronder.",
    })
  }
  // Adset name
  if (
    lc.includes("name") &&
    (lc.includes("too long") || lc.includes("invalid name") || lc.includes("duplicate"))
  ) {
    hints.push({
      field: "adset_name",
      reason: "Ad set name is te lang of conflicteert met een bestaande naam. Pas hem aan.",
    })
  }
  return hints
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ refreshId: string; proposalIndex: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { refreshId, proposalIndex: proposalIndexStr } = await params
  const proposalIndex = parseInt(proposalIndexStr, 10)
  if (!Number.isFinite(proposalIndex) || proposalIndex < 0) {
    return NextResponse.json({ error: "Invalid proposalIndex" }, { status: 400 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const selections = (body.variants ?? [])
    .filter(
      (v): v is { variantId: string; slotPosition: number } =>
        typeof v.variantId === "string" &&
        v.variantId.length > 0 &&
        typeof v.slotPosition === "number" &&
        v.slotPosition >= 0 &&
        v.slotPosition <= 9,
    )
  if (selections.length === 0) {
    return NextResponse.json({ error: "Geen variants geselecteerd" }, { status: 400 })
  }

  // ── 0. Pre-flight: verify the Meta token actually has write scopes.
  // Calls Meta's /debug_token and throws a CM-actionable error before
  // we spin up any of the Meta API calls below. Roy 2026-06-14: the
  // old code blamed scope for any code-200 / code-190 error which
  // could be a totally different cause (page access, ad-account
  // assignment, etc.). This makes the diagnosis authoritative.
  try {
    await assertWriteScopes()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[push-to-meta] scope assertion failed:", message)
    return NextResponse.json(
      { error: message, errorCode: "token_scope" },
      { status: 403 },
    )
  }

  const supabase = await createAdminClient()

  // ── 1. Resolve refresh + client + page + ad account ────────────────
  const { data: refreshRow, error: refreshErr } = await supabase
    .from("pedro_refreshes")
    .select("id, client_id, envelope, saved_to_inbox_event_id")
    .eq("id", refreshId)
    .maybeSingle()
  if (refreshErr) throw refreshErr
  if (!refreshRow) {
    return NextResponse.json({ error: "Refresh not found" }, { status: 404 })
  }

  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, name, meta_ad_account_id")
    .eq("monday_item_id", refreshRow.client_id)
    .maybeSingle()
  if (!clientRow) {
    return NextResponse.json({ error: "Klant niet gevonden in Hub" }, { status: 404 })
  }
  if (!clientRow.meta_ad_account_id) {
    return NextResponse.json(
      { error: "Geen Meta ad account voor deze klant - vul 'm in op het client-info paneel." },
      { status: 400 },
    )
  }
  // Page ID inherits from the winner ad - extracted below from
  // fetchMetaAdDetails. Roy 2026-06-10: override-field removed; winner
  // inheritance turned out to be the right default for every case.

  // ── 2. Resolve winner uit envelope ──────────────────────────────────
  // Roy 2026-06-10 v2: snapshot-first architectuur. Bij refresh-time
  // wordt alle winner-metadata (campaign/adset/page/IG/lead form/link/CTA)
  // in de envelope opgeslagen. Push leest die snapshot ipv een live
  // Meta-lookup, zodat verwijderde winners de flow niet meer breken.
  // Backwards compat: oude refreshes zonder snapshot → val terug op
  // de oude live-lookup pad.
  type WinnerSnapshot = {
    campaignId?: string
    campaignName?: string
    adsetId?: string
    adsetName?: string
    pageId?: string
    instagramActorId?: string
    leadGenFormId?: string
    linkUrl?: string
    callToActionType?: string
  }
  type RefreshEnv = {
    proposals?: Array<{
      basedOnAd?: { adId?: string; adName?: string; snapshot?: WinnerSnapshot }
      preserve?: { angle?: string; hook?: string; format?: string }
      variants?: Array<{ adName?: string; topicLabel?: string }>
    }>
  }
  const envelope = (refreshRow.envelope ?? {}) as RefreshEnv
  const proposal = envelope.proposals?.[proposalIndex]
  if (!proposal?.basedOnAd?.adId) {
    return NextResponse.json(
      { error: "Proposal niet gevonden in envelope (of geen winner ad gekoppeld)." },
      { status: 404 },
    )
  }
  const winnerAdId = proposal.basedOnAd.adId
  const proposalAngle = proposal.preserve?.angle?.trim() ?? ""
  const snapshot = proposal.basedOnAd.snapshot
  const hasCompleteSnapshot =
    !!snapshot?.campaignId &&
    !!snapshot.adsetId &&
    !!snapshot.pageId

  // ── 3. Resolve template source - snapshot-first ─────────────────────
  // Result type: same shape as MetaAdDetail's relevant subset so the
  // rest of the route works uniformly.
  type TemplateSource = {
    adId: string
    adName: string
    adsetId: string
    adsetName: string
    campaignId: string
    campaignName: string
    pageId: string
    instagramActorId: string
    leadGenFormId: string
    linkUrl: string
    callToActionType: string
  }
  let winnerLive: TemplateSource | undefined
  let fallbackInfo: {
    reason: string
    templateAdId: string
    templateAdName: string
    templateAdsetName: string
  } | null = null

  if (body.overrideTemplate?.adsetId && body.overrideTemplate.campaignId && body.overrideTemplate.pageId) {
    // Manual override path - CM picked an ad set in the candidate
    // picker UI when the snapshot was unusable. Use it verbatim;
    // fetchAdSetTemplate below will still pull live budget/targeting
    // from the picked adset.
    const o = body.overrideTemplate
    winnerLive = {
      adId: o.templateAdId ?? winnerAdId,
      adName: o.templateAdName ?? proposal.basedOnAd.adName ?? "",
      adsetId: o.adsetId,
      adsetName: o.adsetName ?? "",
      campaignId: o.campaignId,
      campaignName: o.campaignName ?? "",
      pageId: o.pageId,
      instagramActorId: o.instagramActorId ?? "",
      leadGenFormId: o.leadGenFormId ?? "",
      linkUrl: o.linkUrl ?? "",
      callToActionType: o.callToActionType ?? "",
    }
    fallbackInfo = {
      reason: "Handmatige template-keuze door CM (snapshot was niet bruikbaar).",
      templateAdId: winnerLive.adId,
      templateAdName: winnerLive.adName || "(geen ad)",
      templateAdsetName: winnerLive.adsetName || o.adsetId,
    }
  } else if (hasCompleteSnapshot) {
    // Snapshot path - geen live Meta lookup nodig om de template te
    // resolven. De adset-template (budget/targeting/bid strategy) wordt
    // straks live opgehaald via fetchAdSetTemplate; als die call faalt
    // (= adset verwijderd) doen we de campagne-scoped fallback.
    winnerLive = {
      adId: winnerAdId,
      adName: proposal.basedOnAd.adName ?? "",
      adsetId: snapshot!.adsetId!,
      adsetName: snapshot!.adsetName ?? "",
      campaignId: snapshot!.campaignId!,
      campaignName: snapshot!.campaignName ?? "",
      pageId: snapshot!.pageId!,
      instagramActorId: snapshot!.instagramActorId ?? "",
      leadGenFormId: snapshot!.leadGenFormId ?? "",
      linkUrl: snapshot!.linkUrl ?? "",
      callToActionType: snapshot!.callToActionType ?? "",
    }
  } else {
    // Legacy path - refresh has no snapshot. Same as before: live
    // lookup against last 90d, fall back to most-recent valid ad.
    const end = new Date().toISOString().slice(0, 10)
    const startD = new Date()
    startD.setDate(startD.getDate() - 90)
    const start = startD.toISOString().slice(0, 10)
    const ads = await fetchMetaAdDetails(clientRow.meta_ad_account_id, start, end).catch(() => [])
    const directWinner = ads.find((a) => a.adId === winnerAdId)
    if (directWinner?.campaignId && directWinner?.adsetId && directWinner.pageId) {
      winnerLive = directWinner
    } else {
      const usable = ads
        .filter((a) => a.pageId && a.campaignId && a.adsetId && (a.linkUrl || a.leadGenFormId))
        .sort((a, b) => {
          const aLead = a.leadGenFormId ? 1 : 0
          const bLead = b.leadGenFormId ? 1 : 0
          if (aLead !== bLead) return bLead - aLead
          if (b.spend !== a.spend) return b.spend - a.spend
          return b.impressions - a.impressions
        })
      winnerLive = usable[0]
      if (winnerLive) {
        fallbackInfo = {
          reason:
            "Refresh heeft geen snapshot (oude refresh). Winner ad niet meer in Meta - meest-recente bruikbare ad gebruikt als template.",
          templateAdId: winnerLive.adId,
          templateAdName: winnerLive.adName,
          templateAdsetName: winnerLive.adsetName,
        }
      }
    }
  }

  if (!winnerLive?.campaignId || !winnerLive?.adsetId) {
    return NextResponse.json(
      {
        error:
          "Geen bruikbare template gevonden voor deze refresh. Snapshot ontbreekt én geen recente actieve ad in dit Meta account. Kies handmatig een ad set hieronder om als template te gebruiken.",
        errorCode: "no_template",
      },
      { status: 404 },
    )
  }

  // Roy 2026-06-15: log what we actually resolved from the winner so
  // we can diagnose "empty linkUrl" / "missing CTA" failures from the
  // Vercel logs without guessing.
  console.log(
    `[push-to-meta] winnerLive resolved`,
    `adId=${winnerLive.adId}`,
    `adsetId=${winnerLive.adsetId}`,
    `campaignId=${winnerLive.campaignId}`,
    `pageId=${winnerLive.pageId || "EMPTY"}`,
    `linkUrl=${winnerLive.linkUrl || "EMPTY"}`,
    `callToActionType=${winnerLive.callToActionType || "EMPTY"}`,
    `leadGenFormId=${winnerLive.leadGenFormId || "EMPTY"}`,
    `instagramActorId=${winnerLive.instagramActorId || "EMPTY"}`,
    `cmOverrideLinkUrl=${body.linkUrl || "(none)"}`,
  )

  const pageId = winnerLive.pageId
  if (!pageId) {
    return NextResponse.json(
      {
        error:
          "Template ad heeft geen page_id (geen object_story_spec). Kies een andere refresh.",
      },
      { status: 400 },
    )
  }

  // ── 4. Pull ad set template (budget/targeting/bid strategy) ─────────
  // Try snapshotted adsetId first. If gone (404 from Meta), look up
  // another non-deleted ad set in the SAME campaign - much more stable
  // than falling back to a random ad set elsewhere in the account.
  let adsetTemplate
  let usedCampaignFallback = false
  try {
    adsetTemplate = await fetchAdSetTemplate(winnerLive.adsetId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // 404-ish: ad set was deleted. Try sibling ad sets in same campaign.
    if (/not found|404|does not exist|onbekend|invalid/i.test(msg) && winnerLive.campaignId) {
      try {
        const siblings = await fetchCampaignAdSets(winnerLive.campaignId)
        const alive = siblings.find(
          (s) => s.id !== winnerLive!.adsetId && !/DELETED|ARCHIVED/i.test(s.effectiveStatus),
        )
        if (alive) {
          adsetTemplate = await fetchAdSetTemplate(alive.id)
          usedCampaignFallback = true
          fallbackInfo = {
            reason:
              "Oorspronkelijke ad set niet meer in Meta - andere ad set uit dezelfde campagne gebruikt als template.",
            templateAdId: winnerLive.adId,
            templateAdName: winnerLive.adName,
            templateAdsetName: alive.name,
          }
        } else {
          return NextResponse.json(
            {
              error:
                "Ad set én alle sibling-adsets in deze campagne zijn verwijderd. Kies handmatig een ad set hieronder om als template te gebruiken.",
              errorCode: "no_template",
            },
            { status: 404 },
          )
        }
      } catch (innerE) {
        return NextResponse.json(
          {
            error: `Ad set niet meer beschikbaar in Meta, en campagne-fallback faalde: ${innerE instanceof Error ? innerE.message : "unknown"}`,
          },
          { status: 502 },
        )
      }
    } else {
      return NextResponse.json(
        { error: msg || "fetchAdSetTemplate failed" },
        { status: 502 },
      )
    }
  }
  if (!adsetTemplate) {
    return NextResponse.json(
      { error: "Geen ad set template kunnen ophalen." },
      { status: 502 },
    )
  }
  void usedCampaignFallback // tracked via fallbackInfo

  // Ad set name - CM-supplied override wins. Roy 2026-06-12: de naam
  // moet WEL overschreven worden (niet "- Copy" van de winner) zodat
  // je in Ads Manager direct ziet welke angle/hook Pedro test, niet een
  // duplicate met dezelfde naam. Targeting + audience zijn 1:1
  // gedupliceerd (zie launchTemplate hieronder); alleen de naam krijgt
  // een nieuwe identiteit.
  const sanitizeAdsetName = (s: string): string =>
    s.replace(/\s+/g, " ").trim().slice(0, 200)

  const overrideAdsetName = body.adsetName ? sanitizeAdsetName(body.adsetName) : ""
  let newAdsetName: string
  if (overrideAdsetName) {
    newAdsetName = overrideAdsetName
  } else if (proposalAngle) {
    newAdsetName = proposalAngle.slice(0, 200)
  } else {
    const today = new Date()
    const dd = String(today.getDate()).padStart(2, "0")
    const mm = String(today.getMonth() + 1).padStart(2, "0")
    newAdsetName = `Pedro iteratie - ${dd}/${mm}`
  }

  // Roy 2026-06-12: targeting NIET meer strippen. De winning ad set is
  // winning vanwege deze targeting - die behouden we 1:1 in de duplicate
  // zodat we niet vanaf nul moeten leren op Advantage+. Eerdere NT-flow
  // (stripInterestTargeting + stripPlacementConstraints) is verwijderd.

  // Budget override - CM types daily budget in EUR; Meta wants cents.
  // When omitted, fall back to the winner's daily budget (existing
  // behavior). Minimum sanity: €1/day, max €10000/day.
  let overrideDailyBudget: string | null = null
  if (typeof body.dailyBudgetEuros === "number" && Number.isFinite(body.dailyBudgetEuros)) {
    const eur = Math.max(1, Math.min(10000, body.dailyBudgetEuros))
    overrideDailyBudget = String(Math.round(eur * 100))
  }

  // Build the template we'll actually push. When the CM set a daily
  // budget we ALSO drop lifetime_budget (Meta rejects both at once).
  const launchTemplate = {
    ...adsetTemplate,
    ...(overrideDailyBudget
      ? { dailyBudget: overrideDailyBudget, lifetimeBudget: null }
      : {}),
  }

  // Roy 2026-06-14: inline retry overrides — applied AFTER the budget
  // override so the CM can stack them ("strip targeting AND use this
  // bid strategy AND this budget").
  if (body.stripTargeting === true) {
    launchTemplate.targeting = null
  }
  if (typeof body.bidStrategy === "string" && body.bidStrategy.trim()) {
    launchTemplate.bidStrategy = body.bidStrategy.trim()
  }
  if (typeof body.optimizationGoal === "string" && body.optimizationGoal.trim()) {
    launchTemplate.optimizationGoal = body.optimizationGoal.trim()
  }

  // Roy 2026-06-14: summary of which template fields we actually pulled
  // from Meta. Surfaces in the error response so the modal can suggest
  // a smart retry ("Pedro kon de targeting niet ophalen — kies handmatig
  // een andere ad set") instead of generic "fix bid_strategy" hints.
  const templateSummary = summariseTemplate(winnerLive.adsetId, launchTemplate)

  // ── 5. Create the new ad set (PAUSED) ───────────────────────────────
  let newAdsetId: string
  try {
    const res = await createAdSet({
      adAccountId: clientRow.meta_ad_account_id,
      campaignId: winnerLive.campaignId,
      name: newAdsetName,
      template: launchTemplate,
    })
    newAdsetId = res.adSetId
  } catch (e) {
    const message = e instanceof Error ? e.message : "createAdSet failed"
    // If we couldn't pull the template's targeting/bid/goal from Meta,
    // the "Invalid parameter" complaint is almost certainly a downstream
    // symptom — the modal should offer "pick a different ad set" before
    // the CM fights with bid-strategy/goal dropdowns.
    const templateIncomplete = templateSummary.missingFields.length > 0
    return NextResponse.json(
      {
        error: message,
        // Inline-retry hints so the modal can highlight the matching
        // input + pre-fill suggested values. Roy 2026-06-14.
        paramHints: templateIncomplete ? [] : extractParamHints(message),
        templateSummary,
        templateIncomplete,
        stage: "create_adset",
      },
      { status: 502 },
    )
  }

  // ── 6. Compute ad-name numbering ────────────────────────────────────
  // Use existing ads in the account to determine starting number per
  // format. Each selected slot consumes one number from its format's pool.
  // Roy 2026-06-10 v2: in de snapshot-flow hebben we de adsRaw lijst niet
  // meer in scope (was deel van de legacy live-lookup). Voor numbering
  // doen we nu een lightweight name-only fetch - veel goedkoper dan de
  // volledige fetchMetaAdDetails call die hier voorheen ronddwaalde.
  const allAdNames = await fetchAdNamesInAccount(clientRow.meta_ad_account_id).catch(() => [])
  const maxByFormat = getMaxAdNumberByFormat(allAdNames)
  const nextByFormat: Record<AdFormatHint, number> = {
    Photo: maxByFormat.Photo + 1,
    Video: maxByFormat.Video + 1,
  }

  // ── 7. Load every selected (variant × slot) row in one query ────────
  const variantIds = selections.map((s) => s.variantId)
  const { data: variantRows } = await supabase
    .from("pedro_variants")
    .select(
      "id, format_hint, topic_label, hook, primary_copy_snippet, ad_name, headline, alt_headlines, alt_primary_texts, link_description",
    )
    .in("id", variantIds)
  type VariantRow = {
    id: string
    format_hint: "Photo" | "Video"
    topic_label: string | null
    hook: string | null
    primary_copy_snippet: string | null
    ad_name: string | null
    headline: string | null
    alt_headlines: string[] | null
    alt_primary_texts: string[] | null
    link_description: string | null
  }
  const variantById = new Map<string, VariantRow>()
  for (const v of (variantRows ?? []) as VariantRow[]) variantById.set(v.id, v)

  const { data: imageRows } = await supabase
    .from("pedro_variant_images")
    .select("variant_id, position, storage_path, provider")
    .in("variant_id", variantIds)
  type ImageRow = {
    variant_id: string
    position: number
    storage_path: string | null
    provider: string | null
  }
  const imageBySlot = new Map<string, ImageRow>()
  for (const r of (imageRows ?? []) as ImageRow[]) {
    imageBySlot.set(`${r.variant_id}:${r.position}`, r)
  }

  // ── 8. Loop selections, launch per slot ─────────────────────────────
  type SlotResult = {
    variantId: string
    slotPosition: number
    ok: boolean
    metaAdId?: string
    metaAdName?: string
    error?: string
  }
  const results: SlotResult[] = []
  const launchedAt = new Date().toISOString()

  for (const sel of selections) {
    const variant = variantById.get(sel.variantId)
    const slot = imageBySlot.get(`${sel.variantId}:${sel.slotPosition}`)
    if (!variant) {
      results.push({ ...sel, ok: false, error: "Variant niet gevonden in DB" })
      continue
    }
    if (!slot?.storage_path) {
      results.push({ ...sel, ok: false, error: `Slot ${sel.slotPosition} heeft geen image` })
      continue
    }

    // Fresh number per slot, even when shipping multiple slots of same variant.
    const format: AdFormatHint = variant.format_hint
    const number = nextByFormat[format]
    nextByFormat[format] = number + 1
    const adName = formatAdName({
      format,
      number,
      topic: variant.topic_label ?? "",
    })

    try {
      // 8a. Read image bytes
      const bytes = await getVariantImageBytes(slot.storage_path)
      if (!bytes) {
        results.push({ ...sel, ok: false, error: "Image bytes niet opgehaald uit Storage" })
        continue
      }
      // 8b. Upload to Meta
      const { imageHash } = await uploadAdImage({
        adAccountId: clientRow.meta_ad_account_id,
        bytes,
        fileName: `${adName}.jpg`,
      })
      // 8c. Creative - Pedro-generated headline + primary copy +
      // 2 alt headlines + 2 alt primary texts → asset_feed_spec
      // dynamic creative. IG actor + lead form id inherit from winner.
      // url_tags defaults to PEDRO_UTM_TEMPLATE.
      // Fallback: when Pedro skipped the headline field (older refresh)
      // we derive from the hook first-sentence so the launch still works.
      const primaryHeadline =
        (variant.headline?.trim() || "") ||
        (variant.hook ?? "").split(/[.!?]\s/)[0]?.slice(0, 80) ||
        ""
      // Roy 2026-06-16: NO dynamic creative. Push each slot as a single
      // ad with 1 body + 1 title (link_data only, no asset_feed_spec).
      // Variation comes from the 3 slots themselves (different image +
      // angle per slot), not from Meta permuting texts within one ad.
      // Pedro still produces alt_headlines / alt_primary_texts, but we
      // ignore them on the push - they remain available in the proposal
      // for the CM to reference manually if needed.
      const { creativeId } = await createAdCreative({
        adAccountId: clientRow.meta_ad_account_id,
        name: adName,
        pageId,
        imageHash,
        body: variant.primary_copy_snippet ?? "",
        title: primaryHeadline || undefined,
        description: variant.link_description?.trim() || undefined,
        // Inherit link + CTA from winner when available - same destination
        // so UTM tracking keeps working.
        // Roy 2026-06-15: previously fell back to bare "https://www.facebook.com"
        // which Meta rejected for landing-page conversion ads. Now:
        // (1) CM-supplied body.linkUrl wins (modal input);
        // (2) else use winnerLive.linkUrl from the resolved source ad;
        // (3) else leave EMPTY so createAdCreative's lead-gen-aware
        //     fallback (Page Facebook URL) decides whether to use a
        //     placeholder or surface the error. The bare facebook.com
        //     hardcode is gone.
        linkUrl:
          (body.linkUrl && body.linkUrl.trim().length > 0
            ? body.linkUrl.trim()
            : winnerLive.linkUrl) || "",
        callToActionType: winnerLive.callToActionType || "LEARN_MORE",
        // Inherit IG actor + lead-gen form from winner - keeps the new
        // ad on the same IG account and (for ON_AD lead-form ads) the
        // same instant form. Roy 2026-06-10.
        instagramActorId: winnerLive.instagramActorId || undefined,
        leadGenFormId: winnerLive.leadGenFormId || undefined,
      })
      // 8d. Ad
      const { adId } = await createAd({
        adAccountId: clientRow.meta_ad_account_id,
        adSetId: newAdsetId,
        name: adName,
        creativeId,
      })
      // 8e. Stamp DB
      await supabase
        .from("pedro_variant_images")
        .update({
          meta_ad_id: adId,
          meta_ad_set_id: newAdsetId,
          meta_ad_launched_at: launchedAt,
          meta_ad_name: adName,
          meta_launch_error: null,
        })
        .eq("variant_id", sel.variantId)
        .eq("position", sel.slotPosition)

      results.push({
        ...sel,
        ok: true,
        metaAdId: adId,
        metaAdName: adName,
      })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Launch mislukt"
      // Persist the error per-slot so retries / debug surfaces have it.
      await supabase
        .from("pedro_variant_images")
        .update({
          meta_launch_error: errMsg,
          meta_ad_name: adName,
        })
        .eq("variant_id", sel.variantId)
        .eq("position", sel.slotPosition)
      results.push({ ...sel, ok: false, error: errMsg })
    }
  }

  const successCount = results.filter((r) => r.ok).length

  // ── 9. Auto-log to Watch List ──────────────────────────────────────
  // When at least one variant landed live in Meta, this counts as a
  // creative-iteration action on the client. Move the client to
  // Watchlist "in review" + send the AM an Update so they know the
  // campaign just got new creatives. Best-effort: a logging failure
  // never fails the user-facing push response (the creatives are
  // already in Meta - that's the work done).
  if (successCount > 0) {
    try {
      const kpiCache = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? {}
      const kpi = kpiCache[refreshRow.client_id]
      const successfulVariantSummaries = results
        .filter((r) => r.ok && r.metaAdName)
        .map((r) => r.metaAdName)
        .slice(0, 3)
      const sourceAdName = proposal.basedOnAd?.adName?.trim() || "winner"
      const angle = proposalAngle || "—"
      const actionTextParts: string[] = []
      actionTextParts.push(
        `Pushed ${successCount} new creative variant(s) live via Pedro (angle: ${angle}).`,
      )
      if (successfulVariantSummaries.length > 0) {
        actionTextParts.push(
          `New ad${successfulVariantSummaries.length > 1 ? "s" : ""}: ${successfulVariantSummaries.join(", ")}.`,
        )
      }
      actionTextParts.push(`Source ad: ${sourceAdName}. New ad set: ${newAdsetName} (paused).`)
      const actionText = actionTextParts.join(" ").slice(0, 1900)

      // Pedro creative iterations need 5d to get past Meta's learning
      // phase + accumulate enough leads to compare CPL fairly. Manual
      // mark-done defaults to 3d; Pedro overrides to 5d.
      const PEDRO_REVIEW_DAYS = 5

      const logResult = await logWatchlistAction({
        supabase,
        mondayItemId: refreshRow.client_id,
        clientName: clientRow.name,
        // accountManagerName omitted - helper reads monday_boards cache
        // to look it up. Avoids a per-push Monday API call.
        actionCategory: "creative",
        actionText,
        reviewDays: PEDRO_REVIEW_DAYS,
        kpiSnapshot: kpi
          ? {
              adSpend: kpi.adSpend ?? null,
              leads: kpi.leads ?? null,
              cpl: kpi.cpl ?? null,
              prevCpl: kpi.prevCpl ?? null,
            }
          : null,
        insightAtTime: `Pedro push-to-Meta (refresh ${refreshId.slice(0, 8)})`,
        createdByUserId: session.user.id,
        // If save-to-inbox already notified the AM about this refresh,
        // link the audit row to that existing event instead of writing
        // a duplicate inbox Update.
        existingInboxEventId: refreshRow.saved_to_inbox_event_id ?? null,
        inboxSourceRefExtras: {
          from: "pedro_push_to_meta",
          pedro_refresh_id: refreshId,
          proposal_index: proposalIndex,
          new_ad_set_id: newAdsetId,
          success_count: successCount,
        },
      })

      if (!logResult.ok) {
        console.error(
          "[push-to-meta] watchlist action log failed (non-fatal):",
          logResult.error,
        )
      }
    } catch (e) {
      console.error(
        "[push-to-meta] watchlist action log threw (non-fatal):",
        e instanceof Error ? e.message : e,
      )
    }
  }

  return NextResponse.json({
    refreshId,
    proposalIndex,
    adAccountId: clientRow.meta_ad_account_id,
    campaignId: winnerLive.campaignId,
    adSetId: newAdsetId,
    adSetName: newAdsetName,
    adsManagerUrl: `https://www.facebook.com/adsmanager/manage/adsets?act=${clientRow.meta_ad_account_id.replace(
      /^act_/,
      "",
    )}&selected_adset_ids=${newAdsetId}`,
    successCount,
    totalCount: results.length,
    partialFailure: successCount > 0 && successCount < results.length,
    results,
    // Roy 2026-06-10: wanneer de winner ad uit Meta is verdwenen vallen
    // we terug op de meest-recente bruikbare ad in het account als
    // template. UI toont een amber banner zodat de CM weet dat dit is
    // gebeurd en in Ads Manager kan verifiëren dat de campagne klopt.
    fallback: fallbackInfo,
  })
}
