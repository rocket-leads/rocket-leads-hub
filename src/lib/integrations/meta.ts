import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { readCache, writeCache } from "@/lib/cache"
import type { ResolvedEntity } from "./resolved-entity"

const META_API_BASE = "https://graph.facebook.com/v20.0"

export async function getToken(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "meta")
    .single()
  if (!data) throw new Error("Meta token not configured. Go to Settings → API Tokens.")
  return decrypt(data.token_encrypted)
}

export type MetaCampaign = {
  id: string
  name: string
  status: string
}

export type MetaInsight = {
  campaignId: string
  campaignName: string
  spend: number
  /** Canonical lead count - prefers `lead`, falls back to max of per-source aliases */
  leads: number
}

/**
 * Count leads from a Meta `actions` array. Meta returns the same conversion
 * under multiple aliases (`lead`, `onsite_conversion.lead_grouped`,
 * `leadgen_grouped`, `offsite_conversion.fb_pixel_lead`, ...) - summing all of
 * them double-counts. Prefer the canonical `lead` total; fall back to the max
 * of the per-source counts when `lead` isn't reported.
 */
function countLeads(actions: Array<{ action_type: string; value: string }> | undefined): number {
  if (!actions?.length) return 0
  const lookup = (type: string) =>
    parseInt(actions.find((a) => a.action_type === type)?.value ?? "0", 10) || 0

  const unified = lookup("lead")
  if (unified > 0) return unified

  return Math.max(
    lookup("onsite_conversion.lead_grouped"),
    lookup("offsite_conversion.fb_pixel_lead"),
    lookup("leadgen_grouped"),
  )
}

async function fetchAllPages<T>(
  url: string,
  options: { bypassCache?: boolean } = {},
): Promise<T[]> {
  const results: T[] = []
  let nextUrl: string | null = url

  while (nextUrl) {
    // Same reasoning as the Monday `gql` helper: when the user explicitly
    // clicked Refresh, Next.js' 5-minute fetch cache must not silently
    // re-serve a stale Meta response.
    const fetchOpts = options.bypassCache
      ? ({ cache: "no-store" } as const)
      : ({ next: { revalidate: 300 } } as const)
    const res: Response = await fetch(nextUrl, fetchOpts)
    if (!res.ok) {
      const status = res.status
      const err = await res.json()
      throw new Error(err.error?.message ?? `Meta API error ${status}`)
    }
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    results.push(...(json.data ?? []))
    nextUrl = json.paging?.next ?? null
  }

  return results
}

/**
 * Lightweight Meta ad account summary for the ConnectedEntity picker. Just
 * enough to render the row + discriminate similar names: account id, business
 * name (for agency-managed accounts that share the same company name across
 * multiple accounts), status code.
 */
type MetaAdAccountSummary = {
  /** Full account ID including `act_` prefix - that's what Meta returns and
   *  what every other Meta function in this file expects as input. */
  id: string
  /** ID minus the `act_` prefix for display. Stored separately so we don't
   *  have to slice on render every keystroke. */
  numericId: string
  name: string
  businessName: string | null
  accountStatus: number | null
}

const META_AD_ACCOUNTS_CACHE_KEY = "meta_ad_accounts_v1"
const META_AD_ACCOUNTS_TTL_MS = 5 * 60 * 1000

/**
 * Pull every ad account the Meta token can see. Paginated via the
 * `paging.next` cursor that `fetchAllPages` already follows. Cached for 5
 * minutes so per-keystroke search in the picker doesn't fan out into Meta
 * Graph API calls each time.
 *
 * Field set deliberately minimal - adding `funding_source_details` here
 * would make this call 3× slower for no UX gain. Status alone covers the
 * "this account is disabled, don't pick it" case.
 */
