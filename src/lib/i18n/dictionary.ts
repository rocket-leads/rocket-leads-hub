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
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
