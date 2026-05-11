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

  // ─── Clients overview ─────────────────────────────────────────────────
  "clients.updated": { nl: "Bijgewerkt {time}", en: "Updated {time}" },
  "clients.tab.current": { nl: "Huidige klanten", en: "Current Clients" },
  "clients.tab.onboarding": { nl: "Onboarding", en: "Onboarding" },

  // Toolbar
  "clients.search_placeholder": { nl: "Zoek klanten…", en: "Search clients..." },
  "clients.show_active_only": { nl: "Alleen actieve tonen", en: "Show active only" },
  "clients.show_all": { nl: "Alles tonen", en: "Show all" },
  "clients.count_of": { nl: "{shown} van {total} klanten", en: "{shown} of {total} clients" },
  "clients.count_total_one": { nl: "{n} klant", en: "{n} client" },
  "clients.count_total_many": { nl: "{n} klanten", en: "{n} clients" },
  "clients.empty": { nl: "Geen klanten gevonden", en: "No clients found" },
  "clients.loading_more": { nl: "Meer laden…", en: "Loading more..." },

  // Filter labels + "All ..." options
  "clients.filter.status": { nl: "Status", en: "Status" },
  "clients.filter.status_all": { nl: "Alle statussen", en: "All Statuses" },
  "clients.filter.phase": { nl: "Fase", en: "Phase" },
  "clients.filter.phase_all": { nl: "Alle fases", en: "All Phases" },
  "clients.filter.am": { nl: "Account Manager", en: "Account Manager" },
  "clients.filter.am_all": { nl: "Alle Account Managers", en: "All Account Managers" },
  "clients.filter.cm": { nl: "Campaign Manager", en: "Campaign Manager" },
  "clients.filter.cm_all": { nl: "Alle Campaign Managers", en: "All Campaign Managers" },
  "clients.filter.payment": { nl: "Betaling", en: "Payment" },
  "clients.filter.payment_all": { nl: "Alle betaalstatussen", en: "All Payment Statuses" },
  "clients.filter.health": { nl: "Gezondheid", en: "Health" },
  "clients.filter.health_all": { nl: "Alle gezondheidsstatussen", en: "All Health Statuses" },

  // Column headers
  "clients.col.client": { nl: "Klant", en: "Client" },
  "clients.col.status": { nl: "Status", en: "Status" },
  "clients.col.phase": { nl: "Fase", en: "Phase" },
  "clients.col.meta": { nl: "Meta", en: "Meta" },
  "clients.col.kick_off": { nl: "Kick-off", en: "Kick-off" },
  "clients.col.health": { nl: "Gezondheid", en: "Health" },
  "clients.col.payment": { nl: "Betaling", en: "Payment" },
  "clients.col.outstanding": { nl: "Openstaand", en: "Outstanding" },
  "clients.col.mrr": { nl: "MRR", en: "MRR" },
  "clients.col.next": { nl: "Volgend", en: "Next" },
  "clients.col.am": { nl: "AM", en: "AM" },
  "clients.col.cm": { nl: "CM", en: "CM" },
  "clients.col.as": { nl: "AS", en: "AS" },
  "clients.col.adspend": { nl: "Adspend", en: "Adspend" },
  "clients.col.leads": { nl: "Leads", en: "Leads" },
  "clients.col.cpl": { nl: "CPL", en: "CPL" },
  "clients.col.appts": { nl: "Appts", en: "Appts" },
  "clients.col.cpa": { nl: "CPA", en: "CPA" },

  // Health / payment status labels
  "clients.health.good": { nl: "Goed", en: "Good" },
  "clients.health.warning": { nl: "Let op", en: "Warning" },
  "clients.health.critical": { nl: "Kritiek", en: "Critical" },
  "clients.payment.complete": { nl: "Voldaan", en: "Complete" },
  "clients.payment.open": { nl: "Open", en: "Open" },
  "clients.payment.overdue": { nl: "Te laat", en: "Overdue" },

  // Health reasons + MRR/budget label suffix
  "clients.health.reason.no_campaign": { nl: "Geen campagne geselecteerd", en: "No campaign selected" },
  "clients.health.reason.no_data": { nl: "Geen campagne data beschikbaar", en: "No campaign data available" },
  "clients.health.reason.running_normally": { nl: "Campagne loopt normaal", en: "Campaign running normally" },
  "clients.budget_suffix": { nl: "budget", en: "budget" },

  // Tooltips + cell hints
  "clients.tooltip.next_invoice": { nl: "Volgende factuurdatum", en: "Next invoice date" },
  "clients.tooltip.no_prev_period": { nl: "Geen vergelijkbare voorgaande periode — deze klant was niet live in het grootste deel van het vorige venster.", en: "No comparable prior period — this client wasn't live for most of the previous window." },
  "clients.cell.click_to_assign": { nl: "Klik om toe te wijzen", en: "Click to assign" },
  "clients.cell.loading_users": { nl: "Gebruikers laden…", en: "Loading users..." },
  "clients.cell.load_users_failed": { nl: "Gebruikers laden mislukt", en: "Failed to load users" },
  "clients.cell.clear": { nl: "Wissen", en: "Clear" },

  // ─── Settings — top-level + tab strip ─────────────────────────────────
  "settings.title": { nl: "Instellingen", en: "Settings" },
  "settings.subtitle": { nl: "API tokens, board config, gebruikers en notificaties.", en: "API tokens, board config, users and notifications." },
  "settings.health_link": { nl: "Health →", en: "Health →" },

  "settings.tab.clients": { nl: "Klanten", en: "Clients" },
  "settings.tab.tokens": { nl: "API Tokens", en: "API Tokens" },
  "settings.tab.board": { nl: "Board Config", en: "Board Config" },
  "settings.tab.users": { nl: "Gebruikers", en: "Users" },
  "settings.tab.notifications": { nl: "Notificaties", en: "Notifications" },
  "settings.tab.inbox": { nl: "Inbox", en: "Inbox" },
  "settings.tab.pedro": { nl: "Pedro", en: "Pedro" },

  // ApiHealthBar
  "settings.api_status.title": { nl: "API Status", en: "API Status" },
  "settings.api_status.checked": { nl: "Gecheckt {time}", en: "Checked {time}" },

  // Settings → Clients tab
  "settings.clients.title": { nl: "Klanten", en: "Clients" },
  "settings.clients.subtitle": { nl: "Wijzig elke klantdetail — naam, IDs, financiën, team. Wijzigingen schrijven terug naar Monday en syncen naar de Hub.", en: "Edit any client's details — name, IDs, financials, team. Changes write back to Monday and sync to the Hub." },
  "settings.clients.search": { nl: "Zoek klanten…", en: "Search clients..." },
  "settings.clients.empty": { nl: "Geen {status} klanten{searchSuffix}.", en: "No {status} clients{searchSuffix}." },
  "settings.clients.empty_search_suffix": { nl: " met deze zoekopdracht", en: " matching your search" },

  // ─── Settings → Health page ───────────────────────────────────────────
  "settings.health.back": { nl: "Terug naar Instellingen", en: "Back to Settings" },
  "settings.health.title": { nl: "Health", en: "Health" },
  "settings.health.subtitle": { nl: "Cron + integratie heartbeat. Surface voor “is de data die we tonen daadwerkelijk vers?”", en: "Cron + integration heartbeat. Surface for “is the data we're showing actually fresh?”" },

  // Summary KPI cards
  "settings.health.kpi.crons_ok": { nl: "Crons OK", en: "Crons OK" },
  "settings.health.kpi.crons_clear": { nl: "Alles in orde", en: "All clear" },
  "settings.health.kpi.crons_errored_one": { nl: "{n} gefaald", en: "{n} errored" },
  "settings.health.kpi.crons_partial_one": { nl: "{n} gedeeltelijk", en: "{n} partial" },
  "settings.health.kpi.crons_never_one": { nl: "{n} nooit gedraaid", en: "{n} never ran" },
  "settings.health.kpi.integrations_valid": { nl: "Geldige integraties", en: "Integrations valid" },
  "settings.health.kpi.integrations_all_valid": { nl: "Alle tokens geldig", en: "All tokens valid" },
  "settings.health.kpi.integrations_need_attention": { nl: "{n} vereisen aandacht", en: "{n} need attention" },
  "settings.health.kpi.errors_24h": { nl: "Fouten (24u)", en: "Errors (24h)" },
  "settings.health.kpi.errors_clean": { nl: "Schone run", en: "Clean run" },
  "settings.health.kpi.errors_subtitle": { nl: "Cron-fouten in laatste 24u", en: "Cron failures in last 24h" },
  "settings.health.kpi.last_kpi": { nl: "Laatste refresh-kpi", en: "Last refresh-kpi" },
  "settings.health.kpi.last_kpi_subtitle": { nl: "Drijft de Watch List getallen", en: "Drives Watch List numbers" },

  // Section headers + table columns
  "settings.health.section.crons": { nl: "Crons", en: "Crons" },
  "settings.health.section.integrations": { nl: "Integraties", en: "Integrations" },
  "settings.health.section.recent_errors": { nl: "Recente fouten (24u)", en: "Recent errors (24h)" },
  "settings.health.col.cron": { nl: "Cron", en: "Cron" },
  "settings.health.col.description": { nl: "Beschrijving", en: "Description" },
  "settings.health.col.status": { nl: "Status", en: "Status" },
  "settings.health.col.last_run": { nl: "Laatste run", en: "Last run" },
  "settings.health.col.duration": { nl: "Duur", en: "Duration" },
  "settings.health.col.notes": { nl: "Notities", en: "Notes" },
  "settings.health.col.service": { nl: "Service", en: "Service" },
  "settings.health.col.last_verified": { nl: "Laatst gecontroleerd", en: "Last verified" },

  // Status pills
  "settings.health.status.ok": { nl: "OK", en: "OK" },
  "settings.health.status.error": { nl: "Fout", en: "Error" },
  "settings.health.status.partial": { nl: "Gedeeltelijk", en: "Partial" },
  "settings.health.status.never_ran": { nl: "Nooit gedraaid", en: "Never ran" },
  "settings.health.integration.valid": { nl: "Geldig", en: "Valid" },
  "settings.health.integration.invalid": { nl: "Ongeldig", en: "Invalid" },
  "settings.health.integration.no_token": { nl: "Geen token", en: "No token" },
  "settings.health.integration.never": { nl: "Nooit", en: "Never" },
  "settings.health.recent_errors.no_message": { nl: "(geen bericht)", en: "(no message)" },

  // Cadence labels — short, used in the crons table second-row sub-line
  "settings.health.cadence.daily_5utc": { nl: "dagelijks 05:00 UTC", en: "daily 5:00 UTC" },
  "settings.health.cadence.daily_530utc": { nl: "dagelijks 05:30 UTC", en: "daily 5:30 UTC" },
  "settings.health.cadence.hourly": { nl: "elk uur", en: "hourly" },
  "settings.health.cadence.every_6h": { nl: "elke 6u", en: "every 6h" },
  "settings.health.cadence.daily": { nl: "dagelijks", en: "daily" },
  "settings.health.cadence.nightly": { nl: "nachtelijk", en: "nightly" },
  "settings.health.cadence.weekly": { nl: "wekelijks", en: "weekly" },
  "settings.health.cadence.hourly_gated": { nl: "elk uur (gated)", en: "hourly (gated)" },
  "settings.health.cadence.daily_7utc": { nl: "dagelijks 07:00 UTC", en: "daily 7:00 UTC" },

  // ─── Inbox ────────────────────────────────────────────────────────────
  "inbox.title": { nl: "Inbox", en: "Inbox" },

  // Top action bar
  "inbox.search.placeholder": { nl: "Zoek in inbox…  (/)", en: "Search inbox…  (/)" },
  "inbox.search.clear": { nl: "Zoekopdracht wissen", en: "Clear search" },
  "inbox.filter.assigned_to_me": { nl: "Aan mij toegewezen", en: "Assigned to me" },
  "inbox.filter.all": { nl: "Alles", en: "All" },
  "inbox.action.new_task": { nl: "Nieuwe taak", en: "New task" },
  "inbox.action.new_update": { nl: "Nieuwe update", en: "New update" },
  "inbox.action.shortcuts": { nl: "Toetsenbord shortcuts (?)", en: "Keyboard shortcuts (?)" },

  // Main tabs
  "inbox.tab.tasks": { nl: "Taken", en: "Tasks" },
  "inbox.tab.updates": { nl: "Updates", en: "Updates" },
  "inbox.tab.client_inbox": { nl: "Klanten Inbox", en: "Client Inbox" },
  "inbox.tab.meetings": { nl: "Meetings", en: "Meetings" },

  // Task status filters
  "inbox.task.filter.open": { nl: "Open", en: "Open" },
  "inbox.task.filter.in_progress": { nl: "Bezig", en: "In progress" },
  "inbox.task.filter.done": { nl: "Klaar", en: "Done" },
  "inbox.task.filter.all": { nl: "Alles", en: "All" },

  // Update status filters
  "inbox.update.filter.all": { nl: "Alle updates", en: "All updates" },
  "inbox.update.filter.unread": { nl: "Ongelezen", en: "Unread" },
  "inbox.update.filter.read": { nl: "Gelezen", en: "Read" },

  // Empty states
  "inbox.empty.tasks_loading": { nl: "Taken laden…", en: "Loading tasks…" },
  "inbox.empty.tasks_none": { nl: "Nog geen taken.", en: "No tasks yet." },
  "inbox.empty.tasks_filtered": { nl: "Geen {filter} taken{assigned}.", en: "No {filter} tasks{assigned}." },
  "inbox.empty.tasks_assigned_suffix": { nl: " aan jou toegewezen", en: " assigned to you" },
  "inbox.empty.updates_loading": { nl: "Updates laden…", en: "Loading updates…" },
  "inbox.empty.updates_none": { nl: "Nog geen updates.", en: "No updates yet." },
  "inbox.empty.updates_filtered": { nl: "Geen {filter} updates{assigned}.", en: "No {filter} updates{assigned}." },

  // Update filter labels used inside empty-state strings (lowercase)
  "inbox.update.filter.unread_lower": { nl: "ongelezen", en: "unread" },
  "inbox.update.filter.read_lower": { nl: "gelezen", en: "read" },

  // Source pill labels (brand names stay as plain strings — these are
  // the ones that actually translate)
  "inbox.source.automation": { nl: "Automatisering", en: "Automation" },
  "inbox.source.watchlist": { nl: "Watch List", en: "Watch list" },
  "inbox.source.meeting": { nl: "Meeting", en: "Meeting" },
  "inbox.source.email": { nl: "Email", en: "Email" },
  "inbox.source.tooltip_prefix": { nl: "Bron:", en: "Source:" },
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
