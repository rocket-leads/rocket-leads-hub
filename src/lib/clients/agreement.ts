import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

/** Default follow-up fee used when seeding a new agreement and no fee value
 *  is present in Monday. Matches the standard RL price per the HTO breakdown. */
export const DEFAULT_FOLLOW_UP_FEE = 750

export const PLATFORMS = ["meta", "google", "tiktok"] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * Flat agreement shape - one Monday client row = one campaign. The legacy
 * `campaigns[]` array is gone; consolidation across siblings sharing a Stripe
 * customer happens at the billing UI layer (group by stripe_customer_id), not
 * in the data model. See migration 20240026000000_flatten_client_agreements.
 */
export type Agreement = {
  ad_budget: number
  platforms: Platform[]
  platform_fees: Partial<Record<Platform, number>>
  follow_up: boolean
  follow_up_fee: number
  notes: string
}

export const EMPTY_AGREEMENT: Agreement = {
  ad_budget: 0,
  platforms: [],
  platform_fees: {},
  follow_up: false,
  follow_up_fee: 0,
  notes: "",
}

/**
 * Sum of platform fees for currently selected platforms + follow-up fee if
 * enabled. Unselected platforms are ignored even if a fee is stored - that
 * way deselecting a platform doesn't silently still bill it, and reselecting
 * restores the previous number without re-typing.
 */
export function agreementMonthly(a: Agreement): number {
  const platformFees = a.platforms.reduce((sum, p) => sum + (a.platform_fees[p] ?? 0), 0)
  return platformFees + (a.follow_up ? a.follow_up_fee : 0)
}

/**
 * Resolve a Monday item ID to the Supabase clients.id UUID. Returns null when
 * the client hasn't been synced yet - callers should surface a clear error
 * rather than silently creating an orphan row.
 */
async function resolveSupabaseClientId(mondayItemId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  return data?.id ?? null
}

export async function getAgreement(mondayItemId: string): Promise<Agreement> {
  const clientId = await resolveSupabaseClientId(mondayItemId)
  if (!clientId) return EMPTY_AGREEMENT

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("client_agreements")
    .select("ad_budget, platforms, platform_fees, follow_up, follow_up_fee, notes")
    .eq("client_id", clientId)
    .maybeSingle()

  if (!data) return EMPTY_AGREEMENT
  return normalizeAgreement(data)
}

export async function saveAgreement(
  mondayItemId: string,
  agreement: Agreement,
  updatedBy: string,
): Promise<void> {
  const clientId = await resolveSupabaseClientId(mondayItemId)
  if (!clientId) {
    throw new Error(
      `Client ${mondayItemId} not synced to Supabase yet. Open the clients page once to trigger the initial sync.`,
    )
  }

  const clean = normalizeAgreement(agreement)
  const supabase = await createAdminClient()
  const { error } = await supabase.from("client_agreements").upsert({
    client_id: clientId,
    ad_budget: clean.ad_budget,
    platforms: clean.platforms,
    platform_fees: clean.platform_fees,
    follow_up: clean.follow_up,
    follow_up_fee: clean.follow_up_fee,
    notes: clean.notes,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Failed to save agreement: ${error.message}`)
}

export type SeedMode = "if-missing" | "if-untouched"

/**
 * Seed a default Meta-only agreement for a freshly-synced client.
 *
 * Defaults derived from Monday: ad budget = Monday adBudget, Meta fee = Monday
 * serviceFee, follow-up = on when Monday's "follow-up by" status mentions
 * Rocket Leads, follow-up fee = Monday's number column or DEFAULT_FOLLOW_UP_FEE
 * when empty.
 *
 * Modes:
 * - `if-missing` (default, used during sync): only seed when no agreement
 *   row exists. Existing rows are left alone so manual edits via the UI are
 *   never overwritten.
 * - `if-untouched` (admin backfill): also re-seed when a row exists but
 *   `updated_by IS NULL` - i.e. the row was auto-seeded and never edited
 *   through the UI (which sets `updated_by` to the editing user). Useful for
 *   refreshing stale defaults after the seed logic itself improves.
 */
export async function seedDefaultAgreementIfMissing(
  client: MondayClient,
  supabaseClientId: string,
  mode: SeedMode = "if-missing",
): Promise<"inserted" | "updated" | "skipped"> {
  const supabase = await createAdminClient()

  const { data: existing } = await supabase
    .from("client_agreements")
    .select("client_id, updated_by")
    .eq("client_id", supabaseClientId)
    .maybeSingle()

  if (existing) {
    // Manual edit happened - never touch.
    if (existing.updated_by) return "skipped"
    // Untouched default - only refresh when explicitly asked.
    if (mode === "if-missing") return "skipped"
  }

  const adBudget = parseEuro(client.adBudget)
  const serviceFee = parseEuro(client.serviceFee)
  const followUpByRL = isFollowUpByRL(client.followUpStatus)
  const followUpFee = followUpByRL
    ? parseEuro(client.followUpFee) || DEFAULT_FOLLOW_UP_FEE
    : DEFAULT_FOLLOW_UP_FEE

  const seed = {
    client_id: supabaseClientId,
    ad_budget: adBudget,
    platforms: ["meta"],
    platform_fees: { meta: serviceFee },
    follow_up: followUpByRL,
    follow_up_fee: followUpFee,
    notes: "",
  }

  if (existing) {
    await supabase
      .from("client_agreements")
      .update({ ...seed, updated_at: new Date().toISOString() })
      .eq("client_id", supabaseClientId)
    return "updated"
  }

  await supabase.from("client_agreements").insert(seed)
  return "inserted"
}

/** Permissive matcher - any status label that mentions "rocket" (case-insensitive)
 *  counts as RL doing the follow-up. Anything else (incl. empty) means we don't. */
function isFollowUpByRL(status: string): boolean {
  return /rocket/i.test(status)
}

/** Tolerant euro parser - Monday returns values like "1500", "€1.500",
 *  "1.500,00" depending on the column type. Strips anything that isn't a
 *  digit or sign and returns 0 when nothing parseable is left. */
function parseEuro(raw: string): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[^0-9-]/g, "")
  if (!cleaned) return 0
  const n = Number(cleaned)
  return isFinite(n) ? n : 0
}

/**
 * Defensive normalisation - JSONB / array columns can technically contain
 * anything, so we coerce each field to its expected shape on read/write.
 * Keeps callers from having to handle malformed legacy rows.
 */
export function normalizeAgreement(raw: unknown): Agreement {
  const x = (raw ?? {}) as Record<string, unknown>
  const platforms = Array.isArray(x.platforms)
    ? (x.platforms.filter((p) => PLATFORMS.includes(p as Platform)) as Platform[])
    : []
  const platformFeesRaw = (x.platform_fees ?? {}) as Record<string, unknown>
  const platform_fees: Partial<Record<Platform, number>> = {}
  for (const p of PLATFORMS) {
    const v = platformFeesRaw[p]
    if (typeof v === "number" && isFinite(v)) platform_fees[p] = v
  }
  return {
    ad_budget: typeof x.ad_budget === "number" ? x.ad_budget : Number(x.ad_budget) || 0,
    platforms,
    platform_fees,
    follow_up: x.follow_up === true,
    follow_up_fee:
      typeof x.follow_up_fee === "number" ? x.follow_up_fee : Number(x.follow_up_fee) || 0,
    notes: typeof x.notes === "string" ? x.notes : "",
  }
}
