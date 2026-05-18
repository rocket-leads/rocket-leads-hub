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
  "watchlist.col.create_task": { nl: "Taak", en: "Task" },

  // Row UI bits
  "watchlist.row.new_pill": { nl: "NIEUW", en: "NEW" },
  "watchlist.row.generating": { nl: "Genereren…", en: "Generating..." },
  "watchlist.row.ask_pedro": { nl: "Vraag Pedro", en: "Ask Pedro" },
  "watchlist.row.ask_pedro_tooltip": { nl: "Pedro stelt een creative refresh voor op basis van laatste 30d performance", en: "Pedro proposes a creative refresh based on last 30d performance" },

  // Create-task quick action (replaces AI Note column on Watch List home)
  "watchlist.row.create_task": { nl: "Taak aanmaken", en: "Create task" },
  "watchlist.row.create_task_tooltip": { nl: "Maak direct een taak aan voor {cm} (de campaign manager van deze klant)", en: "Create a task assigned to {cm} (this client's campaign manager) in one click" },
  "watchlist.row.create_task_no_cm_tooltip": { nl: "Geen campaign manager ingesteld voor deze klant", en: "No campaign manager set for this client" },
  "watchlist.row.create_task_title": { nl: "Watch List: {client} — actie nodig", en: "Watch List: {client} — action needed" },
  "watchlist.row.create_task_saving": { nl: "Aanmaken…", en: "Creating…" },
  "watchlist.row.create_task_done": { nl: "Toegewezen aan {cm}", en: "Assigned to {cm}" },
  "watchlist.row.create_task_failed": { nl: "Mislukt", en: "Failed" },
  "watchlist.row.create_task_no_mapping": { nl: "Geen Hub-gebruiker gekoppeld aan {cm}", en: "No Hub user mapped to {cm}" },

  // Create-task edit dialog (opens when Roy clicks the row's Taak chip)
  "watchlist.task_dialog.title": { nl: "Taak aanmaken", en: "Create task" },
  "watchlist.task_dialog.subtitle_with_cm": { nl: "Wordt toegewezen aan {cm}", en: "Will be assigned to {cm}" },
  "watchlist.task_dialog.subtitle_no_cm": { nl: "Geen campaign manager — taak kan nog niet aangemaakt worden", en: "No campaign manager — task can't be created yet" },
  "watchlist.task_dialog.ai_drafting": { nl: "Pedro stelt een concept op…", en: "Pedro is drafting…" },
  "watchlist.task_dialog.ai_label": { nl: "AI-concept · pas aan zoals nodig", en: "AI draft · edit as needed" },
  "watchlist.task_dialog.manual_label": { nl: "Concept · pas aan zoals nodig", en: "Draft · edit as needed" },
  "watchlist.task_dialog.field.title": { nl: "Titel", en: "Title" },
  "watchlist.task_dialog.field.body": { nl: "Context / details", en: "Context / details" },
  "watchlist.task_dialog.field.body_placeholder": { nl: "Wat is de reden, wat moet er gebeuren?", en: "What's the reason, what needs to happen?" },
  "watchlist.task_dialog.field.due": { nl: "Einddatum", en: "Due date" },
  "watchlist.task_dialog.field.regenerate": { nl: "Opnieuw genereren", en: "Regenerate" },
  "watchlist.task_dialog.field.regenerating": { nl: "Bezig…", en: "Working…" },
  "watchlist.task_dialog.cancel": { nl: "Annuleren", en: "Cancel" },
  "watchlist.task_dialog.submit": { nl: "Taak aanmaken", en: "Create task" },
  "watchlist.task_dialog.submitting": { nl: "Aanmaken…", en: "Creating…" },
  "watchlist.task_dialog.error_no_title": { nl: "Titel is verplicht.", en: "Title is required." },

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
  "clients.col.client_update": { nl: "Client update", en: "Client update" },
  "clients.client_update.updated_today": { nl: "Vandaag verstuurd", en: "Sent today" },
  "clients.client_update.last": { nl: "Laatste: {date}", en: "Last: {date}" },

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

  // ─── Settings — API Tokens tab ────────────────────────────────────────
  // Service descriptions kept English in both locales — they're admin
  // setup-instruction copy (referring to vendor screens) that the team
  // reads alongside the vendor docs themselves.
  "settings.tokens.dot.not_tested": { nl: "Niet getest", en: "Not tested" },
  "settings.tokens.dot.connected": { nl: "Verbonden", en: "Connected" },
  "settings.tokens.dot.failed": { nl: "Verbinding mislukt", en: "Connection failed" },
  "settings.tokens.last_tested": { nl: "Laatst getest: {time}", en: "Last tested: {time}" },
  "settings.tokens.input.new_label": { nl: "Nieuw token", en: "New token" },
  "settings.tokens.input.placeholder": { nl: "Plak nieuw token om bij te werken...", en: "Paste new token to update..." },
  "settings.tokens.action.save": { nl: "Token opslaan", en: "Save token" },
  "settings.tokens.action.saving": { nl: "Opslaan...", en: "Saving..." },
  "settings.tokens.action.test": { nl: "Verbinding testen", en: "Test connection" },
  "settings.tokens.action.testing": { nl: "Testen...", en: "Testing..." },
  "settings.tokens.saved_success": { nl: "Token succesvol opgeslagen.", en: "Token saved successfully." },
  "settings.tokens.request_failed": { nl: "Verzoek mislukt", en: "Request failed" },
  "settings.tokens.slack.live_hint_before": { nl: "Verbinding staat. Stel notificaties in en draai previews in de ", en: "Connection is live. Set up notifications and run previews in the " },
  "settings.tokens.slack.live_hint_tab": { nl: "Notificaties", en: "Notifications" },
  "settings.tokens.slack.live_hint_after": { nl: " tab.", en: " tab." },

  // ─── Settings — Board Config tab ──────────────────────────────────────
  // Field labels (Monday column mappings) stay English in both locales —
  // they describe the English schema of Monday boards. Only the chrome
  // (card titles, group titles, top-level board ID fields, save button)
  // flips with the locale toggle.
  "settings.board.boards.title": { nl: "Monday.com Board IDs", en: "Monday.com Board IDs" },
  "settings.board.boards.onboarding": { nl: "Onboarding Board ID", en: "Onboarding Board ID" },
  "settings.board.boards.current": { nl: "Huidige klanten Board ID", en: "Current Clients Board ID" },
  "settings.board.columns.title": { nl: "Kolom mappings", en: "Column Mappings" },
  "settings.board.group.onboarding": { nl: "Onboarding board kolommen", en: "Onboarding Board Columns" },
  "settings.board.group.current": { nl: "Huidige klanten board kolommen", en: "Current Clients Board Columns" },
  "settings.board.group.client": { nl: "Klant-board kolommen (default voor alle klanten)", en: "Client Board Columns (default for all clients)" },
  "settings.board.action.save": { nl: "Configuratie opslaan", en: "Save configuration" },
  "settings.board.action.saving": { nl: "Opslaan...", en: "Saving..." },
  "settings.board.action.saved": { nl: "Opgeslagen!", en: "Saved!" },

  // ─── Settings — Users tab ─────────────────────────────────────────────
  // Invite form
  "settings.users.invite.first_name": { nl: "Voornaam", en: "First name" },
  "settings.users.invite.last_name": { nl: "Achternaam", en: "Last name" },
  "settings.users.invite.email": { nl: "E-mail", en: "Email" },
  "settings.users.invite.hub_role": { nl: "Hub rol", en: "Hub role" },
  "settings.users.invite.monday_role": { nl: "Monday rol", en: "Monday role" },
  "settings.users.invite.monday_name": { nl: "Monday naam", en: "Monday name" },
  "settings.users.invite.slack_id": { nl: "Slack ID", en: "Slack ID" },
  "settings.users.invite.helper": { nl: "Monday rol + naam bepalen welke klanten deze gebruiker ziet (niet-admins). Slack ID schakelt DM-notificaties in. Allemaal optioneel bij uitnodigen.", en: "Monday role + name controls which clients this user sees (non-admins). Slack ID enables DM notifications. All optional at invite time." },
  "settings.users.invite.action.add": { nl: "Gebruiker toevoegen", en: "Add user" },
  "settings.users.invite.action.adding": { nl: "Toevoegen...", en: "Adding..." },
  "settings.users.invite.error.failed": { nl: "Gebruiker toevoegen mislukt", en: "Failed to add user" },

  // Roles
  "settings.users.role.admin": { nl: "Admin", en: "Admin" },
  "settings.users.role.member": { nl: "Member", en: "Member" },
  "settings.users.role.guest": { nl: "Guest", en: "Guest" },

  // Select placeholders / fallbacks
  "settings.users.select.not_applicable": { nl: "Niet van toepassing", en: "Not applicable" },
  "settings.users.select.pick_person": { nl: "Kies een persoon", en: "Pick a person" },
  "settings.users.select.connect_fathom": { nl: "Verbind Fathom eerst", en: "Connect Fathom first" },
  "settings.users.select.pick_fathom": { nl: "Kies Fathom-gebruiker", en: "Pick Fathom user" },

  // Per-row indicators
  "settings.users.row.unsaved": { nl: "Niet opgeslagen", en: "Unsaved" },
  "settings.users.row.saved": { nl: "Opgeslagen", en: "Saved" },

  // Table headers
  "settings.users.col.user": { nl: "Gebruiker", en: "User" },
  "settings.users.col.hub_role": { nl: "Hub rol", en: "Hub role" },
  "settings.users.col.monday_role": { nl: "Monday rol", en: "Monday role" },
  "settings.users.col.monday_name": { nl: "Monday naam", en: "Monday name" },
  "settings.users.col.slack_id": { nl: "Slack user ID", en: "Slack user ID" },
  "settings.users.col.wa_template": { nl: "WhatsApp template", en: "WhatsApp template" },
  "settings.users.col.fathom_email": { nl: "Fathom e-mail", en: "Fathom email" },
  "settings.users.col.joined": { nl: "Lid sinds", en: "Joined" },

  // Row inputs / actions
  "settings.users.row.name_placeholder": { nl: "Voornaam Achternaam", en: "First Last" },
  "settings.users.row.remove_title": { nl: "Gebruiker verwijderen", en: "Remove user" },
  "settings.users.row.remove_confirm": { nl: "{email} verwijderen? Verliest direct toegang.", en: "Remove {email}? They will lose access immediately." },
  "settings.users.row.remove_failed": { nl: "Gebruiker verwijderen mislukt", en: "Failed to remove user" },
  "settings.users.row.wa_tooltip": { nl: "Trengo WhatsApp template-naam (bv. rl_universal_roel) — gebruikt voor outbound buiten 24u session window", en: "Trengo WhatsApp template name (e.g. rl_universal_roel) — used for outbound buiten 24u session window" },

  // Footer
  "settings.users.footer": { nl: "Hub rol bepaalt toegang. Monday rol bepaalt wat deze gebruiker doet — voor AM/CM/Setter pikt de Monday naam welke klanten ze zien (admins zien altijd alles). Finance is org-breed en heeft geen Monday naam nodig; triggert factuur-taken via de inbox automation. Slack ID wordt gebruikt voor DM-notificaties. Fathom e-mail koppelt deze Hub-gebruiker aan hun Fathom-account zodat de meeting matcher weet wie er in een opgenomen call zat. Alle velden auto-saven.", en: "Hub role controls access. Monday role decides what this user does — for AM/CM/Setter, the Monday name picks which clients they see (admins always see all). Finance is org-level and doesn't need a Monday name; it triggers invoice tasks via the inbox automation. Slack ID is used for DM notifications. Fathom email maps this Hub user to their Fathom account so the meeting matcher knows who was in a recorded call. All fields autosave." },

  // ─── Settings — Inbox Automations tab ─────────────────────────────────
  // Per-rule descriptions (title/description/trigger/effect) intentionally
  // stay English — admin operator docs full of code-flow terminology
  // (cron, idempotent, source_ref, etc.) that maps to the implementation.
  // Translating would break the mental model with code/UI.
  "settings.inbox.title": { nl: "Inbox automatiseringen", en: "Inbox Automations" },
  "settings.inbox.subtitle": { nl: "Regels die automatisch inbox-taken of updates aanmaken op basis van data-signalen uit de Hub. Elke regel draait dagelijks via cron en is volledig idempotent — opnieuw draaien levert geen duplicaten.", en: "Rules that automatically create inbox tasks or updates based on data signals across the Hub. Each rule runs once daily via cron and is fully idempotent — re-running won't create duplicates." },
  "settings.inbox.trigger": { nl: "Trigger", en: "Trigger" },
  "settings.inbox.effect": { nl: "Effect", en: "Effect" },
  "settings.inbox.footer_more": { nl: "Meer regels landen hier zodra we signalen uit Monday updates, Trengo conversaties en Watch List events verbinden met geautomatiseerde taken.", en: "More rules will land here as we wire signals from Monday updates, Trengo conversations and Watch List events into automated tasks." },

  // Run-as-test panel
  "settings.inbox.run.title": { nl: "Test draaien (toegewezen aan jou)", en: "Run as test (assigned to you)" },
  "settings.inbox.run.subtitle_before": { nl: "Zelfde code-pad als de dagelijkse cron, maar taken worden toegewezen aan ", en: "Same code path as the daily cron, but tasks are assigned to " },
  "settings.inbox.run.subtitle_you": { nl: "jou", en: "you" },
  "settings.inbox.run.subtitle_with": { nl: " met een ", en: " with a " },
  "settings.inbox.run.subtitle_after": { nl: " prefix — zodat je AI-output en regel-logica kunt valideren zonder het team te spammen. Idempotency check is uit, dus opnieuw draaien levert altijd verse items.", en: " prefix — so you can validate AI output and rule logic without spamming the team. Idempotency check is skipped, so re-running always produces fresh items." },
  "settings.inbox.run.action.run": { nl: "Test draaien", en: "Run test" },
  "settings.inbox.run.action.running": { nl: "Draait...", en: "Running..." },
  "settings.inbox.run.error.failed": { nl: "Draaien mislukt", en: "Run failed" },

  // Result summary
  "settings.inbox.result.last_run": { nl: "Laatste run · {duration}", en: "Last run · {duration}" },
  "settings.inbox.result.created": { nl: "aangemaakt", en: "created" },
  "settings.inbox.result.skipped": { nl: "overgeslagen", en: "skipped" },
  "settings.inbox.result.section_created": { nl: "Aangemaakt ({n})", en: "Created ({n})" },
  "settings.inbox.result.section_skipped": { nl: "Overgeslagen ({n})", en: "Skipped ({n})" },
  "settings.inbox.result.empty": { nl: "Geen acties ondernomen — niks paste vandaag bij een regel.", en: "No actions taken — nothing matched any rule today." },
  "settings.inbox.result.truncated": { nl: "+{n} meer (afgekapt)", en: "+{n} more (truncated)" },

  // Created-row labels
  "settings.inbox.row.payment_overdue": { nl: "Betaling achterstallig", en: "Payment overdue" },
  "settings.inbox.row.auto_completed": { nl: "Auto-completed factuurtaak", en: "Auto-completed invoice task" },
  "settings.inbox.row.deduped": { nl: "Taken gededupliceerd", en: "Deduped tasks" },
  "settings.inbox.row.cpl_drop": { nl: "CPL daling {period}", en: "CPL drop {period}" },
  "settings.inbox.row.invoice_short": { nl: "factuur {id}…", en: "invoice {id}…" },

  // ─── Settings — Pedro tab (admin pipeline observability) ──────────────
  "settings.pedro.error.title": { nl: "Pedro health niet beschikbaar — {message}", en: "Pedro health unavailable — {message}" },
  "settings.pedro.error.unknown": { nl: "onbekende fout", en: "unknown error" },

  "settings.pedro.kickoff.title": { nl: "Pedro pipeline (laatste 7d)", en: "Pedro pipeline (last 7d)" },
  "settings.pedro.kickoff.description": { nl: "Kick-off auto-trigger health. Admin-only. Polled elke 60s.", en: "Kick-off auto-trigger health. Admin-only. Polled every 60s." },
  "settings.pedro.stat.kickoffs_ingested": { nl: "Kick-offs ingested", en: "Kick-offs ingested" },
  "settings.pedro.stat.kickoffs_ingested.unlinked": { nl: "{n} ongekoppeld", en: "{n} unlinked" },
  "settings.pedro.stat.kickoffs_ingested.all_linked": { nl: "alle gekoppeld", en: "all linked" },
  "settings.pedro.stat.linked_to_client": { nl: "Gekoppeld aan klant", en: "Linked to client" },
  "settings.pedro.stat.linked_to_client.hint": { nl: "trigger-eligible", en: "trigger-eligible" },
  "settings.pedro.stat.pedro_fires": { nl: "Pedro auto-fires", en: "Pedro auto-fires" },
  "settings.pedro.stat.pedro_fires.conv": { nl: "{pct}% conversion", en: "{pct}% conversion" },
  "settings.pedro.stat.pedro_fires.conv_with_missed": { nl: "{pct}% conversion · {n} niet gefired", en: "{pct}% conversion · {n} not fired" },
  "settings.pedro.stat.pedro_fires.none": { nl: "geen kick-offs in window", en: "no kick-offs in window" },
  "settings.pedro.stat.status": { nl: "Status", en: "Status" },
  "settings.pedro.status.healthy": { nl: "Healthy", en: "Healthy" },
  "settings.pedro.status.degraded": { nl: "Degraded", en: "Degraded" },
  "settings.pedro.status.ok": { nl: "OK", en: "OK" },

  "settings.pedro.degraded.title": { nl: "Pedro fired niet voor de afgelopen 7 dagen aan kick-offs", en: "Pedro didn't fire for the last 7 days of kick-offs" },
  "settings.pedro.degraded.body": { nl: "Mogelijk hebben de klanten al een eerdere `pedro_client_state` row (geen rerun-rule), of er is een bug. Check de server logs of inspecteer de \"missed\" lijst hieronder.", en: "Clients might already have a prior `pedro_client_state` row (no rerun rule), or there's a bug. Check the server logs or inspect the \"missed\" list below." },

  "settings.pedro.evals.title": { nl: "Eval digest pipeline (laatste 7d)", en: "Eval digest pipeline (last 7d)" },
  "settings.pedro.evals.description": { nl: "Pedro leest elke evaluatie en flagt alleen wanneer Claude iets actionable detecteert. Lage conversion is normaal — routine evals produceren geen task.", en: "Pedro reads every evaluation and only flags when Claude detects something actionable. Low conversion is normal — routine evals produce no task." },
  "settings.pedro.stat.evals_ingested": { nl: "Evals ingested", en: "Evals ingested" },
  "settings.pedro.stat.evals_ingested.hint": { nl: "{n} gekoppeld", en: "{n} linked" },
  "settings.pedro.stat.digests_fired": { nl: "Digests fired", en: "Digests fired" },
  "settings.pedro.stat.digests_fired.actionable": { nl: "{pct}% actionable", en: "{pct}% actionable" },
  "settings.pedro.stat.digests_fired.none": { nl: "geen evals in window", en: "no evals in window" },
  "settings.pedro.stat.high_severity": { nl: "High severity", en: "High severity" },
  "settings.pedro.stat.high_severity.hint": { nl: "vraagt CM aandacht", en: "needs CM attention" },
  "settings.pedro.stat.medium_low": { nl: "Medium / low", en: "Medium / low" },

  "settings.pedro.fires.title": { nl: "Recente kick-off fires ({n})", en: "Recent kick-off fires ({n})" },
  "settings.pedro.fires.description": { nl: "Pedro auto-trigger taken die naar de CM zijn gestuurd.", en: "Pedro auto-trigger tasks sent to the CM." },
  "settings.pedro.fires.empty": { nl: "Geen Pedro auto-fires in dit window.", en: "No Pedro auto-fires in this window." },
  "settings.pedro.fires.open": { nl: "Openen", en: "Open" },

  "settings.pedro.missed.title": { nl: "Kick-offs zonder Pedro fire ({n})", en: "Kick-offs without Pedro fire ({n})" },
  "settings.pedro.missed.description": { nl: "Gekoppelde kick-offs uit de afgelopen 7d die geen auto-fire hebben getriggerd. Vaak legit (CM had Pedro al gestart vóór de kick-off), maar inspecteer als de aantallen hoog zijn.", en: "Linked kick-offs from the last 7d that didn't trigger an auto-fire. Often legit (CM had already started Pedro before the kick-off), but inspect if the counts are high." },
  "settings.pedro.missed.client_link": { nl: "Klant", en: "Client" },

  // ─── Settings — Notifications tab ─────────────────────────────────────
  // Per-notification descriptions + example bodies stay in their authored
  // mix of EN/NL — they're admin-docs about a multilingual product.
  "settings.notifications.intro": { nl: "Beheer geautomatiseerde notificaties die de Hub verstuurt. Elke notificatie heeft een preview-knop die naar je eigen Slack DM stuurt — veilig om te testen zonder het team te spammen.", en: "Manage automated notifications sent from the Hub. Each notification has a preview button that posts to your own Slack DM — safe to test without spamming the team." },
  "settings.notifications.slack_section": { nl: "Slack", en: "Slack" },
  "settings.notifications.slack_not_connected.title": { nl: "Slack token niet verbonden", en: "Slack token not connected" },
  "settings.notifications.slack_not_connected.body_before": { nl: "Verbind eerst een Slack Bot Token in ", en: "Connect a Slack Bot Token in " },
  "settings.notifications.slack_not_connected.tokens_tab": { nl: "API Tokens", en: "API Tokens" },
  "settings.notifications.slack_not_connected.body_middle": { nl: ", koppel daarna Hub-gebruikers aan Slack user IDs in ", en: ", then map Hub users to Slack user IDs in " },
  "settings.notifications.slack_not_connected.mapping_tab": { nl: "Kolom mapping", en: "Column Mapping" },
  "settings.notifications.slack_not_connected.body_after": { nl: ".", en: "." },

  "settings.notifications.action.send_test_dm": { nl: "Test-DM naar mij sturen", en: "Send test DM to me" },
  "settings.notifications.action.sending": { nl: "Versturen...", en: "Sending..." },
  "settings.notifications.action.working": { nl: "Bezig...", en: "Working..." },
  "settings.notifications.action.preview_to_me": { nl: "Preview naar mij", en: "Preview to me" },
  "settings.notifications.action.send_now": { nl: "Nu naar ontvangers sturen", en: "Send to recipients now" },
  "settings.notifications.example.show": { nl: "Voorbeeldformaat tonen", en: "Show example format" },
  "settings.notifications.example.hide": { nl: "Voorbeeld verbergen", en: "Hide example" },
  "settings.notifications.metadata.schedule": { nl: "Schema", en: "Schedule" },
  "settings.notifications.metadata.destination": { nl: "Bestemming", en: "Destination" },
  "settings.notifications.metadata.recipients": { nl: "Ontvangers", en: "Recipients" },
  "settings.notifications.recipients.empty": { nl: "Nog geen gebruikers hebben een Slack ID — voeg er één toe in Kolom mapping.", en: "No users have a Slack ID configured yet — add one in Column Mapping." },
  "settings.notifications.recipients.no_slack": { nl: "(geen Slack ID)", en: "(no Slack ID)" },
  "settings.notifications.recipients.no_slack_title": { nl: "Geen Slack ID ingesteld — ontvangt geen notificaties", en: "No Slack ID set — won't receive notifications" },
  "settings.notifications.footer.preview_label": { nl: "Preview naar mij", en: "Preview to me" },
  "settings.notifications.footer.preview_channel": { nl: "post naar je eigen DM (niet het kanaal) zodat je veilig kunt testen.", en: "posts to your own DM (not the channel) for safe testing." },
  "settings.notifications.footer.preview_dm": { nl: "stuurt alleen naar je eigen Slack met live data.", en: "sends only to your own Slack with live data." },
  "settings.notifications.footer.send_label": { nl: "Nu naar ontvangers sturen", en: "Send to recipients now" },
  "settings.notifications.footer.send_channel": { nl: "post het echte bericht naar het ingestelde kanaal.", en: "posts the real message to the configured channel." },
  "settings.notifications.footer.send_dm_closers": { nl: "stuurt de echte DM naar alle gemapte closers/setters.", en: "sends the real DM to all mapped closers/setters." },
  "settings.notifications.footer.send_dm_users": { nl: "stuurt de echte DM naar alle gemapte Hub-gebruikers.", en: "sends the real DM to all mapped Hub users." },
  "settings.notifications.request_failed": { nl: "Verzoek mislukt", en: "Request failed" },
  "settings.notifications.sent_to_recipients": { nl: "Naar ontvangers verstuurd.", en: "Sent to recipients." },
  "settings.notifications.save_failed": { nl: "Opslaan mislukt", en: "Failed to save" },

  // Closer/Setter Slack mapping card
  "settings.notifications.closers.title": { nl: "Closer / Setter Slack mapping", en: "Closer / Setter Slack Mapping" },
  "settings.notifications.closers.col_name": { nl: "Closer / Setter", en: "Closer / Setter" },
  "settings.notifications.closers.col_slack": { nl: "Slack user ID", en: "Slack user ID" },
  "settings.notifications.closers.empty": { nl: "Geen actieve closers gevonden in het targets board (geen leads in de laatste 60 dagen).", en: "No active closers found in the targets board (no leads in the last 60 days)." },
  "settings.notifications.closers.row.unsaved": { nl: "Niet opgeslagen", en: "Unsaved" },
  "settings.notifications.closers.row.saved": { nl: "Opgeslagen", en: "Saved" },

  // ─── Targets — Delivery tab ───────────────────────────────────────────
  // Section headers (the KPI metric labels themselves stay English — RL jargon)
  "targets.delivery.section.revenue": { nl: "Omzet", en: "Revenue" },
  "targets.delivery.section.retention": { nl: "Retentie", en: "Retention" },
  "targets.delivery.section.revenue_by_team": { nl: "Omzet per team", en: "Revenue by Team" },
  "targets.delivery.section.unassigned": { nl: "Niet-toegewezen omzet", en: "Unassigned Revenue" },

  // Retention card labels
  "targets.delivery.retention.previous": { nl: "Vorige periode", en: "Previous Period" },
  "targets.delivery.retention.new": { nl: "Nieuwe klanten", en: "New Clients" },
  "targets.delivery.retention.churned": { nl: "Verloren", en: "Churned" },
  "targets.delivery.retention.net": { nl: "Netto verandering", en: "Net Change" },
  "targets.delivery.retention.current": { nl: "Huidige periode", en: "Current Period" },

  // Customer count text
  "targets.delivery.customers_one": { nl: "{n} klant", en: "{n} customer" },
  "targets.delivery.customers_many": { nl: "{n} klanten", en: "{n} customers" },
  "targets.delivery.needs_fix_one": { nl: "{n} klant heeft een fix nodig", en: "{n} customer needs a fix" },
  "targets.delivery.needs_fix_many": { nl: "{n} klanten hebben een fix nodig", en: "{n} customers need a fix" },

  // Unassigned bucket header
  "targets.delivery.unassigned.label": { nl: "Niet-toegewezen", en: "Unassigned" },

  // Unassigned row reasons + actions
  "targets.delivery.no_monday_match": { nl: "Geen Monday item gekoppeld aan deze Stripe-klant.", en: "No Monday item links this Stripe customer." },
  "targets.delivery.am_empty.before": { nl: "Monday item bestaat, maar Account Manager is leeg. ", en: "Linked Monday item exists but Account Manager is empty. " },
  "targets.delivery.open_client": { nl: "Open klant →", en: "Open client →" },
  "targets.delivery.fee_ad": { nl: "fee {fee} · ad {ad}", en: "fee {fee} · ad {ad}" },
  "targets.delivery.suggested": { nl: "Voorgesteld:", en: "Suggested:" },
  "targets.delivery.pick_another": { nl: "Kies een ander item…", en: "Pick another item…" },
  "targets.delivery.pick_monday": { nl: "Kies een Monday item…", en: "Pick a Monday item…" },
  "targets.delivery.search_placeholder": { nl: "Zoek Monday items...", en: "Search Monday items..." },
  "targets.delivery.cancel": { nl: "Annuleren", en: "Cancel" },
  "targets.delivery.no_unlinked": { nl: "Geen ongekoppelde Monday items beschikbaar.", en: "No unlinked Monday items available." },
  "targets.delivery.no_match": { nl: "Geen items komen overeen met deze zoekopdracht.", en: "No items match this search." },
  "targets.delivery.more_results": { nl: "+ {n} meer — verfijn je zoekopdracht.", en: "+ {n} more — refine your search to narrow down." },
  "targets.delivery.assigning": { nl: "Toewijzen…", en: "Assigning…" },
  "targets.delivery.assign_failed": { nl: "Toewijzen mislukt", en: "Failed to assign" },

  // ─── Targets — Finance tab ────────────────────────────────────────────
  // Section headers — KPI labels stay English (RL jargon).
  "targets.finance.section.revenue_service_fee": { nl: "Omzet — Service Fee", en: "Revenue — Service Fee" },
  "targets.finance.section.revenue_ad_budget": { nl: "Omzet — Ad Budget", en: "Revenue — Ad Budget" },
  "targets.finance.section.costs": { nl: "Kosten (volledige maand)", en: "Costs (Full Month)" },
  "targets.finance.section.profit": { nl: "Winst", en: "Profit" },

  // ─── Targets — Settings tab (per-month targets config) ────────────────
  // Field labels (Deals/Revenue/Max CBC/etc.) stay English (RL jargon).
  "targets.settings.title": { nl: "Maandelijkse targets", en: "Monthly Targets" },
  "targets.settings.subtitle": { nl: "Stel targets in per tab. Waardes worden pro-rata vergeleken met de huidige periode. 0 = target uit.", en: "Set targets for each tab. Values are compared pro-rata against the current period. Set to 0 to disable a target." },
  "targets.settings.action.save": { nl: "Targets opslaan", en: "Save Targets" },
  "targets.settings.action.saving": { nl: "Opslaan...", en: "Saving..." },
  "targets.settings.action.saved": { nl: "Opgeslagen", en: "Saved" },
  "targets.settings.unsaved": { nl: "Niet-opgeslagen wijzigingen", en: "Unsaved changes" },
  "targets.settings.derived.label": { nl: "Afgeleid", en: "Derived" },
  "targets.settings.derived.hint": { nl: "auto-berekend · alleen-lezen", en: "auto-calculated · read only" },

  // ─── Inbox composer dialog (New task / New update) ────────────────────
  "inbox.composer.title.task": { nl: "Nieuwe taak", en: "New task" },
  "inbox.composer.title.update": { nl: "Nieuwe update", en: "New update" },
  "inbox.composer.tab.update": { nl: "Update", en: "Update" },
  "inbox.composer.tab.task": { nl: "Taak", en: "Task" },
  "inbox.composer.field.client": { nl: "Klant", en: "Client" },
  "inbox.composer.field.to": { nl: "Naar", en: "To" },
  "inbox.composer.field.assignee": { nl: "Toegewezen aan", en: "Assignee" },
  "inbox.composer.field.title": { nl: "Titel", en: "Title" },
  "inbox.composer.field.body": { nl: "Details", en: "Details" },
  "inbox.composer.field.priority": { nl: "Prioriteit", en: "Priority" },
  "inbox.composer.field.due": { nl: "Einddatum", en: "Due date" },
  "inbox.composer.placeholder.title_task": { nl: "Wat moet er gebeuren?", en: "What needs to happen?" },
  "inbox.composer.placeholder.title_update": { nl: "Wat is de update?", en: "What's the update?" },
  "inbox.composer.placeholder.body": { nl: "Optionele context, links, instructies…", en: "Optional context, links, instructions…" },
  "inbox.composer.placeholder.client_search": { nl: "Zoek een klant…", en: "Search a client…" },
  "inbox.composer.you_suffix": { nl: " (jij)", en: " (you)" },
  "inbox.composer.priority.low": { nl: "Laag", en: "Low" },
  "inbox.composer.priority.normal": { nl: "Normaal", en: "Normal" },
  "inbox.composer.priority.high": { nl: "Hoog", en: "High" },
  "inbox.composer.action.cancel": { nl: "Annuleren", en: "Cancel" },
  "inbox.composer.action.create_task": { nl: "Taak aanmaken", en: "Create task" },
  "inbox.composer.action.create_update": { nl: "Update aanmaken", en: "Create update" },
  "inbox.composer.action.creating": { nl: "Bezig met aanmaken…", en: "Creating…" },
  "inbox.composer.action.clear": { nl: "Wissen", en: "Clear" },
  "inbox.composer.error.no_client": { nl: "Kies een klant.", en: "Pick a client." },
  "inbox.composer.error.no_recipient": { nl: "Kies een ontvanger.", en: "Pick a recipient." },
  "inbox.composer.error.no_title": { nl: "Titel is verplicht.", en: "Title is required." },
  "inbox.composer.error.no_due": { nl: "Einddatum is verplicht voor taken.", en: "Due date is required for tasks." },
  "inbox.composer.error.create_failed": { nl: "Item aanmaken mislukt", en: "Failed to create item" },
  "inbox.composer.combobox.no_match": { nl: "Geen klant gevonden voor \"{query}\".", en: "No client found for \"{query}\"." },

  // ─── Pedro client picker ──────────────────────────────────────────────
  "pedro.picker.placeholder": { nl: "Selecteer klant uit hub...", en: "Pick a client from the hub..." },
  "pedro.picker.search": { nl: "Zoek klant...", en: "Search clients..." },
  "pedro.picker.empty": { nl: "Geen klanten gevonden", en: "No clients found" },
  "pedro.picker.signal.saved": { nl: "Campagne opgeslagen", en: "Campaign saved" },
  "pedro.picker.signal.eval": { nl: "Evaluatie", en: "Evaluation" },
  "pedro.picker.signal.kickoff": { nl: "Kick-off", en: "Kick-off" },
  "pedro.picker.signal.meetings": { nl: "{n} mtg", en: "{n} mtg" },
  "pedro.picker.autofill": { nl: "AI auto-fill", en: "AI auto-fill" },
  "pedro.picker.autofill.loading": { nl: "Pedro denkt na...", en: "Pedro is thinking..." },

  // ─── Pedro stage action bar (Save final version per stage) ────────────
  "pedro.stage.last_saved_prefix": { nl: "Laatst opgeslagen:", en: "Last saved:" },
  "pedro.stage.unsaved_lead": { nl: "Nog niet opgeslagen — werkt in", en: "Not yet saved — working in" },
  "pedro.stage.draft_mode": { nl: "draft mode", en: "draft mode" },
  "pedro.stage.draft_hint": { nl: "(auto-save aan, niet zichtbaar voor klant-record)", en: "(auto-save on, not visible to client record)" },
  "pedro.stage.saving": { nl: "Opslaan...", en: "Saving..." },
  "pedro.stage.save_as_next": { nl: "Save als v{n}", en: "Save as v{n}" },
  "pedro.stage.save_initial": { nl: "Save naar klant", en: "Save to client" },
  "pedro.stage.saved_as": { nl: "Opgeslagen als v{n}", en: "Saved as v{n}" },
  "pedro.stage.unchanged": { nl: "v{n} ongewijzigd — geen nieuwe versie", en: "v{n} unchanged — no new version" },
  "pedro.stage.save_failed": { nl: "Opslaan mislukt", en: "Save failed" },
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
