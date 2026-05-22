# Pedro — Improvement Roadmap

> **Created:** 2026-05-21
> **Owner:** Roy (next session — picked up by Claude on prompt)
> **Status:** Plan locked in; not started. Resume when Roy says "verder met Pedro" or similar.

Plan + diagnosis captured after a deep read of the Pedro flow on 2026-05-21. Resume here next session instead of re-analyzing.

---

## Context (so next-session Claude can pick this up cold)

Pedro is the in-app AI campaign manager. CM picks a client → 6-stage flow (brief → research → angles → script → creatives/Manus → LP/Lovable → ad copy). Every stage hits `/api/pedro/claude` which prepends the full knowledge base (`campaigns.md` + `brand.md`, ~25k tokens) as system prompt + optional past-campaign + cross-client examples context.

Main file: [src/app/(dashboard)/pedro/_components/pedro-campaign.tsx](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx) — 2027 lines, all 6 stages in one client component.

Persistence: `pedro_client_state` (draft, 800ms debounced auto-save) + `pedro_stage_versions` (explicit "Save and continue" snapshots). Saved versions are canonical, drafts are working state.

### Bug fixed in the same session (2026-05-21)

The Pedro Claude route had no `maxDuration` → Vercel killed long Sonnet calls at 10s → 504 HTML → client `res.json()` blew up → swallowed by `catch {}` → user saw "Fout bij genereren LP prompt" with no detail.

Fixed by:
- `export const maxDuration = 120` in [src/app/api/pedro/claude/route.ts](src/app/api/pedro/claude/route.ts)
- `callClaude` in pedro-campaign.tsx now reads response as text first, parses safely, throws informative errors with HTTP status + body snippet
- Catch blocks for Manus / LP / ad-copy now log error and include real message in toast

Other Pedro endpoints (`auto-brief`, `research`, `creative-refresh`) probably need the same `maxDuration` audit — not done yet.

---

## Verdict from the analysis

The bones are right (6-stage flow, auto-fill from hub context, drafts + saved versions, per-stage refresh). The execution is the problem: **sequential, blocking, no-streaming, no-caching pipeline where every stage pays the full cost.** CM experience: click → 30-60s blank spinner → maybe error toast → try again. Quality also held back by same architecture (heavy context recomputed every call, output validation is reactive, no per-item regeneration).

---

## Top 8 changes — ranked by impact

| # | Change | Effort | Win |
|---|---|---|---|
| 1 | **Stream every Claude call** (Anthropic SDK `stream: true`) | M | Feels 5× faster, no logic change |
| 2 | **Enable prompt caching** on the system prompt | S | 30%+ cost + latency drop across a session |
| 3 | **Schema-validate + auto-retry once** on JSON stages (angles, ad copy) | S | Kills the "Claude added a preamble → toast" failure mode |
| 4 | **"Regenerate just this one"** for angles + creatives | M | Captures CM taste; biggest quality multiplier |
| 5 | **Parallel-generate LP + creatives + ad-copy** once brief+angles locked | M | Cuts wall-clock from 5 spinners to 1 |
| 6 | **Mix models per stage** (Haiku for ad-copy/angles JSON, Sonnet for LP/Manus reasoning) | S | 30-40% latency + cost cut |
| 7 | **Build prompts server-side** — client posts `{stage, options}`, not the full prompt | M | Smaller payloads, secrets-safe, easier to evolve prompts |
| 8 | **Bump LP `maxTokens` to 2500 + creatives to 4000**, detect truncation, retry with higher cap | S | Eliminates silent cut-offs |

**If only doing three this week: #1 (streaming), #2 (caching), #4 (per-item regenerate).** Those alone will make Pedro feel like a different product.

---

## Stage-by-stage friction (detail, for when we actually start fixing)

### Brief — [pedro-campaign.tsx:645-712](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L645-L712)
- Auto-brief silently degrades for brand new clients (no kick-off, no eval, no Trengo, no Monday history). User gets blank form with no guidance.
- Website analysis is colors-only. Could *also* extract sector/USPs/audience via one extra Claude call — exactly what's needed when there's no Monday history.
- "Bron: X" source tags are great but only used on brief, never on later stages.

### Research — [pedro-research.tsx](src/app/(dashboard)/pedro/_components/pedro-research.tsx)
- Angles only loads the *latest saved version* of research ([pedro-campaign.tsx:730-738](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L730-L738)). Iterated-but-unsaved research is silently ignored.

### Angles — [build-angles.ts](src/lib/pedro/prompts/build-angles.ts)
- `parseJSON()` ([pedro-campaign.tsx:107](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L107)) just strips code fences. Claude preamble = parsing throws = generic toast. No retry, no schema validation.
- Output is replace-all. No "angle #3 is brilliant, give me 4 new ones in that direction".

### Script — optional, fine. 3000 max_tokens is the longest call.

