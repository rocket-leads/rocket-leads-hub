import { createAdminClient } from "@/lib/supabase/server"

export type NotificationKey =
  | "personal_watchlist"
  | "team_watchlist"
  | "personal_sales"
  | "team_sales"

export type NotificationConfig = {
  enabled: boolean
  /** 0–23, Europe/Amsterdam local time. The cron fires hourly; the route only proceeds at this hour. */
  hour: number
  /** Override template. null = use the built-in default. */
  template: string | null
}

export type AllNotificationConfigs = Record<NotificationKey, NotificationConfig>

const DEFAULT_HOUR = 6

const DEFAULTS: AllNotificationConfigs = {
  personal_watchlist: { enabled: true, hour: DEFAULT_HOUR, template: null },
  team_watchlist: { enabled: true, hour: DEFAULT_HOUR, template: null },
  personal_sales: { enabled: true, hour: DEFAULT_HOUR, template: null },
  team_sales: { enabled: true, hour: DEFAULT_HOUR, template: null },
}

const KEYS: NotificationKey[] = [
  "personal_watchlist",
  "team_watchlist",
  "personal_sales",
  "team_sales",
]

function normaliseHour(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_HOUR
  const h = Math.trunc(value)
  if (h < 0 || h > 23) return DEFAULT_HOUR
  return h
}

function normaliseConfig(raw: unknown): NotificationConfig {
  const v = (raw ?? {}) as Record<string, unknown>
  return {
    enabled: v.enabled !== false, // defaults to true
    hour: normaliseHour(v.hour),
    template: typeof v.template === "string" && v.template.length > 0 ? v.template : null,
  }
}

/** Read all four configs from the `settings` table, applying defaults for missing/malformed entries. */
export async function getAllNotificationConfigs(): Promise<AllNotificationConfigs> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "slack_notifications")
    .maybeSingle()
  const raw = (data?.value ?? {}) as Record<string, unknown>

  const result = { ...DEFAULTS }
  for (const key of KEYS) {
    if (raw[key]) result[key] = normaliseConfig(raw[key])
  }
  return result
}

export async function getNotificationConfig(key: NotificationKey): Promise<NotificationConfig> {
  const all = await getAllNotificationConfigs()
  return all[key]
}