async function fetchAllAccessibleAdAccounts(): Promise<MetaAdAccountSummary[]> {
  const cached = await readCache<MetaAdAccountSummary[]>(
    META_AD_ACCOUNTS_CACHE_KEY,
    META_AD_ACCOUNTS_TTL_MS,
  )
  if (cached) return cached

  const token = await getToken()
  const fields = "id,account_id,name,business_name,account_status"
  const url = `${META_API_BASE}/me/adaccounts?fields=${fields}&limit=200&access_token=${token}`
  type Raw = {
    id: string
    account_id: string
    name: string
    business_name: string | null
    account_status: number | null
  }
  const raw = await fetchAllPages<Raw>(url)
  const out: MetaAdAccountSummary[] = raw.map((r) => ({
    id: r.id,
    numericId: r.account_id ?? r.id.replace(/^act_/, ""),
    name: r.name ?? r.id,
    businessName: r.business_name ?? null,
    accountStatus: typeof r.account_status === "number" ? r.account_status : null,
  }))

  await writeCache(META_AD_ACCOUNTS_CACHE_KEY, out)
  return out
}

function toResolvedAdAccount(a: MetaAdAccountSummary): ResolvedEntity {
  const subParts: string[] = []
  if (a.businessName) subParts.push(a.businessName)
  const statusMeta = a.accountStatus != null ? META_ACCOUNT_STATUS[a.accountStatus] : undefined
  if (statusMeta && a.accountStatus !== 1) subParts.push(statusMeta.label)
  // Status flag drives the red/amber pill in the picker row. Active = ok;
  // billing problems = error (loud); everything else = warning (mostly
  // visual: "this account exists but isn't ready to run ads").
  const status: ResolvedEntity["status"] =
    a.accountStatus === 1
      ? "ok"
      : statusMeta?.isBilling
        ? "error"
        : statusMeta
          ? "warning"
          : undefined
  return {
    id: a.id,
    name: a.name,
    subline: subParts.length > 0 ? subParts.join(" · ") : undefined,
    status,
    statusLabel: statusMeta?.label,
  }
}

/**
 * Search Meta ad accounts by name for the ConnectedEntity picker.
 *
 * Meta's `/me/adaccounts` endpoint has no name-filter parameter, so we
 * fetch all accessible accounts (cached 5 minutes) and substring-match
 * client-side. Ranks active-with-prefix-match first, active-substring next,
 * everything else last - so the AM doesn't end up linking a Disabled
 * account when a same-named Active one exists.
 *
 * Match scope: name OR business_name OR raw numeric ID. The numeric-ID
 * match is for the rare case where the AM has the act_… string copied from
 * Meta Business Manager and just wants to paste-and-confirm.
 */
export async function searchMetaAdAccounts(
  query: string,
  limit = 10,
): Promise<ResolvedEntity[]> {
  const accounts = await fetchAllAccessibleAdAccounts()
  const trimmed = query.trim().toLowerCase()
  const cap = Math.min(Math.max(limit, 1), 25)

  if (trimmed.length === 0) {
    // Cold-open: active accounts first, then everything else, alphabetical
    // within each group. The agency typically has 50-200 ad accounts; the
    // archived/disabled tail should never be the first thing in the picker.
    return accounts
      .slice()
      .sort((a, b) => {
        const aActive = a.accountStatus === 1 ? 0 : 1
        const bActive = b.accountStatus === 1 ? 0 : 1
        return aActive - bActive || a.name.localeCompare(b.name)
      })
      .slice(0, cap)
      .map(toResolvedAdAccount)
  }

  type Scored = { account: MetaAdAccountSummary; rank: number }
  const scored: Scored[] = []
  for (const a of accounts) {
    const name = a.name.toLowerCase()
    const biz = a.businessName?.toLowerCase() ?? ""
    const idMatch = a.numericId === trimmed || a.id === trimmed
    const isActive = a.accountStatus === 1
    let rank: number | null = null
    if (idMatch) rank = 0
    else if (name.startsWith(trimmed)) rank = isActive ? 1 : 3
    else if (name.includes(trimmed) || biz.includes(trimmed)) rank = isActive ? 2 : 4
    if (rank !== null) scored.push({ account: a, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.account.name.localeCompare(b.account.name))
  return scored.slice(0, cap).map((s) => toResolvedAdAccount(s.account))
}

/**
 * Resolve a single Meta ad account ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger - catches the "ad account
 * got disabled by Meta but the ID is still set" case that's been silently
 * breaking the Performance Overview for weeks at a time.
 *
 * Accepts `act_…`, plain numeric, or numeric-with-leading-zero forms. Returns
 * null when Meta says the account doesn't exist or the token has no access.
 * Throws on other transport/auth failures so the picker shows "couldn't
 * verify" instead of "definitely broken".
 */
export async function resolveMetaAdAccount(id: string): Promise<ResolvedEntity | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const token = await getToken()
  const accountId = trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`
  const fields = "id,account_id,name,business_name,account_status"
  const url = `${META_API_BASE}/${accountId}?fields=${fields}&access_token=${token}`

  const res = await fetch(url, { cache: "no-store" })
  if (res.status === 400 || res.status === 404) {
    // 400 covers "Invalid OAuth access token" (treat as broken so the AM
    // knows the link's dead) and "Object does not exist". 404 is the
    // straightforward "no such account" - also broken.
    return null
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Meta API error ${res.status}: ${text.slice(0, 200)}`)
  }
  const raw = (await res.json()) as {
    id: string
    account_id: string
    name: string
    business_name: string | null
    account_status: number | null
  }
  return toResolvedAdAccount({
    id: raw.id,
    numericId: raw.account_id ?? raw.id.replace(/^act_/, ""),
    name: raw.name ?? raw.id,
    businessName: raw.business_name ?? null,
    accountStatus: typeof raw.account_status === "number" ? raw.account_status : null,
  })
}