### Creatives / Manus — [build-creatives.ts](src/lib/pedro/prompts/build-creatives.ts)
- Two-section split is clever (static master + Claude-generated specs).
- Pre-validation ([pedro-campaign.tsx:874-884](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L874-L884)) fires *after* Claude has burned 30-60s. Should be in prompt + retry-on-fail.
- `uploadedImages` + `brandbookName` state exist ([line 277-278](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L277-L278)) but I couldn't find where they're sent. Either dead code or half-finished — verify and either wire up or remove.
- 2500 max_tokens gets cramped at qty=5+.

### LP / Lovable — [build-lp.ts](src/lib/pedro/prompts/build-lp.ts)
- 1200 max_tokens is too tight for a full Lovable prompt. Long-lengte options get truncated.
- This was the failing call when Roy reported the bug on 2026-05-21.

### Ad copy — fine in theory, same JSON-no-validation problem as angles.

---

## Cross-cutting issues

### Performance
1. **No streaming.** Every call = blank spinner 30-60s. Streaming would feel ~5× faster at zero logic change.
2. **No prompt caching.** `loadPedroSystemPrompt()` ([knowledge.ts](src/lib/pedro/knowledge.ts)) sends ~25k tokens of knowledge fresh on every call. Anthropic prompt caching = 90% cost discount + ~85% latency cut on hits.
3. **Forced-sequential when it doesn't have to be.** LP + creatives both depend only on `brief + angles + script` — could run in parallel. Ad-copy + LP once dependency met. "Generate everything below this point" button after angles would let CM grab coffee.
4. **No `maxDuration` audit beyond claude/route.ts.** Other Pedro endpoints likely have the same 504 risk.
5. **Sonnet 4 for everything.** Ad-copy + angles-JSON-parsing don't need Sonnet. Haiku 4.5 = 4-5× faster, cheaper, good enough for structured output. Reserve Sonnet for Manus specs + LP prompt.

### Quality
1. **Output validation is afterthought** — warnings come after generation. Should be `validateAndRetry()` wrapper that re-prompts once on schema/length/language failure.
2. **Past-campaign context hardcoded to N=2** ([past-campaigns.ts:71](src/lib/pedro/past-campaigns.ts#L71)). Returning client with 8 campaigns → Pedro only sees last 2. Vertical-patterns cron compensates per-branche but not per-client.
3. **No human-in-the-loop iteration.** Biggest single quality multiplier missing. CM's taste is the asset, tool doesn't capture it. Per-item regenerate ("regenerate angle #3 with different psychological trigger") would unlock this.
4. **CM can't see what context Pedro used.** Cross-client examples + past-campaign + research + style ref all silently injected. Output bad → CM can't tell why. Small "context used: research v3, 2 past campaigns, Meta style ref (8 ads), 5 cross-client winners" line under each output would build trust + help debug.

### Usability
1. **One 2027-line client component.** Split into route segments or lazy-loaded per-stage components.
2. **Step navigation isn't dependency-aware.** Can jump to ad copy with empty brief. Either gate progression or show "missing inputs" banner.
3. **No A/B compare on regenerated outputs.** Saved versions exist but no diff/compare view.
4. **Drive link is decorative.** Pasted into Manus prompt as URL — Manus can't browse it. Either fetch server-side + extract image refs, or remove.
5. **Silent failure on picker** ([page.tsx:94](src/app/(dashboard)/pedro/page.tsx#L94)). Monday/Supabase down → empty picker → CM thinks no clients. Should show "couldn't load, retry".
6. **Auto-save fires entire payload on every keystroke** (800ms debounce, [line 572-592](src/app/(dashboard)/pedro/_components/pedro-campaign.tsx#L572-L592)). Typing in `hooksAM` re-POSTs ad copy + LP + Manus + brand style. Save per-stage with dirty-tracking.

---

## How to resume

When Roy comes back and says "verder met Pedro" / "Pedro plan" / similar:
1. **Don't re-analyze.** Read this file. Confirm scope with Roy: "Ranked plan was 1-8. Where do we start? Default is streaming (#1) + caching (#2) + per-item regenerate (#4)."
2. **Pick a starting item** — confirm with Roy before writing code.
3. **Start with #2 (prompt caching) if quick win mode** — smallest diff, big latency/cost payoff, low risk. Adds `cache_control: { type: "ephemeral" }` to the system prompt block in [src/app/api/pedro/claude/route.ts](src/app/api/pedro/claude/route.ts) and to other Pedro endpoints using the same knowledge.
4. **Start with #1 (streaming) if visible-UX mode** — biggest perceived-speed win. Requires changing the Pedro Claude endpoint to return a stream (Anthropic SDK supports it) and rewiring `callClaude` on the client to consume it.
5. **#4 (per-item regenerate) is the biggest quality win but more UI work** — touch angles and creatives stages; add per-item "↻ Regenerate this one" with optional steering note.

For any item: respect the existing prompt-builder split ([src/lib/pedro/prompts/](src/lib/pedro/prompts/)) — don't inline prompts in route handlers.
