/**
 * Canonical catalogue of "what to refetch after which mutation". Every
 * mutation in the Hub picks one or more of these groups; the
 * `useHubMutation` hook then invalidates the matching React Query keys
 * AND broadcasts the invalidation to other open tabs.
 *
 * Why catalogue instead of "let each call site invalidate":
 *   - Today the call sites are hand-rolled. When a new feature reads
 *     from `["client-detail", id]`, you can only discover the mutations
 *     that need to invalidate it by grepping. That's a bug magnet (see:
 *     KPI cards going stale after agreement edits, fixed 3× already).
 *   - One central definition makes "what surfaces a mutation affects"
 *     reviewable in one diff.
 *   - The Realtime broadcaster (`broadcastInvalidate`) can read from
 *     the same catalogue so server-side writes invalidate exactly the
 *     same queries client-side does.
 *
 * Each entry is an array of React Query keys (with `exact: false` match
 * semantics - `["client-detail"]` matches every per-id child key).
 */
export type InvalidationGroup = ReadonlyArray<ReadonlyArray<unknown>>

export const INVALIDATION_GROUPS = {
  /** Anything that touches an individual client's Monday data, billing,
   *  KPIs, inbox or watchlist position. */
  CLIENT_DETAIL: [
    ["client-detail"],
    ["clients-overview"],
    ["watchlist-state"],
    ["watchlist-expand"],
    ["kpi-summary-single"],
    ["kpi-summaries"],
    // Onboarding wizard reads the same Monday-mirrored fields and shows
    // them in its Hub-connection pickers. Without this, picking a
    // Trengo/Stripe/Monday board/Drive folder in the wizard updates
    // Monday + Supabase but the picker UI still shows the old value
    // until a full page reload. Roy 2026-06-10.
    ["onboarding-wizard"],
  ],
  /** Per-client billing - invoices, agreement state, payment status. */
  BILLING: [
    ["billing-summaries"],
    ["billing"],
    ["clients-overview"],
    ["client-detail"],
  ],
  /** Inbox items: tasks, updates, chat threads. */
  INBOX: [
    ["inbox-items"],
    ["inbox-badge"],
    ["chat-threads"],
  ],
  /** Pedro insights cache (per-client + portfolio). */
  PEDRO: [
    ["pedro-insights"],
    ["pedro-insight-card"],
  ],
  /** Settings → Users + per-user identity reads. */
  USERS: [
    ["admin-users"],
    ["admin-monday-clients"],
  ],
} as const satisfies Record<string, InvalidationGroup>

export type InvalidationGroupName = keyof typeof INVALIDATION_GROUPS
