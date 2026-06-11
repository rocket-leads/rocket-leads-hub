import { getToken } from "./meta"

/**
 * Meta write helpers - Push-to-Meta backend.
 *
 * All calls go through the Marketing API and require the token to have
 * `ads_management` scope (the read-only token RL uses for performance
 * reads is NOT sufficient). When the token lacks the scope, Meta
 * returns 403 with a structured error - we translate that into a
 * Dutch user-facing message so the CM knows what to fix.
 *
 * All writes default to status="PAUSED" so the CM never accidentally
 * launches a live spend before they've reviewed in Ads Manager.
 *
 * Roy 2026-06-09.
 */

const META_API_BASE = "https://graph.facebook.com/v20.0"

/** Translate a raw Meta error into something the CM can act on. */
function explainMetaError(message: string, code?: number, subcode?: number): string {
  const lc = message.toLowerCase()
  if (
    code === 200 ||
    code === 190 ||
    lc.includes("ads_management") ||
    lc.includes("permission") ||
    lc.includes("does not have permission")
  ) {
    return `Meta token mist de 'ads_management' scope. Genereer een nieuw token in Meta Business Manager → Business Settings → System Users → jouw user → Generate New Token, en selecteer minimaal 'ads_management' + 'pages_read_engagement'. Plak het nieuwe token in Settings → API Tokens → Meta.`
  }
  if (lc.includes("page_id") && (lc.includes("invalid") || lc.includes("not found"))) {
    return `Facebook Page ID is ongeldig of niet zichtbaar voor dit token. Check de Page ID in Meta Business Manager → Pages, en zorg dat het ingelogde system-user toegang heeft tot deze page.`
  }
  if (subcode === 1487390 || lc.includes("image_hash")) {
    return `Meta accepteerde de image niet (image_hash error). Gebruikelijke oorzaken: foto te klein (<400×400), te groot (>30MB), of formaat is geen JPG/PNG.`
  }
  if (lc.includes("placement") || lc.includes("publisher_platform")) {
    return `Meta kan deze placement-config niet kopiëren van de winner. Push handmatig met aangepaste targeting via Meta Ads Manager.`
  }
  return `Meta API fout: ${message}`
}

type MetaErrorResponse = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

async function postToMeta<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${META_API_BASE}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  })
  const text = await res.text()
  if (!res.ok) {
    let parsed: MetaErrorResponse = {}
    try {
      parsed = JSON.parse(text) as MetaErrorResponse
    } catch {
      /* not JSON */
    }
    const err = parsed.error ?? {}
    const message = explainMetaError(
      err.message ?? text.slice(0, 200) ?? `HTTP ${res.status}`,
      err.code,
      err.error_subcode,
    )
    throw new Error(message)
  }
  return JSON.parse(text) as T
}

async function uploadBinaryToMeta<T>(
  path: string,
  form: FormData,
): Promise<T> {
  const token = await getToken()
  form.append("access_token", token)
  const res = await fetch(`${META_API_BASE}/${path}`, {
    method: "POST",
    body: form,
  })
  const text = await res.text()
  if (!res.ok) {
    let parsed: MetaErrorResponse = {}
    try {
      parsed = JSON.parse(text) as MetaErrorResponse
    } catch {
      /* not JSON */
    }
    const err = parsed.error ?? {}
    const message = explainMetaError(
      err.message ?? text.slice(0, 200) ?? `HTTP ${res.status}`,
      err.code,
      err.error_subcode,
    )
    throw new Error(message)
  }
  return JSON.parse(text) as T
}

/** Account prefix helper - Meta expects "act_<id>" but we sometimes
 *  store the bare numeric id. */
function actId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
}

