"use server"

import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { encrypt } from "@/lib/encryption"
import { revalidatePath } from "next/cache"
import type { NotificationKey } from "@/lib/slack/notification-config"
import { DEFAULT_INBOX_AUTOMATION_RULES, ROLES_NEEDING_MONDAY_NAME } from "./types"
import type { MondayRole, InboxAutomationRules } from "./types"

async function requireAdmin() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    throw new Error("Unauthorized")
  }
}

export async function saveApiToken(service: string, token: string) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("api_tokens").upsert(
    {
      service,
      token_encrypted: encrypt(token.trim()),
      is_valid: true,
      last_verified: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "service" }
  )
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function saveBoardConfig(config: Record<string, unknown>) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("settings").upsert({
    key: "board_config",
    value: config,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function updateUserSlackId(userId: string, slackUserId: string) {
  await requireAdmin()
  const cleaned = slackUserId.trim() || null
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ slack_user_id: cleaned })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Map a Hub user to their Fathom user (by email). Hub emails (@rocketleads.com)
 * don't necessarily match Fathom login emails, so the AM picks their Fathom
 * identity from a dropdown sourced from Fathom's `/team_members` endpoint.
 *
 * Used by the meeting matcher to know which AM/CM was in a recorded meeting.
 */
export async function updateUserFathomEmail(userId: string, fathomEmail: string | null) {
  await requireAdmin()
  const cleaned = fathomEmail?.trim().toLowerCase() || null
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ fathom_email: cleaned })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Update a single notification's config field. We merge into whatever exists
 * under settings.slack_notifications so partial updates don't wipe the others.
 */
export async function updateNotificationConfig(
  key: NotificationKey,
  patch: Partial<{ enabled: boolean; hour: number; template: string | null }>,
) {
  await requireAdmin()
  const supabase = await createAdminClient()

  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "slack_notifications")
    .maybeSingle()
  const current = (existing?.value ?? {}) as Record<string, Record<string, unknown>>

  const before = current[key] ?? {}
  const next: Record<string, unknown> = { ...before }
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled
  if (typeof patch.hour === "number") {
    const h = Math.trunc(patch.hour)
    if (h < 0 || h > 23) throw new Error("hour must be 0–23")
    next.hour = h
  }
  if (patch.template !== undefined) {
    // null means "use the built-in default" — we strip the key so getNotificationConfig falls back.
    if (patch.template === null || patch.template.trim() === "") delete next.template
    else next.template = patch.template
  }

  const merged = { ...current, [key]: next }
  const { error } = await supabase.from("settings").upsert({
    key: "slack_notifications",
    value: merged,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function saveSlackChannelId(
  key: "team_watchlist" | "sales",
  channelId: string,
) {
  await requireAdmin()
  const trimmed = channelId.trim()
  const supabase = await createAdminClient()

  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "slack_channels")
    .maybeSingle()
  const current = (existing?.value ?? {}) as Record<string, string>

  const next = { ...current }
  if (trimmed) next[key] = trimmed
  else delete next[key]

  const { error } = await supabase.from("settings").upsert({
    key: "slack_channels",
    value: next,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function updateCloserSlackId(mondayPersonName: string, slackUserId: string) {
  await requireAdmin()
  const trimmed = slackUserId.trim()
  const supabase = await createAdminClient()
  if (!trimmed) {
    const { error } = await supabase
      .from("closer_slack_mappings")
      .delete()
      .eq("monday_person_name", mondayPersonName)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase
      .from("closer_slack_mappings")
      .upsert(
        {
          monday_person_name: mondayPersonName,
          slack_user_id: trimmed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "monday_person_name" },
      )
    if (error) throw new Error(error.message)
  }
  revalidatePath("/settings")
}

export async function updateUserRole(userId: string, role: "admin" | "member" | "guest") {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase.from("users").update({ role }).eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Per-user WhatsApp template name registered in Trengo (e.g.
 * `rl_universal_roel`). The send-endpoint uses this when posting outside the
 * 24h session window. Empty string clears the assignment.
 */
export async function updateUserWhatsappTemplate(userId: string, templateName: string) {
  await requireAdmin()
  const cleaned = templateName.trim() || null
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ whatsapp_template_name: cleaned })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Per-user PRIMARY outbound email channel. The send-client-update route
 * resolves AM from Monday → Hub user, then reads this column to decide
 * which Trengo email channel the outbound mail leaves through. Null
 * = unset → send pipeline hard-fails with `am_email_channel_missing`.
 *
 * Admin-managed centrally here in Settings → Users so freelance AMs
 * don't each have to configure their own /account separately.
 */
export async function updateUserPrimaryEmailChannel(
  userId: string,
  channelId: number | null,
) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ primary_email_channel_id: channelId })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Per-user PRIMARY outbound WhatsApp channel. Mirrors
 * `updateUserPrimaryEmailChannel`. Currently only used by a future
 * WA-bootstrap send flow — the existing WA path inherits the channel
 * from the open ticket — but stored centrally so we don't need another
 * migration when that flow ships.
 */
export async function updateUserPrimaryWaChannel(
  userId: string,
  channelId: number | null,
) {
  await requireAdmin()
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ primary_wa_channel_id: channelId })
    .eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function updateUserName(userId: string, name: string | null) {
  await requireAdmin()
  const trimmed = name?.trim() || null
  const supabase = await createAdminClient()
  const { error } = await supabase.from("users").update({ name: trimmed }).eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

export async function inviteUser(input: {
  email: string
  name?: string | null
  role: "admin" | "member" | "guest"
  mondayRole?: MondayRole | null
  mondayPersonName?: string | null
  slackUserId?: string | null
}) {
  await requireAdmin()
  const normalized = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Invalid email address")
  }
  const slackId = input.slackUserId?.trim() || null
  const name = input.name?.trim() || null
  const supabase = await createAdminClient()
  const { data: inserted, error } = await supabase
    .from("users")
    .insert({ email: normalized, name, role: input.role, slack_user_id: slackId })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") throw new Error("User already exists")
    throw new Error(error.message)
  }

  if (input.mondayRole) {
    // Roles that map to a Monday client-board column require a person name to
    // resolve which client rows belong to this user. Finance doesn't — its
    // mapping is purely "this Hub user is the org's finance person".
    const requiresName = ROLES_NEEDING_MONDAY_NAME.has(input.mondayRole)
    const personName = input.mondayPersonName?.trim() || null
    if (requiresName && !personName) {
      // Skip silently — the user can be assigned a Monday name later from the
      // users table without having to recreate the account.
    } else {
      const { error: mappingErr } = await supabase
        .from("user_column_mappings")
        .insert({
          user_id: inserted.id,
          monday_column_role: input.mondayRole,
          monday_person_name: personName,
        })
      if (mappingErr) throw new Error(mappingErr.message)
    }
  }

  revalidatePath("/settings")
  revalidatePath("/clients")
  return { id: inserted.id }
}

