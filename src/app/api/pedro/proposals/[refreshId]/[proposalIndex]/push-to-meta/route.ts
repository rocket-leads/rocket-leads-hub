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
    .select("id, name, meta_ad_account_id, facebook_page_id")
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
  // Page ID resolution happens AFTER we fetch the winner (below) — we
  // default to the page that hosts the winner ad, with the client's
  // facebook_page_id as optional override. Validating here would be
  // premature.

  // ── 2. Resolve winner uit envelope ──────────────────────────────────
  type RefreshEnv = {
    proposals?: Array<{
      basedOnAd?: { adId?: string; adName?: string }
      variants?: Array<{ adName?: string }>
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

  // Page id resolution: winner's page wins (zelfde page = zelfde
  // pixel + UTM-consistency + geen handmatige config). client.facebook_page_id
  // overrides als de CM expliciet een andere page wil — bv. een tweede
  // FB page voor een dochter-merk. Roy 2026-06-09.
  const pageId = clientRow.facebook_page_id?.trim() || winnerLive.pageId || ""
  if (!pageId) {
    return NextResponse.json(
      {
        error:
          "Geen page id gevonden. De winner ad heeft geen page_id (object_story_spec leeg — gebeurt bij sommige dynamic-creative ads). Vul handmatig een Facebook Page ID in op het client-info paneel.",
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

  const today = new Date()
  const dd = String(today.getDate()).padStart(2, "0")
  const mm = String(today.getMonth() + 1).padStart(2, "0")
  // Inherit LF/LP from the winner's ad set name (first token) when present;
  // default LF (Lead Form) per knowledge/campaigns.md.
  const adsetTokenMatch = winnerLive.adsetName?.match(/^\s*(LF|LP)\b/i)
  const lfOrLp = adsetTokenMatch ? adsetTokenMatch[1].toUpperCase() : "LF"
  const newAdsetName = `${lfOrLp} | Open targeting | ${dd}/${mm}`

  // ── 5. Create the new ad set (PAUSED) ───────────────────────────────
  let newAdsetId: string
  try {
    const res = await createAdSet({
      adAccountId: clientRow.meta_ad_account_id,
      campaignId: winnerLive.campaignId,
      name: newAdsetName,
      template: adsetTemplate,
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