/**
 * Strip all interest-based targeting from a cloned ad set template,
 * keeping geo/age/gender/platforms/locale/advantage settings intact.
 *
 * Roy 2026-06-10: Pedro launches every new ad set as "NT" (no targeting)
 * - same audience configuration as the winner, but with all interest
 * and behavioral targeting removed. Meta Advantage+ takes over from
 * there. This matches the standard RL play of duplicating a working
 * ad set and wiping the interests so the algorithm gets full freedom.
 *
 * We use a BLOCKLIST (not allowlist) so any new targeting field Meta
 * adds in future API versions doesn't accidentally make it through -
 * if we don't recognise it as safe, we strip it. Safe fields = the
 * structural audience definition (where + who-demographically), not
 * the interest-graph.
 */
const TARGETING_INTEREST_FIELDS = [
  "interests",
  "flexible_spec",
  "behaviors",
  "exclusions",
  "connections",
  "excluded_connections",
  "custom_audiences",
  "excluded_custom_audiences",
  "interest_clusters",
  "interest_clusters_ids",
  "relationship_statuses",
  "education_statuses",
  "education_majors",
  "education_schools",
  "work_employers",
  "work_positions",
  "industries",
  "income",
  "life_events",
  "family_statuses",
  "user_adclusters",
  "app_install_state",
  "college_years",
  "fine_age_levels",
  "moms",
  "office_type",
  "politics",
  "user_event",
  "generation",
  "ethnic_affinity",
  "engagement_specs",
  "excluded_engagement_specs",
] as const

/** Placement-constraint fields stripped to enable Meta's Advantage+
 *  placements. With all of these absent, Meta auto-selects every
 *  placement (FB feed, IG feed, IG stories, Reels, Marketplace,
 *  Audience Network, Messenger). Roy 2026-06-10: "platforms gewoon
 *  op advantage+ dus Meta laten kiezen." */
const TARGETING_PLACEMENT_FIELDS = [
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "audience_network_positions",
  "messenger_positions",
  "device_platforms",
] as const

export function stripInterestTargeting(
  targeting: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!targeting) return null
  const stripped: Record<string, unknown> = { ...targeting }
  for (const f of TARGETING_INTEREST_FIELDS) {
    delete stripped[f]
  }
  return stripped
}

/** Strip placement constraints so Meta defaults to Advantage+
 *  placements. Use AFTER stripInterestTargeting in the same chain. */
export function stripPlacementConstraints(
  targeting: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!targeting) return null
  const stripped: Record<string, unknown> = { ...targeting }
  for (const f of TARGETING_PLACEMENT_FIELDS) {
    delete stripped[f]
  }
  return stripped
}

// ─── Read: ad set config clone-template ─────────────────────────────────

/**
 * Pull the full config of an existing ad set so we can clone it as the
 * basis for a new ad set under the same campaign. The fields we copy:
 * targeting, budget, schedule, optimization goal, billing event,
 * placements. Roy's design: new ad set inherits everything that was
 * already working on the winner's parent set - CM can adjust in Meta
 * Ads Manager before activating if needed.
 */
export type MetaAdSetTemplate = {
  campaignId: string
  targeting: Record<string, unknown> | null
  dailyBudget: string | null
  lifetimeBudget: string | null
  bidStrategy: string | null
  billingEvent: string | null
  optimizationGoal: string | null
  destinationType: string | null
  promotedObject: Record<string, unknown> | null
  startTime: string | null
  endTime: string | null
  publisherPlatforms: string[] | null
}

