import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

/**
 * Apify integration - minimal wrapper around the Apify API for running
 * actors and pulling their results.
 *
 * We use this for Meta Ad Library scraping (apify~facebook-ads-scraper)
 * during the onboarding wizard's competitor research step. Meta's Ad
 * Library has Cloudflare + bot protection that breaks home-grown
 * scrapers within weeks; Apify maintains the scraper against the live
 * site for us at a few cents per run.
 *
 * Token is stored encrypted in `api_tokens` under service='apify' - same
 * pattern as Fathom/Monday/Trengo. The in-memory cache mirrors the
 * Fathom wrapper's behaviour (5-min TTL, busted on 401/403).
 */

const BASE_URL = "https://api.apify.com/v2"

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getApifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "apify")
    .single()
  if (!data) {
    throw new Error("Apify token not configured. Go to Settings → API Tokens.")
  }
  const token = decrypt(data.token_encrypted).trim()
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

export function clearApifyTokenCache() {
  cachedToken = null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function apifyFetch<T>(
  path: string,
  init: RequestInit = {},
  retries = 3,
): Promise<T> {
  const token = await getApifyToken()
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        // No body header here - caller sets Content-Type when POSTing JSON
      },
      // Auth-bearing API responses aren't ISR-cacheable. Same logic as
      // the Fathom wrapper - a stale 4xx parked in the Next Data Cache
      // for minutes makes every call look like the token expired.
      cache: "no-store",
    })

    if (res.status === 401 || res.status === 403) {
      clearApifyTokenCache()
      const text = await res.text().catch(() => "")
      throw new Error(`Apify API error ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }

    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10)
      const delay = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt
      await sleep(delay)
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Apify API error ${res.status}: ${text.slice(0, 200) || res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  throw new Error("Apify API rate limit exceeded after retries")
}

// ─── Public types ──────────────────────────────────────────────────────────

export type ApifyActor = "apify/facebook-ads-scraper"

/** Subset of the Apify run lifecycle we care about. There are more states
 *  (ABORTING, TIMED_OUT, etc.) but for our purposes "is it done?" is the
 *  only question that matters. */
export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTED"
  | "TIMED_OUT"
  | "ABORTING"

type ApifyRunResponse = {
  data: {
    id: string
    actId: string
    status: ApifyRunStatus
    startedAt: string
    finishedAt: string | null
    defaultDatasetId: string
    defaultKeyValueStoreId: string
  }
}

/** Item shape returned by the Facebook Ads Scraper actor (apify/facebook-
 *  ads-scraper). Reflects the fields documented on the actor's page - we
 *  only declare the ones we use; Apify may return more.
 *
 *  Note: Apify periodically tweaks output schemas. Treat every field as
 *  potentially-missing at runtime; the orchestrator validates before
 *  storing to Supabase. */
export type FacebookAdScrapeResult = {
  ad_archive_id?: string
  page_id?: string
  page_name?: string
  page_url?: string
  /** Unix timestamp (seconds) when the ad started running. */
  start_date?: number
  end_date?: number | null
  /** Active or inactive. We filter for active=true to get only currently-
   *  running ads. */
  is_active?: boolean
  publisher_platform?: string[]
  /** Ad creative - primary body of the ad. Multiple snapshots may exist
   *  for carousel/multi-card formats. */
  snapshot?: {
    title?: string
    body?: { text?: string }
    cta_text?: string
    cta_type?: string
    page_name?: string
    page_profile_picture_url?: string
    creation_time?: number
    images?: Array<{ resized_image_url?: string; original_image_url?: string }>
    videos?: Array<{ video_hd_url?: string; video_sd_url?: string; video_preview_image_url?: string }>
    cards?: Array<{
      title?: string
      body?: string
      image_url?: string
      video_hd_url?: string
      link_url?: string
    }>
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Start an Apify actor run. Returns the run ID - caller polls until the
 * status is terminal, then reads the dataset via {@link getDatasetItems}.
 *
 * `input` shape varies per actor. For the Facebook Ads Scraper see the
 * scraper-specific helpers further down (`runFacebookAdsScraper`).
 */
export async function startActorRun(
  actor: ApifyActor,
  input: Record<string, unknown>,
): Promise<{ runId: string; datasetId: string }> {
  // Apify accepts the actor in `user~name` form (slash → tilde) in URLs.
  const actorPath = actor.replace("/", "~")
  const res = await apifyFetch<ApifyRunResponse>(`/acts/${actorPath}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return {
    runId: res.data.id,
    datasetId: res.data.defaultDatasetId,
  }
}

/**
 * Get the current status of a run. Used by the orchestrator's polling
 * loop while waiting for the scraper to finish.
 */
export async function getRunStatus(runId: string): Promise<ApifyRunStatus> {
  const res = await apifyFetch<ApifyRunResponse>(`/actor-runs/${runId}`)
  return res.data.status
}

/**
 * Pull items from a dataset once the run is done. We don't paginate
 * (the scraper's typical 50-200 item output fits in a single fetch).
 * `limit` caps how many items to pull so we don't blow up memory on a
 * runaway scrape.
 */
export async function getDatasetItems<T = unknown>(
  datasetId: string,
  limit = 500,
): Promise<T[]> {
  const items = await apifyFetch<T[]>(
    `/datasets/${datasetId}/items?clean=1&limit=${limit}&format=json`,
  )
  return items
}

/**
 * Block until a run is in a terminal state (SUCCEEDED / FAILED /
 * ABORTED / TIMED_OUT). Polls every `pollMs` (default 3s) up to
 * `timeoutMs` total (default 90s).
 *
 * Facebook Ads Scraper typically finishes in 20-60s for a single
 * advertiser. If we're consistently hitting the timeout, raise it -
 * don't shorten the poll interval (Apify rate-limits).
 */
export async function waitForRun(
  runId: string,
  { pollMs = 3000, timeoutMs = 90_000 }: { pollMs?: number; timeoutMs?: number } = {},
): Promise<ApifyRunStatus> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await getRunStatus(runId)
    if (
      status === "SUCCEEDED" ||
      status === "FAILED" ||
      status === "ABORTED" ||
      status === "TIMED_OUT"
    ) {
      return status
    }
    await sleep(pollMs)
  }
  throw new Error(`Apify run ${runId} timed out after ${timeoutMs}ms`)
}

