import type { Locale } from "./types"

/**
 * Hub UI dictionary. Every user-facing string the Hub renders should
 * route through `t(key, locale)` so the language switch flips it.
 *
 * Conventions:
 *   - Keys are dot-namespaced by surface (`nav.home`, `home.greeting`).
 *   - Both locales are mandatory — TypeScript enforces it via the
 *     `Record<Locale, ...>` shape on every leaf.
 *   - When a string is the same in both locales (a brand term, a number,
 *     a punctuation-only string), still write it twice. Don't try to be
 *     clever with fallback chains — clever fallbacks become the bug
 *     surface when "English" silently means "I forgot to translate".
 *   - Placeholders use `{name}` syntax. Resolved by passing
 *     `t("home.greeting", locale, { name: "Roy" })`.
 *
 * This file is intentionally a single big record so adding a string is
 * one edit. If it grows past a few thousand entries we can split per-
 * surface — but flat is simpler until then.
 */

type LocalizedString = Record<Locale, string>

export const DICTIONARY = {
  // ─── Sidebar nav ──────────────────────────────────────────────────────
  "nav.home": { nl: "Home", en: "Home" },
  "nav.watch_list": { nl: "Watch List", en: "Watch List" }, // brand term
  "nav.clients": { nl: "Klanten", en: "Clients" },
  "nav.inbox": { nl: "Inbox", en: "Inbox" },
  "nav.meetings": { nl: "Meetings", en: "Meetings" },
  "nav.pedro": { nl: "Pedro", en: "Pedro" },
  "nav.targets": { nl: "Targets", en: "Targets" },
  "nav.billing": { nl: "Facturatie", en: "Billing" },
  "nav.settings": { nl: "Instellingen", en: "Settings" },

  // ─── Account dropdown ─────────────────────────────────────────────────
  "account.sign_out": { nl: "Uitloggen", en: "Sign out" },
  "account.user_fallback": { nl: "Gebruiker", en: "User" },

  // ─── Theme + locale toggles ───────────────────────────────────────────
  "theme.dark": { nl: "Donkere modus", en: "Dark mode" },
  "theme.light": { nl: "Lichte modus", en: "Light mode" },
  "theme.fallback": { nl: "Thema", en: "Theme" },
  "locale.label": { nl: "Taal", en: "Language" },
  "locale.dutch": { nl: "Nederlands", en: "Dutch" },
  "locale.english": { nl: "Engels", en: "English" },

  // ─── Home page ────────────────────────────────────────────────────────
  "home.greeting.morning": { nl: "Goedemorgen, {name}", en: "Good morning, {name}" },
  "home.updated_prefix": { nl: "Bijgewerkt {ago}", en: "Updated {ago}" },

  "home.kpi.action.label": { nl: "Actie nodig", en: "Action needed" },
  "home.kpi.action.eq_yesterday": { nl: "= gisteren", en: "= yesterday" },
  "home.kpi.action.delta_pos": { nl: "+{n} t.o.v. gisteren", en: "+{n} vs yesterday" },
  "home.kpi.action.delta_neg": { nl: "{n} t.o.v. gisteren", en: "{n} vs yesterday" },
  "home.kpi.action.no_scope": { nl: "Geen actieve klanten", en: "No live clients in scope" },
  "home.kpi.inbox.label": { nl: "Inbox voor jou", en: "Your inbox" },
  "home.kpi.inbox.zero": { nl: "Inbox zero", en: "Inbox zero" },
  "home.kpi.inbox.subtitle": { nl: "taken + ongelezen updates", en: "tasks + unread updates" },
  "home.kpi.health.label": { nl: "Gezondheidsscore", en: "Health score" },
  "home.kpi.health.target": { nl: "doel ≥ 75%", en: "target ≥ 75%" },
  "home.kpi.health.no_scope": { nl: "Geen actieve klanten", en: "No live clients in scope" },
  "home.kpi.mrr.label": { nl: "Team MRR", en: "Team MRR" },
  "home.kpi.mrr.no_agreements": { nl: "Geen actieve agreements", en: "No active agreements" },
  "home.kpi.mrr.live_one": { nl: "{n} klant live", en: "{n} client live" },
  "home.kpi.mrr.live_many": { nl: "{n} klanten live", en: "{n} clients live" },

  "home.block.action.title": { nl: "Actie nodig", en: "Action Needed" },
  "home.block.action.empty": { nl: "Niks urgents — top of watch list ↓", en: "Nothing urgent — top of watch list ↓" },
  "home.block.action.cta": { nl: "Open Watch List", en: "Open Watch List" },
  "home.block.inbox.title": { nl: "Inbox voor jou", en: "Your inbox" },
  "home.block.inbox.empty": { nl: "Inbox zero — niks toegewezen.", en: "Inbox zero — nothing assigned." },
  "home.block.inbox.cta": { nl: "Open Inbox", en: "Open Inbox" },
  "home.block.billing.title": { nl: "Openstaande facturen", en: "Open invoices" },
  "home.block.billing.total_open": { nl: "Totaal open", en: "Total open" },
  "home.block.billing.empty": { nl: "Geen openstaande facturen.", en: "No open invoices." },
  "home.block.billing.cta": { nl: "Open Facturatie", en: "Open Billing" },
  "home.block.pedro.title": { nl: "Pedro voorstellen", en: "Pedro proposals" },
  "home.block.pedro.empty": { nl: "Niks te reviewen.", en: "Nothing to review." },
  "home.block.pedro.cta": { nl: "Open Pedro", en: "Open Pedro" },

  // ─── PedroInsightCard (slide-over) ────────────────────────────────────
  "pedro.label": { nl: "Pedro", en: "Pedro" },
  "pedro.tile.next_move": { nl: "Volgende stap", en: "Next move" },
  "pedro.tile.lead_quality": { nl: "Lead kwaliteit", en: "Lead quality" },

  // ─── Watch List ───────────────────────────────────────────────────────
  "watchlist.title": { nl: "Watch List", en: "Watch List" },
  "watchlist.updated": { nl: "Bijgewerkt {time}", en: "Updated {time}" },

  // Summary pills + filter
  "watchlist.pill.action": { nl: "Actie", en: "Action" },
  "watchlist.pill.watch": { nl: "Watch", en: "Watch" },
  "watchlist.pill.good": { nl: "Goed", en: "Good" },
  "watchlist.pill.no_data": { nl: "Geen data", en: "No data" },
  "watchlist.filter.cm_label": { nl: "Campaign Manager", en: "Campaign Manager" },
  "watchlist.filter.all_cms": { nl: "Alle Campaign Managers", en: "All Campaign Managers" },

  // KPI cards
  "watchlist.kpi.health.label": { nl: "Gezondheidsscore", en: "Health score" },
  "watchlist.kpi.health.target": { nl: "doel ≥ 75%", en: "target ≥ 75%" },
  "watchlist.kpi.health.no_scope": { nl: "Geen klanten in scope", en: "No clients in scope" },
  "watchlist.kpi.vs_avg.label": { nl: "T.o.v. 7-daags gemiddelde", en: "Vs 7-day avg" },
  "watchlist.kpi.vs_avg.building": { nl: "7-daags gemiddelde wordt opgebouwd…", en: "Building 7-day baseline…" },
  "watchlist.kpi.vs_avg.subtitle": { nl: "7-daags gemiddelde: {avg}%", en: "7-day average: {avg}%" },
  "watchlist.kpi.healthy.label": { nl: "Gezonde klanten", en: "Healthy clients" },
  "watchlist.kpi.healthy.no_scope": { nl: "Geen klanten in scope", en: "No clients in scope" },
  "watchlist.kpi.healthy.subtitle": { nl: "in goede performance", en: "in good performance" },
  "watchlist.kpi.avg_cpl.label": { nl: "Gemiddelde CPL", en: "Avg CPL" },
  "watchlist.kpi.avg_cpl.empty": { nl: "Geen spend met leads (7d)", en: "No spend with leads in 7d" },
  "watchlist.kpi.avg_cpl.subtitle_one": { nl: "over {n} live klant (7d)", en: "across {n} live client (7d)" },
  "watchlist.kpi.avg_cpl.subtitle_many": { nl: "over {n} live klanten (7d)", en: "across {n} live clients (7d)" },

  // Insights + Proposals panel
  "watchlist.insights.title": { nl: "Belangrijkste inzichten", en: "Key Insights" },
  "watchlist.insights.empty": { nl: "Nog geen patronen — wacht op de volgende sync.", en: "No notable patterns yet — wait for the next sync." },
  "watchlist.proposals.title": { nl: "Optimalisatievoorstellen", en: "Optimisation Proposal" },
  "watchlist.proposals.empty": { nl: "Nog geen voorstellen — wacht op de volgende sync.", en: "No proposals yet — wait for the next sync." },

  // Section headers
  "watchlist.section.action": { nl: "Actie nodig", en: "Action Needed" },
  "watchlist.section.watch": { nl: "Watch List", en: "Watch List" },
  "watchlist.section.good": { nl: "Goede performance", en: "Good Performance" },

  // Column headers
  "watchlist.col.client": { nl: "Klant", en: "Client" },
  "watchlist.col.insight": { nl: "Inzicht", en: "Insight" },
  "watchlist.col.ai_note": { nl: "AI Note", en: "AI Note" },
  "watchlist.col.spend": { nl: "Spend", en: "Spend" },
  "watchlist.col.leads": { nl: "Leads", en: "Leads" },
  "watchlist.col.cpl": { nl: "CPL", en: "CPL" },
  "watchlist.col.appts": { nl: "Appts", en: "Appts" },
  "watchlist.col.cpl_14d": { nl: "14d CPL", en: "14d CPL" },

  // Row UI bits
  "watchlist.row.new_pill": { nl: "NIEUW", en: "NEW" },
  "watchlist.row.generating": { nl: "Genereren…", en: "Generating..." },
  "watchlist.row.ask_pedro": { nl: "Vraag Pedro", en: "Ask Pedro" },
  "watchlist.row.ask_pedro_tooltip": { nl: "Pedro stelt een creative refresh voor op basis van laatste 30d performance", en: "Pedro proposes a creative refresh based on last 30d performance" },

  // No Data section
  "watchlist.no_data.title": { nl: "Geen data", en: "No data" },
  "watchlist.no_data.subtitle": { nl: "live in Monday maar deze week geen bruikbare Meta data", en: "live in Monday but no usable Meta data this week" },
  "watchlist.no_data.col_reason": { nl: "Reden", en: "Reason" },
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
