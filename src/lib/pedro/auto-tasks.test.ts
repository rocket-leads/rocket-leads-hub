import { describe, it, expect } from "vitest"
import {
  decideForClient,
  decideAutoClose,
  decideBillingHealthTask,
  decideAutoCloseBillingHealth,
  ACTION_TASK_THRESHOLD,
  MAX_OPEN_PEDRO_TASKS_PER_USER,
  RECENT_CLOSED_DEDUP_DAYS,
  PEDRO_TASK_MARKER,
  PEDRO_BILLING_HEALTH_MARKER,
  type DecideInput,
  type BillingHealthTaskInput,
} from "./auto-tasks"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingHealthVerdict } from "@/lib/clients/billing-health"

/**
 * Anti-spam invariants - every guardrail in decideForClient gets a
 * positive AND negative case here. A regression in any of these
 * silently floods the team's inbox; the test names map 1:1 to the
 * SkipReason enum so a failure tells you exactly which gate broke.
 */

function makeClient(): MondayClient {
  return {
    mondayItemId: "1",
    name: "Test Client",
    firstName: "Test",
    companyName: "Test BV",
    accountManager: "AM",
    campaignManager: "CM",
    appointmentSetter: "Setter",
    campaignStatus: "Live",
    kickOffDate: "",
    adBudget: "1000",
    serviceFee: "1000",
    followUpFee: "",
    followUpStatus: "",
    metaConnected: "",
    metaAdAccountId: "act_999",
    stripeCustomerId: "cus_test",
    trengoContactId: "",
    clientBoardId: "",
    googleDriveId: "",
    cycleStartDate: "",
    nextInvoiceDate: "",
    boardType: "current",
  } as MondayClient
}

const NOW_ISO = "2026-05-09T12:00:00Z"

function input(overrides: Partial<DecideInput> = {}): DecideInput {
  return {
    client: overrides.client ?? makeClient(),
    category: "action",
    daysInBucket: 3,
    severity: ACTION_TASK_THRESHOLD * 2, // well above gate
    assigneeUserId: "user-cm-1",
    existingPedroTask: null,
    openTasksForAssignee: 0,
    now: NOW_ISO,
    ...overrides,
  }
}

// ─── Bucket gate ─────────────────────────────────────────────────────────

describe("decideForClient - bucket gate (skip non-Action)", () => {
  it("skips watch bucket", () => {
    const d = decideForClient(input({ category: "watch" }))
    expect(d).toEqual({ action: "skip", reason: "not_in_action" })
  })

  it("skips good bucket", () => {
    const d = decideForClient(input({ category: "good" }))
    expect(d).toEqual({ action: "skip", reason: "not_in_action" })
  })

  it("skips no-data bucket", () => {
    const d = decideForClient(input({ category: "no-data" }))
    expect(d).toEqual({ action: "skip", reason: "not_in_action" })
  })
})

// ─── Stickiness gate ─────────────────────────────────────────────────────

describe("decideForClient - stickiness gate (≥2 days)", () => {
  it("skips when daysInBucket is 0 (just landed today)", () => {
    expect(decideForClient(input({ daysInBucket: 0 })).action).toBe("skip")
    expect(decideForClient(input({ daysInBucket: 0 }))).toMatchObject({ reason: "too_fresh" })
  })

  it("skips when daysInBucket is 1 (transient - let recover)", () => {
    expect(decideForClient(input({ daysInBucket: 1 }))).toMatchObject({ reason: "too_fresh" })
  })

  it("skips when daysInBucket is null (state unknown)", () => {
    expect(decideForClient(input({ daysInBucket: null }))).toMatchObject({ reason: "too_fresh" })
  })

  it("creates when daysInBucket is exactly the minimum (2)", () => {
    const d = decideForClient(input({ daysInBucket: 2 }))
    expect(d.action).toBe("create")
  })

  it("creates when daysInBucket is far above minimum (7)", () => {
    const d = decideForClient(input({ daysInBucket: 7 }))
    expect(d.action).toBe("create")
  })
})

// ─── Severity gate ───────────────────────────────────────────────────────