export async function fetchMetaCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const url = `${META_API_BASE}/${accountId}/campaigns?fields=id,name,status&limit=100&access_token=${token}`
  return fetchAllPages<MetaCampaign>(url)
}

export async function fetchMetaInsights(
  adAccountId: string,
  startDate: string,
  endDate: string,
  options: { bypassCache?: boolean } = {},
): Promise<MetaInsight[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))
  const url = `${META_API_BASE}/${accountId}/insights?fields=campaign_id,campaign_name,spend,actions&level=campaign&time_range=${timeRange}&limit=100&access_token=${token}`

  const data = await fetchAllPages<{
    campaign_id: string
    campaign_name: string
    spend: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url, { bypassCache: options.bypassCache })
  return data.map((d) => ({
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    spend: parseFloat(d.spend ?? "0"),
    leads: countLeads(d.actions),
  }))
}

export type MetaDailyInsight = {
  campaignId: string
  campaignName: string
  /** YYYY-MM-DD */
  date: string
  spend: number
  leads: number
}

/**
 * Per-day, per-campaign breakdown via Meta's `time_increment=1`. Use this when you need
 * a daily trend (sparklines, time-series charts). Aggregate with `aggregateMetaDailyToTotals`
 * or `aggregateMetaDailyByDate` to recover totals - saves a separate roundtrip.
 *
 * Note: Meta omits days with zero activity, so the returned array may be sparser than
 * the requested range. Callers rendering a continuous timeline should fill missing dates.
 */
export async function fetchMetaInsightsDaily(
  adAccountId: string,
  startDate: string,
  endDate: string,
  options: { bypassCache?: boolean } = {},
): Promise<MetaDailyInsight[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))
  const url = `${META_API_BASE}/${accountId}/insights?fields=campaign_id,campaign_name,date_start,spend,actions&level=campaign&time_range=${timeRange}&time_increment=1&limit=1000&access_token=${token}`

  const data = await fetchAllPages<{
    campaign_id: string
    campaign_name: string
    date_start: string
    spend: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url, { bypassCache: options.bypassCache })
  return data.map((d) => ({
    campaignId: d.campaign_id,
    campaignName: d.campaign_name,
    date: d.date_start,
    spend: parseFloat(d.spend ?? "0"),
    leads: countLeads(d.actions),
  }))
}

/** Sum daily rows back to per-campaign totals (drop-in replacement for fetchMetaInsights output). */
export function aggregateMetaDailyToTotals(daily: MetaDailyInsight[]): MetaInsight[] {
  const map = new Map<string, MetaInsight>()
  for (const d of daily) {
    const cur = map.get(d.campaignId)
    if (cur) {
      cur.spend += d.spend
      cur.leads += d.leads
    } else {
      map.set(d.campaignId, { campaignId: d.campaignId, campaignName: d.campaignName, spend: d.spend, leads: d.leads })
    }
  }
  return Array.from(map.values())
}