export async function fetchAdSetTemplate(adsetId: string): Promise<MetaAdSetTemplate> {
  const token = await getToken()
  const fields = [
    "campaign_id",
    "targeting",
    "daily_budget",
    "lifetime_budget",
    "bid_strategy",
    "billing_event",
    "optimization_goal",
    "destination_type",
    "promoted_object",
    "start_time",
    "end_time",
  ].join(",")
  const res = await fetch(
    `${META_API_BASE}/${adsetId}?fields=${fields}&access_token=${token}`,
  )
  const text = await res.text()
  if (!res.ok) {
    let parsed: MetaErrorResponse = {}
    try {
      parsed = JSON.parse(text) as MetaErrorResponse
    } catch {
      /* not JSON */
    }
    const err = parsed.error ?? {}
    throw new Error(
      explainMetaError(
        err.message ?? text.slice(0, 200) ?? `HTTP ${res.status}`,
        err.code,
        err.error_subcode,
      ),
    )
  }
  const json = JSON.parse(text) as {
    campaign_id?: string
    targeting?: Record<string, unknown>
    daily_budget?: string
    lifetime_budget?: string
    bid_strategy?: string
    billing_event?: string
    optimization_goal?: string
    destination_type?: string
    promoted_object?: Record<string, unknown>
    start_time?: string
    end_time?: string
  }

  // Pull publisher_platforms out of targeting for easier UI display;
  // we still send the full targeting object back to Meta when cloning.
  const publisherPlatforms = Array.isArray(
    (json.targeting as { publisher_platforms?: string[] } | undefined)?.publisher_platforms,
  )
    ? ((json.targeting as { publisher_platforms?: string[] }).publisher_platforms ?? null)
    : null

  return {
    campaignId: json.campaign_id ?? "",
    targeting: json.targeting ?? null,
    dailyBudget: json.daily_budget ?? null,
    lifetimeBudget: json.lifetime_budget ?? null,
    bidStrategy: json.bid_strategy ?? null,
    billingEvent: json.billing_event ?? null,
    optimizationGoal: json.optimization_goal ?? null,
    destinationType: json.destination_type ?? null,
    promotedObject: json.promoted_object ?? null,
    startTime: json.start_time ?? null,
    endTime: json.end_time ?? null,
    publisherPlatforms,
  }
}

// ─── Write: image upload ─────────────────────────────────────────────────

/**
 * Upload a JPG/PNG to Meta's ad image library. Returns the image_hash
 * which we then reference in createAdCreative. Meta keeps ad images
 * scoped per ad account.
 */
export async function uploadAdImage(args: {
  adAccountId: string
  bytes: Buffer
  fileName: string
}): Promise<{ imageHash: string }> {
  const form = new FormData()
  // Field name MUST be "filename" per Meta docs even though it's just
  // an internal label here. Allocate a fresh ArrayBuffer copy of the
  // bytes so the BlobPart type (which rejects SharedArrayBuffer-typed
  // views) is satisfied across runtime + tsc.
  const arrayBuffer = new ArrayBuffer(args.bytes.byteLength)
  new Uint8Array(arrayBuffer).set(args.bytes)
  const blob = new Blob([arrayBuffer], { type: "image/jpeg" })
  form.append("filename", blob, args.fileName)
  const json = await uploadBinaryToMeta<{
    images?: Record<string, { hash?: string }>
  }>(`${actId(args.adAccountId)}/adimages`, form)
  // Meta returns { images: { "<filename>": { hash } } }.
  const first = Object.values(json.images ?? {})[0]
  if (!first?.hash) {
    throw new Error("Meta gaf geen image_hash terug - upload mislukt.")
  }
  return { imageHash: first.hash }
}

// ─── Write: ad set ───────────────────────────────────────────────────────

/**
 * Create a new ad set under an existing campaign, cloning targeting +
 * budget + placement from a template. Returns the new ad_set_id.
 * Always created in status="PAUSED" so nothing goes live until the CM
 * activates.
 */
export async function createAdSet(args: {
  adAccountId: string
  campaignId: string
  name: string
  template: MetaAdSetTemplate
}): Promise<{ adSetId: string }> {
  const body: Record<string, unknown> = {
    name: args.name,
    campaign_id: args.campaignId,
    status: "PAUSED",
  }
  // Copy template fields. Meta requires AT LEAST ONE of daily_budget or
  // lifetime_budget when the campaign isn't on CBO; we forward whichever
  // the source ad set had.
  if (args.template.dailyBudget) body.daily_budget = args.template.dailyBudget
  if (args.template.lifetimeBudget) body.lifetime_budget = args.template.lifetimeBudget
  if (args.template.bidStrategy) body.bid_strategy = args.template.bidStrategy
  if (args.template.billingEvent) body.billing_event = args.template.billingEvent
  if (args.template.optimizationGoal) body.optimization_goal = args.template.optimizationGoal
  if (args.template.destinationType) body.destination_type = args.template.destinationType
  if (args.template.promotedObject) body.promoted_object = args.template.promotedObject
  if (args.template.targeting) body.targeting = args.template.targeting
  // Roy 2026-06-10: NIET de winner's start_time / end_time overnemen.
  // De AM stelt het schema in tijdens de pre-launch review in Meta
  // Ads Manager. Inheriten zou de nieuwe ad set met een verlopen
  // einddatum kunnen lanceren, of bij een lange-loop winner met een
  // start ver in het verleden direct activeren.

  const json = await postToMeta<{ id?: string }>(
    `${actId(args.adAccountId)}/adsets`,
    body,
  )
  if (!json.id) throw new Error("Meta gaf geen ad_set id terug.")
  return { adSetId: json.id }
}

