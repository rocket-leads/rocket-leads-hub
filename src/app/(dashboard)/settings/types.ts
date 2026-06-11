/**
 * Shared types and constants for the settings module.
 *
 * Lives in its own file because `actions.ts` is `"use server"` - Next.js 16
 * forbids non-async-function exports from server-action files at runtime
 * ("A 'use server' file can only export async functions, found object").
 * Anything that isn't a server action (types, default-value constants, plain
 * helpers) belongs here so callers can import it without dragging server-only
 * code along.
 */

export type MondayRole = "account_manager" | "campaign_manager" | "appointment_setter" | "finance"

/** Single source of truth for Monday-role labels. Use everywhere a role is
 *  rendered to avoid raw `account_manager` strings ever leaking into the UI. */
export const MONDAY_ROLE_LABELS: Record<MondayRole, string> = {
  account_manager: "Account Manager",
  campaign_manager: "Campaign Manager",
  appointment_setter: "Appointment Setter",
  finance: "Finance",
}

/** Roles that DO map to a column on the Monday client boards (so they need a
 *  Monday person name). Finance doesn't - it's org-level, no client-column. */
export const ROLES_NEEDING_MONDAY_NAME: ReadonlySet<MondayRole> = new Set([
  "account_manager",
  "campaign_manager",
  "appointment_setter",
])

export type InboxAutomationRules = {
  payment_overdue_task: boolean
  positive_client_signal_cpl_drop: boolean
  // `next_invoice_due_task` was removed - finance handles invoicing fast
  // enough that an auto-task adds noise. The Billing page now flags overdue
  // Stripe state via a sidebar dot for the finance user instead.
  auto_complete_invoice_tasks: boolean
  dedup_overlapping_tasks: boolean
}

export const DEFAULT_INBOX_AUTOMATION_RULES: InboxAutomationRules = {
  payment_overdue_task: true,
  positive_client_signal_cpl_drop: true,
  auto_complete_invoice_tasks: true,
  // Dedup defaults OFF - admin opts in after reviewing what AI would cancel
  // (see Settings → Inbox automations → "Run now (test mode)").
  dedup_overlapping_tasks: false,
}
