# 187N Redesign — Working Brief

> Paste-in context for any chat continuing the Hub's 187N re-skin. Read this
> first, then work only your assigned section. Keep everything 187N.

## Goal

Make the Rocket Leads Hub look **exactly** like the 187N "Mission Control" app,
keeping the Hub's features/content. The only deliberate brand change: **coral
`#FF6301` → Rocket Leads purple `#8967F3`**, and the Rocket Leads logo. **Light
theme only.**

## Branch & preview

- All work goes on the **`redesign/187n`** branch (NOT `main`).
- `git checkout redesign/187n && git pull` before starting.
- Push → Vercel builds a branch preview. Never merge to main without Roy.

## The design system (where the look comes from)

- `src/styles/187n/theme.css` — the **verbatim 187N design system** (do not edit).
  Semantic classes: `.section-card`, `.stat-card`, `.rev-card`, `.chip`,
  `.st-label`, `.switch`, `.icon-btn`, `.cmd-*` (command palette), `.page-header`,
  `.table`, `.pill`, `.btn`/`.btn-primary`/`.btn-secondary`/`.btn-ghost`,
  `.bg-field`, `.sidebar`/`.nav-*`, `.op-hero`/`.metric-hero`/`.instrument-panel`.
- `src/styles/187n/client.css` — **the ONLY brand override** (purple accent +
  the coral-derived tokens re-pointed to purple + fonts). Edit here for brand,
  not theme.css.
- `reference-187n/` — the original theme.css + reference (gitignored, local only).
- `src/app/globals.css` — the **token bridge**: `@theme` maps Tailwind tokens
  (`bg-primary`, `border`, `rounded-*`, fonts, shadows) → 187N vars, plus a few
  Hub helper classes (`.search-pill`, `.st-label`, `.nav-badge`, `.app` gutter).

## How the look is applied — TWO layers

1. **Token bridge** (globals.css `@theme`) recolours *every* Tailwind/shadcn
   component to the 187N palette automatically (cream, purple, Schibsted/Geist,
   187N radii + shadows). This is already done globally.
2. **Native 187N classes** give the exact *shapes* for bespoke pieces.

**The leak to watch for:** shadcn primitives keep their own *shape* — the bridge
only recolours them. So a component can be "on-brand colour, wrong shape."

## GOLDEN RULES (follow these exactly)

1. **Purple, never orange.** Brand accent is `#8967F3`. If you see coral/orange,
   it's a hardcoded token leak — fix it in `client.css`, not inline. Amber is
   only for semantic warnings (`--st-warn`), red (`--st-error`) for errors.
2. **Fix shapes at the primitive, once — never per screen.** If a Button / Dialog
   / input shape is off, fix its file in `src/components/ui/*` so every usage
   inherits it. Don't patch the same shape on 10 screens.
3. **Use the 187N vocabulary** (cheat-sheet below) instead of inventing new
   Tailwind. Status = `.st-label` (dot + mono uppercase, NO fill). Toolterms/
   toggles = `.chip`/`.chip.active`. Search = `.search-pill`. Cards = `.section-card`.
   KPI numbers = **Geist Mono** (`font-mono`), never the display face.
4. **Tables** use the shared `Table` primitive (already 187N: mono uppercase
   micro-headers, purple-wash row hover, hairlines). Status/health/payment cells
   render as `.st-label`, not filled pills.
5. **Modals** use the shared `Dialog` (already 187N: blur backdrop, rounded-2xl,
   shadow-2xl). For a custom-header dialog set `showCloseButton={false}` and put a
   `<DismissButton>` in the header so the default X doesn't overlap.
6. **English UI text**, `€`/dates in `en-GB`, no `any`, API routes check `auth()`.
   Match surrounding code style. See AGENTS.md — this is Next.js 16 (params are
   Promises, `proxy.ts` not middleware).

## 187N class cheat-sheet