// ─── Write: ad creative ──────────────────────────────────────────────────

/** Standard UTM template Pedro stamps on every new creative. Meta
 *  resolves the `{{...}}` macros at impression time so each lead comes
 *  back tagged with the exact campaign / ad set / ad they clicked from.
 *  Critical for the Pedro learning loop: incoming Monday leads tie back
 *  to the variant ad_name without manual config per launch.
 *  Roy 2026-06-10. */
export const PEDRO_UTM_TEMPLATE =
  "utm_source=meta&utm_medium={{adset.name}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}"

/**
 * Create an ad creative. Two modes:
 *
 *   1. Single-copy creative (legacy) - exactly one body + one title,
 *      via `object_story_spec.link_data`. Used when caller doesn't
 *      pass `altBodies` / `altTitles`. Same behavior as pre-2026-06-10.
 *
 *   2. Dynamic-creative spec - Meta's `asset_feed_spec`. Used when the
 *      caller passes 2+ bodies or titles. We pack everything into
 *      `asset_feed_spec` (Meta tests permutations) PLUS a fallback
 *      `object_story_spec` so older endpoints can still serve. Roy
 *      2026-06-10: every Pedro variant ships with 3 headlines + 3
 *      primary texts so Meta has dynamic-creative pool to optimise.
 *
 * Common to both:
 *  - `instagramActorId` is included when set (otherwise Meta uses FB
 *    page identity on IG which looks off-brand).
 *  - `leadGenFormId` is included in the CTA value when the campaign is
 *    a Lead-Gen instant form (destination_type ON_AD).
 *  - `urlTags` defaults to PEDRO_UTM_TEMPLATE so every click is tracked
 *    back to ad name / ad set / campaign.
 */
