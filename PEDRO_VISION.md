# Pedro — Campaign Manager AI: Vision & Roadmap

> **Status:** Last updated 2026-05-07. Living document — update as Pedro evolves.
> **Owner:** Roy
> **Pedro's job:** be the AI campaign manager that handles every Rocket Leads onboarding from kick-off to live ads, and progressively takes over the monthly optimisation cycle for every active client.

---

## Why Pedro exists

Rocket Leads delivers a marketing-and-sales-machine to every client. The bottleneck is **campaign manager capacity** — every new client needs a campaign manager to translate the kick-off into:

1. Marketing angles
2. Video scripts
3. Creatives (Manus prompts)
4. Landing pages (Loveable)
5. Ad copy (Meta)

…and then keep iterating monthly with creative refreshes, new angles, and copy variants. At ~100 active clients with a target margin of 60%, this work cannot be done linearly by humans. Pedro is how we 10× output without 10×ing the team.

Pedro is **not** a replacement for the campaign manager — Pedro is the campaign manager's force multiplier. The CM reviews, refines, and ships. Pedro drafts, drafts, drafts.

The vision in one line: **the campaign manager opens Pedro on Monday morning, reviews 5 ready-to-ship deliverables, and ships them by lunch.**

---

## Pedro's two operating modes

### Mode 1 — Onboarding specialist (currently 80% built)

A new client lands on the onboarding board. Pedro detects this, gathers every byte of context (kick-off transcript, Monday updates, Trengo, brand, website), and produces:

- Brief (auto-filled from hub data, AM reviews)
- 5 marketing angles (selected by AM)
- 4-5 video scripts (DOCX export to client)
- Manus prompts for creatives (per format)
- Loveable prompt for the landing page
- Ad copy variant A + B + 5 headlines + descriptions

The CM hits "next" through 6 stages. Pedro proposes; the CM curates. End state: a complete first-month campaign package, ready for client feedback within hours of the kick-off — not days.

### Mode 2 — Optimisation analyst (next 4-8 weeks of build)

For every Live client, Pedro reads:

- **Meta ad performance** (last 7d / 14d / 30d, per-ad CPL, CTR, frequency)
- **Monday CRM lead feedback** per UTM (so we know quality, not just cost)
- **Watch List state** (which clients are "Action Needed")
- **Trengo client sentiment** (recent complaints, satisfaction signals)
- **Last evaluation meeting transcript** (what the AM and client agreed)

…and produces, on demand or proactively:

- **Creative refresh proposals** ("itereer op 'Photo 2 - Pricelist' — €25 CPL, top winner. 3 nieuwe varianten in dezelfde richting.")
- **New angle test plans** when current angle is fatigued ("Subsidie-angle uitgewerkt — test 'urgency without date' next.")
- **Copy variants** for ad fatigue ("CTR daalt op variant A. Hier 3 nieuwe versies in zelfde tone.")
- **Lead-quality fixes** ("Ad X: 5/8 leads zeggen 'geen budget'. Voeg budget-vraag toe aan leadform.")

The output goes to the Hub inbox as a task assigned to the CM. CM reviews, approves, ships.

This is where Pedro 10×s the agency.

---

## The data Pedro can see

Pedro is only as good as the context we feed him. Every additional source we wire in is direct quality uplift on every deliverable.

