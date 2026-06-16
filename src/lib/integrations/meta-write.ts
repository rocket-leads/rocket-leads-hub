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

/**
 * Translate a raw Meta error into something the CM can act on.
 *
 * Roy 2026-06-14: previously this aggressively blamed `ads_management`
 * for any code 190/200 or any message containing "permission" — way
 * too broad. Code 190 is "invalid OAuth token" (could be expired,
 * revoked, malformed); code 200 is generic "permission error" (could be
 * page access, ad-account access, audience access, etc.). False-blaming
 * scope sends the CM down the wrong rabbit hole. We now only flag
 * `ads_management` specifically when Meta's own message says so —
 * otherwise we surface the actual Meta message so it can be diagnosed.
 */
function explainMetaError(message: string, code?: number, subcode?: number): string {
  const lc = message.toLowerCase()
  // Specific: Meta itself names the missing scope.
  if (lc.includes("ads_management") || lc.includes("ads_read")) {
    return `Meta token mist de 'ads_management' scope. Genereer een nieuw token in Meta Business Manager → Business Settings → System Users → jouw user → Generate New Token, en selecteer minimaal 'ads_management' + 'pages_read_engagement'. Plak het nieuwe token in Settings → API Tokens → Meta. Belangrijk: scopes worden vastgezet op het moment van token-generatie — je moet de scopes WEL aangevinkt hebben in het Generate-dialog, niet alleen op de system user. Een token van VOOR je de scopes toevoegde heeft ze niet.`
  }
  // Token is structurally invalid / expired / revoked — code 190.
  if (code === 190) {
    return `Meta token is ongeldig of verlopen (code 190): ${message}. Genereer een nieuw token in Meta Business Manager → Business Settings → System Users → jouw user → Generate New Token (selecteer minimaal 'ads_management' + 'pages_read_engagement'). Plak in Settings → API Tokens → Meta.`
  }
  // Lead Generation Terms of Service — distinct from "permission":
  // even when the Page owner accepted Lead Ads TOS in Meta UI, running
  // lead ads via API as a SYSTEM USER often requires a separate
  // per-business TOS acceptance + Lead Access grant to the system user.
  // Roy 2026-06-14: TMM case showed "You've accepted Lead Ads Terms"
  // in Meta Ads Manager UI but the API still rejected — that's because
  // the Page is owned by a different Business and the hub system-user
  // needs explicit Lead Access on Rocket Leads' side.
  if (
    lc.includes("terms of service not accepted") ||
    lc.includes("lead generation terms") ||
    lc.includes("lead ads terms") ||
    lc.includes("leadgen tos")
  ) {
    return `Lead Generation Terms of Service zijn niet geaccepteerd voor de aanvragende business. Ook al heeft de Page-owner Lead Ads TOS in Meta UI geaccepteerd, een system-user die ads runt namens een ANDERE business heeft een eigen TOS-acceptatie nodig. Twee acties:

(1) Lead Access voor de hub system-user — Meta Business Settings → Integrations → Lead Access → "+Assign". Voeg de hub system user toe met "Lead access" + "Download" voor de Page van deze klant.

(2) Re-accept Lead Gen TOS namens Rocket Leads — open https://www.facebook.com/leadgen_terms/ (ingelogd als Rocket Leads BM admin) en accepteer de nieuwste versie van de Lead Generation TOS.

Beide checks zijn vaak nodig wanneer de klant-Page bij een ándere business hangt (zoals TMM Technology onder "Code Cookers"). Daarna push opnieuw.`
  }
  // Specific resource-permission errors.
  if (lc.includes("page_id") && (lc.includes("invalid") || lc.includes("not found"))) {
    return `Facebook Page ID is ongeldig of niet zichtbaar voor dit token. Check de Page ID in Meta Business Manager → Pages, en zorg dat het ingelogde system-user toegang heeft tot deze page.`
  }
  if (subcode === 1487390 || lc.includes("image_hash")) {
    return `Meta accepteerde de image niet (image_hash error). Gebruikelijke oorzaken: foto te klein (<400×400), te groot (>30MB), of formaat is geen JPG/PNG.`
  }
  if (lc.includes("placement") || lc.includes("publisher_platform")) {
    return `Meta kan deze placement-config niet kopiëren van de winner. Push handmatig met aangepaste targeting via Meta Ads Manager.`
  }
  // Generic permission code 200 (without a specific match above): the
  // token authenticates but Meta refused access to this resource. Could
  // be: system user not assigned to ad account, page not added to BM,
  // ad account not granted to the system user, etc. Surface Meta's own
  // message so the CM can diagnose.
  if (code === 200 || lc.includes("permission") || lc.includes("does not have permission")) {
    return `Meta API permission error (code ${code ?? "?"}): ${message}. Het token werkt, maar Meta weigert toegang tot deze resource. Veelvoorkomende oorzaken: (1) de hub system-user heeft geen Admin/Advertise toegang tot DEZE specifieke ad account; (2) de Facebook Page van de klant is niet aan Business Manager toegevoegd of niet aan de system-user gekoppeld; (3) het ad-account hoort niet bij hetzelfde Business Portfolio als de system-user. Check Meta Business Settings → Accounts → Ad accounts en zorg dat de hub user expliciete toegang heeft.`
  }
  // Object story spec failures — code 100 with "object_story_spec" in
  // the message. This is a createAdCreative failure (NOT createAdSet),
  // so the diagnostic must point at the creative payload, not the ad
  // set settings. Roy 2026-06-14: TMM + Diamondflame both hit this
  // because lead-gen winners had no website link → empty link_data.link
  // → Meta rejects object_story_spec as ill-formed. The auto-fallback
  // to the Page's Facebook URL handles this now; this message remains
  // for the residual cases.
  if (lc.includes("object_story_spec") || lc.includes("object story spec")) {
    // Roy 2026-06-15: lead with Meta's own verbose message verbatim
    // so the CM can actually see what's wrong, then list likely causes.
    // Generic-only Dutch text was hiding the real signal.
    return `Meta zegt: "${message}"

(createAdCreative-fout — niet een ad set probleem.)
Veelvoorkomende oorzaken:
(a) Primary copy (message), headline of image_hash leeg in de creative payload.
(b) Page heeft geen Lead Forms / Instant Forms enabled (alleen relevant voor lead-gen).
(c) De Page ID is wel bekend maar niet meer toegankelijk voor het token (Page verwijderd / unpublished / gemigreerd).
(d) Conversions-campagne mist een Conversion Goal die compatibel is met de creative (bv. pixel niet meer trackbaar).
Server logs bevatten het exacte payload + Meta's error_user_msg + blame_field_specs.`
  }
  // "Invalid parameter" — code 100. Bare "Invalid parameter" zonder
  // verbose details. Generic fallback: tell the CM where to look without
  // mentioning specific field names (those would false-fire the inline
  // override hints on the modal side).
  if (code === 100 || lc === "invalid parameter") {
    return `Meta weigerde het verzoek (Invalid parameter, code 100): ${message}. De API-call mist of botst op een veld. Check de server logs voor de exacte payload + Meta's verbose error velden (error_user_msg + blame_field_specs) om te zien welk veld precies afgewezen werd.`
  }
  return `Meta API fout: ${message}`
}

