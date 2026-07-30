/**
 * Environment secrets posture — presence only, never values.
 *
 * Infra secrets (encryption key, OAuth client secrets, webhook signing secrets,
 * cron token, push keys) stay in env vars on purpose: they gate the whole
 * process, they're rotated by redeploy, and they must never be editable from a
 * UI. Unlike the 11 service API tokens — which live encrypted in the DB and ARE
 * managed from the Connections list — these have no Settings surface at all, so
 * a missing one is invisible until something silently breaks (a webhook stops
 * verifying, push stops sending).
 *
 * This module reports which of the known env vars are LOADED vs MISSING so the
 * Integrations · System panel + the posture hero can show "18/21 loaded", the
 * same at-a-glance signal as the 187N reference. It reads `process.env` on the
 * server and returns booleans only — a value is never read into the payload, so
 * nothing sensitive can leak to the client.
 */

export type EnvPostureItem = {
  /** The env var name (shown mono in the panel). */
  key: string
  /** Human label for what it powers. */
  label: string
  /** Grouping for the panel. */
  group: "Core" | "Auth & OAuth" | "Webhooks" | "Push" | "Config"
  /** Critical secrets missing = red; non-critical missing = amber. */
  critical: boolean
  /** True when the env var is set to a non-empty value. */
  loaded: boolean
}

type EnvSpec = Omit<EnvPostureItem, "loaded"> & {
  /** Alternate env names that also satisfy this entry (e.g. NextAuth accepts
   *  AUTH_SECRET or NEXTAUTH_SECRET). Loaded when any of key/altKeys is set. */
  altKeys?: string[]
}

// The known env vars, from an audit of process.env usage across src/. Ordered by
// group. `critical` marks the ones whose absence breaks a core capability.
const ENV_SPECS: EnvSpec[] = [
  { key: "ENCRYPTION_KEY", label: "AES key for all stored secrets", group: "Core", critical: true },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Server DB access (bypasses RLS)", group: "Core", critical: true },
  { key: "NEXT_PUBLIC_SUPABASE_URL", label: "Supabase project URL", group: "Core", critical: true },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", label: "Supabase anon key (client)", group: "Core", critical: true },
  { key: "CRON_SECRET", label: "Bearer token for cron endpoints", group: "Core", critical: true },
  { key: "AUTH_SECRET", label: "NextAuth session signing", group: "Core", critical: true, altKeys: ["NEXTAUTH_SECRET"] },

  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth (sign-in + Calendar)", group: "Auth & OAuth", critical: true },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth secret", group: "Auth & OAuth", critical: true },
  { key: "SLACK_CLIENT_ID", label: "Slack OAuth (reply-as-self)", group: "Auth & OAuth", critical: false },
  { key: "SLACK_CLIENT_SECRET", label: "Slack OAuth secret", group: "Auth & OAuth", critical: false },
  { key: "SLACK_SIGNING_SECRET", label: "Slack Events webhook verify", group: "Auth & OAuth", critical: false },

  { key: "MONDAY_WEBHOOK_SECRET", label: "Monday webhook verify", group: "Webhooks", critical: false },
  { key: "TRENGO_WEBHOOK_SECRET", label: "Trengo webhook verify", group: "Webhooks", critical: false },
  { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe webhook verify", group: "Webhooks", critical: false },
  { key: "FATHOM_WEBHOOK_SECRET", label: "Fathom webhook verify", group: "Webhooks", critical: false },

  { key: "VAPID_PUBLIC_KEY", label: "Web push public key", group: "Push", critical: false },
  { key: "VAPID_PRIVATE_KEY", label: "Web push private key", group: "Push", critical: false },
  { key: "NEXT_PUBLIC_VAPID_PUBLIC_KEY", label: "Web push key (client)", group: "Push", critical: false },
  { key: "VAPID_CONTACT_EMAIL", label: "Web push contact email", group: "Push", critical: false },

  { key: "NEXT_PUBLIC_HUB_URL", label: "Canonical Hub URL", group: "Config", critical: false },
  { key: "GOOGLE_SHEETS_SPREADSHEET_ID", label: "Targets/Finance sheet ID", group: "Config", critical: false },
  { key: "RL_OWN_AD_ACCOUNT_ID", label: "Rocket Leads own ad account", group: "Config", critical: false },
  { key: "RL_CLIENTS_DRIVE_PARENT_ID", label: "Client Drive parent folder", group: "Config", critical: false },
]

function isLoaded(key: string): boolean {
  const v = process.env[key]
  return typeof v === "string" && v.trim().length > 0
}

/** Presence-only posture for every known env var. Server-only. */
export function getEnvPosture(): EnvPostureItem[] {
  return ENV_SPECS.map(({ altKeys, ...spec }) => ({
    ...spec,
    loaded: isLoaded(spec.key) || (altKeys ?? []).some(isLoaded),
  }))
}

/** Roll-up counts for the posture hero chip. `criticalMissing` drives the
 *  chip tone (red when any critical secret is absent). */
export function summarizeEnvPosture(items: EnvPostureItem[]): {
  loaded: number
  total: number
  criticalMissing: number
} {
  const loaded = items.filter((i) => i.loaded).length
  const criticalMissing = items.filter((i) => i.critical && !i.loaded).length
  return { loaded, total: items.length, criticalMissing }
}