| Source | What's there | Status | Used for |
|---|---|---|---|
| **Monday CRM (clients board)** | Client metadata: ICP, budget, status, AM, CM | ✓ wired | Brief auto-fill |
| **Monday item updates** | Kick-off update + recent comments per client | ✓ wired (90d, 8 most recent) | Brief auto-fill, evolution tracking |
| **Monday lead board** | Per-lead status, qualification, deal close, lead-feedback updates per UTM | ◯ partial | Optimisation: lead quality per ad |
| **Fathom kick-off transcript** | Full discovery conversation | ✓ wired (10k chars) | Brief auto-fill, ICP extraction |
| **Fathom evaluation transcripts** | Most-recent eval prioritised — never older if newer exists | ✓ wired (6k chars, latest only) | Brief refresh, optimisation pivots |
| **Fathom sales/internal/other** | Lower priority context | ✓ partial (1 included) | Background |
| **Trengo conversations** | Client WhatsApp + email, satisfaction + complaints | ✓ wired (5 convs, 6 msgs each) | Sentiment, urgent issues |
| **Slack threads** | Internal AM↔CM coordination per client | ◯ not yet | Future: implicit decisions |
| **Meta Graph API** | Active campaigns, ads, spend, CPL, CTR, frequency, creative content | ◯ partial (style ref only — research) | Optimisation mode (build) |
| **Meta winning ads (RL portfolio)** | All RL ads across all clients in same niche | ✓ wired (research) | Style reference, pattern lib |
| **Watch List state** | Categorised health, severity score, AI insights | ◯ not consumed by Pedro yet | Optimisation triggers |
| **Stripe billing** | Cycle, ad budget pause status | — | Not relevant for content |
| **knowledge/campaigns.md** | RL playbook: angles per branche, scripts, hooks | ✓ wired (system prompt) | Every Pedro AI call |
| **knowledge/brand.md** | Tone of voice, brand colours, USPs | ✓ wired (system prompt) | Every Pedro AI call |
| **Per-client past Pedro output** | Briefs/angles/scripts from previous campaigns | ✓ stored, ◯ not yet referenced | Future: in-context examples |
| **Per-vertical winning patterns** | "B2B coaches that work" / "Renovatie hooks that win" | — | Future: cross-client learning |

---

## Three quality multipliers (the moat)

Pedro's quality compounds along three axes. These are what make Pedro better than a generic "ChatGPT for ads."

### 1. Most-recent-eval prioritisation (the no-noise rule)

Roy's rule: never let stale eval transcripts contradict current eval. The most recent evaluation meeting is leading; older ones are background.

✓ Implemented in `/api/pedro/auto-brief`. Prompt explicitly tells Claude: "Negeer expliciet tegenstrijdige info uit oude meetings of updates."

To extend: same logic for optimisation mode (most recent month's CPL > older months').

### 2. Lead feedback over CPL alone (quality, not just cost)

Per `knowledge/campaigns.md`: a cheap ad that produces "geen budget" leads is worse than an expensive ad that produces deals. Pedro must read Monday lead-board updates per UTM and weigh that **above** raw CPL.

◯ Not yet wired — this is high-priority Phase 3.

### 3. Per-client knowledge accrual (every campaign trains the next)

Every brief, angle, script, and ad copy Pedro produces is stored per client (✓ `pedro_client_state` table). Future Pedro calls for the same client should include "you wrote this last campaign — what worked, what didn't" as context.

Combined with Meta performance data for those past creatives, Pedro can self-correct: "We tested this angle last month — CPL was €45 (target €25), ad was paused after 7 days. Don't repeat this angle."

---

## Roadmap

Phased so each phase ships value independently. Don't chain too tightly — the agency's needs will shift Pedro's priorities.

### Phase 1 — Onboarding MVP ✓ (largely done, this commit)

- [x] Pedro section in Hub sidebar
- [x] Hub-native UI (TopTabs, shadcn components, hub colours, light/dark)
- [x] Hub client picker with data-signal badges (kick-off / eval / saved campaign)
- [x] AI auto-brief from Monday + Fathom + Trengo + knowledge base
- [x] Most-recent-eval prioritisation in auto-brief prompt
- [x] Per-client deliverable storage (`pedro_client_state`)
- [x] Auto-load saved campaigns when client is re-picked
- [x] Debounced auto-save on every state change
- [x] All 7 stages (brief, research, angles, script, creatives, LP, ad copy) functional
- [x] Knowledge base injection (campaigns.md + brand.md as system prompt)
- [x] Shared Anthropic key with rest of hub (no separate token)

### Phase 2 — Onboarding excellence (next 1-2 weeks)

Make every stage of onboarding produce world-class output by feeding Pedro better context per stage.

