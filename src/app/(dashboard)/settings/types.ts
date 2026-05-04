/**
 * Shared types and constants for the settings module.
 *
 * Lives in its own file because `actions.ts` is `"use server"` — Next.js 16
 * forbids non-async-function exports from server-action files at runtime
 * ("A 'use server' file can only export async functions, found object").
 * Anything that isn't a server action (types, default-value constants, plain
 * helpers) belongs here so callers can import it without dragging server-only
 * code along.
 */

export type MondayRole = "account_manager" | "campaign_manager" | "appointment_setter"

export type InboxAutomationRules = {
  payment_overdue_task: boolean
  positive_client_signal_cpl_drop: boolean
  next_invoice_due_task: boolean
}

export const DEFAULT_INBOX_AUTOMATION_RULES: InboxAutomationRules = {
  payment_overdue_task: true,
  positive_client_signal_cpl_drop: true,
  next_invoice_due_task: true,
}