describe("decideForClient - severity gate", () => {
  it("skips below the threshold (low-impact spike on tiny spend)", () => {
    const d = decideForClient(input({ severity: ACTION_TASK_THRESHOLD - 1 }))
    expect(d).toMatchObject({ action: "skip", reason: "low_severity" })
  })

  it("creates exactly at the threshold", () => {
    const d = decideForClient(input({ severity: ACTION_TASK_THRESHOLD }))
    expect(d.action).toBe("create")
  })

  it("creates well above the threshold", () => {
    const d = decideForClient(input({ severity: ACTION_TASK_THRESHOLD * 5 }))
    expect(d.action).toBe("create")
  })
})

// ─── Assignee gate ───────────────────────────────────────────────────────

describe("decideForClient - assignee gate (no fallback to phantom user)", () => {
  it("skips when no Hub user is mapped to the CM/AM", () => {
    const d = decideForClient(input({ assigneeUserId: null }))
    expect(d).toMatchObject({ action: "skip", reason: "no_assignee" })
  })
})

// ─── Dedup gate ──────────────────────────────────────────────────────────

describe("decideForClient - dedup (open task)", () => {
  it("skips when an open Pedro task already exists for this client", () => {
    const d = decideForClient(
      input({ existingPedroTask: { status: "open", completedAt: null } }),
    )
    expect(d).toMatchObject({ action: "skip", reason: "open_task_exists" })
  })

  it("skips when an in_progress Pedro task already exists", () => {
    const d = decideForClient(
      input({ existingPedroTask: { status: "in_progress", completedAt: null } }),
    )
    expect(d).toMatchObject({ action: "skip", reason: "open_task_exists" })
  })

  it("DOES create when the existing task was cancelled", () => {
    // Cancelled = explicitly invalidated, not a closed-by-CM. Pedro can
    // re-fire because the previous task didn't represent CM acknowledgement.
    const d = decideForClient(
      input({ existingPedroTask: { status: "cancelled", completedAt: null } }),
    )
    expect(d.action).toBe("create")
  })
})

describe("decideForClient - recently-closed dedup (CM just resolved)", () => {
  it("skips when a Pedro task was closed by the CM 2 days ago", () => {
    const closedAt = new Date(new Date(NOW_ISO).getTime() - 2 * 86_400_000).toISOString()
    const d = decideForClient(
      input({ existingPedroTask: { status: "done", completedAt: closedAt } }),
    )
    expect(d).toMatchObject({ action: "skip", reason: "recently_closed" })
  })

  it("creates when the previous task was closed > 7 days ago", () => {
    const closedAt = new Date(
      new Date(NOW_ISO).getTime() - (RECENT_CLOSED_DEDUP_DAYS + 1) * 86_400_000,
    ).toISOString()
    const d = decideForClient(
      input({ existingPedroTask: { status: "done", completedAt: closedAt } }),
    )
    expect(d.action).toBe("create")
  })

  it("treats a done task with no completedAt as eligible to re-create (data-quality fallback)", () => {
    // Defensive: if completed_at is null but status is done, we don't have
    // info to gate on - treat as if the dedup gate passes. The caller's
    // database constraint should normally prevent this.
    const d = decideForClient(
      input({ existingPedroTask: { status: "done", completedAt: null } }),
    )
    expect(d.action).toBe("create")
  })
})

// ─── Per-CM cap ──────────────────────────────────────────────────────────

describe("decideForClient - per-assignee cap", () => {
  it("creates when assignee is below cap", () => {
    const d = decideForClient(
      input({ openTasksForAssignee: MAX_OPEN_PEDRO_TASKS_PER_USER - 1 }),
    )
    expect(d.action).toBe("create")
  })

  it("skips at cap (we don't displace human prioritisation)", () => {
    const d = decideForClient(
      input({ openTasksForAssignee: MAX_OPEN_PEDRO_TASKS_PER_USER }),
    )
    expect(d).toMatchObject({ action: "skip", reason: "assignee_at_cap" })
  })

  it("skips above cap (defensive)", () => {
    const d = decideForClient(
      input({ openTasksForAssignee: MAX_OPEN_PEDRO_TASKS_PER_USER + 5 }),
    )
    expect(d).toMatchObject({ action: "skip", reason: "assignee_at_cap" })
  })
})