| Need | Use |
|---|---|
| Page title block | `<PageHeader>` (already `.page-header`) |
| Card / list container | `.section-card` (mono `.section-title` + `.count` + `.ghost-link`) |
| KPI tile | `.stat-card` (`.icon-badge` + `.hero-num` mono + `.delta`) or `KpiCard`/`KpiTile` (already mono) |
| Revenue panel | `.rev-card` / `.instrument-panel` |
| Status label | `.st-label live|warn|error|idle|pending` = coloured dot + mono uppercase |
| Filter/toggle chips | `.chip` / `.chip active` |
| Condition filter (Where/is/value) | `<ConditionFilter>` (`src/components/ui/condition-filter.tsx`) |
| Search field | `.search-pill` |
| Toggle switch | `.switch` / `.switch.on` (black in corporate, matches 187N) |
| Circular icon button | `.icon-btn` |
| Command palette | `<GlobalSearch>` / `.cmd-*` |
| Updated stamp | `font-mono text-[11px] text-muted-foreground/50` + `.icon-btn` refresh |

## Build & deploy

- Node is at `/opt/homebrew/bin`. Build: `PATH="/opt/homebrew/bin:$PATH" /opt/homebrew/bin/npm run build`.
- Verify build passes (exit 0, no type errors) before committing.
- Commit with a clear message + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Push to `redesign/187n`.

## DONE (do NOT redo)

- **Shell**: sidebar (grouped nav, brand + ONLINE pill, `.app` gutter), topbar
  (breadcrumb + `.cmd-*` global search + AI copilot), `bg-field`, `PageHeader`.
- **Home**: `.stat-card` KPI row + `.section-card` blocks.
- **⌘K palette**: `<GlobalSearch>` (clients/tasks/messages/pages).
- **Targets → 3 dashboards**: `/targets/marketing` (Marketing / Sales),
  `/targets/delivery`, `/targets/finance` (+ `/targets/settings`), routes + sidebar.
- **Clients page**: `.table` mono headers, `.st-label` status/health/payment,
  `<ConditionFilter>`, Performance/Finance views (People hidden but filterable),
  `.search-pill` + `.chip` toolbar, 187N refresh stamp. Client-update popup → 187N dialog.
- **Calendar**: week grid + Today/Sources rail (`.section-card` + `.switch`).
- **Primitives aligned**: `Button` → 187N `.btn` (rounded-sm, semibold, purple
  hovers); `Table`; `Dialog` (blur/rounded-2xl/shadow). Orange purged in client.css.

## SECTIONS still to do (one chat each)

Each section = mostly its own `_components/` folder; the shared primitives + globals
are already done, so **avoid editing shared files** (globals.css, client.css,
theme.css, `components/ui/{button,table,dialog,select,...}.tsx`, sidebar) unless a
genuine primitive gap forces it — and if so, say so in the commit.

| Section | Files (start here) |
|---|---|
| **Watch List** | `src/app/(dashboard)/watchlist/_components/*` — cards, AI-note rows, severity pills → `.section-card` / `.st-label` / `.chip`; the `FiltersPopover` → `<ConditionFilter>`. |
| **Inbox** | `src/app/(dashboard)/inbox/_components/*` — tabs → `.chip`, rows, thread pane, composer → 187N surfaces + mono meta. |
| **Marketing / Sales** | `src/app/(dashboard)/targets/_components/marketing-tab.tsx` + `hero-pillars`, `industry-table`, `closers-table`, `closer-insights`, `marketing-insights`, `weekly-overview`, `pulse-banner` → `.rev-card`/`.table`/`.st-label`; `FiltersPopover` → `<ConditionFilter>`. |
| **Delivery** | `src/app/(dashboard)/targets/_components/delivery-tab.tsx` (+ RetentionCard/TeamCard) → `.stat-card`/`.rev-card`/`.table`. |
| **Finance** | `src/app/(dashboard)/targets/_components/finance-tab.tsx` + `revenue-progress-bar`, `invoice-detail-modal` → `.rev-card`/`.table`/187N dialog. |
| **Onboarding** | `src/app/(dashboard)/onboarding/**` — wizard + list → 187N surfaces. |

## Working agreement for parallel chats

- One section per chat. Commit small + often. `git pull` before you start and
  before you push (rebase if needed).
- Don't touch another section's files or the shared primitives/globals.
- If you genuinely need a shared-primitive change, make it minimal and call it out
  loudly in the commit message so the other chats can pull it.