/**
 * Token introspection via Meta's /debug_token endpoint. Returns the
 * scopes that were granted on the token at generation time — Meta
 * embeds the scope set into the token itself, so adding new scopes to
 * the system user AFTER the token was generated does not retroactively
 * grant them. That makes /debug_token the only reliable way to see
 * "what can this specific token actually do".
 *
 * Used by `assertWriteScopes()` at the top of every push-to-meta
 * flow so the CM gets an accurate, specific error BEFORE we burn
 * through ad-set / creative / ad calls trying to push.
 *
 * Roy 2026-06-14: built after a false-positive scope error — the CM
 * had ads_management / ads_read / pages_read_engagement granted on the
 * system user but the underlying issue was a different code-200 path.
 * The old explainMetaError blamed scope; this helper now tells us
 * authoritatively whether scope is the real issue.
 */
export type MetaTokenInfo = {
  isValid: boolean
  scopes: string[]
  type: string | null
  expiresAt: number | null
  appId: string | null
  userId: string | null
  rawError: string | null
}

export async function debugMetaToken(): Promise<MetaTokenInfo> {
  const token = await getToken()
  // System-user tokens can introspect themselves — pass the token as
  // BOTH input_token and access_token. (For user-tokens you'd need an
  // app-token, but Hub uses system-user tokens.)
  const url = `${META_API_BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) {
    return {
      isValid: false,
      scopes: [],
      type: null,
      expiresAt: null,
      appId: null,
      userId: null,
      rawError: text.slice(0, 400),
    }
  }
  type DebugTokenResponse = {
    data?: {
      app_id?: string
      user_id?: string
      type?: string
      is_valid?: boolean
      expires_at?: number
      scopes?: string[]
      error?: { message?: string; code?: number; subcode?: number }
    }
  }
  let parsed: DebugTokenResponse
  try {
    parsed = JSON.parse(text) as DebugTokenResponse
  } catch {
    return {
      isValid: false,
      scopes: [],
      type: null,
      expiresAt: null,
      appId: null,
      userId: null,
      rawError: `Onverwacht antwoord van Meta /debug_token: ${text.slice(0, 200)}`,
    }
  }
  const d = parsed.data ?? {}
  return {
    isValid: d.is_valid === true,
    scopes: Array.isArray(d.scopes) ? d.scopes : [],
    type: d.type ?? null,
    expiresAt: typeof d.expires_at === "number" ? d.expires_at : null,
    appId: d.app_id ?? null,
    userId: d.user_id ?? null,
    rawError: d.error?.message ? d.error.message.slice(0, 300) : null,
  }
}

/**
 * Pre-flight check for write operations. Throws a CM-actionable error
 * when the token is missing the required scopes — BEFORE any actual
 * Meta API call is made. Eliminates the false-blame loop where Pedro
 * said "missing ads_management" for any code-200 error. Roy 2026-06-14.
 */
export async function assertWriteScopes(): Promise<void> {
  const info = await debugMetaToken()
  if (!info.isValid) {
    throw new Error(
      `Meta token is niet (langer) geldig${info.rawError ? ` — Meta zegt: ${info.rawError}` : ""}. Genereer een nieuw token in Meta Business Manager → Business Settings → System Users → jouw user → Generate New Token (selecteer minimaal 'ads_management' + 'pages_read_engagement'). Plak het in Settings → API Tokens → Meta.`,
    )
  }
  const required = ["ads_management"]
  const missing = required.filter((r) => !info.scopes.includes(r))
  if (missing.length > 0) {
    const has = info.scopes.length > 0 ? info.scopes.join(", ") : "(geen scopes)"
    throw new Error(
      `Meta token mist de scope(s): ${missing.join(", ")}. Het huidige token heeft alleen: ${has}. Belangrijk: scopes worden vastgezet op het moment dat je het token GENEREERT — alleen toevoegen aan de system user is niet genoeg. Genereer een NIEUW token in Meta Business Manager → Business Settings → System Users → jouw user → Generate New Token en VINK ‘ads_management’ + ‘pages_read_engagement’ aan in het dialog. Plak het nieuwe token in Settings → API Tokens → Meta.`,
    )
  }
}

type MetaErrorResponse = {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
    /** Meta surfaces a CM-friendly title here when available — usually
     *  more specific than `message` (e.g. "Daily Budget Too Low"). */
    error_user_title?: string
    /** Meta surfaces a CM-friendly explanation here — usually the
     *  most diagnosable part of the error (e.g. "The minimum daily
     *  budget for this ad set is €X."). */
    error_user_msg?: string
    /** Free-form structured detail. Often contains a `blame_field_specs`
     *  array pointing at which field broke. */
    error_data?: Record<string, unknown>
  }
}

/** Combine Meta's verbose error fields into one human-readable string.
 *  Falls back through error_user_msg → error_user_title → message in
 *  priority order, then optionally appends a blame-field summary if
 *  Meta pointed at a specific field. Roy 2026-06-14: previously we
 *  only used `message`, which is often just "Invalid parameter" with
 *  no diagnosis attached. */
function bestMetaErrorMessage(err: NonNullable<MetaErrorResponse["error"]>): string {
  const parts: string[] = []
  if (err.error_user_title && err.error_user_msg) {
    parts.push(`${err.error_user_title}: ${err.error_user_msg}`)
  } else if (err.error_user_msg) {
    parts.push(err.error_user_msg)
  } else if (err.error_user_title) {
    parts.push(err.error_user_title)
  } else if (err.message) {
    parts.push(err.message)
  }
  // Pull blame_field_specs out of error_data if present — Meta names
  // exactly which field is broken (e.g. "AdSet[targeting][geo_locations]").
  const blame = err.error_data?.blame_field_specs
  if (Array.isArray(blame) && blame.length > 0) {
    const fields = blame
      .map((b) => (Array.isArray(b) ? b.filter((x) => typeof x === "string").join(".") : ""))
      .filter((s) => s.length > 0)
    if (fields.length > 0) {
      parts.push(`Velden: ${fields.join(", ")}`)
    }
  }
  return parts.join(" — ") || "Onbekende Meta API fout"
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
    // Roy 2026-06-14: log the raw error + the request payload so we
    // can diagnose code-200 / "Invalid parameter" failures from the
    // server logs without guessing. The payload is the most useful
    // bit — strip access_token before logging.
    const { access_token: _omit, ...payloadForLog } = { ...body, access_token: token } as Record<
      string,
      unknown
    >
    void _omit
    console.error(
      `[meta-write] POST ${path} failed`,
      `status=${res.status}`,
      `code=${err.code ?? "?"}`,
      `subcode=${err.error_subcode ?? "?"}`,
      `type=${err.type ?? "?"}`,
      `fbtrace=${err.fbtrace_id ?? "?"}`,
      `message=${(err.message ?? text.slice(0, 200) ?? "").slice(0, 400)}`,
      `user_title=${(err.error_user_title ?? "").slice(0, 200)}`,
      `user_msg=${(err.error_user_msg ?? "").slice(0, 400)}`,
      `error_data=${JSON.stringify(err.error_data ?? {}).slice(0, 400)}`,
      `payload=${JSON.stringify(payloadForLog).slice(0, 800)}`,
    )
    const verbose = bestMetaErrorMessage(err)
    const message = explainMetaError(verbose, err.code, err.error_subcode)
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
    console.error(
      `[meta-write] UPLOAD ${path} failed`,
      `status=${res.status}`,
      `code=${err.code ?? "?"}`,
      `subcode=${err.error_subcode ?? "?"}`,
      `type=${err.type ?? "?"}`,
      `fbtrace=${err.fbtrace_id ?? "?"}`,
      `message=${(err.message ?? text.slice(0, 200) ?? "").slice(0, 400)}`,
      `user_title=${(err.error_user_title ?? "").slice(0, 200)}`,
      `user_msg=${(err.error_user_msg ?? "").slice(0, 400)}`,
      `error_data=${JSON.stringify(err.error_data ?? {}).slice(0, 400)}`,
    )
    const verbose = bestMetaErrorMessage(err)
    const message = explainMetaError(verbose, err.code, err.error_subcode)
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
    console.error(
      `[meta-write] GET adset ${adsetId} failed`,
      `status=${res.status}`,
      `code=${err.code ?? "?"}`,
      `message=${(err.message ?? text.slice(0, 200) ?? "").slice(0, 400)}`,
      `user_msg=${(err.error_user_msg ?? "").slice(0, 400)}`,
    )
    const verbose = bestMetaErrorMessage(err)
    throw new Error(explainMetaError(verbose, err.code, err.error_subcode))
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

  const template: MetaAdSetTemplate = {
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
  // Roy 2026-06-14: log which fields Meta actually populated. When key
  // fields (targeting / bid_strategy / optimization_goal) come back
  // null we silently drop them in createAdSet, which then sends a
  // half-empty payload that Meta rejects. The log makes that visible
  // so we can diagnose without guessing.
  console.log(
    `[meta-write] fetchAdSetTemplate ${adsetId}`,
    `campaign=${template.campaignId || "?"}`,
    `targeting=${template.targeting ? "yes" : "NULL"}`,
    `dailyBudget=${template.dailyBudget ?? "NULL"}`,
    `lifetimeBudget=${template.lifetimeBudget ?? "NULL"}`,
    `bidStrategy=${template.bidStrategy ?? "NULL"}`,
    `billingEvent=${template.billingEvent ?? "NULL"}`,
    `optimizationGoal=${template.optimizationGoal ?? "NULL"}`,
    `destinationType=${template.destinationType ?? "NULL"}`,
    `promotedObject=${template.promotedObject ? "yes" : "NULL"}`,
  )
  return template
}

/** Summary of which key fields were resolved on the template. Used by
 *  the push-to-meta route to surface a diagnostic block in the error
 *  response so the modal can offer a smart retry hint ("Pedro kon de
 *  targeting niet ophalen — kies handmatig een ad set"). Roy 2026-06-14. */
export type TemplateResolutionSummary = {
  adsetId: string
  campaignId: string
  hasTargeting: boolean
  hasBidStrategy: boolean
  hasOptimizationGoal: boolean
  hasBudget: boolean
  hasBillingEvent: boolean
  missingFields: string[]
}

export function summariseTemplate(
  adsetId: string,
  template: MetaAdSetTemplate,
): TemplateResolutionSummary {
  const missing: string[] = []
  if (!template.targeting) missing.push("targeting")
  if (!template.bidStrategy) missing.push("bid_strategy")
  if (!template.optimizationGoal) missing.push("optimization_goal")
  if (!template.dailyBudget && !template.lifetimeBudget) missing.push("budget")
  if (!template.billingEvent) missing.push("billing_event")
  return {
    adsetId,
    campaignId: template.campaignId,
    hasTargeting: !!template.targeting,
    hasBidStrategy: !!template.bidStrategy,
    hasOptimizationGoal: !!template.optimizationGoal,
    hasBudget: !!(template.dailyBudget || template.lifetimeBudget),
    hasBillingEvent: !!template.billingEvent,
    missingFields: missing,
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
  // Budget: Meta requires AT LEAST ONE of daily_budget / lifetime_budget
  // (unless the campaign is on CBO, where neither is set on the adset).
  //
  // Roy 2026-06-14: lifetime_budget REQUIRES end_time. We strip
  // start_time/end_time below for safety reasons (see comment), which
  // creates an "Invalid parameter" failure when the source adset used
  // lifetime_budget. Fix: if the source used lifetime_budget, convert
  // it to a daily_budget approximation (divide by 30 — Meta's standard
  // monthly assumption) so the new adset has a valid budget without
  // needing an end_time. The CM can adjust to the real cadence in Ads
  // Manager before activating.
  if (args.template.dailyBudget) {
    body.daily_budget = args.template.dailyBudget
  } else if (args.template.lifetimeBudget) {
    const lifetimeCents = Number(args.template.lifetimeBudget)
    if (Number.isFinite(lifetimeCents) && lifetimeCents > 0) {
      // 30-day amortisation. Round to nearest euro (100 cents) so we
      // don't ship odd-cent budgets that look like glitches in Ads
      // Manager. Minimum 100 cents (€1) — Meta rejects sub-€1 daily
      // budgets across most markets.
      const daily = Math.max(100, Math.round(lifetimeCents / 30 / 100) * 100)
      body.daily_budget = String(daily)
    }
  }
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

  // Roy 2026-06-15: early guards on fields Meta validates as required.
  // Without these we got vague "object_story_spec is ill-formed" errors
  // from Meta after a 30-second round trip; now we fail in 0ms with
  // an actionable message that points at the actual missing input.
  if (!args.imageHash || args.imageHash.trim().length === 0) {
    throw new Error(
      `Image hash ontbreekt voor de creative "${args.name}". De image-upload naar Meta is mislukt of de slot had geen image. Genereer / upload de image opnieuw en push dan.`,
    )
  }
  if (allBodies.length === 0) {
    throw new Error(
      `Primary copy (message) is leeg voor de creative "${args.name}". Pedro's variant had geen primary_copy_snippet. Genereer de refresh opnieuw of vul de primary copy handmatig aan voordat je pusht.`,
    )
  }
  if (!args.pageId || args.pageId.trim().length === 0) {
    throw new Error(
      `Page ID ontbreekt voor de creative "${args.name}". Bron ad set leverde geen pageId — kies een andere ad set als template waar de Facebook Page wel correct uit komt.`,
    )
  }

  // Roy 2026-06-14/15: lead-gen ads typically have no website landing URL —
  // the ad routes to an instant form via call_to_action.value.lead_gen_form_id.
  // But Meta's object_story_spec validation REQUIRES a valid URL in
  // link_data.link AND in asset_feed_spec.link_urls[].website_url.
  // Strict fallback rules — the Facebook-Page URL placeholder is ONLY
  // safe when the ad is actually lead-gen (instant form). For landing-
  // page conversion ads, falling back to the FB page would create an
  // ad pointing at the page instead of the actual landing page (wrong
  // destination, but Meta would still validate the spec). Roy's
  // Diamondflame case is "landing page conversions", NOT lead-gen — so
  // here an empty linkUrl is a real CM-actionable problem, not something
  // we should paper over with a placeholder.
  const hasRealLink = !!args.linkUrl && args.linkUrl.trim().length > 0
  const effectiveLinkUrl = hasRealLink
    ? args.linkUrl.trim()
    : args.leadGenFormId && args.pageId
      ? `https://www.facebook.com/${args.pageId}`
      : args.linkUrl // empty → Meta will surface the actual error
  if (!hasRealLink) {
    console.warn(
      `[meta-write] createAdCreative for ${args.name}: linkUrl is empty.`,
      `leadGenFormId=${args.leadGenFormId ?? "none"}`,
      `→ usingFallback=${args.leadGenFormId && args.pageId ? `facebook.com/${args.pageId}` : "(none — Meta will reject)"}`,
    )
  }

  // Lead-gen ads also need an explicit call_to_action with a button
  // type — without one, Meta has no way to surface the form. Default to
  // SIGN_UP when leadGenFormId is set but the source didn't carry a
  // CTA type (common when the source itself was deeply customised in
  // Ads Manager). Non-lead-gen ads keep their explicit CTA or none at all.
  const effectiveCtaType =
    args.callToActionType ||
    (args.leadGenFormId ? "SIGN_UP" : undefined)

  // Choose CTA value - lead form id wins when present (Meta replaces
  // the link with the form modal); otherwise the destination link.
  const ctaValue: Record<string, unknown> = args.leadGenFormId
    ? { link: effectiveLinkUrl, lead_gen_form_id: args.leadGenFormId }
    : { link: effectiveLinkUrl }
  const callToAction = effectiveCtaType
    ? { type: effectiveCtaType, value: ctaValue }
    : null

  const dynamicCreative = allBodies.length > 1 || allTitles.length > 1
  const urlTags = args.urlTags === undefined ? PEDRO_UTM_TEMPLATE : args.urlTags

  const creativeBody: Record<string, unknown> = {
    name: args.name,
  }
  if (urlTags) creativeBody.url_tags = urlTags

  // Roy 2026-06-15: Meta's API v20.0 silently rejects creatives on
  // newer accounts when `degrees_of_freedom_spec` is missing. Setting
  // standard_enhancements to OPT_OUT explicitly tells Meta we don't
  // want Advantage+ creative auto-changes (which Pedro doesn't control).
  // Without this field, accounts that have Advantage+ enabled at the
  // account level get the generic "object_story_spec is ill-formed"
  // error even though every other field is correct. Diamondflame's TMM
  // case hit this exact issue.
  creativeBody.degrees_of_freedom_spec = {
    creative_features_spec: {
      standard_enhancements: { enroll_status: "OPT_OUT" },
    },
  }

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
      link_urls: [{ website_url: effectiveLinkUrl }],
      ad_formats: ["SINGLE_IMAGE"],
    }
    if (args.description) {
      assetFeedSpec.descriptions = [{ text: args.description }]
    }
    if (effectiveCtaType) {
      assetFeedSpec.call_to_action_types = [effectiveCtaType]
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
      link: effectiveLinkUrl,
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
      link: effectiveLinkUrl,
      message: args.body,
    }
    if (args.title) linkData.name = args.title
    if (args.description) linkData.description = args.description
    if (callToAction) linkData.call_to_action = callToAction
    objectStorySpec.link_data = linkData
    creativeBody.object_story_spec = objectStorySpec
  }

  // Roy 2026-06-15: always log the creative payload pre-send so we can
  // diagnose "object_story_spec is ill-formed" failures from Vercel
  // logs without having to reverse-engineer them. The postToMeta
  // error path already logs on failure, but logging unconditionally
  // here also captures the SUCCESS path so we can compare working vs.
  // failing payloads side-by-side.
  console.log(
    `[meta-write] createAdCreative sending`,
    `name=${args.name}`,
    `pageId=${args.pageId}`,
    `imageHash=${args.imageHash}`,
    `linkUrl=${effectiveLinkUrl || "EMPTY"}`,
    `ctaType=${effectiveCtaType ?? "(none)"}`,
    `leadGenFormId=${args.leadGenFormId ?? "(none)"}`,
    `bodyLen=${(args.body ?? "").length}`,
    `titleLen=${(args.title ?? "").length}`,
    `descLen=${(args.description ?? "").length}`,
    `dynamicCreative=${dynamicCreative}`,
    `payload=${JSON.stringify(creativeBody).slice(0, 1500)}`,
  )

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