/**
 * Replace `{{var}}` placeholders with values, then collapse 3+ consecutive
 * newlines into a double newline so empty optional sections don't leave gaps.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  let out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const v = vars[name]
    if (v === undefined || v === null) return ""
    return String(v)
  })
  // Collapse 3+ blank lines into 2 (one separator). Trim trailing whitespace.
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd()
  return out
}

// ─── Default templates ─────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES: Record<NotificationKey, string> = {
  personal_watchlist: `{{greeting}}

*{{score_line}}*
{{bucket_line}}

{{concerns_section}}
{{persistent_section}}
{{wins_section}}
{{open_link}}`,

  team_watchlist: `{{greeting}}

*{{score_line}}*
{{bucket_line}}

{{cm_ranking_section}}
{{revenue_ranking_section}}
{{unassigned_section}}`,

  personal_sales: `Goedemorgen {{first_name}}.

*Gisteren*
{{yesterday_lines}}

*Vandaag*
{{today_lines}}

*Deze maand ({{month_label}})*
{{mtd_lines}}

{{action_items_section}}`,

  team_sales: `{{greeting}}

*Gisteren*
{{yesterday_lines}}

*Vandaag*
{{today_lines}}

{{action_items_section}}

*Deze maand ({{month_label}})*
{{mtd_lines}}

{{leaderboard_section}}`,
}

// ─── Variable reference (used by the Settings UI) ──────────────────────────

export type VariableDoc = { name: string; description: string }

export const AVAILABLE_VARIABLES: Record<NotificationKey, VariableDoc[]> = {
  personal_watchlist: [
    { name: "greeting", description: "Tone-aware morning greeting line." },
    { name: "score_line", description: "Health score + day delta + 7d avg trend (no bold)." },
    { name: "bucket_line", description: "🟢 X healthy · 🟡 Y watch · 🔴 Z action." },
    { name: "healthy_count", description: "Just the count of healthy clients." },
    { name: "watch_count", description: "Just the count of watch clients." },
    { name: "action_count", description: "Just the count of action clients." },
    { name: "concerns_section", description: "Full block (header + bullets) for new concerns today, or empty." },
    { name: "wins_section", description: "Full block for wins today, or empty." },
    { name: "persistent_section", description: "Day 3 / day 7 persistent concerns block, or empty." },
    { name: "open_link", description: "Slack link to open the Watchlist page." },
  ],
  team_watchlist: [
    { name: "greeting", description: "Date-deterministic random morning greeting." },
    { name: "score_line", description: "Health score + day delta + 7d avg trend (no bold)." },
    { name: "bucket_line", description: "🟢 X healthy · 🟡 Y watch · 🔴 Z action across the tracked teams." },
    { name: "healthy_count", description: "Just the count of healthy clients." },
    { name: "watch_count", description: "Just the count of watch clients." },
    { name: "action_count", description: "Just the count of action clients." },
    { name: "cm_ranking_section", description: "Campaign Manager ranking block (header + medal bullets)." },
    { name: "revenue_ranking_section", description: "Revenue ranking block (header + medal bullets)." },
    { name: "unassigned_section", description: "Unassigned revenue callout (only renders when there's untracked revenue to fix)." },
    { name: "open_link", description: "Slack link to open the Watchlist page." },
  ],
  personal_sales: [
    { name: "first_name", description: "Closer's first name (split on space)." },
    { name: "closer_name", description: "Full closer name." },
    { name: "yesterday_lines", description: "Bullet lines about yesterday's calls + status breakdown." },
    { name: "today_lines", description: "Bullet line(s) about today's planned calls." },
    { name: "mtd_lines", description: "Bullet lines for MTD: taken, deals, revenue, conversion vs targets." },
    { name: "month_label", description: "Lowercase Dutch month name (e.g. 'april')." },
    { name: "action_items_section", description: "Empty-outcome action items block, or empty." },
    { name: "open_link", description: "Slack link to open the Targets page." },
  ],
  team_sales: [
    { name: "greeting", description: "Date-deterministic random morning greeting." },
    { name: "yesterday_lines", description: "Per-closer yesterday breakdown (calls + outcomes); plus a sub-section for deals closed yesterday from older calls." },
    { name: "today_lines", description: "Aggregated bullet line about today's planned calls." },
    { name: "mtd_lines", description: "Aggregated MTD vs targets bullet lines." },
    { name: "month_label", description: "Lowercase Dutch month name." },
    { name: "leaderboard_section", description: "Closer leaderboard block (top 3 by deals, MTD-active closers only), or empty." },
    { name: "action_items_section", description: ":rotating_light: header + per-closer empty-call-outcome counts. Empty when all outcomes are logged." },
    { name: "open_link", description: "Slack link to open the Targets page." },
  ],
}

// ─── Schedule guard helper ─────────────────────────────────────────────────

/**
 * Returns true if the cron should proceed: enabled AND current Amsterdam hour
 * matches the configured hour. Bypasses the hour check when force=true.
 */
export function shouldRunNow(config: NotificationConfig, force: boolean): {
  ok: boolean
  reason?: string
} {
  if (force) return { ok: config.enabled, reason: config.enabled ? undefined : "disabled in settings" }
  if (!config.enabled) return { ok: false, reason: "disabled in settings" }

  // Round to nearest hour Amsterdam-time so a cron fire at 05:59 still counts as "06:00".
  // Vercel cron timing can drift a few seconds in either direction; a strict equality on
  // the hour string previously caused entire days to be skipped when the cron fired
  // 1-2 seconds early. The cron schedule (`0 * * * *`) only fires at minute 0 each hour,
  // so the ±30-min window around the configured hour overlaps exactly one firing — no
  // double-fire risk.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date())
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10)
  const effectiveHour = minute < 30 ? hour : (hour + 1) % 24
  const targetStr = String(config.hour).padStart(2, "0")
  if (effectiveHour !== config.hour) {
    return {
      ok: false,
      reason: `Not ${targetStr}:00 Amsterdam (currently ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}, effective hour ${String(effectiveHour).padStart(2, "0")})`,
    }
  }
  return { ok: true }
}