- [ ] **Per-stage prompt library** — angles/script/creatives/LP/adcopy each have their own Claude prompts in `src/lib/pedro/prompts/` (currently inline strings in components). Easier to iterate.
- [ ] **Video script library as in-context examples** — feed `knowledge/campaigns.md`'s 14+ video script bodies as few-shot examples in the script generator stage. Pedro learns RL's exact tone from real examples.
- [x] **Past-campaign context** — server-side enrichment of `/api/pedro/claude` and `/api/pedro/auto-brief` with prior Pedro output for the same client. Stage-aware: angles get past angles, scripts get past scripts, etc. Lives in [src/lib/pedro/past-campaigns.ts](src/lib/pedro/past-campaigns.ts).
- [x] **Cross-client examples by vertical** — when generating angles/script/ad-copy for a client, Pedro pulls 3-5 winning ads from same-vertical RL clients (last 30d, CPL-driven scoring against each candidate's own account-avg). Lives in [src/lib/pedro/cross-client-examples.ts](src/lib/pedro/cross-client-examples.ts). Vertical match via keyword-overlap on `brief.sector`. Wired into [/api/pedro/claude](src/app/api/pedro/claude/route.ts) (angles + script + ad-copy stages) and [/api/pedro/creative-refresh](src/app/api/pedro/creative-refresh/route.ts). Anonymised in prompt — Pedro never name-drops other RL clients in output. Per `knowledge/campaigns.md` 2026-Q2 status note: CPL-driven, not lead-quality-validated; explicit caveat in the prompt.
- [ ] **Brief explainability** — under each auto-filled field, show which source(s) Pedro used (`Bron: kick-off 2026-04-12 + laatste eval`). Single-source claims build trust; AM knows what to verify.
- [ ] **Brief diffing** — when re-running auto-brief on an existing client, show what Pedro would change vs. the saved brief, with a per-field "accept/reject."
- [ ] **Slack thread ingestion** — read recent #client-X channel discussions for additional context. Slack often holds decisions that never make it to Monday.
- [ ] **Brand-style auto-extraction quality** — current CSS scraper is brittle. Add fallback: ask Claude to read a screenshot of the homepage if CSS scrape fails.
- [ ] **Manus prompt quality** — feed Pedro the actual `prompts/manus-master-prompt.md` template and have Pedro fill it in stage-aware (currently a static template + AI fills variables).
- [ ] **Loveable prompt quality** — same: structured template + per-client filled fields.
- [ ] **Output-quality eval harness** — every Pedro deliverable gets stored. Build a `/api/pedro/eval` script that lets Roy A/B compare two prompt versions on the same 10 historical clients. Iterate prompts with data, not vibes.

### Phase 3 — Optimisation mode (4-8 weeks)

Pedro stops being onboarding-only and starts running monthly creative refreshes for every Live client.

- [x] **Meta performance ingest** — `/api/pedro/client-performance?clientId=X&days=30` aggregates window Meta data: per-ad spend/leads/CPL/CTR/frequency, account stats, prior-window trend deltas, and per-ad winner/loser/neutral verdicts via [src/lib/pedro/performance.ts](src/lib/pedro/performance.ts). Cached 5min via `cachedFetch`. Ready for the creative-refresh stage to consume.
- [ ] **Lead-quality per UTM** — query Monday lead board for the client; group leads by UTM; surface qualification rate, conversion rate, and free-text feedback patterns ("3/5 leads zeggen 'geen budget' → ad sucks regardless of CPL").
- [x] **Pedro stage: "Creative refresh"** — new top-tab. Inputs: client + window (7/14/30/60d). Outputs: 1-3 proposals (one per winner), each with 3 variants (hook + script outline + primary copy + why). Powered by [/api/pedro/creative-refresh](src/app/api/pedro/creative-refresh/route.ts) + [PedroRefresh](src/app/(dashboard)/pedro/_components/pedro-refresh.tsx). No-winners path falls through with explicit "this is a new-angle moment, not a refresh moment" message. Auto-saves to `pedro_client_state.creatives.refreshes[]` (capped at 20 historical entries).
- [ ] **Pedro stage: "New angle test"** — when current angle is fatigued (Pedro detects: same angle, multiple creatives, all CPL > 1.4× account avg, 14d). Outputs: 2 new angles from the framework + 3 scripts each.
- [ ] **Pedro stage: "Copy refresh"** — when CTR on variant A drops > 25% over 14d. Outputs: 3 new variant A's in same tone.
- [ ] **Pedro stage: "Lead-quality fix"** — when Monday updates per UTM show consistent "no budget" / "wrong audience" patterns. Outputs: leadform changes (add qualification question), targeting tweaks, or angle pivot.
- [x] **Watch List integration** — every Action / Watch row in the watchlist now has an "Ask Pedro" chip in the AI Note cell. One click → opens Pedro at `?tab=refresh&clientId=X&auto=1`, auto-fires the refresh flow. Pedro page is URL-param-aware (`tab` + `clientId` + `auto`). Future: per-category routing (Action → refresh vs Watch → angle-test) once those modes ship.
- [ ] **Per-client monthly digest** — automated cron: 1st of each month, Pedro produces "what worked / what didn't / what to test" for every Live client. Output as Hub inbox task assigned to CM.
- [ ] **Watch List score → Pedro priority queue** — high-severity clients are surfaced in a "Pedro to-do" feed at the top of the Pedro page. CM clicks through them in priority order each morning.

### Phase 4 — Proactive intelligence (8-16 weeks)

Pedro stops waiting to be asked. He notices, proposes, alerts.

- [x] **Kick-off auto-trigger** — when a Fathom kick-off is ingested + matched to a client, Pedro fires `generateAutoBrief` and saves the result as a draft on `pedro_client_state` (campaign #1). An inbox task lands on the campaign manager (resolved via `user_column_mappings`): "Pedro brief klaar voor [Klant] — review en start campagne", with a deep-link to `/pedro?tab=brief&clientId=X`. Dedupe: skipped if any `pedro_client_state` row already exists for the client (CM has already started). Silent on failure. Lives in [src/lib/pedro/auto-trigger.ts](src/lib/pedro/auto-trigger.ts), hooked into [src/lib/meetings/ingest.ts](src/lib/meetings/ingest.ts).
- [x] **Eval meeting digestion** — Fathom eval ingest fires Pedro's digest generator ([generate-eval-digest.ts](src/lib/pedro/generate-eval-digest.ts)). Claude is the strict gate: routine "alles is goed" check-ins return `actionable: false` and produce no task. Real signals (ICP shift, new pain, new objection, pricing/scope changes, client requests, performance feedback, satisfaction) become an inbox task assigned to the CM with severity-coded priority + deep-link to the suggested Pedro stage (brief_update / new_angle / creative_refresh / etc.). Dedupe via `inbox_events.source_ref->>meetingId` so re-ingest is safe. Health endpoint + Settings → Pedro tab now surface the eval funnel separately (ingested → linked → fired → severity split). Hooked in [ingest.ts](src/lib/meetings/ingest.ts).
- [ ] **Performance anomaly alerts** — daily cron: if any Live client has CPL > 25% degraded vs 14d baseline, Pedro auto-generates a fix proposal and tasks the CM. (Currently the Watch List flags these; Pedro should make the next move.)
- [ ] **Churn-risk reactive content** — when sentiment in Trengo turns negative (cron sentiment scan), Pedro produces "AM check-in talking points" for the next call. Helps the AM walk in armed.
- [ ] **Quarterly strategy review prep** — 1 week before each quarterly review, Pedro produces: 3-month performance summary + ICP fit analysis + recommended next-quarter angles. CM gets it in inbox.
- [ ] **Multi-language support** — Pedro currently always outputs Dutch. Some clients abroad need English. Detect from client's language signals (Monday updates, ad copy history) and auto-switch.

### Phase 5 — Cross-client intelligence (16+ weeks)

The agency-level moat. Every campaign Pedro touches teaches the next one.

- [x] **Per-vertical pattern library** — `pedro_vertical_patterns` table refreshed nightly by [/api/cron/refresh-pedro-patterns](src/app/api/cron/refresh-pedro-patterns/route.ts) (04:00). Per vertical (normalised first-token of `brief.sector`): top winners (CPL-driven, last 30d), Claude-synthesised common angles + hooks, format distribution, sample size, client count. [cross-client-examples.ts](src/lib/pedro/cross-client-examples.ts) reads from this table first (instant), falls back to live Meta query when not yet computed. Library grows with every Pedro client. Per `knowledge/campaigns.md` 2026-Q2 status note: CPL-driven (lead-quality validation is Phase 5+ once Monday data is normalised).
- [x] **Agency-wide insights** — new Pedro **Insights** tab ([pedro-insights.tsx](src/app/(dashboard)/pedro/_components/pedro-insights.tsx)) renders `pedro_vertical_patterns` per vertical: top winners (anonymised — only sector aliases shown, never client names), Claude-synthesised common angles + hooks with frequency, format distribution chips, sample size + client count, search-by-vertical. Powered by [/api/pedro/insights](src/app/api/pedro/insights/route.ts).
- [ ] **Client-fit scoring** — when a new lead lands in sales pipeline (sales call booked), Pedro scores ICP fit based on agency's portfolio: "Sterk fit — vergelijkbaar met Werk en Berg en Adeqo, beiden >€100K omzet/mnd. Lage CPL waarschijnlijk." or "Risk: hyper-lokaal. Werkt zelden voor RL — past niet in ICP."
- [x] **Auto-update knowledge base** — weekly cron [/api/cron/pedro-knowledge-proposals](src/app/api/cron/pedro-knowledge-proposals/route.ts) (Mon 08:00) detects convergence (≥5 winners across ≥3 distinct clients) on angles/hooks not yet covered in `knowledge/campaigns.md`. Pedro composes a proposed addition, persists in `pedro_knowledge_proposals`, and creates an inbox task for Roy. Manual review + manual file edit (auto-write deliberately not built — knowledge file is loaded into every Pedro AI call, blast radius too high). Accept/reject via [/api/pedro/knowledge-proposals](src/app/api/pedro/knowledge-proposals/route.ts) closes the loop.
- [~] **AI avatar workflow** — *scaffolding shipped 2026-05-08.* Provider abstraction at [src/lib/pedro/avatar/types.ts](src/lib/pedro/avatar/types.ts), resolver at [src/lib/pedro/avatar/index.ts](src/lib/pedro/avatar/index.ts), Heygen provider stub at [src/lib/pedro/avatar/heygen.ts](src/lib/pedro/avatar/heygen.ts). Heygen API key is configurable via Settings → API Tokens. Full implementation pending — open decisions:
   - **Account model**: single RL Heygen org vs per-client (impacts billing visibility + avatar isolation)
   - **Avatar model**: RL-shared library vs per-client custom-trained (custom = more authentic, requires HEYGEN_AVATAR_TRAIN ingest pipeline)
   - **Storage destination**: per-client Google Drive folder (matches existing client onboarding pattern) vs Supabase Storage (cheaper, less integrated with existing handoff)
   - **Completion model**: webhook (faster, requires public webhook URL + retry semantics) vs polling (simpler, 30s tick from a cron)
   - **DB schema**: new `pedro_avatar_jobs` table with status / external_job_id / video_url / driveLink — needs a migration
   - **Pedro UI stage**: new "Avatar" stage that takes a script (existing) + avatar pick + aspect ratio → fires `provider.startRender` → poll loop → display ready video with copy-link button
- [ ] **Loveable / Manus actuation** — *deferred indefinitely.* Loveable is a UI-only tool (no public API for project creation as of 2026-Q2) and Manus is a Meta Ads-internal AI tool with no API. Auto-actuation isn't feasible without provider cooperation. Realistic alternative: deepen the **deliverable handoff pipeline** — Pedro auto-uploads generated prompts + assets to the client's Google Drive folder + marks the corresponding inbox task complete with a "ready to paste into Loveable" payload. The CM still does the paste, but the friction is gone.

---

## Architectural principles

These are the non-negotiables for every Pedro feature:

1. **Hub-native UI always.** Every Pedro screen uses `Panel`, `TopTabs`, shadcn components, hub colours, font-heading. No standalone styling.
2. **Hub auth + hub keys.** Pedro never asks the user to configure anything. Anthropic key is hub's env var. Monday/Meta/Trengo are hub's `api_tokens`. Pedro is "free" inside the hub.
3. **Knowledge base is the single source of truth.** Pedro's tone, angles, scripts always reference `knowledge/*.md`. If the playbook changes, edit those files; don't rewrite Pedro prompts.
4. **Most recent wins.** Every aggregator (briefs, optimisation analysis) prioritises the most recent signal and explicitly tells Claude to ignore older contradicting context.
5. **Quality is per-deliverable, not per-API-call.** It's fine to make 5 Claude calls for one stage if it produces a 10× better output. Latency budget per stage: ~30s.
6. **Stored per-client, queryable everywhere.** Every Pedro output lives in `pedro_client_state` (or future companion tables). Hub-wide views (client detail, watchlist, inbox) can read from it.
7. **CM reviews everything, ships nothing automatically.** Pedro never publishes ads, never sends emails, never updates Monday. Pedro produces; humans ship. (Phase 5 may relax this for low-risk actions like landing page generation.)
8. **Never recommend "scale budget."** Per `knowledge/campaigns.md` — RL clients have fixed budgets. Levers are creatives, angles, targeting. Hardcoded into every Pedro optimisation prompt.
9. **No hallucinated data.** If Pedro doesn't have it, leave the field empty. Never fabricate sector / ICP / pain points / hooks.
10. **One Pedro, many entry points.** Same backend powers: Pedro page, Watch List "fix it" button, client-detail "refresh creatives" button, automated cron jobs. Never duplicate logic.

---

## What we're explicitly NOT building

| Idea | Why not |
|---|---|
| Pedro publishing ads to Meta automatically | Too risky. CM ships, always. |
| Pedro replying to clients in Trengo unsupervised | Per the v3.0 vision: AI drafts, mens stuurt af. |
| A separate Pedro Anthropic account / billing | Shared key with rest of hub. Unified spend visibility. |
| A Pedro mobile app | Hub web is the surface. Pedro lives in the hub, period. |
| Pedro learning from outside-RL data | We have €18M+ ad spend across 2000+ clients. That's the corpus. No need for external. |
| Pedro fine-tuning a custom model | Anthropic Claude + good prompts + good context > fine-tuning at our scale. Re-evaluate at €1M+ Pedro-attributed revenue. |
| Replacing campaign managers | CMs review, refine, judge. Pedro can't replace judgment — he can do everything else. |

---

## Open questions for Roy

These need a decision before the corresponding feature ships:

- **Q1.** Onboarding board webhook → Pedro auto-trigger: do we want Pedro to start auto-briefing the moment a row is added, or wait until the AM hits "client paid + kick-off scheduled"? *(Affects Phase 4 trigger.)*
- **Q2.** Should Pedro's optimisation outputs (creative refresh proposals) appear as Hub tasks **or** as inline cards inside the Watch List **or** both? *(UX decision for Phase 3.)*
- **Q3.** Per-vertical winning-pattern library — do we tag `clients.sector` manually or auto-classify? Manual is more accurate; auto scales. *(Phase 5 decision.)*
- **Q4.** When Pedro proposes new creatives, do we also store the *Meta performance result* of each creative once shipped, so Pedro learns? Requires a per-creative tracking pipeline. *(Phase 3-4 — "closed loop" learning.)*
- **Q5.** What's the budget for Anthropic spend per month for Pedro? Need a ceiling so we can size the cron / batch jobs. (Estimate: Phase 2 ~$50/mo, Phase 4 ~$300/mo, Phase 5 with avatar generation ~$1000+/mo.)

---

## Build order recommendation

If I had to pick the **next four things** to build in priority order, given Phase 1 just shipped:

1. ~~**Past-campaign context** in the brief stage (Phase 2). Cheap, high-impact: every re-onboarding gets dramatically better.~~ ✓ shipped 2026-05-08
2. ~~**Performance ingest** (`/api/pedro/client-performance`) (Phase 3 prereq). Unlocks all of optimisation mode.~~ ✓ shipped 2026-05-08
3. ~~**Creative-refresh stage** that consumes the performance endpoint — first concrete optimisation feature.~~ ✓ shipped 2026-05-08
4. ~~**Save refresh proposals to `pedro_client_state.creatives.refreshes[]`**.~~ ✓ shipped 2026-05-08
5. ~~**Watch List → "Ask Pedro" chip** on every Action/Watch row.~~ ✓ shipped 2026-05-08
6. ~~**New-client trigger via webhook** (Phase 4).~~ ✓ shipped 2026-05-08 as kick-off auto-trigger (Fathom-based, not Monday-row-based, per Roy's call)
7. ~~**Surface refresh history on client detail page**.~~ ✓ shipped 2026-05-08 — new "Pedro" tab on every client detail page renders brief status (auto-draft / edited / not started), brief snapshot, and full refresh history timeline with stats + trends + proposals teaser per round. Lives in [src/app/(dashboard)/clients/[id]/_components/pedro-tab.tsx](src/app/(dashboard)/clients/[id]/_components/pedro-tab.tsx).
8. ~~**Auto-trigger observability**.~~ ✓ shipped 2026-05-08 — admin Settings → Pedro tab. Polls `/api/pedro/health` every 60s. Surfaces 7d funnel (kick-offs ingested → linked → Pedro fires + conversion %), recent fires list with assignee/status/deep-links, and a "Kick-offs zonder fire" inspection list. Health verdict (healthy / degraded) up top.

After those, evaluate. The roadmap will look different.

---

*Pedro is not a feature. Pedro is the mechanism by which Rocket Leads scales from 100 to 500 clients without proportional team growth. Every line of code in `src/app/(dashboard)/pedro/` and `src/app/api/pedro/` should ladder up to that.*
