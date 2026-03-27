@AGENTS.md

# Rocket Leads Hub — Project Context

Internal dashboard for Rocket Leads (marketing agency) to manage all client data in one place.

## Tech Stack

- **Next.js 16.2.1** (App Router) — NOT v14. Many breaking changes vs training data. Read AGENTS.md.
- **NextAuth v5 beta** (`next-auth@5`) — API differs from v4. Uses `auth()` not `getServerSession()`.
- **Supabase** (PostgreSQL) — all anon access blocked via RLS. Always use `createAdminClient()` (service role) on the server.
- **React Query (TanStack v5)** — all client-side data fetching
- **shadcn/ui + Tailwind CSS** — dark mode, `cn()` utility
- **Monday.com GraphQL API** — cursor pagination, 3-layer board architecture
- **Meta Graph API v20.0** — campaign + insights data
- **Stripe SDK** — billing/invoices
- **Trengo API v2** — conversation/message history

## Critical Next.js 16 Breaking Changes

- **No `middleware.ts`** — use `proxy.ts` with named `proxy` export (not `default`)
- **`params` and `searchParams` are Promises** — always `await params` in server components and API routes
- **`NextAuthRequest`** — import from `next-auth` for proxy type annotations

## Auth

- Google OAuth restricted to `@rocketleads.com` domain + `rocketleadsnl@gmail.com` + `rocketleadshq@gmail.com`
- Session includes `role` field loaded from Supabase `users` table
- Admin-only routes: `/settings`
- Auth config: `src/lib/auth.ts` | Proxy: `src/proxy.ts`

## Supabase

- **Always use `createAdminClient()`** (service role) for all server-side queries — anon key is blocked by RLS
- **Schema**: `users`, `clients`, `client_campaigns`, `client_access`, `api_tokens`, `settings`
- `api_tokens` stores encrypted API keys (AES-256-GCM). Use `decrypt()` from `src/lib/encryption.ts`
- `settings` table holds JSON board config for Monday.com column mappings
- If you get "schema cache" errors: run `NOTIFY pgrst, 'reload schema'` in Supabase SQL Editor

## Monday.com Board Architecture

3 layers:
1. **Onboarding board** (`1316567475`) + **Current clients board** (`1626272350`) — top-level client list
2. Each client row has a column pointing to their own **per-client board ID**
3. Per-client board has lead/KPI data rows

Column mappings are stored in Supabase `settings` table (key `board_config`). Configurable in Settings → Board Config.

## API Keys Storage

All API tokens stored encrypted in Supabase `api_tokens` table. Services: `monday`, `meta`, `stripe`, `trengo`.
Never hardcode or expose keys client-side.

## Race Condition Pattern (Important)

Client pages load Monday data server-side, but `syncClientToSupabase()` is **non-blocking** (fire-and-forget). API routes that need `meta_ad_account_id`, `client_board_id`, or `stripe_customer_id` must accept these as **query params** as fallback — the client components pass them directly from the Monday data rather than waiting for Supabase sync.

## Key File Map

```
src/
  lib/
    auth.ts              — NextAuth v5 config
    monday.ts            — Monday GraphQL client, fetchBothBoards(), fetchClientById()
    meta.ts              — Meta Graph API client
    kpis.ts              — KPI calculation (14 metrics)
    stripe-client.ts     — Stripe billing data + summary
    trengo.ts            — Trengo conversations + messages
    encryption.ts        — AES-256-GCM encrypt/decrypt
    sync-client.ts       — Upsert Monday client to Supabase (non-blocking)
    supabase/server.ts   — createAdminClient() + createClient()
  proxy.ts               — Auth guard for all routes (Next.js 16 middleware replacement)
  app/
    (dashboard)/
      layout.tsx         — Shared layout: Navbar + React Query Provider
      clients/
        page.tsx         — Server: fetches both Monday boards
        _components/
          clients-overview.tsx  — Client: tabs + billing summaries via React Query
          clients-table.tsx     — Client: search/filter table with payment status columns
      clients/[id]/
        page.tsx         — Server: fetchClientById + non-blocking sync
        _components/
          client-tabs.tsx       — Campaigns / Billing / Communication tabs
          campaigns-tab.tsx     — Meta campaigns + KPI data
          campaign-selector.tsx — Active/inactive campaign toggle
          kpi-cards.tsx         — 14 KPI metric cards
          date-filter.tsx       — Date presets + custom range
          utm-table.tsx         — Sortable UTM breakdown
          billing-tab.tsx       — Stripe invoices table
          communication-tab.tsx — Trengo conversations + messages
      settings/
        page.tsx          — Admin only: API tokens, board config, user management
        actions.ts        — Server actions: saveApiToken, saveBoardConfig, updateUserRole
    api/
      clients/[id]/
        campaigns/route.ts
        kpis/route.ts
        billing/route.ts
        conversations/route.ts
        conversations/[convId]/messages/route.ts
      billing-summaries/route.ts   — Bulk Stripe status for clients overview
      settings/test-token/route.ts — Tests API token connectivity
  supabase/migrations/
    20240001000000_initial_schema.sql
    20240002000000_settings_table.sql
```

## Build Status

### Done
- [x] Step 1: Auth (Google OAuth + NextAuth v5) + Supabase connection
- [x] Step 2: Monday.com client list with search/filter
- [x] Step 3: Settings page (API tokens, board config, user management)
- [x] Step 4: Client detail page + Meta campaigns tab + KPI cards + UTM table
- [x] Step 5: Campaign selector (active/inactive toggle) + date filter
- [x] Step 6: Stripe billing tab (invoices, summary cards) + payment status columns in client overview
- [x] Step 7: Trengo communication tab (conversations + message threads)

### Pending
- [ ] Step 8: API health bar in navbar
- [ ] Step 9: Per-user per-client per-tab access control
- [ ] Step 10: Polish (error boundaries, responsive, loading states)
- [ ] Deployment: Vercel + custom domain `hub.rocketleads.com`

## Git

Auto-push to GitHub on every commit via post-commit hook (`.git/hooks/post-commit`).
Repo: `https://github.com/royvosters/rocket-leads-hub`

## Conventions

- All UI text in **English**
- Currency formatted as `€` with `en-GB` locale
- Dates formatted with `en-GB` locale
- No TypeScript `any` — use proper types
- API routes always check `auth()` first and return 401 if no session
- Server components fetch data directly; client components use React Query
