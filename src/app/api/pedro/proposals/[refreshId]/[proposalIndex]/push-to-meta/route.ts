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
  stripInterestTargeting,
} from "@/lib/integrations/meta-write"
import { fetchMetaAdDetails } from "@/lib/integrations/meta"
import { getMaxAdNumberByFormat, formatAdName, type AdFormatHint } from "@/lib/pedro/refresh-naming"

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
    .select("id, client_id, envelope")
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
      { error: "Geen Meta ad account voor deze klant — vul 'm in op het client-info paneel." },
      { status: 400 },
    )
  }
  // Page ID inherits from the winner ad — extracted below from
  // fetchMetaAdDetails. Roy 2026-06-10: override-field removed; winner
  // inheritance turned out to be the right default for every case.

  // ── 2. Resolve winner uit envelope ──────────────────────────────────
  type RefreshEnv = {
    proposals?: Array<{
      basedOnAd?: { adId?: string; adName?: string }
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

  // ── 3. Look up winner's parent campaign + ad set ────────────────────
  const end = new Date().toISOString().slice(0, 10)
  const startD = new Date()
  startD.setDate(startD.getDate() - 90)
  const start = startD.toISOString().slice(0, 10)
  const ads = await fetchMetaAdDetails(clientRow.meta_ad_account_id, start, end).catch(() => [])
  const winnerLive = ads.find((a) => a.adId === winnerAdId)
  if (!winnerLive?.campaignId || !winnerLive?.adsetId) {
    return NextResponse.json(
      {
        error:
          "Winner ad niet meer gevonden in Meta (laatste 90d). Mogelijk verwijderd; kies een andere refresh.",
      },
      { status: 404 },
    )
  }

  // Page id = winner's page (zelfde page = zelfde pixel + UTM-consistency).
  // Roy 2026-06-10: override-pad uitgezet; winner inheritance werkt voor
  // alle cases zonder handmatige config.
  const pageId = winnerLive.pageId
  if (!pageId) {
    return NextResponse.json(
      {
        error:
          "Winner ad heeft geen page_id in object_story_spec — gebeurt bij sommige dynamic-creative winners. Kies een andere refresh of pak een andere winning ad als basis.",
      },
      { status: 400 },
    )
  }

  // ── 4. Pull ad set template + generate new ad set name ─────────────
  let adsetTemplate
  try {
    adsetTemplate = await fetchAdSetTemplate(winnerLive.adsetId)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetchAdSetTemplate failed" },
      { status: 502 },
    )
  }

  // Ad set name — CM-supplied override wins. Default follows Roy's
  // 2026-06-10 NT convention: `NT | {{angle}}`. Falls back to legacy
  // "LF | Open targeting | DD/MM" only when neither override nor angle
  // is available (e.g. older refreshes with no preserve.angle).
  const sanitizeAdsetName = (s: string): string =>
    s.replace(/\s+/g, " ").trim().slice(0, 200)

  const overrideAdsetName = body.adsetName ? sanitizeAdsetName(body.adsetName) : ""
  let newAdsetName: string
  if (overrideAdsetName) {
    newAdsetName = overrideAdsetName
  } else if (proposalAngle) {
    newAdsetName = `NT | ${proposalAngle}`.slice(0, 200)
  } else {
    const today = new Date()
    const dd = String(today.getDate()).padStart(2, "0")
    const mm = String(today.getMonth() + 1).padStart(2, "0")
    newAdsetName = `NT | Open targeting | ${dd}/${mm}`
  }

  // Strip ALL interest-based targeting from the cloned template per
  // Roy 2026-06-10. Geo/age/gender/platforms/locale stay; interests,
  // behaviors, custom audiences, demographics get wiped. Result: same
  // audience structure as the winner, "no targeting" inside it.
  const strippedTargeting = stripInterestTargeting(adsetTemplate.targeting)

  // Budget override — CM types daily budget in EUR; Meta wants cents.
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
    targeting: strippedTargeting,
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
  const allAdNames = ads.map((a) => a.adName).filter((n): n is string => !!n)
  const maxByFormat = getMaxAdNumberByFormat(allAdNames)
  const nextByFormat: Record<AdFormatHint, number> = {
    Photo: maxByFormat.Photo + 1,
    Video: maxByFormat.Video + 1,
  }

  // ── 7. Load every selected (variant × slot) row in one query ────────
  const variantIds = selections.map((s) => s.variantId)
  const { data: variantRows } = await supabase
    .from("pedro_variants")
    .select("id, format_hint, topic_label, hook, primary_copy_snippet, ad_name")
    .in("id", variantIds)
  type VariantRow = {
    id: string
    format_hint: "Photo" | "Video"
    topic_label: string | null
    hook: string | null
    primary_copy_snippet: string | null
    ad_name: string | null
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
      // 8c. Creative — title = first sentence of hook, body = primary copy
      const title = (variant.hook ?? "").split(/[.!?]\s/)[0]?.slice(0, 80) ?? ""
      const { creativeId } = await createAdCreative({
        adAccountId: clientRow.meta_ad_account_id,
        name: adName,
        pageId,
        imageHash,
        body: variant.primary_copy_snippet ?? "",
        title: title || undefined,
        // Inherit link + CTA from winner when available — same destination
        // so UTM tracking keeps working.
        linkUrl: winnerLive.linkUrl || "https://www.facebook.com",
        callToActionType: winnerLive.callToActionType || "LEARN_MORE",
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
  })
}