/**
 * Sets a user's Monday mapping to exactly one role+name pair (or clears it).
 * Replaces any existing rows for the user — we now enforce one Monday identity
 * per Hub user from the UI, even though the underlying schema allows multiple.
 */
export async function setUserMondayMapping(
  userId: string,
  mondayRole: MondayRole | null,
  mondayPersonName: string | null,
) {
  await requireAdmin()
  const supabase = await createAdminClient()

  const { error: deleteErr } = await supabase
    .from("user_column_mappings")
    .delete()
    .eq("user_id", userId)
  if (deleteErr) throw new Error(deleteErr.message)

  if (mondayRole) {
    // Same rule as `inviteUser`: roles tied to Monday client-board columns
    // need a person name; finance doesn't.
    const requiresName = ROLES_NEEDING_MONDAY_NAME.has(mondayRole)
    const personName = mondayPersonName?.trim() || null
    if (!requiresName || personName) {
      const { error } = await supabase
        .from("user_column_mappings")
        .insert({
          user_id: userId,
          monday_column_role: mondayRole,
          monday_person_name: personName,
        })
      if (error) throw new Error(error.message)
    }
  }

  revalidatePath("/settings")
  revalidatePath("/clients")
}

/**
 * Toggle a single inbox automation rule. Stored under a single settings row
 * so adding new rules is just adding new keys here + new logic in the cron.
 */
export async function setInboxAutomationRule(
  rule: keyof InboxAutomationRules,
  enabled: boolean,
) {
  await requireAdmin()
  const supabase = await createAdminClient()

  const { data: existing } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "inbox_automation_rules")
    .maybeSingle()
  const current = (existing?.value ?? {}) as Partial<InboxAutomationRules>
  const merged: InboxAutomationRules = {
    ...DEFAULT_INBOX_AUTOMATION_RULES,
    ...current,
    [rule]: enabled,
  }

  const { error } = await supabase.from("settings").upsert({
    key: "inbox_automation_rules",
    value: merged,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

/**
 * Manually trigger the inbox automations runner in TEST MODE — produces the
 * same tasks the daily cron would, but routes them to the admin's own inbox
 * (with [TEST] prefix and a body note about who *would* have received it in
 * production). Lets us validate AI-generated content and rule logic without
 * spamming AMs. Skips the idempotency check so the admin can re-run freely.
 */
export async function triggerInboxAutomationsNow() {
  await requireAdmin()
  const session = await auth()
  if (!session?.user?.id) throw new Error("No session")

  const { runInboxAutomations } = await import("@/lib/inbox/automations")
  const result = await runInboxAutomations({
    testMode: { assigneeUserId: session.user.id },
  })
  revalidatePath("/inbox")
  revalidatePath("/settings")
  return result
}

export async function removeUser(userId: string) {
  await requireAdmin()
  const session = await auth()
  if (session?.user.id === userId) throw new Error("You cannot remove yourself")
  const supabase = await createAdminClient()
  const { error } = await supabase.from("users").delete().eq("id", userId)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