// ─── Create payload shape ────────────────────────────────────────────────

describe("decideForClient - create payload", () => {
  it("includes the marker on source_ref so the cron can find its own tasks", () => {
    const d = decideForClient(input())
    if (d.action !== "create") throw new Error("expected create")
    expect(d.sourceRef.marker).toBe(PEDRO_TASK_MARKER)
    expect(d.sourceRef.trigger).toMatch(/action_bucket/i)
  })

  it("title references the client name and days in bucket", () => {
    const client = makeClient()
    client.name = "Acme BV"
    const d = decideForClient(input({ client, daysInBucket: 4 }))
    if (d.action !== "create") throw new Error("expected create")
    expect(d.title).toContain("Acme BV")
    expect(d.title).toContain("4d")
  })

  it("assigneeUserId on the candidate equals the input assigneeUserId", () => {
    const d = decideForClient(input({ assigneeUserId: "user-special" }))
    if (d.action !== "create") throw new Error("expected create")
    expect(d.assigneeUserId).toBe("user-special")
  })
})

// ─── Auto-close ──────────────────────────────────────────────────────────

describe("decideAutoClose", () => {
  it("does NOT close when the client is still in Action", () => {
    expect(decideAutoClose("action").close).toBe(false)
  })

  it("closes when the client moved to Watch", () => {
    const d = decideAutoClose("watch")
    expect(d.close).toBe(true)
    if (!d.close) throw new Error("expected close")
    expect(d.reason).toMatch(/Watch/)
  })

  it("closes when the client moved to Good", () => {
    const d = decideAutoClose("good")
    expect(d.close).toBe(true)
    if (!d.close) throw new Error("expected close")
    expect(d.reason).toMatch(/Good/)
  })

  it("closes when the client dropped to no-data", () => {
    const d = decideAutoClose("no-data")
    expect(d.close).toBe(true)
  })
})

// ─── Billing-health task - guardrails ───────────────────────────────────

