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

  // ─── Targets ──────────────────────────────────────────────────────────
  "targets.title": { nl: "Targets", en: "Targets" },
  "targets.subtitle": { nl: "Bedrijfsbrede performance tegenover maandelijkse targets.", en: "Company-wide performance against monthly targets." },

  // Main tabs
  "targets.tab.marketing": { nl: "Marketing / Sales", en: "Marketing / Sales" },
  "targets.tab.delivery": { nl: "Delivery", en: "Delivery" },
  "targets.tab.finance": { nl: "Finance", en: "Finance" },
  "targets.tab.settings": { nl: "Instellingen", en: "Settings" },

  // Tab strip right-side buttons
  "targets.action.refresh": { nl: "Alle tabs verversen", en: "Refresh all tabs" },
  "targets.action.settings": { nl: "Instellingen", en: "Settings" },

  // Hero pillars (4 KPI cards always visible above Marketing tab)
  "targets.pillar.cbc": { nl: "Cost per Booked Call", en: "Cost per Booked Call" },
  "targets.pillar.qual": { nl: "Qualification Rate", en: "Qualification Rate" },
  "targets.pillar.showup": { nl: "Show-up Rate", en: "Show-up Rate" },
  "targets.pillar.conv": { nl: "Conversion Rate", en: "Conversion Rate" },

  // Pillar subtitle fragments
  "targets.pillar.cbc.with_target": { nl: "target {target} · {calls} booked", en: "target {target} · {calls} booked" },
  "targets.pillar.cbc.no_target": { nl: "{calls} booked · stel CBC target in", en: "{calls} booked · set CBC target" },
  "targets.pillar.cbc.none_yet": { nl: "Nog geen booked calls", en: "No booked calls yet" },
  "targets.pillar.qual.with_target": { nl: "target {target} · {qualified}/{calls}", en: "target {target} · {qualified}/{calls}" },
  "targets.pillar.qual.no_target": { nl: "{qualified}/{calls} leads gekwalificeerd", en: "{qualified}/{calls} leads qualified" },
  "targets.pillar.showup.with_target": { nl: "target {target} · {taken}/{qualified}", en: "target {target} · {taken}/{qualified}" },
  "targets.pillar.showup.no_target": { nl: "{taken}/{qualified} opgekomen", en: "{taken}/{qualified} showed up" },
  "targets.pillar.conv.with_target": { nl: "target {target} · {deals}/{taken}", en: "target {target} · {deals}/{taken}" },
  "targets.pillar.conv.no_target": { nl: "{deals}/{taken} gesloten", en: "{deals}/{taken} closed" },

  // ─── Client detail page ───────────────────────────────────────────────
  // Tab strip
  "client.tab.home": { nl: "Home", en: "Home" },
  "client.tab.campaigns": { nl: "Campagnes", en: "Campaigns" },
  "client.tab.inbox": { nl: "Inbox", en: "Inbox" },
  "client.tab.timeline": { nl: "Timeline", en: "Timeline" },
  "client.tab.pedro": { nl: "Pedro", en: "Pedro" },
  "client.tab.billing": { nl: "Facturatie", en: "Billing" },
  "client.tab.settings": { nl: "Instellingen", en: "Settings" },
  "client.tab.refresh_title": { nl: "Data verversen en analyse opnieuw genereren", en: "Refresh data and regenerate analysis" },
  "client.no_access": { nl: "Je hebt geen toegang tot deze sectie.", en: "You do not have access to this section." },

  // Header — meta row labels + payment summary
  "client.header.am": { nl: "AM", en: "AM" },
  "client.header.cm": { nl: "CM", en: "CM" },
  "client.header.budget": { nl: "Budget", en: "Budget" },
  "client.header.payment": { nl: "Betaling", en: "Payment" },
  "client.header.payment.paid": { nl: "Betaald", en: "Paid up" },
  "client.header.payment.open": { nl: "{count} openstaand · {amount}", en: "{count} open · {amount}" },
  "client.header.payment.overdue": { nl: "{count} achterstallig · {amount}", en: "{count} overdue · {amount}" },

  // ─── Watch List sparkline tooltip ─────────────────────────────────────
  // The rest of the Watch List is already wired through t() — these are
  // the leftover hardcoded English strings inside the CPL trend tooltip.
  "watchlist.sparkline.trending_up": { nl: "CPL stijgt ({pct}% over de periode)", en: "CPL trending up ({pct}% over the window)" },
  "watchlist.sparkline.trending_down": { nl: "CPL daalt ({pct}% over de periode)", en: "CPL trending down ({pct}% over the window)" },
  "watchlist.sparkline.stable": { nl: "CPL stabiel over de periode", en: "CPL stable over the window" },
  "watchlist.sparkline.no_leads": { nl: "{date}: geen leads (carry €{cpl})", en: "{date}: no leads (carry €{cpl})" },
  "watchlist.sparkline.no_spend": { nl: "{date}: geen spend", en: "{date}: no spend" },
  "watchlist.sparkline.day_summary": { nl: "{date}: €{cpl} CPL · {leads} leads · €{spend} spend", en: "{date}: €{cpl} CPL · {leads} leads · €{spend} spend" },

  // ─── Meetings page ────────────────────────────────────────────────────
  "meetings.title": { nl: "Meetings", en: "Meetings" },
  "meetings.subtitle": { nl: "Fathom-opnames van de Rocket Leads teams. Gekoppelde meetings verschijnen ook op de klantpagina.", en: "Fathom recordings from the Rocket Leads teams. Linked meetings also appear on the client's page." },

  // Tabs
  "meetings.tab.unlinked": { nl: "Ongekoppeld", en: "Unlinked" },
  "meetings.tab.recent": { nl: "Recent", en: "Recent" },
  "meetings.tab.internal": { nl: "Intern", en: "Internal" },
  "meetings.tab.archived": { nl: "Gearchiveerd", en: "Archived" },

  // Action buttons
  "meetings.action.backfill": { nl: "Backfill 90d", en: "Backfill 90d" },
  "meetings.action.backfill_tooltip": { nl: "Haal laatste 90 dagen op uit Fathom + matcher draaien", en: "Pull last 90 days from Fathom + run matcher" },
  "meetings.action.run_matcher": { nl: "Matcher draaien", en: "Run matcher" },
  "meetings.confirm.backfill": { nl: "Laatste 90 dagen uit Fathom ophalen + matcher draaien? Kan 30-60 seconden duren.", en: "Pull last 90 days from Fathom + run matcher? Can take 30-60 seconds." },

  // Tab subtitle (count + helper)
  "meetings.subtitle.unlinked": { nl: "{n} meeting(s) nog niet gekoppeld aan een klant. Koppel handmatig hieronder of archiveer als koppelen niet nodig is.", en: "{n} meeting(s) not yet matched to a client. Link manually below or archive if no link is needed." },
  "meetings.subtitle.recent": { nl: "{n} gekoppelde meeting(s) in de laatste 60 dagen.", en: "{n} linked meeting(s) in the last 60 days." },
  "meetings.subtitle.internal": { nl: "{n} interne RL-team meeting(s) in de laatste 60 dagen.", en: "{n} internal RL-team meeting(s) in the last 60 days." },
  "meetings.subtitle.archived": { nl: "{n} gearchiveerde meeting(s). Gebruik Dearchiveren om terug te zetten in triage.", en: "{n} archived meeting(s). Use Unarchive to restore to triage." },

  // Empty states
  "meetings.empty.unlinked": { nl: "Niks te triagen — alle recente meetings zijn gekoppeld.", en: "Nothing to triage — all recent meetings are matched." },
  "meetings.empty.recent": { nl: "Nog geen gekoppelde meetings.", en: "No linked meetings yet." },
  "meetings.empty.internal": { nl: "Geen interne team meetings opgenomen in de laatste 60 dagen.", en: "No internal team meetings recorded in the last 60 days." },
  "meetings.empty.archived": { nl: "Niks gearchiveerd.", en: "Nothing archived." },

  // ─── Clients overview page ────────────────────────────────────────────
  "clients.title": { nl: "Klanten", en: "Clients" },
  "clients.error.failed_to_load": { nl: "Klanten konden niet geladen worden", en: "Failed to load clients" },
  "clients.error.go_to_settings": { nl: "Ga naar Instellingen", en: "Go to Settings" },

  // ─── Pedro page ───────────────────────────────────────────────────────
  "pedro.title": { nl: "Pedro", en: "Pedro" },
  "pedro.subtitle": { nl: "Alle deliverables (brief, research, angles, scripts, creatives, LP, ad copy, refreshes) horen bij de geselecteerde klant.", en: "All deliverables (brief, research, angles, scripts, creatives, LP, ad copy, refreshes) belong to the selected client." },
  "pedro.status.online": { nl: "Online", en: "Online" },
  "pedro.picker.active_client": { nl: "Actieve klant", en: "Active client" },
  "pedro.picker.onboarding": { nl: "Onboarding", en: "Onboarding" },
  "pedro.picker.live": { nl: "Live", en: "Live" },
  "pedro.picker.saved": { nl: " · campagne opgeslagen", en: " · campaign saved" },

  // Tabs
  "pedro.tab.brief": { nl: "Brief", en: "Brief" },
  "pedro.tab.research": { nl: "Research", en: "Research" },
  "pedro.tab.angles": { nl: "Angles", en: "Angles" },
  "pedro.tab.script": { nl: "Video scripts", en: "Video scripts" },
  "pedro.tab.creatives": { nl: "Creatives", en: "Creatives" },
  "pedro.tab.lp": { nl: "LP prompts", en: "LP prompts" },
  "pedro.tab.ad_copy": { nl: "Ad copy", en: "Ad copy" },
  "pedro.tab.refresh": { nl: "Refresh", en: "Refresh" },
  "pedro.tab.insights": { nl: "Insights", en: "Insights" },

  // No-client-selected state
  "pedro.no_client.title": { nl: "Selecteer een klant om te starten", en: "Select a client to start" },
  "pedro.no_client.body": { nl: "Pedro's output — brief, research, angles, scripts, creatives, LP, ad copy, refreshes — wordt allemaal opgeslagen bij de actieve klant. Kies hierboven een klant zodat Pedro weet voor wie hij werkt.", en: "Pedro's output — brief, research, angles, scripts, creatives, LP, ad copy, refreshes — is all stored on the active client. Pick a client above so Pedro knows who he's working for." },

  // ─── Client detail — Settings tab sections ────────────────────────────
  "client.settings.info.title": { nl: "Klantgegevens", en: "Client Information" },
  "client.settings.info.description": { nl: "Bewerk de klantgegevens. Wijzigingen worden teruggeschreven naar Monday en gesynchroniseerd met de Hub.", en: "Edit the client's details. Changes write back to Monday and sync to the Hub." },
  "client.settings.kpi.title": { nl: "KPI-secties", en: "KPI Sections" },
  "client.settings.kpi.description": { nl: "Kies welke KPI-secties zichtbaar zijn voor deze klant. Leads staat altijd aan. Zet Afspraken en Deals aan zodra Monday CRM-data beschikbaar is.", en: "Choose which KPI sections are visible for this client. Leads is always on. Enable Afspraken and Deals when Monday CRM data is available." },
  "client.settings.campaigns.title": { nl: "Campagne selectie", en: "Campaign Selection" },
  "client.settings.campaigns.description": { nl: "Kies welke campagnes meetellen in de KPI-berekeningen. Alleen geselecteerde campagnes worden gebruikt voor de Campagnes tab.", en: "Select which campaigns to include in KPI calculations. Only selected campaigns are used for the Campaigns tab." },
  "client.settings.columns.title": { nl: "Board kolom-IDs", en: "Board Column IDs" },
  "client.settings.columns.description": { nl: "Overschrijf de standaard Monday kolom-IDs voor deze klant. Laat leeg om de globale defaults uit Instellingen te gebruiken.", en: "Override default Monday column IDs for this client. Leave empty to use the global defaults from Settings." },

  // ─── Client detail — Meetings tab (per-client view) ───────────────────
  "client.meetings.error": { nl: "Meetings konden niet geladen worden.", en: "Failed to load meetings." },
  "client.meetings.empty.title": { nl: "Nog geen meetings aan deze klant gekoppeld.", en: "No meetings linked to this client yet." },
  "client.meetings.empty.body": { nl: "Fathom-opnames worden automatisch gekoppeld via e-mailadres van de deelnemer. Check de globale {meetings} pagina om handmatig te koppelen.", en: "Fathom recordings auto-link via attendee email. Check the global {meetings} page to link manually." },
  "client.meetings.empty.body.meetings_word": { nl: "Meetings", en: "Meetings" },

  // ─── Date filter (Campaigns + Billing tabs) ───────────────────────────
  "client.date.preset.today": { nl: "Vandaag", en: "Today" },
  "client.date.preset.yesterday": { nl: "Gisteren", en: "Yesterday" },
  "client.date.preset.last7": { nl: "Laatste 7 dagen", en: "Last 7 days" },
  "client.date.preset.this_month": { nl: "Deze maand", en: "This month" },
  "client.date.preset.last_month": { nl: "Vorige maand", en: "Last month" },
  "client.date.preset.this_quarter": { nl: "Dit kwartaal", en: "This quarter" },
  "client.date.from": { nl: "Vanaf", en: "From" },
  "client.date.to": { nl: "Tot", en: "To" },

  // ─── Targets — Marketing tab chrome ───────────────────────────────────
  // KPI metric labels (Ad Spend, Booked Calls, CBC, CQC, etc.) stay English
  // in both locales — they're agreed RL jargon used in Slack + Settings.
  "targets.country.all": { nl: "Alles", en: "All" },
  "targets.country.other": { nl: "Overig", en: "Other" },
  "targets.filter.closer": { nl: "Closer", en: "Closer" },
  "targets.filter.all_closers": { nl: "Alle closers", en: "All Closers" },
  "targets.filter.unassigned": { nl: "Niet toegewezen", en: "Unassigned" },
  "targets.filter.active_closer": { nl: "Filteren op closer: {name}", en: "Filtering by closer: {name}" },
  "targets.filter.clear_closer": { nl: "Klik om het closer filter te wissen", en: "Click to clear the closer filter" },

  "targets.section.summary.title": { nl: "Samenvatting", en: "Summary" },
  "targets.section.summary.subtitle": { nl: "Status & insights in één oogopslag", en: "One-second status & insights" },
  "targets.section.metrics.title": { nl: "Metrics", en: "Metrics" },
  "targets.section.metrics.subtitle": { nl: "Volume, kosten & ratio's", en: "Volume, costs & ratios" },
  "targets.section.breakdown.title": { nl: "Breakdown", en: "Breakdown" },
  "targets.section.breakdown.subtitle": { nl: "Trends, branches & team performance", en: "Trends, industries & team performance" },
  "targets.section.volume_costs": { nl: "Volume & Kosten", en: "Volume & Costs" },

  // KpiCard helpers
  "targets.kpi.not_updated": { nl: "{n} niet bijgewerkt", en: "{n} not updated" },
  "targets.kpi.not_updated_title": { nl: "{n} van deze afgelopen afspraken staan nog op Qualified / Gepland status. Geteld als taken zodat de conversion rate niet gespeeld wordt, maar gemarkeerd zodat closers hun statussen bijwerken.", en: "{n} of these past appointments are still in Qualified / Gepland status. Counted as taken so the conversion rate isn't gamed, but flagged so closers update their statuses." },
  "targets.kpi.target_of": { nl: "{value} van {target}", en: "{value} of {target}" },

  // Stripe gap modal (admin drilldown)
  "targets.stripe.title": { nl: "Monday vs Stripe — Revenue cross-check", en: "Monday vs Stripe — Revenue cross-check" },
  "targets.stripe.subtitle": { nl: "Toont alleen items zonder tegenhanger aan de andere kant. Gematchte paren zijn standaard verborgen — gebruik de toggle om alles te zien.", en: "Showing only items without a counterpart on the other side. Matched pairs are hidden by default — toggle below to see everything." },
  "targets.stripe.monday_closed_deals": { nl: "Monday closed deals", en: "Monday closed deals" },
  "targets.stripe.stripe_new_business": { nl: "Stripe new business", en: "Stripe new business" },
  "targets.stripe.gap": { nl: "Gap (Stripe − Monday)", en: "Gap (Stripe − Monday)" },
  "targets.stripe.show_unmatched": { nl: "Toon alleen unmatched", en: "Show only unmatched" },
  "targets.stripe.show_all": { nl: "Toon alles (incl. matched)", en: "Show all (incl. matched)" },
  "targets.stripe.stripe_invoices_title": { nl: "Stripe new-business facturen", en: "Stripe new-business invoices" },
  "targets.stripe.empty.deals_none": { nl: "Geen closed deals in deze periode.", en: "No closed deals in this period." },
  "targets.stripe.empty.deals_all_matched": { nl: "Elke deal heeft een Stripe match. Niks om te fixen.", en: "Every deal has a Stripe match. Nothing to fix." },
  "targets.stripe.empty.invoices_none": { nl: "Geen Stripe new-business facturen in deze periode.", en: "No Stripe new-business invoices in this period." },
  "targets.stripe.empty.invoices_all_matched": { nl: "Elke factuur heeft een Monday match. Niks om te fixen.", en: "Every invoice has a Monday match. Nothing to fix." },
  "targets.stripe.col.date": { nl: "Datum", en: "Date" },
  "targets.stripe.col.lead_company_closer": { nl: "Lead · Bedrijf · Closer", en: "Lead · Company · Closer" },
  "targets.stripe.col.value": { nl: "Waarde", en: "Value" },
  "targets.stripe.col.customer_invoice": { nl: "Klant / Factuur", en: "Customer / Invoice" },
  "targets.stripe.col.amount": { nl: "Bedrag", en: "Amount" },
  "targets.stripe.count.total": { nl: "{n} totaal", en: "{n} total" },
  "targets.stripe.count.split": { nl: "{unmatched} unmatched · {matched} matched", en: "{unmatched} unmatched · {matched} matched" },

  // ─── Client detail — Home tab ─────────────────────────────────────────
  // Health card (top-right)
  "client.home.health.label": { nl: "Health", en: "Health" },
  "client.home.health.action": { nl: "Action", en: "Action" },
  "client.home.health.watch": { nl: "Watch", en: "Watch" },
  "client.home.health.good": { nl: "Healthy", en: "Healthy" },
  "client.home.health.no_data": { nl: "Geen data", en: "No data" },

  // Lead Analysis card
  "client.home.lead_analysis.title": { nl: "Lead Analysis · Quantity", en: "Lead Analysis · Quantity" },
  "client.home.lead_analysis.verdict.good": { nl: "good", en: "good" },
  "client.home.lead_analysis.verdict.neutral": { nl: "neutral", en: "neutral" },
  "client.home.lead_analysis.verdict.concerning": { nl: "concerning", en: "concerning" },
  "client.home.lead_analysis.empty": { nl: "Nog geen lead-analyse beschikbaar — open Campagnes om te genereren.", en: "No lead analysis available yet — open Campaigns to generate." },
  "client.home.lead_analysis.see_full": { nl: "Bekijk volledige proposal", en: "See full proposal" },

  // Top ads card
  "client.home.top_ads.title": { nl: "Top performing ads", en: "Top Performing Ads" },
  "client.home.top_ads.subtitle": { nl: "Op spend (30d) · kleur = t.o.v. account-gemiddelde CPL", en: "By spend (30d) · color = vs account avg CPL" },
  "client.home.top_ads.empty": { nl: "Geen ads met noemenswaardige spend in de laatste 30d.", en: "No ads with meaningful spend in the last 30d." },

  // Activity summary card
  "client.home.activity.title": { nl: "Activiteit-samenvatting", en: "Activity Summary" },
  "client.home.activity.subtitle": { nl: "Monday CRM · Current Clients · Trengo (14d)", en: "Monday CRM · Current Clients · Trengo (14d)" },
  "client.home.activity.empty": { nl: "Geen klantcommunicatie of CRM-activiteit in de laatste 14d.", en: "No client communication or CRM activity in the last 14d." },

  // Payment banner
  "client.home.payment.label": { nl: "Betaling", en: "Payment" },
  "client.home.payment.no_stripe": { nl: "Geen Stripe-klant gekoppeld.", en: "No Stripe customer linked." },
  "client.home.payment.paid": { nl: "Betaald — geen open of achterstallige facturen", en: "Paid up — no open or overdue invoices" },
  "client.home.payment.open_one": { nl: "{count} open factuur · {amount} openstaand", en: "{count} open invoice · {amount} outstanding" },
  "client.home.payment.open_many": { nl: "{count} open facturen · {amount} openstaand", en: "{count} open invoices · {amount} outstanding" },
  "client.home.payment.overdue_one": { nl: "{count} achterstallige factuur · {amount} openstaand", en: "{count} overdue invoice · {amount} outstanding" },
  "client.home.payment.overdue_many": { nl: "{count} achterstallige facturen · {amount} openstaand", en: "{count} overdue invoices · {amount} outstanding" },
  "client.home.payment.open_billing": { nl: "Open facturatie", en: "Open billing" },

  // Tasks list
  "client.home.tasks.title": { nl: "Open taken", en: "Open Tasks" },
  "client.home.tasks.open_inbox": { nl: "Open inbox", en: "Open inbox" },
  "client.home.tasks.empty": { nl: "Geen open taken voor deze klant.", en: "No open tasks for this client." },
  "client.home.tasks.assigned_to": { nl: "Toegewezen aan {name}", en: "Assigned to {name}" },
  "client.home.tasks.more": { nl: "+{n} meer", en: "+{n} more" },

  // Due-date pills
  "client.home.due.none": { nl: "Geen einddatum", en: "No due date" },
  "client.home.due.overdue": { nl: "{n}d te laat", en: "{n}d overdue" },
  "client.home.due.today": { nl: "Vandaag", en: "Due today" },
  "client.home.due.tomorrow": { nl: "Morgen", en: "Due tomorrow" },
  "client.home.due.in_days": { nl: "Over {n}d", en: "Due in {n}d" },
  "client.home.due.on_date": { nl: "Voor {date}", en: "Due {date}" },

  // ─── KPI Cards (Campaigns tab) ─────────────────────────────────────────
  // Group titles — KPI labels themselves stay English (RL jargon).
  "kpi.group.leads": { nl: "Leads", en: "Leads" },
  "kpi.group.appointments": { nl: "Afspraken", en: "Appointments" },
  "kpi.group.deals": { nl: "Deals", en: "Deals" },

  // ─── Client detail — Campaigns tab ────────────────────────────────────
  "client.campaigns.empty.no_link": { nl: "Geen Meta-advertentieaccount of klantbord gekoppeld in Monday.com voor deze klant.", en: "No Meta Ad Account or Client Board linked in Monday.com for this client." },
  "client.campaigns.empty.no_selection": { nl: "Nog geen campagnes geselecteerd. Kies welke campagnes worden bijgehouden in Instellingen.", en: "No campaigns selected yet. Select which campaigns to track in Settings." },
  "client.campaigns.empty.go_settings": { nl: "Ga naar instellingen", en: "Go to Settings" },
  "client.campaigns.error.kpi": { nl: "KPI-data kon niet geladen worden. Controleer je API-tokens.", en: "Failed to load KPI data. Check your API tokens." },
  "client.campaigns.utm.title": { nl: "UTM / Ad performance breakdown", en: "UTM / Ad Performance Breakdown" },

  // ─── Client detail — Billing tab ──────────────────────────────────────
  // Invoice status pills
  "client.billing.status.paid": { nl: "Betaald", en: "Paid" },
  "client.billing.status.open": { nl: "Open", en: "Open" },
  "client.billing.status.overdue": { nl: "Achterstallig", en: "Overdue" },
  "client.billing.status.void": { nl: "Vervallen", en: "Void" },
  "client.billing.status.draft": { nl: "Concept", en: "Draft" },

  // Next invoice date section
  "client.billing.next_invoice.title": { nl: "Volgende factuur", en: "Next invoice" },
  "client.billing.next_invoice.subtitle": { nl: "Wanneer de volgende factuur de deur uit moet. Op deze datum verschijnt automatisch een taak in de inbox van finance.", en: "When the next invoice should go out. A task lands in finance's inbox automatically on this date." },
  "client.billing.action.save": { nl: "Opslaan", en: "Save" },
  "client.billing.action.clear": { nl: "Wissen", en: "Clear" },
  "client.billing.action.clear_title": { nl: "Datum volgende factuur wissen", en: "Clear next invoice date" },
  "client.billing.action.saved": { nl: "Opgeslagen", en: "Saved" },
  "client.billing.error.save_failed": { nl: "Opslaan mislukt", en: "Failed to save" },

  // Invoices section
  "client.billing.invoices.title": { nl: "Facturen", en: "Invoices" },
  "client.billing.invoices.subtitle_fallback": { nl: "Wat er daadwerkelijk via Stripe gefactureerd is voor deze klant.", en: "What this client has actually been billed via Stripe." },
  "client.billing.invoices.no_stripe_id": { nl: "Geen Stripe Customer ID gekoppeld in Monday.com voor deze klant.", en: "No Stripe Customer ID linked in Monday.com for this client." },
  "client.billing.invoices.load_failed": { nl: "Facturatie-data kon niet geladen worden.", en: "Failed to load billing data." },

  // Summary cards (4 across the top)
  "client.billing.summary.invoiced": { nl: "Totaal gefactureerd", en: "Total invoiced" },
  "client.billing.summary.paid": { nl: "Totaal betaald", en: "Total paid" },
  "client.billing.summary.outstanding": { nl: "Openstaand", en: "Outstanding" },
  "client.billing.summary.outstanding.sub": { nl: "Actie vereist", en: "Action required" },
  "client.billing.summary.avg_days": { nl: "Gem. betaaltijd", en: "Avg. payment time" },
  "client.billing.summary.avg_days.sub": { nl: "Van factuur naar betaling", en: "From invoice to payment" },
  "client.billing.summary.days": { nl: "{n} dagen", en: "{n} days" },

  // Table columns + empty + view links
  "client.billing.col.invoice": { nl: "Factuur", en: "Invoice" },
  "client.billing.col.date": { nl: "Datum", en: "Date" },
  "client.billing.col.due_date": { nl: "Vervaldatum", en: "Due date" },
  "client.billing.col.amount": { nl: "Bedrag", en: "Amount" },
  "client.billing.col.status": { nl: "Status", en: "Status" },
  "client.billing.col.pdf": { nl: "PDF", en: "PDF" },
  "client.billing.empty.no_invoices": { nl: "Geen facturen gevonden", en: "No invoices found" },
  "client.billing.link.view": { nl: "Bekijk", en: "View" },

  // ─── Client detail — Timeline tab ─────────────────────────────────────
  // Source labels: Monday/Trengo/Slack/Fathom stay as brand names; only the
  // generic "Manual" and "Watch List" labels translate. The badge classes
  // (color tokens) stay independent of the labels.
  "client.timeline.source.monday": { nl: "Monday", en: "Monday" },
  "client.timeline.source.trengo": { nl: "Trengo", en: "Trengo" },
  "client.timeline.source.slack": { nl: "Slack", en: "Slack" },
  "client.timeline.source.meeting": { nl: "Fathom", en: "Fathom" },
  "client.timeline.source.manual": { nl: "Handmatig", en: "Manual" },
  "client.timeline.source.watchlist": { nl: "Watch List", en: "Watch List" },
  "client.timeline.source.automation": { nl: "Automatisering", en: "Automation" },

  "client.timeline.filter.all": { nl: "Alles", en: "All" },
  "client.timeline.error": { nl: "Timeline kon niet geladen worden.", en: "Failed to load timeline." },
  "client.timeline.empty.title": { nl: "Er is nog niks gebeurd met deze klant.", en: "Nothing has happened with this client yet." },
  "client.timeline.empty.body": { nl: "Trengo-berichten, Monday updates, Slack mentions en Fathom meetings verschijnen hier.", en: "Trengo messages, Monday updates, Slack mentions and Fathom meetings show up here." },
  "client.timeline.empty.filtered": { nl: "Geen {source} items.", en: "No {source} entries." },
  "client.timeline.scope.internal": { nl: "intern", en: "internal" },
  "client.timeline.open_link": { nl: "Openen", en: "Open" },
  "client.timeline.day.today": { nl: "Vandaag", en: "Today" },
  "client.timeline.day.yesterday": { nl: "Gisteren", en: "Yesterday" },

  // ─── Client detail — Pedro tab (per-client) ───────────────────────────
  // Status pills
  "client.pedro.status.not_started": { nl: "Pedro nog niet gestart", en: "Pedro not started yet" },
  "client.pedro.status.auto_draft": { nl: "Auto-draft (nog niet bewerkt)", en: "Auto-draft (not edited yet)" },
  "client.pedro.status.active": { nl: "Pedro actief — campagne #{n}", en: "Pedro active — campaign #{n}" },

  // Header card
  "client.pedro.header.last_edited_one": { nl: "Laatst bewerkt {date} · {n} refresh", en: "Last edited {date} · {n} refresh" },
  "client.pedro.header.last_edited_many": { nl: "Laatst bewerkt {date} · {n} refreshes", en: "Last edited {date} · {n} refreshes" },
  "client.pedro.header.empty": { nl: "Nog geen brief, angles of refreshes voor deze klant gegenereerd.", en: "No brief, angles or refreshes generated for this client yet." },
  "client.pedro.action.open": { nl: "Open in Pedro", en: "Open in Pedro" },
  "client.pedro.action.refresh": { nl: "Refresh", en: "Refresh" },
  "client.pedro.action.refresh_title": { nl: "Vraag Pedro een nieuwe creative refresh", en: "Ask Pedro for a new creative refresh" },

  // Brief snapshot card
  "client.pedro.brief.title": { nl: "Brief snapshot", en: "Brief snapshot" },
  "client.pedro.brief.campaign": { nl: "Campagne #{n}", en: "Campaign #{n}" },
  "client.pedro.brief.field.sector": { nl: "Sector", en: "Sector" },
  "client.pedro.brief.field.doel": { nl: "Doelgroep", en: "Target audience" },
  "client.pedro.brief.field.pijn": { nl: "Pijnpunten", en: "Pain points" },
  "client.pedro.brief.field.aanbod": { nl: "Aanbod", en: "Offer" },
  "client.pedro.brief.field.usps": { nl: "USPs", en: "USPs" },
  "client.pedro.brief.field.hooksAM": { nl: "Marketing hooks", en: "Marketing hooks" },

  // Refresh history card
  "client.pedro.refresh.title": { nl: "Refresh history", en: "Refresh history" },
  "client.pedro.refresh.total": { nl: "{n} totaal", en: "{n} total" },
  "client.pedro.refresh.empty_lead": { nl: "Nog geen refresh-rondes gedraaid.", en: "No refresh rounds run yet." },
  "client.pedro.refresh.empty_cta": { nl: "Genereer er nu één →", en: "Generate one now →" },
  "client.pedro.refresh.window": { nl: "{days}d window ({start} → {end})", en: "{days}d window ({start} → {end})" },
  "client.pedro.refresh.winners_losers": { nl: "{w} winners / {l} losers", en: "{w} winners / {l} losers" },
  "client.pedro.refresh.stat.spend": { nl: "Spend", en: "Spend" },
  "client.pedro.refresh.stat.leads": { nl: "Leads", en: "Leads" },
  "client.pedro.refresh.stat.avg_cpl": { nl: "Avg CPL", en: "Avg CPL" },
  "client.pedro.refresh.trend.flat": { nl: "stabiel", en: "flat" },
  "client.pedro.refresh.proposals_one": { nl: "{n} proposal — itereren op:", en: "{n} proposal — iterate on:" },
  "client.pedro.refresh.proposals_many": { nl: "{n} proposals — itereren op:", en: "{n} proposals — iterate on:" },
  "client.pedro.refresh.variants": { nl: "{n} varianten", en: "{n} variants" },
  "client.pedro.refresh.open_full": { nl: "Open de volledige refresh-stage in Pedro", en: "Open the full refresh stage in Pedro" },

  // Footer
  "client.pedro.footer": { nl: "{client} · alle Pedro deliverables worden per campagne opgeslagen op deze klant", en: "{client} · all Pedro deliverables are stored per campaign on this client" },

  // Saved-version timeline
  "client.pedro.versions.title": { nl: "Versie geschiedenis", en: "Version history" },
  "client.pedro.versions.count_one": { nl: "{n} versie", en: "{n} version" },
  "client.pedro.versions.count_many": { nl: "{n} versies", en: "{n} versions" },
  "client.pedro.versions.empty_lead": { nl: "Nog geen versies opgeslagen.", en: "No versions saved yet." },
  "client.pedro.versions.empty_cta": { nl: "Open Pedro →", en: "Open Pedro →" },
  "client.pedro.versions.filter.all": { nl: "Alle ({n})", en: "All ({n})" },
  "client.pedro.versions.stage_filter_count": { nl: "{stage} ({n})", en: "{stage} ({n})" },
  "client.pedro.versions.action.restore": { nl: "Restore", en: "Restore" },
  "client.pedro.versions.action.restored": { nl: "Hersteld", en: "Restored" },
  "client.pedro.versions.action.error": { nl: "Fout", en: "Error" },
  "client.pedro.versions.action.title": { nl: "Restore deze versie als draft (overschrijft de huidige draft)", en: "Restore this version as the draft (overwrites the current draft)" },
  "client.pedro.versions.empty_filtered": { nl: "Geen versies in deze stage.", en: "No versions in this stage." },

  // Stage labels (used in saved-version filter chips + row labels)
  "client.pedro.stage.brief": { nl: "Brief", en: "Brief" },
  "client.pedro.stage.research": { nl: "Research", en: "Research" },
  "client.pedro.stage.angles": { nl: "Angles", en: "Angles" },
  "client.pedro.stage.script": { nl: "Script", en: "Script" },
  "client.pedro.stage.creatives": { nl: "Creatives", en: "Creatives" },
  "client.pedro.stage.lp": { nl: "LP prompts", en: "LP prompts" },
  "client.pedro.stage.ad_copy": { nl: "Ad copy", en: "Ad copy" },
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
