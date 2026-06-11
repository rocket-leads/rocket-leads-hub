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

  // Ad set name - CM-supplied override wins. Default: true Meta-style
  // duplicate of the winner's ad set name with " - Copy" suffix.
  // Roy 2026-06-12: stapte af van de NT-naming + interest strips. De
  // winning ad set is winning vanwege ZIJN targeting; we duplicaten 'm
  // 1:1 zodat nieuwe ads dezelfde audience reach krijgen ipv vanaf nul
  // te moeten leren op Advantage+.
  const sanitizeAdsetName = (s: string): string =>
    s.replace(/\s+/g, " ").trim().slice(0, 200)

  const overrideAdsetName = body.adsetName ? sanitizeAdsetName(body.adsetName) : ""
  let newAdsetName: string
  if (overrideAdsetName) {
    newAdsetName = overrideAdsetName
  } else if (winnerLive.adsetName) {
    newAdsetName = `${winnerLive.adsetName} - Copy`.slice(0, 200)
  } else if (proposalAngle) {
    newAdsetName = `${proposalAngle} - Copy`.slice(0, 200)
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "createAdSet failed" },
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
      const altTitles = Array.isArray(variant.alt_headlines)
        ? variant.alt_headlines.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : []
      const altBodies = Array.isArray(variant.alt_primary_texts)
        ? variant.alt_primary_texts.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : []
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
        linkUrl: winnerLive.linkUrl || "https://www.facebook.com",
        callToActionType: winnerLive.callToActionType || "LEARN_MORE",
        // Inherit IG actor + lead-gen form from winner - keeps the new
        // ad on the same IG account and (for ON_AD lead-form ads) the
        // same instant form. Roy 2026-06-10.
        instagramActorId: winnerLive.instagramActorId || undefined,
        leadGenFormId: winnerLive.leadGenFormId || undefined,
        // Multi-variant copy → asset_feed_spec for dynamic creative.
        altTitles: altTitles.length > 0 ? altTitles : undefined,
        altBodies: altBodies.length > 0 ? altBodies : undefined,
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