describe("decideBillingHealthTask - guardrails", () => {
  function verdict(overrides: Partial<BillingHealthVerdict> = {}): BillingHealthVerdict {
    return {
      hasIssue: true,
      severity: "billing_error",
      reason: "ACCOUNT_DISABLED",
      label: "Meta account: Disabled",
      expectedWeeklyBudget: 462,
      actualSpendLast7d: 50,
      spendRatio: 0.11,
      metaHealth: {
        adAccountId: "act_999",
        accountStatus: 2,
        accountStatusLabel: "Disabled",
        isBillingIssue: true,
        disableReason: 1,
        fundingSourceLabel: "Visa **** 1234",
        fetchedAt: "2026-05-09T11:00:00Z",
      },
      ...overrides,
    }
  }

  function billingInput(overrides: Partial<BillingHealthTaskInput> = {}): BillingHealthTaskInput {
    return {
      client: makeClient(),
      verdict: verdict(),
      assigneeUserId: "user-am-1",
      existingTask: null,
      openTasksForAssignee: 0,
      now: NOW_ISO,
      ...overrides,
    }
  }

  it("skips when no verdict is available (cache miss / fetch failed)", () => {
    const d = decideBillingHealthTask(billingInput({ verdict: null }))
    expect(d).toEqual({ action: "skip", reason: "no_issue" })
  })

  it("skips when verdict is healthy (hasIssue=false)", () => {
    const d = decideBillingHealthTask(
      billingInput({
        verdict: verdict({ hasIssue: false, severity: "ok", reason: "NONE" }),
      }),
    )
    expect(d).toEqual({ action: "skip", reason: "no_issue" })
  })

  it("skips when no AM mapping (no fallback to phantom user)", () => {
    const d = decideBillingHealthTask(billingInput({ assigneeUserId: null }))
    expect(d).toEqual({ action: "skip", reason: "no_am_assignee" })
  })

  it("skips when an open billing task already exists (no re-nagging)", () => {
    const d = decideBillingHealthTask(
      billingInput({ existingTask: { status: "open", completedAt: null } }),
    )
    expect(d).toEqual({ action: "skip", reason: "open_task_exists" })
  })

  it("skips when a billing task was closed within the recently-closed window", () => {
    // Closed 2 days ago - still within RECENT_CLOSED_DEDUP_DAYS (7)
    const closedAt = "2026-05-07T12:00:00Z"
    const d = decideBillingHealthTask(
      billingInput({ existingTask: { status: "done", completedAt: closedAt } }),
    )
    expect(d).toEqual({ action: "skip", reason: "recently_closed" })
  })

  it("creates when the previous billing task closed > 7 days ago (re-eligible)", () => {
    const closedAt = "2026-04-25T12:00:00Z" // 14 days before NOW_ISO
    const d = decideBillingHealthTask(
      billingInput({ existingTask: { status: "done", completedAt: closedAt } }),
    )
    expect(d.action).toBe("create")
  })

  it("skips at the per-assignee cap (shared across markers)", () => {
    const d = decideBillingHealthTask(
      billingInput({ openTasksForAssignee: MAX_OPEN_PEDRO_TASKS_PER_USER }),
    )
    expect(d).toEqual({ action: "skip", reason: "assignee_at_cap" })
  })

  it("create payload - title flags billing_error vs severe_underspend distinctly", () => {
    const errorTask = decideBillingHealthTask(billingInput())
    expect(errorTask.action).toBe("create")
    if (errorTask.action !== "create") throw new Error("expected create")
    expect(errorTask.title).toMatch(/billing error confirmed/i)

    const underspendTask = decideBillingHealthTask(
      billingInput({
        verdict: verdict({
          severity: "severe_underspend",
          reason: "UNDERSPEND_SEVERE",
          label: "Underspending - €50 spent vs €462 expected",
        }),
      }),
    )
    expect(underspendTask.action).toBe("create")
    if (underspendTask.action !== "create") throw new Error("expected create")
    expect(underspendTask.title).toMatch(/severe underspend/i)
  })

  it("create payload - body embeds the Dutch client-facing message verbatim", () => {
    const d = decideBillingHealthTask(billingInput())
    if (d.action !== "create") throw new Error("expected create")
    // The pre-baked Dutch template starts with "Hé {firstName}," and
    // mentions "betaalprobleem" - both are the AM's hint that they can
    // copy-paste the bottom block straight to the client.
    expect(d.body).toContain("Hé Test")
    expect(d.body).toContain("betaalprobleem")
    expect(d.body).toContain("Meta Business Manager")
  })

  it("create payload - sourceRef carries the verdict severity + reason for filtering", () => {
    const d = decideBillingHealthTask(billingInput())
    if (d.action !== "create") throw new Error("expected create")
    expect(d.sourceRef.marker).toBe(PEDRO_BILLING_HEALTH_MARKER)
    expect(d.sourceRef.severity).toBe("billing_error")
    expect(d.sourceRef.reason).toBe("ACCOUNT_DISABLED")
  })
})

describe("decideAutoCloseBillingHealth - only closes when verdict clears", () => {
  it("closes when there is no verdict at all (Meta data gone)", () => {
    const d = decideAutoCloseBillingHealth(null)
    expect(d.close).toBe(true)
  })

  it("closes when verdict went healthy (hasIssue=false)", () => {
    const d = decideAutoCloseBillingHealth({
      hasIssue: false,
      severity: "ok",
      reason: "NONE",
      label: "Meta account: Active",
      expectedWeeklyBudget: 462,
      actualSpendLast7d: 450,
      spendRatio: 0.97,
      metaHealth: null,
    })
    expect(d.close).toBe(true)
  })

  it("does NOT close while the issue is still active", () => {
    const d = decideAutoCloseBillingHealth({
      hasIssue: true,
      severity: "billing_error",
      reason: "ACCOUNT_DISABLED",
      label: "Meta account: Disabled",
      expectedWeeklyBudget: 462,
      actualSpendLast7d: 0,
      spendRatio: 0,
      metaHealth: null,
    })
    expect(d.close).toBe(false)
  })
})
