import { getToken } from "./meta"

/**
 * Meta write helpers — Push-to-Meta backend.
 *
 * All calls go through the Marketing API and require the token to have
 * `ads_management` scope (the read-only token RL uses for performance
 * reads is NOT sufficient). When the token lacks the scope, Meta
 * returns 403 with a structured error — we translate that into a
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

/** Account prefix helper — Meta expects "act_<id>" but we sometimes
 *  store the bare numeric id. */
function actId(adAccountId: string): string {
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
}

// ─── Read: ad set config clone-template ─────────────────────────────────

/**
 * Pull the full config of an existing ad set so we can clone it as the
 * basis for a new ad set under the same campaign. The fields we copy:
 * targeting, budget, schedule, optimization goal, billing event,
 * placements. Roy's design: new ad set inherits everything that was
 * already working on the winner's parent set — CM can adjust in Meta
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
    throw new Error("Meta gaf geen image_hash terug — upload mislukt.")
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
  if (args.template.startTime) body.start_time = args.template.startTime
  if (args.template.endTime) body.end_time = args.template.endTime

  const json = await postToMeta<{ id?: string }>(
    `${actId(args.adAccountId)}/adsets`,
    body,
  )
  if (!json.id) throw new Error("Meta gaf geen ad_set id terug.")
  return { adSetId: json.id }
}

// ─── Write: ad creative ──────────────────────────────────────────────────

/**
 * Create an ad creative bundling: image_hash + body text + headline +
 * page + CTA + link. Per knowledge/campaigns.md the CTA defaults to
 * LEARN_MORE for lead-gen variants; caller can override.
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
}): Promise<{ creativeId: string }> {
  const linkData: Record<string, unknown> = {
    image_hash: args.imageHash,
    link: args.linkUrl,
    message: args.body,
  }
  if (args.title) linkData.name = args.title
  if (args.description) linkData.description = args.description
  if (args.callToActionType) {
    linkData.call_to_action = {
      type: args.callToActionType,
      value: { link: args.linkUrl },
    }
  }

  const json = await postToMeta<{ id?: string }>(
    `${actId(args.adAccountId)}/adcreatives`,
    {
      name: args.name,
      object_story_spec: {
        page_id: args.pageId,
        link_data: linkData,
      },
    },
  )
  if (!json.id) throw new Error("Meta gaf geen creative id terug.")
  return { creativeId: json.id }
}

// ─── Write: ad ───────────────────────────────────────────────────────────

/**
 * Create an Ad under an ad set, referencing a creative. Status defaults
 * to PAUSED — Roy's principle: nooit auto-live, CM activeert in Ads
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