export async function createAdCreative(args: {
  adAccountId: string
  name: string
  pageId: string
  imageHash: string
  body: string
  title?: string
  description?: string
  linkUrl: string
  callToActionType?: string
  /** Connected IG account (object_story_spec.instagram_actor_id). */
  instagramActorId?: string
  /** Lead-form id for ON_AD instant-form ads. When set, replaces the
   *  CTA value link with the form id. */
  leadGenFormId?: string
  /** 0-N alternative primary texts. When non-empty we switch to
   *  asset_feed_spec. Roy 2026-06-10: Pedro standard = 2 alts. */
  altBodies?: string[]
  /** 0-N alternative headlines. Same trigger condition as altBodies. */
  altTitles?: string[]
  /** UTM template for Meta link parameters. Defaults to PEDRO_UTM_TEMPLATE.
   *  Pass null/empty to opt out. */
  urlTags?: string | null
}): Promise<{ creativeId: string }> {
  // De-duplicate + drop empty strings from the alt arrays so we don't
  // ship "headline | headline | headline" as 3 identical options.
  const dedup = (xs: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const x of xs) {
      const t = (x ?? "").trim()
      if (!t) continue
      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out.push(t)
    }
    return out
  }
  const allBodies = dedup([args.body, ...(args.altBodies ?? [])])
  const allTitles = dedup([args.title ?? "", ...(args.altTitles ?? [])])

  // Choose CTA value - lead form id wins when present (Meta replaces
  // the link with the form modal); otherwise the destination link.
  const ctaValue: Record<string, unknown> = args.leadGenFormId
    ? { link: args.linkUrl, lead_gen_form_id: args.leadGenFormId }
    : { link: args.linkUrl }
  const callToAction = args.callToActionType
    ? { type: args.callToActionType, value: ctaValue }
    : null

  const dynamicCreative = allBodies.length > 1 || allTitles.length > 1
  const urlTags = args.urlTags === undefined ? PEDRO_UTM_TEMPLATE : args.urlTags

  const creativeBody: Record<string, unknown> = {
    name: args.name,
  }
  if (urlTags) creativeBody.url_tags = urlTags

  // Always send object_story_spec - it's required even for asset-feed
  // creatives as the "fallback" identity (page + IG actor).
  const objectStorySpec: Record<string, unknown> = {
    page_id: args.pageId,
  }
  if (args.instagramActorId) {
    objectStorySpec.instagram_actor_id = args.instagramActorId
  }

  if (dynamicCreative) {
    // Asset-feed mode - Meta will permute across the arrays. Lead form
    // creatives ALSO support this since v15+.
    const assetFeedSpec: Record<string, unknown> = {
      images: [{ hash: args.imageHash }],
      bodies: allBodies.map((text) => ({ text })),
      titles: allTitles.length > 0 ? allTitles.map((text) => ({ text })) : undefined,
      link_urls: [{ website_url: args.linkUrl }],
      ad_formats: ["SINGLE_IMAGE"],
    }
    if (args.description) {
      assetFeedSpec.descriptions = [{ text: args.description }]
    }
    if (args.callToActionType) {
      assetFeedSpec.call_to_action_types = [args.callToActionType]
    }
    // Strip undefineds so Meta sees a clean payload.
    for (const k of Object.keys(assetFeedSpec)) {
      if (assetFeedSpec[k] === undefined) delete assetFeedSpec[k]
    }
    creativeBody.asset_feed_spec = assetFeedSpec
    // Fallback object_story_spec - uses the FIRST body/title so the
    // creative still has a renderable preview if Meta can't yet permute.
    const linkData: Record<string, unknown> = {
      image_hash: args.imageHash,
      link: args.linkUrl,
      message: allBodies[0] ?? "",
    }
    if (allTitles[0]) linkData.name = allTitles[0]
    if (args.description) linkData.description = args.description
    if (callToAction) linkData.call_to_action = callToAction
    objectStorySpec.link_data = linkData
    creativeBody.object_story_spec = objectStorySpec
  } else {
    // Single-copy creative - classic link_data only.
    const linkData: Record<string, unknown> = {
      image_hash: args.imageHash,
      link: args.linkUrl,
      message: args.body,
    }
    if (args.title) linkData.name = args.title
    if (args.description) linkData.description = args.description
    if (callToAction) linkData.call_to_action = callToAction
    objectStorySpec.link_data = linkData
    creativeBody.object_story_spec = objectStorySpec
  }

  const json = await postToMeta<{ id?: string }>(
    `${actId(args.adAccountId)}/adcreatives`,
    creativeBody,
  )
  if (!json.id) throw new Error("Meta gaf geen creative id terug.")
  return { creativeId: json.id }
}

// ─── Write: ad ───────────────────────────────────────────────────────────

/**
 * Create an Ad under an ad set, referencing a creative. Status defaults
 * to PAUSED - Roy's principle: nooit auto-live, CM activeert in Ads
 * Manager na review.
 */
export async function createAd(args: {
  adAccountId: string
  adSetId: string
  name: string
  creativeId: string
}): Promise<{ adId: string }> {
  const json = await postToMeta<{ id?: string }>(
    `${actId(args.adAccountId)}/ads`,
    {
      name: args.name,
      adset_id: args.adSetId,
      status: "PAUSED",
      creative: { creative_id: args.creativeId },
    },
  )
  if (!json.id) throw new Error("Meta gaf geen ad id terug.")
  return { adId: json.id }
}
