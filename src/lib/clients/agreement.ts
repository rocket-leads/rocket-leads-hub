import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

/** Default follow-up fee used when seeding a new agreement and no fee value
 *  is present in Monday. Matches the standard RL price per the HTO breakdown. */
export const DEFAULT_FOLLOW_UP_FEE = 750

export const PLATFORMS = ["meta", "google", "tiktok"] as const
export type Platform = (typeof PLATFORMS)[number]

export type AgreementCampaign = {
  id: string
  name: string
  ad_budget: number
  platforms: Platform[]
  platform_fees: Partial<Record<Platform, number>>
  follow_up: boolean
  follow_up_fee: number
  notes: string
}

export type Agreement = {
  campaigns: AgreementCampaign[]
  notes: string | null
}

export const EMPTY_AGREEMENT: Agreement = { campaigns: [], notes: null }

export function newCampaign(): AgreementCampaign {
  return {
    id: crypto.randomUUID(),
    name: "",
    ad_budget: 0,
    platforms: ["meta"],
    platform_fees: { meta: 0 },
    follow_up: false,
    follow_up_fee: 0,
    notes: "",
  }
}

/**
 * Sum of platform fees for currently selected platforms + follow-up fee if
 * enabled. Unselected platforms are ignored even if a fee is stored — that
 * way deselecting a platform doesn't silently still bill it, and reselecting
 * restores the previous number without re-typing.
 */
export function campaignMonthly(c: AgreementCampaign): number {
  const platformFees = c.platforms.reduce((sum, p) => sum + (c.platform_fees[p] ?? 0), 0)
  return platformFees + (c.follow_up ? c.follow_up_fee : 0)
}

export function totalMRR(campaigns: AgreementCampaign[]): number {
  return campaigns.reduce((sum, c) => sum + campaignMonthly(c), 0)
}

export function totalAdBudget(campaigns: AgreementCampaign[]): number {
  return campaigns.reduce((sum, c) => sum + (c.ad_budget || 0), 0)
}

/**
 * Resolve a Monday item ID to the Supabase clients.id UUID. Returns null when
 * the client hasn't been synced yet — callers should surface a clear error
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
    .select("campaigns, notes")
    .eq("client_id", clientId)
    .maybeSingle()

  if (!data) return EMPTY_AGREEMENT
  return {
    campaigns: normalizeCampaigns(data.campaigns),
    notes: data.notes,
  }
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

  const supabase = await createAdminClient()
  const { error } = await supabase.from("client_agreements").upsert({
    client_id: clientId,
    campaigns: normalizeCampaigns(agreement.campaigns),
    notes: agreement.notes,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Failed to save agreement: ${error.message}`)
}

export type SeedMode = "if-missing" | "if-untouched"

/**
 * Seed a default single-Meta-campaign agreement for a freshly-synced client.
 *
 * Defaults derived from Monday: campaign name = client name, ad budget =
 * Monday adBudget, Meta fee = Monday serviceFee, follow-up = on when Monday's
 * "follow-up by" status mentions Rocket Leads, follow-up fee = Monday's
 * number column or `DEFAULT_FOLLOW_UP_FEE` when empty.
 *
 * Modes:
 * - `if-missing` (default, used during sync): only seed when no agreement
 *   row exists. Existing rows are left alone so manual edits via the UI are
 *   never overwritten.
 * - `if-untouched` (admin backfill): also re-seed when a row exists but
 *   `updated_by IS NULL` — i.e. the row was auto-seeded and never edited
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
    // Manual edit happened — never touch.
    if (existing.updated_by) return "skipped"
    // Untouched default — only refresh when explicitly asked.
    if (mode === "if-missing") return "skipped"
  }

  const adBudget = parseEuro(client.adBudget)
  const serviceFee = parseEuro(client.serviceFee)
  const followUpByRL = isFollowUpByRL(client.followUpStatus)
  const followUpFee = followUpByRL
    ? parseEuro(client.followUpFee) || DEFAULT_FOLLOW_UP_FEE
    : DEFAULT_FOLLOW_UP_FEE

  const campaign: AgreementCampaign = {
    id: crypto.randomUUID(),
    name: client.name,
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
      .update({ campaigns: [campaign], updated_at: new Date().toISOString() })
      .eq("client_id", supabaseClientId)
    return "updated"
  }

  await supabase.from("client_agreements").insert({
    client_id: supabaseClientId,
    campaigns: [campaign],
  })
  return "inserted"
}

/** Permissive matcher — any status label that mentions "rocket" (case-insensitive)
 *  counts as RL doing the follow-up. Anything else (incl. empty) means we don't. */
function isFollowUpByRL(status: string): boolean {
  return /rocket/i.test(status)
}

/** Tolerant euro parser — Monday returns values like "1500", "€1.500",
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
 * Defensive normalisation — JSONB can technically contain anything, so we
 * coerce each field to its expected shape on read/write. Keeps the rest of
 * the code from having to handle malformed legacy rows.
 */
function normalizeCampaigns(raw: unknown): AgreementCampaign[] {
  if (!Array.isArray(raw)) return []
  return raw.map((c) => {
    const x = (c ?? {}) as Record<string, unknown>
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
      id: typeof x.id === "string" && x.id ? x.id : crypto.randomUUID(),
      name: typeof x.name === "string" ? x.name : "",
      ad_budget: typeof x.ad_budget === "number" ? x.ad_budget : 0,
      platforms,
      platform_fees,
      follow_up: x.follow_up === true,
      follow_up_fee: typeof x.follow_up_fee === "number" ? x.follow_up_fee : 0,
      notes: typeof x.notes === "string" ? x.notes : "",
    }
  })
}