/** Sum daily rows by date (across campaigns), sorted ascending. Missing dates are NOT filled. */
export function aggregateMetaDailyByDate(daily: MetaDailyInsight[]): Array<{ date: string; spend: number; leads: number }> {
  const map = new Map<string, { date: string; spend: number; leads: number }>()
  for (const d of daily) {
    const cur = map.get(d.date)
    if (cur) {
      cur.spend += d.spend
      cur.leads += d.leads
    } else {
      map.set(d.date, { date: d.date, spend: d.spend, leads: d.leads })
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Ad account billing health ───────────────────────────────────────────
//
// Detects billing/payment problems at the ad-account level. Meta exposes
// these on the AdAccount node itself - `account_status` is the canonical
// signal (1=active, anything else means something is wrong), `disable_reason`
// gives the why (UNSETTLED, UNPAID, etc.), `funding_source_details` shows
// the current payment method.
//
// We don't poll campaign-level `effective_status` because (a) campaign
// pauses are intentional 95% of the time and (b) the live-but-dark
// detector already catches the symptom (Live status + no spend).
// Account-level status catches the ROOT CAUSE before a campaign even pauses
// - Meta sometimes reduces delivery before pausing entirely.

/** Meta `account_status` numeric → label + actionable flag. Sourced from
 *  https://developers.facebook.com/docs/marketing-api/reference/ad-account.
 *  `isBilling` marks the statuses that mean "payment problem" (vs. e.g.
 *  closed-on-purpose which isn't actionable from our side). */
export const META_ACCOUNT_STATUS: Record<
  number,
  { label: string; isBilling: boolean }
> = {
  1: { label: "Active", isBilling: false },
  2: { label: "Disabled", isBilling: true },
  3: { label: "Unsettled", isBilling: true },
  7: { label: "Pending risk review", isBilling: false },
  8: { label: "Pending settlement", isBilling: true },
  9: { label: "In grace period", isBilling: true },
  100: { label: "Pending closure", isBilling: false },
  101: { label: "Closed", isBilling: false },
  201: { label: "Any active", isBilling: false },
  202: { label: "Any closed", isBilling: false },
}

export type MetaAdAccountHealth = {
  adAccountId: string
  /** Raw Meta numeric status. Null when the fetch returned no value. */
  accountStatus: number | null
  /** Human-readable label for `accountStatus`. */
  accountStatusLabel: string
  /** True for the statuses that signal a payment problem the AM can fix
   *  (disabled / unsettled / pending settlement / grace period). False
   *  for "active" and for "closed on purpose" states. */
  isBillingIssue: boolean
  /** Meta's `disable_reason` numeric - gives detail on WHY a disabled
   *  account is disabled. 0 = not disabled. */
  disableReason: number | null
  /** Funding source label as Meta returns it ("Visa **** 1234",
   *  "PayPal user@x.com", etc). Empty string when not exposed. */
  fundingSourceLabel: string
  /** ISO timestamp when we fetched this. */
  fetchedAt: string
}

/** Fetch ad-account-level health (status + disable reason + funding source).
 *  Returns null when the request fails entirely (don't poison the cache with
 *  a fake "active" record); caller is expected to preserve prior state in
 *  that case, same pattern as the KPI fetch's `metaFetchFailed`. */
export async function fetchAdAccountHealth(
  adAccountId: string,
): Promise<MetaAdAccountHealth | null> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const url = `${META_API_BASE}/${accountId}?fields=account_status,disable_reason,funding_source_details&access_token=${token}`

  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    console.error(
      `[meta] account-health fetch failed for ${adAccountId}: ${res.status} ${text.slice(0, 200)}`,
    )
    return null
  }
  const json = (await res.json()) as {
    account_status?: number
    disable_reason?: number
    funding_source_details?: {
      display_string?: string
      type?: number
    }
  }

  const statusNum = typeof json.account_status === "number" ? json.account_status : null
  const statusMeta = statusNum != null ? META_ACCOUNT_STATUS[statusNum] : undefined

  return {
    adAccountId,
    accountStatus: statusNum,
    accountStatusLabel: statusMeta?.label ?? (statusNum != null ? `Unknown (${statusNum})` : "Unknown"),
    isBillingIssue: statusMeta?.isBilling ?? false,
    disableReason:
      typeof json.disable_reason === "number" && json.disable_reason > 0 ? json.disable_reason : null,
    fundingSourceLabel: json.funding_source_details?.display_string ?? "",
    fetchedAt: new Date().toISOString(),
  }
}

export type MetaAdDetail = {
  adId: string
  adName: string
  adsetName: string
  /** Campaign id this ad sits in. Used by Push-to-Meta to discover
   *  the winner's parent campaign so a new ad set lands in the right
   *  place. Roy 2026-06-09. */
  campaignId: string
  /** Campaign name (RL convention: "RL | NL | RV | Zumex | LP"). Used
   *  by Pedro to figure out which campaign/product this winner belongs
   *  to - drives Drive-folder targeting + image relevance scoring.
   *  Roy 2026-06-10. */
  campaignName: string
  /** Ad set id this ad sits in. Used as the clone-template for new
   *  ad set config (budget / targeting / placement). */
  adsetId: string
  status: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  leads: number
  /** Primary copy - long text body. */
  body: string
  /** Headline / title shown above the body. Empty when ad has no title
   *  (rare; mostly dynamic/asset-feed ads or pre-2020 setups). */
  title: string
  /** Description / link description shown below the title. */
  description: string
  /** Call-to-action button label as Meta reports it
   *  ("LEARN_MORE", "GET_OFFER", "CONTACT_US", etc.). */
  callToActionType: string
  /** Landing-page URL the click goes to. Empty for non-link ads (e.g.
   *  pure brand video views). */
  linkUrl: string
  creativeType: "video" | "image" | "dynamic" | "unknown"
  thumbnailUrl: string
  /** Higher-res image URL when available - better signal for vision
   *  analysis than the squashed thumbnail. */
  imageUrl: string
  /** Facebook Page ID the ad is posted under. Pedro Push-to-Meta uses
   *  this so the new ad lands on the same page as the winner - no
   *  per-client config needed. Roy 2026-06-09. */
  pageId: string
  /** Instagram Actor ID (the connected IG account). When present we
   *  set it on the new creative so the ad also shows on the right IG
   *  account; otherwise Meta falls back to using the FB page identity
   *  on IG which looks off-brand. Roy 2026-06-10. */
  instagramActorId: string
  /** Lead-gen form id when the winner is an Instant Form lead ad
   *  (destination_type ON_AD). Bubbles up from
   *  `object_story_spec.link_data.call_to_action.value.lead_gen_form_id`.
   *  Empty when this isn't a lead-form ad. Roy 2026-06-10. */
  leadGenFormId: string
  /** Roy 2026-06-09: dynamic creatives carry multiple variations under
   *  `asset_feed_spec`. Stringified summary of the variation pool so
   *  Pedro can see which messages worked at all. */
  assetFeedSummary: string
}

export async function fetchMetaAdDetails(
  adAccountId: string,
  startDate: string,
  endDate: string,
  campaignIds?: Set<string>,
): Promise<MetaAdDetail[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const timeRange = encodeURIComponent(JSON.stringify({ since: startDate, until: endDate }))

  const url = `${META_API_BASE}/${accountId}/insights?fields=ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions&level=ad&time_range=${timeRange}&limit=200&access_token=${token}`
  const insightsData = await fetchAllPages<{
    ad_id: string
    ad_name: string
    adset_id: string
    adset_name: string
    campaign_id: string
    campaign_name: string
    spend: string
    impressions: string
    clicks: string
    ctr: string
    cpc: string
    actions?: Array<{ action_type: string; value: string }>
  }>(url)

  const filtered = campaignIds && campaignIds.size > 0
    ? insightsData.filter((d) => campaignIds.has(d.campaign_id))
    : insightsData

  const adIds = filtered.map((d) => d.ad_id).filter(Boolean)
  type CreativeExtras = {
    body: string
    title: string
    description: string
    callToActionType: string
    linkUrl: string
    creativeType: MetaAdDetail["creativeType"]
    thumbnailUrl: string
    imageUrl: string
    assetFeedSummary: string
    pageId: string
    instagramActorId: string
    leadGenFormId: string
  }
  const creativeMap = new Map<string, CreativeExtras>()

  if (adIds.length > 0) {
    for (let i = 0; i < adIds.length; i += 50) {
      const batch = adIds.slice(i, i + 50)
      // Roy 2026-06-09: expanded field set so Pedro sees full copy
      // package - title + description + CTA + landing-page URL +
      // dynamic variations - not just the body. Critical for
      // creative-refresh to iterate in real DNA instead of guessing.
      //
      // Roy 2026-06-10: asset_feed_spec.images + link_data.picture
      // toegevoegd zodat dynamic creatives en link-data ads ook een
      // image URL teruggeven. Daarvoor stond elke dynamic ad in de
      // AdPicker met "image unknown". Met deze expansie heeft Meta vaak
      // wel een url onder asset_feed_spec.images[0].url die we kunnen
      // gebruiken als thumbnail-fallback.
      const fieldExpansion = [
        "body",
        "title",
        "object_type",
        "thumbnail_url",
        "image_url",
        "link_url",
        "call_to_action_type",
        "object_story_spec",
        "asset_feed_spec{bodies,titles,descriptions,call_to_action_types,link_urls,images{url,hash}}",
      ].join(",")
      const adsUrl = `${META_API_BASE}/?ids=${batch.join(",")}&fields=creative{${fieldExpansion}}&access_token=${token}`
      try {
        const res: Response = await fetch(adsUrl, { next: { revalidate: 300 } })
        if (res.ok) {
          const json = await res.json()
          for (const [adId, adData] of Object.entries(json)) {
            type RawCreative = {
              body?: string
              title?: string
              object_type?: string
              thumbnail_url?: string
              image_url?: string
              link_url?: string
              call_to_action_type?: string
              object_story_spec?: {
                page_id?: string
                instagram_actor_id?: string
                link_data?: {
                  message?: string
                  name?: string
                  description?: string
                  link?: string
                  picture?: string
                  image_hash?: string
                  call_to_action?: {
                    type?: string
                    value?: { link?: string; lead_gen_form_id?: string }
                  }
                }
                video_data?: {
                  message?: string
                  title?: string
                  description?: string
                  image_url?: string
                  call_to_action?: {
                    type?: string
                    value?: { link?: string; lead_gen_form_id?: string }
                  }
                }
              }
              asset_feed_spec?: {
                bodies?: Array<{ text?: string }>
                titles?: Array<{ text?: string }>
                descriptions?: Array<{ text?: string }>
                call_to_action_types?: string[]
                link_urls?: Array<{ website_url?: string }>
                images?: Array<{ url?: string; hash?: string }>
              }
            }
            const creative = (adData as { creative?: { data?: RawCreative } }).creative?.data
            const oss = creative?.object_story_spec
            const link = oss?.link_data
            const vid = oss?.video_data
            const feed = creative?.asset_feed_spec

            // Roy 2026-06-11: dynamic creatives kunnen meerdere bodies /
            // titles bevatten waar de eerste vaak NIET de meest representatieve
            // is. Voor Pedro's iteration-on-source-ad flow moet ALLE tekst van
            // de winning ad bereikbaar zijn als één primary-copy block,
            // anders ziet Pedro "Primary copy: (not available)" terwijl
            // de echte tekst in asset_feed_spec.bodies zit. Concat alle
            // bodies / titles met dubbel-newline scheiding wanneer er meer
            // dan één is - downstream consumers behandelen het dan als
            // gewone primary copy.
            function joinFeedTexts(items: Array<{ text?: string }> | undefined): string {
              if (!items || items.length === 0) return ""
              const seen = new Set<string>()
              const out: string[] = []
              for (const it of items) {
                const t = (it.text ?? "").trim()
                if (!t) continue
                if (seen.has(t)) continue
                seen.add(t)
                out.push(t)
                if (out.length >= 5) break
              }
              return out.join("\n\n")
            }

            // Fallback chain: top-level → object_story_spec → asset_feed first item.
            // When feed bodies/titles exist met meer dan 1 entry, gebruiken
            // we de joined versie zodat alle DNA mee gaat naar Pedro.
            const feedJoinedBody = joinFeedTexts(feed?.bodies)
            const feedJoinedTitle = joinFeedTexts(feed?.titles)
            const feedJoinedDescription = joinFeedTexts(feed?.descriptions)
            const body =
              creative?.body
              || link?.message
              || vid?.message
              || feedJoinedBody
              || feed?.bodies?.[0]?.text
              || ""
            const title =
              creative?.title
              || link?.name
              || vid?.title
              || feedJoinedTitle
              || feed?.titles?.[0]?.text
              || ""
            const description =
              link?.description
              || vid?.description
              || feedJoinedDescription
              || feed?.descriptions?.[0]?.text
              || ""
            const callToActionType =
              creative?.call_to_action_type
              || link?.call_to_action?.type
              || vid?.call_to_action?.type
              || feed?.call_to_action_types?.[0]
              || ""
            const linkUrl =
              creative?.link_url
              || link?.link
              || link?.call_to_action?.value?.link
              || vid?.call_to_action?.value?.link
              || feed?.link_urls?.[0]?.website_url
              || ""

            let creativeType: MetaAdDetail["creativeType"] = "unknown"
            const objectType = (creative?.object_type ?? "").toUpperCase()
            if (objectType.includes("VIDEO")) creativeType = "video"
            else if (objectType.includes("PHOTO") || objectType.includes("IMAGE") || objectType.includes("LINK")) creativeType = "image"

            const adName = filtered.find((d) => d.ad_id === adId)?.ad_name ?? ""
            const hasAssetFeed = (feed?.bodies?.length ?? 0) > 1 || (feed?.titles?.length ?? 0) > 1
            if (/dynamic|dyn\b|flexible/i.test(adName) || objectType.includes("DYNAMIC") || hasAssetFeed) {
              creativeType = "dynamic"
            }

            // Summarise dynamic variation pool so Pedro can read "this
            // dynamic ad rotates across these messages" rather than just
            // seeing the first variation.
            // Roy 2026-06-10 BUG FIX: was sliced at 80 chars per body
            // → primary copy van ~300 chars werd geknipt na 80 → Pedro
            // zag effectief geen DNA en raadde op de ad-naam alleen.
            // Nu: per body 800 chars, per title 200, per description
            // 200. Op één regel per item zodat de prompt scanbaar blijft.
            let assetFeedSummary = ""
            if (feed) {
              const parts: string[] = []
              if (feed.bodies && feed.bodies.length > 0) {
                const lines = feed.bodies.slice(0, 5).map((b, i) => {
                  const t = (b.text ?? "").replace(/\s+/g, " ").trim()
                  return `    ${i + 1}. "${t.slice(0, 800)}${t.length > 800 ? "…" : ""}"`
                })
                parts.push(`Bodies (${feed.bodies.length} total):\n${lines.join("\n")}`)
              }
              if (feed.titles && feed.titles.length > 0) {
                const lines = feed.titles.slice(0, 5).map((t, i) => {
                  const txt = (t.text ?? "").replace(/\s+/g, " ").trim()
                  return `    ${i + 1}. "${txt.slice(0, 200)}${txt.length > 200 ? "…" : ""}"`
                })
                parts.push(`Titles (${feed.titles.length} total):\n${lines.join("\n")}`)
              }
              if (feed.descriptions && feed.descriptions.length > 0) {
                const lines = feed.descriptions.slice(0, 3).map((dsc, i) => {
                  const t = (dsc.text ?? "").replace(/\s+/g, " ").trim()
                  return `    ${i + 1}. "${t.slice(0, 200)}${t.length > 200 ? "…" : ""}"`
                })
                parts.push(`Descriptions (${feed.descriptions.length} total):\n${lines.join("\n")}`)
              }
              assetFeedSummary = parts.join("\n")
            }

            const leadGenFormId =
              link?.call_to_action?.value?.lead_gen_form_id
              || vid?.call_to_action?.value?.lead_gen_form_id
              || ""

            // Roy 2026-06-10: multi-fallback voor thumbnail. Meta
            // retourneert vaak alleen thumbnail_url voor "klassieke" link
            // ads; voor dynamic creatives en sommige link_data ads is
            // het leeg. We proberen:
            //   1. creative.thumbnail_url      (klassieke ads)
            //   2. creative.image_url          (sommige link ads)
            //   3. asset_feed_spec.images[0].url (dynamic creatives, RL standaard)
            //   4. link_data.picture           (link_data ads waar pic
            //                                   wel maar thumbnail niet)
            //   5. video_data.image_url        (video ads - preview frame)
            // Voor imageUrl (hires): zelfde keten met andere prio.
            const firstFeedImageUrl = feed?.images?.find((i) => i?.url)?.url ?? ""
            const resolvedThumbnail =
              creative?.thumbnail_url
              || creative?.image_url
              || firstFeedImageUrl
              || link?.picture
              || vid?.image_url
              || ""
            const resolvedImageUrl =
              creative?.image_url
              || firstFeedImageUrl
              || creative?.thumbnail_url
              || link?.picture
              || vid?.image_url
              || ""

            creativeMap.set(adId, {
              body,
              title,
              description,
              callToActionType,
              linkUrl,
              creativeType,
              thumbnailUrl: resolvedThumbnail,
              imageUrl: resolvedImageUrl,
              assetFeedSummary,
              pageId: oss?.page_id ?? "",
              instagramActorId: oss?.instagram_actor_id ?? "",
              leadGenFormId,
            })
          }
        }
      } catch {
        // Continue without creative details
      }
    }
  }

  return filtered.map((d) => {
    const creative = creativeMap.get(d.ad_id)
    const leads = countLeads(d.actions)
    return {
      adId: d.ad_id,
      adName: d.ad_name,
      adsetName: d.adset_name,
      campaignId: d.campaign_id,
      campaignName: d.campaign_name ?? "",
      adsetId: d.adset_id,
      status: "ACTIVE",
      spend: parseFloat(d.spend ?? "0"),
      impressions: parseInt(d.impressions ?? "0", 10),
      clicks: parseInt(d.clicks ?? "0", 10),
      ctr: parseFloat(d.ctr ?? "0"),
      cpc: parseFloat(d.cpc ?? "0"),
      leads,
      body: creative?.body ?? "",
      title: creative?.title ?? "",
      description: creative?.description ?? "",
      callToActionType: creative?.callToActionType ?? "",
      linkUrl: creative?.linkUrl ?? "",
      creativeType: creative?.creativeType ?? "unknown",
      thumbnailUrl: creative?.thumbnailUrl ?? "",
      imageUrl: creative?.imageUrl ?? "",
      assetFeedSummary: creative?.assetFeedSummary ?? "",
      pageId: creative?.pageId ?? "",
      instagramActorId: creative?.instagramActorId ?? "",
      leadGenFormId: creative?.leadGenFormId ?? "",
    }
  })
}

/**
 * List ad sets within a campaign - fallback resolver voor Push-to-Meta
 * wanneer de gesnapshote winner-adset uit Meta is verwijderd, maar de
 * campagne nog leeft. We pakken de meest-recente niet-DELETED ad set
 * als template-bron. Roy 2026-06-10.
 *
 * Returns id + name + status, sorted by `created_time` desc. Caller
 * filters non-DELETED en pakt de eerste.
 */
export type MetaCampaignAdSet = {
  id: string
  name: string
  status: string
  effectiveStatus: string
  createdTime: string
}

/**
 * Lightweight listing of ad names in an account. Used by Pedro
 * Push-to-Meta to compute the next "Photo N | …" / "Video N | …"
 * number without doing a full insights fetch. Roy 2026-06-10.
 *
 * Returns up to ~500 ad names (recent + active). For RL accounts that
 * usually means full coverage.
 */
export async function fetchAdNamesInAccount(adAccountId: string): Promise<string[]> {
  const token = await getToken()
  const accountId = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`
  const url = `${META_API_BASE}/${accountId}/ads?fields=name&limit=500&access_token=${token}`
  type Raw = { name?: string }
  const data = await fetchAllPages<Raw>(url).catch(() => [] as Raw[])
  return data
    .map((d) => (typeof d.name === "string" ? d.name.trim() : ""))
    .filter((n): n is string => n.length > 0)
}

export async function fetchCampaignAdSets(
  campaignId: string,
): Promise<MetaCampaignAdSet[]> {
  const token = await getToken()
  const url = `${META_API_BASE}/${campaignId}/adsets?fields=id,name,status,effective_status,created_time&limit=50&access_token=${token}`
  type Raw = {
    id?: string
    name?: string
    status?: string
    effective_status?: string
    created_time?: string
  }
  const data = await fetchAllPages<Raw>(url).catch(() => [] as Raw[])
  return data
    .filter((d): d is Required<Pick<Raw, "id" | "name">> & Raw => !!d.id && !!d.name)
    .map((d) => ({
      id: d.id,
      name: d.name,
      status: d.status ?? "",
      effectiveStatus: d.effective_status ?? "",
      createdTime: d.created_time ?? "",
    }))
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime))
}