/**
 * High-level helper: run the Facebook Ads Scraper for a given Meta page
 * URL (advertiser homepage on Facebook). Returns active ads only, sorted
 * server-side by Apify's relevance - caller is responsible for further
 * ranking (e.g. by days_running for "winning ads").
 *
 * `country` filters to ads visible from that locale. Defaults to NL
 * (Rocket Leads is NL/BE focused). Pass "BE" / "DE" etc. as needed.
 *
 * `maxAds` caps the per-advertiser result count - the actor's default
 * is too generous for our cost profile.
 */
export async function runFacebookAdsScraper(args: {
  pageUrls: string[]
  country?: string
  maxAds?: number
  activeOnly?: boolean
}): Promise<FacebookAdScrapeResult[]> {
  const input = {
    urls: args.pageUrls.map((u) => ({ url: u })),
    country: args.country ?? "NL",
    "ads.activeStatus": args.activeOnly === false ? "all" : "active",
    "ads.maxItems": args.maxAds ?? 30,
  }
  const { runId, datasetId } = await startActorRun("apify/facebook-ads-scraper", input)
  const status = await waitForRun(runId)
  if (status !== "SUCCEEDED") {
    throw new Error(`Facebook Ads Scraper run finished with status ${status}`)
  }
  return getDatasetItems<FacebookAdScrapeResult>(datasetId)
}

/**
 * Test-token helper - used by the Settings → API Tokens "Test" button.
 * Hits a cheap endpoint (`/users/me`) that 401s on bad tokens and 200s
 * on good ones, without consuming any compute units.
 */
export async function testApifyToken(): Promise<{ ok: boolean; message: string }> {
  try {
    await apifyFetch<{ data: { username: string } }>("/users/me")
    return { ok: true, message: "Apify token valid" }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Unknown error" }
  }
}
