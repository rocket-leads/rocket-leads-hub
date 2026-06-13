import type { Locale } from "./types"

/**
 * Hub UI dictionary. Every user-facing string the Hub renders should
 * route through `t(key, locale)` so the language switch flips it.
 *
 * Conventions:
 *   - Keys are dot-namespaced by surface (`nav.home`, `home.greeting`).
 *   - Both locales are mandatory - TypeScript enforces it via the
 *     `Record<Locale, ...>` shape on every leaf.
 *   - When a string is the same in both locales (a brand term, a number,
 *     a punctuation-only string), still write it twice. Don't try to be
 *     clever with fallback chains - clever fallbacks become the bug
 *     surface when "English" silently means "I forgot to translate".
 *   - Placeholders use `{name}` syntax. Resolved by passing
 *     `t("home.greeting", locale, { name: "Roy" })`.
 *
 * This file is intentionally a single big record so adding a string is
 * one edit. If it grows past a few thousand entries we can split per-
 * surface - but flat is simpler until then.
 */

type LocalizedString = Record<Locale, string>

export const DICTIONARY = {
  // ─── Sidebar nav ──────────────────────────────────────────────────────
  "nav.home": { nl: "Home", en: "Home" },
  "nav.watch_list": { nl: "Watch list", en: "Watch list" }, // brand term
  "nav.clients": { nl: "Huidige klanten", en: "Current clients" },
  "nav.inbox": { nl: "Inbox", en: "Inbox" },
  "nav.calendar": { nl: "Kalender", en: "Calendar" },
  "nav.meetings": { nl: "Meetings", en: "Meetings" },
  "nav.pedro": { nl: "Pedro", en: "Pedro" },
  "nav.pedro_onboard": { nl: "On-board", en: "On-board" },
  "nav.pedro_optimize": { nl: "Optimaliseer", en: "Optimize" },
  "nav.insights": { nl: "Insights", en: "Insights" },
  "nav.targets": { nl: "Targets", en: "Targets" },
  "nav.billing": { nl: "Facturatie", en: "Billing" },
  "nav.settings": { nl: "Instellingen", en: "Settings" },

  // ─── Account dropdown ─────────────────────────────────────────────────
  "account.sign_out": { nl: "Uitloggen", en: "Sign out" },
  "account.user_fallback": { nl: "Gebruiker", en: "User" },

  // ─── Global client search (top bar, ⌘K) ──────────────────────────────
  "search.trigger.placeholder": { nl: "Klant zoeken...", en: "Search client..." },
  "search.input.placeholder": { nl: "Typ een klantnaam...", en: "Type a client name..." },
  "search.loading": { nl: "Klanten laden...", en: "Loading clients..." },
  "search.empty": { nl: "Geen klanten gevonden", en: "No clients found" },
  "search.board.onboarding": { nl: "Onboarding", en: "Onboarding" },
  "search.board.current": { nl: "Actief", en: "Active" },

  // ─── Slide-over navigation header (Back button + inline switcher) ─────
  // Contextual back labels resolved via the underlying pathname so the
  // panel reads "Back to Watchlist" when opened from /watchlist and
  // "Back to All Clients" from /clients, etc.
  "client.back.to_clients": { nl: "Terug naar alle klanten", en: "Back to All Clients" },
  "client.back.to_watchlist": { nl: "Terug naar Watch List", en: "Back to Watch List" },
  "client.back.generic": { nl: "Terug", en: "Back" },
  "client.switch.placeholder": { nl: "Wissel naar een andere klant...", en: "Switch to another client..." },
  "client.switch.clear": { nl: "Wissen", en: "Clear" },
  "client.switch.empty": { nl: "Geen andere klanten gevonden", en: "No other clients found" },

  // ─── Theme + locale toggles ───────────────────────────────────────────
  "theme.dark": { nl: "Donkere modus", en: "Dark mode" },
  "theme.light": { nl: "Lichte modus", en: "Light mode" },
  "theme.fallback": { nl: "Thema", en: "Theme" },
  "locale.label": { nl: "Taal", en: "Language" },
  "locale.dutch": { nl: "Nederlands", en: "Dutch" },
  "locale.english": { nl: "Engels", en: "English" },

  // ─── Home page (the "Today" landing - what needs your attention now) ──
  "home.greeting.morning": { nl: "Goedemorgen, {name}", en: "Good morning, {name}" },
  "home.subtitle": { nl: "Hier is wat vandaag aandacht nodig heeft.", en: "Here's what needs your attention today." },
  "home.updated_prefix": { nl: "Bijgewerkt {ago}", en: "Updated {ago}" },

  // Today's meetings block - surfaces Fathom calls happening today.
  "home.block.meetings.title": { nl: "Vandaag's meetings", en: "Today's Meetings" },
  "home.block.meetings.empty": { nl: "Geen meetings vandaag.", en: "No meetings today." },
  "home.block.meetings.cta": { nl: "Open Meetings", en: "Open Meetings" },
  "home.block.meetings.in": { nl: "over {mins} min", en: "in {mins} min" },
  "home.block.meetings.now": { nl: "Nu", en: "Now" },
  "home.block.meetings.passed": { nl: "Eerder vandaag", en: "Earlier today" },

  "home.kpi.action.label": { nl: "Actie nodig", en: "Action Needed" },
  "home.kpi.action.eq_yesterday": { nl: "= gisteren", en: "= yesterday" },
  "home.kpi.action.delta_pos": { nl: "+{n} t.o.v. gisteren", en: "+{n} vs yesterday" },
  "home.kpi.action.delta_neg": { nl: "{n} t.o.v. gisteren", en: "{n} vs yesterday" },
  "home.kpi.action.no_scope": { nl: "Geen actieve klanten", en: "No live clients in scope" },
  "home.kpi.inbox.label": { nl: "Inbox voor jou", en: "Your Inbox" },
  "home.kpi.inbox.zero": { nl: "Inbox zero", en: "Inbox zero" },
  "home.kpi.inbox.subtitle": { nl: "taken + ongelezen updates", en: "tasks + unread updates" },
  "home.kpi.health.label": { nl: "Gezondheidsscore", en: "Health Score" },
  "home.kpi.health.target": { nl: "doel ≥ 75%", en: "target ≥ 75%" },
  "home.kpi.health.no_scope": { nl: "Geen actieve klanten", en: "No live clients in scope" },
  "home.kpi.mrr.label": { nl: "Team MRR · Deze maand", en: "Team MRR · This Month" },
  "home.kpi.mrr.no_agreements": { nl: "Geen facturatie deze maand", en: "No invoicing this month" },
  "home.kpi.mrr.live_one": { nl: "{n} klant deze maand", en: "{n} client this month" },
  "home.kpi.mrr.live_many": { nl: "{n} klanten deze maand", en: "{n} clients this month" },

  "home.block.action.title": { nl: "Actie nodig", en: "Action Needed" },
  "home.block.action.empty": { nl: "Niks urgents - top of watch list ↓", en: "Nothing urgent - top of watch list ↓" },
  "home.block.action.cta": { nl: "Open Watch List", en: "Open Watch List" },
  "home.block.inbox.title": { nl: "Inbox voor jou", en: "Your Inbox" },
  "home.block.inbox.empty": { nl: "Inbox zero - niks toegewezen.", en: "Inbox zero - nothing assigned." },
  "home.block.inbox.cta": { nl: "Open Inbox", en: "Open Inbox" },
  "home.block.inbox.split.tasks": { nl: "Taken", en: "Tasks" },
  "home.block.inbox.split.updates": { nl: "Updates", en: "Updates" },
  "home.block.inbox.split.tasks_empty": { nl: "Geen open taken.", en: "No open tasks." },
  "home.block.inbox.split.updates_empty": { nl: "Geen nieuwe updates.", en: "No new updates." },
  "home.block.channels.title": { nl: "Channels", en: "Channels" },
  "home.block.channels.empty": { nl: "Geen ongelezen gesprekken.", en: "No unread conversations." },
  "home.block.channels.cta": { nl: "Open Channels", en: "Open Channels" },
  "home.block.billing.title": { nl: "Openstaande facturen", en: "Open Invoices" },
  "home.block.billing.total_open": { nl: "Totaal open", en: "Total Open" },
  "home.block.billing.empty": { nl: "Geen openstaande facturen.", en: "No open invoices." },
  "home.block.billing.cta": { nl: "Open Facturatie", en: "Open Billing" },
  "home.block.billing.of_total": { nl: "van {total} totaal", en: "of {total} total" },
  "home.block.pedro.title": { nl: "Pedro voorstellen", en: "Pedro Proposals" },
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
  "watchlist.pill.watch": { nl: "Watchlist", en: "Watchlist" },
  "watchlist.pill.good": { nl: "Gezond", en: "Healthy" },
  "watchlist.pill.no_data": { nl: "Geen data", en: "No data" },
  "watchlist.filter.cm_label": { nl: "Campaign Manager", en: "Campaign Manager" },
  "watchlist.filter.all_cms": { nl: "Alle Campaign Managers", en: "All Campaign Managers" },
  "watchlist.filter.shown_of": { nl: "{shown} van {total} klanten", en: "{shown} of {total} clients" },

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
  "watchlist.insights.empty": { nl: "Nog geen patronen - wacht op de volgende sync.", en: "No notable patterns yet - wait for the next sync." },
  "watchlist.proposals.title": { nl: "Optimalisatievoorstellen", en: "Optimisation Proposal" },
  "watchlist.proposals.empty": { nl: "Nog geen voorstellen - wacht op de volgende sync.", en: "No proposals yet - wait for the next sync." },

  // Section headers - "Healthy" + "Watchlist" are the canonical bucket
  // names after the inbox-zero workflow rename (2026-06-11). Action Needed
  // becomes the daily inbox; Watchlist holds organic concerns + in-review
  // actions; Healthy is everything else.
  "watchlist.section.action": { nl: "Actie nodig", en: "Action Needed" },
  "watchlist.section.watch": { nl: "Watchlist", en: "Watchlist" },
  "watchlist.section.good": { nl: "Gezond", en: "Healthy" },

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
  "watchlist.col.move": { nl: "Verplaats", en: "Move" },
  "watchlist.col.ads_manager": { nl: "Ads Manager", en: "Ads Manager" },

  // Move (override) - manually moves a client between Action / Watch / Good
  "watchlist.move.tooltip": { nl: "Verplaats deze klant naar een andere bucket", en: "Move this client to a different bucket" },
  "watchlist.move.tooltip_overridden": { nl: "Override actief · nog {days}d. Klik om aan te passen of te wissen.", en: "Override active · {days}d left. Click to adjust or clear." },
  "watchlist.move.dialog_title": { nl: "Verplaats klant", en: "Move client" },
  "watchlist.move.dialog_subtitle": { nl: "De override geldt 7 dagen of vervalt eerder als de KPI's flink verschuiven. Het algoritme leert van elke move.", en: "Override lasts 7 days or expires sooner when KPIs shift significantly. The algorithm learns from every move." },
  "watchlist.move.target_label": { nl: "Nieuwe bucket", en: "Move to" },
  "watchlist.move.target_action": { nl: "Action Needed", en: "Action Needed" },
  "watchlist.move.target_watch": { nl: "Watch", en: "Watch" },
  "watchlist.move.target_good": { nl: "Good Performance", en: "Good Performance" },
  "watchlist.move.reason_label": { nl: "Waarom hoort deze klant daar?", en: "Why does this client belong there?" },
  "watchlist.move.reason_placeholder": { nl: "Bv. CPL spike was eenmalig na creative refresh - leadkwaliteit is goed", en: "E.g. CPL spike was a one-off after creative refresh - lead quality is good" },
  "watchlist.move.reason_required": { nl: "Reden is verplicht - dit is de feedback waar het algoritme van leert.", en: "Reason is required - this is the feedback the algorithm learns from." },
  "watchlist.move.submit": { nl: "Verplaatsen", en: "Move" },
  "watchlist.move.submit_saving": { nl: "Verplaatsen…", en: "Moving…" },
  "watchlist.move.clear": { nl: "Override wissen", en: "Clear override" },
  "watchlist.move.clear_saving": { nl: "Wissen…", en: "Clearing…" },
  "watchlist.move.cancel": { nl: "Annuleren", en: "Cancel" },
  "watchlist.move.current_override": { nl: "Actieve override: {category} · nog {days} dagen · reden: {reason}", en: "Active override: {category} · {days}d left · reason: {reason}" },
  "watchlist.move.failed": { nl: "Verplaatsen mislukt", en: "Move failed" },

  // Row UI bits
  "watchlist.row.new_pill": { nl: "NIEUW", en: "NEW" },
  "watchlist.row.generating": { nl: "Genereren…", en: "Generating..." },
  "watchlist.row.ask_pedro": { nl: "Vraag Pedro", en: "Ask Pedro" },
  "watchlist.row.ask_pedro_tooltip": { nl: "Pedro stelt een creative refresh voor op basis van laatste 30d performance", en: "Pedro proposes a creative refresh based on last 30d performance" },

  // Create-task quick action (replaces AI Note column on Watch List home)
  "watchlist.row.create_task": { nl: "Taak aanmaken", en: "Create task" },
  "watchlist.row.open_ads_manager": { nl: "Open Meta Ads Manager (⌘/Ctrl-klik voor achtergrond-tab)", en: "Open Meta Ads Manager (⌘/Ctrl-click for background tab)" },
  "watchlist.row.create_task_tooltip": { nl: "Maak direct een taak aan voor {cm} (de campaign manager van deze klant)", en: "Create a task assigned to {cm} (this client's campaign manager) in one click" },
  "watchlist.row.create_task_no_cm_tooltip": { nl: "Geen campaign manager ingesteld voor deze klant", en: "No campaign manager set for this client" },
  "watchlist.row.create_task_title": { nl: "Watch List: {client} - actie nodig", en: "Watch List: {client} - action needed" },
  "watchlist.row.create_task_saving": { nl: "Aanmaken…", en: "Creating…" },
  "watchlist.row.create_task_done": { nl: "Toegewezen aan {cm}", en: "Assigned to {cm}" },
  "watchlist.row.create_task_failed": { nl: "Mislukt", en: "Failed" },
  "watchlist.row.create_task_no_mapping": { nl: "Geen Hub-gebruiker gekoppeld aan {cm}", en: "No Hub user mapped to {cm}" },

  // Create-task edit dialog (opens when Roy clicks the row's Taak chip)
  "watchlist.task_dialog.title": { nl: "Taak aanmaken", en: "Create task" },
  "watchlist.task_dialog.subtitle_with_cm": { nl: "Wordt toegewezen aan {cm}", en: "Will be assigned to {cm}" },
  "watchlist.task_dialog.subtitle_no_cm": { nl: "Geen campaign manager - taak kan nog niet aangemaakt worden", en: "No campaign manager - task can't be created yet" },
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

  // Mark done - inbox-zero workflow primary action on Action Needed rows.
  // CM logs what was done + the AM gets an inbox Update; the client flips
  // to Watchlist "in review" until the cron re-checks at review_due_at.
  "watchlist.row.mark_done": { nl: "Markeer klaar", en: "Mark done" },
  "watchlist.row.mark_done_tooltip": {
    nl: "Log wat je hebt gedaan, stuur een update naar de AM en zet de klant op her-eval over een paar dagen",
    en: "Log what you did, send an update to the AM, and queue the client for re-evaluation",
  },
  "watchlist.row.mark_done_submitted": { nl: "Gelogd · AM op de hoogte", en: "Logged · AM notified" },
  "watchlist.row.mark_done_failed": { nl: "Niet gelukt", en: "Failed" },

  // Mark done dialog
  "watchlist.mark_done.title": { nl: "Actie loggen", en: "Log action" },
  "watchlist.mark_done.subtitle_with_am": {
    nl: "{am} krijgt deze update in zijn inbox. Klant verhuist naar Watchlist totdat de her-eval draait.",
    en: "{am} sees this update in their inbox. Client moves to Watchlist until the re-eval runs.",
  },
  "watchlist.mark_done.subtitle_no_am": {
    nl: "Geen account manager gekoppeld - update wordt alleen in de audit log gelogd.",
    en: "No account manager mapped - update will only be logged in the audit log.",
  },
  "watchlist.mark_done.category_label": { nl: "Wat heb je gedaan?", en: "What did you do?" },
  "watchlist.mark_done.category_creative": { nl: "Creative", en: "Creative" },
  "watchlist.mark_done.category_pause": { nl: "Pause", en: "Pause" },
  "watchlist.mark_done.category_angle": { nl: "Angle", en: "Angle" },
  "watchlist.mark_done.category_funnel": { nl: "Funnel", en: "Funnel" },
  "watchlist.mark_done.category_other": { nl: "Overig", en: "Other" },
  "watchlist.mark_done.what_label": { nl: "Korte update voor de AM", en: "Short update for the AM" },
  "watchlist.mark_done.what_placeholder": {
    nl: "Bv. Pauseerd Photo 2 | Pricelist (€77 CPL, 30d). 3 varianten subsidie-angle live.",
    en: "E.g. Paused Photo 2 | Pricelist (€77 CPL, 30d). 3 new variants in subsidy angle now live.",
  },
  "watchlist.mark_done.what_hint": {
    nl: "Wat de AM nodig heeft om de klant te kunnen briefen - 1-2 zinnen, geen JSON.",
    en: "What the AM needs to brief the client - 1-2 sentences, no JSON.",
  },
  "watchlist.mark_done.review_label": { nl: "Her-eval over", en: "Re-eval in" },
  "watchlist.mark_done.cancel": { nl: "Annuleren", en: "Cancel" },
  "watchlist.mark_done.submit": { nl: "Loggen", en: "Log" },
  "watchlist.mark_done.submit_saving": { nl: "Loggen…", en: "Logging…" },
  "watchlist.mark_done.error_too_short": {
    nl: "Schrijf minstens 1 zin - dit gaat naar de AM.",
    en: "Write at least one sentence - this goes to the AM.",
  },
  "watchlist.mark_done.failed": { nl: "Loggen mislukt", en: "Logging failed" },

  // No Data section
  "watchlist.no_data.title": { nl: "Geen data", en: "No data" },
  "watchlist.no_data.subtitle": { nl: "live in Monday maar deze week geen bruikbare Meta data", en: "live in Monday but no usable Meta data this week" },
  "watchlist.no_data.col_reason": { nl: "Reden", en: "Reason" },

  // ─── Clients overview ─────────────────────────────────────────────────
  "clients.updated": { nl: "Bijgewerkt {time}", en: "Updated {time}" },
  "clients.refresh": { nl: "Vernieuwen", en: "Refresh" },
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

  // Column-group toggles (current board only). Each user picks which
  // groups to show; preference saved per browser via localStorage.
  "clients.group.status": { nl: "Status", en: "Status" },
  "clients.group.invoice": { nl: "Facturatie", en: "Billing" },
  "clients.group.people": { nl: "Personen", en: "People" },
  "clients.group.kpi": { nl: "Prestaties", en: "KPIs" },
  "clients.groups.toolbar_label": { nl: "Toon kolommen", en: "Show columns" },
  "clients.groups.show": { nl: "Toon {name}", en: "Show {name}" },
  "clients.groups.hide": { nl: "Verberg {name}", en: "Hide {name}" },

  // Column headers
  "clients.col.client": { nl: "Klant", en: "Client" },
  "clients.col.status": { nl: "Status", en: "Status" },
  "clients.col.phase": { nl: "Fase", en: "Phase" },
  "clients.col.meta": { nl: "Meta", en: "Meta" },
  "clients.col.kick_off": { nl: "Kick-off", en: "Kick-off" },
  "clients.col.health": { nl: "Gezondheid", en: "Health" },
  "clients.col.payment": { nl: "Betaling", en: "Payment" },
  "clients.col.overdue": { nl: "Achterstallig", en: "Overdue" },
  "clients.col.outstanding": { nl: "Openstaand", en: "Outstanding" },
  "clients.overdue.of": { nl: "van {total} totaal", en: "of {total} total" },
  "clients.col.mrr": { nl: "MRR", en: "MRR" },
  "clients.col.next": { nl: "Volgend", en: "Next" },
  "clients.col.am": { nl: "AM", en: "AM" },
  "clients.col.cm": { nl: "CM", en: "CM" },
  "clients.col.as": { nl: "AS", en: "AS" },
  "clients.col.adspend": { nl: "Adspend", en: "Adspend" },
  "clients.col.leads": { nl: "Leads", en: "Leads" },
  "clients.col.cpl": { nl: "CPL", en: "CPL" },
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
  "clients.tooltip.no_prev_period": { nl: "Geen vergelijkbare voorgaande periode - deze klant was niet live in het grootste deel van het vorige venster.", en: "No comparable prior period - this client wasn't live for most of the previous window." },
  "clients.cell.click_to_assign": { nl: "Klik om toe te wijzen", en: "Click to assign" },
  "clients.cell.loading_users": { nl: "Gebruikers laden…", en: "Loading users..." },
  "clients.cell.load_users_failed": { nl: "Gebruikers laden mislukt", en: "Failed to load users" },
  "clients.cell.clear": { nl: "Wissen", en: "Clear" },

  // ─── Settings - top-level + tab strip ─────────────────────────────────
  "settings.title": { nl: "Instellingen", en: "Settings" },
  "settings.subtitle": { nl: "API tokens, board config, gebruikers en notificaties.", en: "API tokens, board config, users and notifications." },
  "settings.health_link": { nl: "Health →", en: "Health →" },

  "settings.tab.me": { nl: "Mijn account", en: "My account" },
  "settings.tab.clients": { nl: "Klanten", en: "Clients" },
  "settings.tab.tokens": { nl: "API Tokens", en: "API Tokens" },
  "settings.tab.board": { nl: "Board Config", en: "Board Config" },
  "settings.tab.users": { nl: "Gebruikers", en: "Users" },
  "settings.tab.automations": { nl: "Automations", en: "Automations" },
  "settings.tab.health": { nl: "Health", en: "Health" },

  // ApiHealthBar
  "settings.api_status.title": { nl: "API Status", en: "API Status" },
  "settings.api_status.checked": { nl: "Gecheckt {time}", en: "Checked {time}" },

  // Settings → Clients tab
  "settings.clients.title": { nl: "Klanten", en: "Clients" },
  "settings.clients.subtitle": { nl: "Wijzig elke klantdetail - naam, IDs, financiën, team. Wijzigingen schrijven terug naar Monday en syncen naar de Hub.", en: "Edit any client's details - name, IDs, financials, team. Changes write back to Monday and sync to the Hub." },
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

  // Cadence labels - short, used in the crons table second-row sub-line
  "settings.health.cadence.daily_5utc": { nl: "dagelijks 05:00 UTC", en: "daily 5:00 UTC" },
  "settings.health.cadence.daily_530utc": { nl: "dagelijks 05:30 UTC", en: "daily 5:30 UTC" },
  "settings.health.cadence.hourly": { nl: "elk uur", en: "hourly" },
  "settings.health.cadence.every_6h": { nl: "elke 6u", en: "every 6h" },
  "settings.health.cadence.daily": { nl: "dagelijks", en: "daily" },
  "settings.health.cadence.nightly": { nl: "nachtelijk", en: "nightly" },
  "settings.health.cadence.weekly": { nl: "wekelijks", en: "weekly" },
  "settings.health.cadence.hourly_gated": { nl: "elk uur (gated)", en: "hourly (gated)" },
  "settings.health.cadence.daily_7utc": { nl: "dagelijks 07:00 UTC", en: "daily 7:00 UTC" },
  "settings.health.cadence.every_15min": { nl: "elke 15 min", en: "every 15 min" },

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
  "inbox.tab.now": { nl: "Nu", en: "Now" },
  "inbox.tab.tasks": { nl: "Taken", en: "Tasks" },
  "inbox.tab.updates": { nl: "Updates", en: "Updates" },
  "inbox.tab.client_inbox": { nl: "Klanten Inbox", en: "Client Inbox" },
  "inbox.tab.meetings": { nl: "Meetings", en: "Meetings" },

  // Global inbox scope tabs + 2-column split headers. The "klanten" key
  // predates the rename to "Kanalen / Channels" (Roy 2026-06-12: CMs
  // also have private email channels, so the tab represents the
  // subscribed-channel inbox - not just client conversations).
  "inbox.scope.klanten": { nl: "Kanalen", en: "Channels" },
  "inbox.scope.intern": { nl: "Intern", en: "Internal" },
  "inbox.split.tasks": { nl: "Taken", en: "Tasks" },
  "inbox.split.updates": { nl: "Updates", en: "Updates" },

  // Now-feed section labels + empty state
  "inbox.now.section.overdue": { nl: "Te laat", en: "Overdue" },
  "inbox.now.section.today": { nl: "Vandaag", en: "Due today" },
  "inbox.now.section.updates": { nl: "Nieuwe updates", en: "Unread updates" },
  "inbox.now.section.chats": { nl: "Nieuwe berichten", en: "Unread chats" },
  // Combined "Unread inbox" - single Now section that mixes unread updates
  // and unread client chats, sorted by recency. Roy: one consolidated
  // signal instead of two separate sections.
  "inbox.now.section.unread_inbox": { nl: "Nieuwe inbox", en: "Unread inbox" },
  "inbox.now.empty": { nl: "Alles bij. Geen urgente items op dit moment.", en: "All caught up. No urgent items right now." },
  "inbox.now.chat.open": { nl: "Open in Klanten Inbox", en: "Open in Client Inbox" },

  // Task status filters
  "inbox.task.filter.open": { nl: "Open", en: "Open" },
  "inbox.task.filter.in_progress": { nl: "Bezig", en: "In progress" },
  "inbox.task.filter.done": { nl: "Klaar", en: "Done" },
  "inbox.task.filter.all": { nl: "Alles", en: "All" },
  "inbox.task.filter.snoozed": { nl: "Snoozed", en: "Snoozed" },

  // Update status filters - same vocabulary as Tasks ("Open" / "Alles")
  // so the sub-tab strip reads identically across kinds. The chip id
  // still maps to the underlying DB status (`unread`) - only the label
  // changed. Roy 2026-06-09.
  "inbox.update.filter.all": { nl: "Alle updates", en: "All updates" },
  "inbox.update.filter.open": { nl: "Open", en: "Open" },

  // Empty states
  "inbox.empty.tasks_loading": { nl: "Taken laden…", en: "Loading tasks…" },
  "inbox.empty.tasks_none": { nl: "Nog geen taken.", en: "No tasks yet." },
  "inbox.empty.tasks_filtered": { nl: "Geen {filter} taken{assigned}.", en: "No {filter} tasks{assigned}." },
  "inbox.empty.tasks_assigned_suffix": { nl: " aan jou toegewezen", en: " assigned to you" },
  "inbox.empty.updates_loading": { nl: "Updates laden…", en: "Loading updates…" },
  "inbox.empty.updates_none": { nl: "Nog geen updates.", en: "No updates yet." },
  "inbox.empty.updates_filtered": { nl: "Geen {filter} updates{assigned}.", en: "No {filter} updates{assigned}." },

  // Update filter label used inside empty-state strings (lowercase). Only
  // the "open" branch is reachable: the "all" filter routes to the
  // generic `updates_none` empty state instead.
  "inbox.update.filter.open_lower": { nl: "open", en: "open" },

  // Source pill labels (brand names stay as plain strings - these are
  // the ones that actually translate)
  "inbox.source.automation": { nl: "Automatisering", en: "Automation" },
  "inbox.source.watchlist": { nl: "Watch List", en: "Watch list" },
  "inbox.source.meeting": { nl: "Meeting", en: "Meeting" },
  "inbox.source.email": { nl: "Email", en: "Email" },
  "inbox.source.tooltip_prefix": { nl: "Bron:", en: "Source:" },
  // Additional inbox source labels - used by the source filter chips on
  // /inbox. Brand names (Monday, Trengo, Slack) stay identical across locales.
  "inbox.source.manual": { nl: "Handmatig", en: "Manual" },
  "inbox.source.meetings": { nl: "Meetings", en: "Meetings" },
  "inbox.source.monday": { nl: "Monday", en: "Monday" },
  "inbox.source.trengo": { nl: "Trengo", en: "Trengo" },
  "inbox.source.slack": { nl: "Slack", en: "Slack" },
  "inbox.source.all": { nl: "Alle bronnen", en: "All sources" },

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

  // ─── Client status + onboarding phase (display labels) ───────────────
  // Canonical EN labels in src/lib/clients/status.ts stay reserved for Monday
  // writes - these dictionary entries drive everything the user reads.
  "client.status.onboarding": { nl: "Onboarding", en: "Onboarding" },
  "client.status.live": { nl: "Live", en: "Live" },
  "client.status.on_hold": { nl: "On Hold", en: "On Hold" },
  "client.status.churned": { nl: "Gestopt", en: "Churned" },

  "client.phase.kickoff_scheduled": { nl: "Kickoff ingepland", en: "Kickoff scheduled" },
  "client.phase.waiting_on_client": { nl: "Wachten op klant", en: "Waiting on client" },
  "client.phase.create_campaign": { nl: "Campagne opzetten", en: "Create campaign" },
  "client.phase.waiting_for_feedback": { nl: "Wachten op feedback", en: "Waiting for feedback" },
  "client.phase.launch": { nl: "LAUNCH 🚀", en: "LAUNCH 🚀" },
  "client.phase.on_hold": { nl: "On Hold", en: "On Hold" },
  "client.phase.debt_collection": { nl: "Incassobureau", en: "Debt collection agency" },

  // Onboarding checklist - only shown for clients on the onboarding board.
  "client.onboarding.checklist.title": { nl: "Onboarding checklist", en: "Onboarding checklist" },
  "client.onboarding.checklist.team_assigned": { nl: "AM + CM toegewezen", en: "AM + CM assigned" },
  "client.onboarding.checklist.stripe_linked": { nl: "Stripe gekoppeld", en: "Stripe linked" },
  "client.onboarding.checklist.kickoff_scheduled": { nl: "Kick-off ingepland", en: "Kick-off scheduled" },
  "client.onboarding.checklist.drive_created": { nl: "Google Drive aangemaakt", en: "Google Drive created" },
  "client.onboarding.checklist.meta_linked": { nl: "Meta ad account gekoppeld", en: "Meta ad account linked" },
  "client.onboarding.checklist.lead_board_created": { nl: "Lead-board aangemaakt", en: "Lead board created" },
  "client.onboarding.checklist.trengo_linked": { nl: "Trengo contact gekoppeld", en: "Trengo contact linked" },
  "client.onboarding.checklist.creatives_approved": { nl: "Creatives goedgekeurd", en: "Creatives approved" },
  "client.onboarding.checklist.live": { nl: "Campagne live", en: "Campaign live" },

  // Onboarding tasks - extended checklist used by the rich Onboarding panel
  // and the cross-client /onboarding overview. Each task maps to an entry in
  // `src/lib/clients/onboarding.ts`. Keep the key naming aligned with the
  // task `key` field - that's the contract the registry counts on.
  "client.onboarding.section.hub_setup": { nl: "Hub setup", en: "Hub setup" },
  "client.onboarding.section.client_access": { nl: "Klanttoegang", en: "Client access" },
  "client.onboarding.section.content_campaign": { nl: "Content & campagne", en: "Content & campaign" },
  "client.onboarding.section.go_live": { nl: "Live gaan", en: "Go live" },

  "client.onboarding.task.am_assigned": { nl: "Account manager toegewezen", en: "Account manager assigned" },
  "client.onboarding.task.cm_assigned": { nl: "Campagne manager toegewezen", en: "Campaign manager assigned" },
  "client.onboarding.task.setter_assigned": { nl: "Appointment setter toegewezen", en: "Appointment setter assigned" },
  "client.onboarding.task.monday_board_linked": { nl: "Monday lead-board ID gekoppeld", en: "Monday lead board ID linked" },
  "client.onboarding.task.meta_account_linked": { nl: "Meta ad account ID gekoppeld", en: "Meta ad account ID linked" },
  "client.onboarding.task.stripe_linked": { nl: "Stripe customer ID gekoppeld", en: "Stripe customer ID linked" },
  "client.onboarding.task.trengo_linked": { nl: "Trengo contact gekoppeld", en: "Trengo contact linked" },
  "client.onboarding.task.drive_linked": { nl: "Google Drive folder gekoppeld", en: "Google Drive folder linked" },
  "client.onboarding.task.billing_filled": { nl: "Ad budget + service fee ingevuld", en: "Ad budget + service fee filled" },

  "client.onboarding.task.client_brief": { nl: "Client brief opgesteld (website + brand + ICP)", en: "Client brief created (website + brand + ICP)" },
  "client.onboarding.task.drive_service_account": { nl: "Drive service account toegevoegd als Editor", en: "Drive service account added as Editor" },
  "client.onboarding.task.client_meta_bm": { nl: "Klant gaf Meta Business Manager toegang", en: "Client granted Meta Business Manager access" },
  "client.onboarding.task.pixel_and_page": { nl: "Meta pixel + Facebook page gekoppeld", en: "Meta pixel + Facebook page linked" },

  "client.onboarding.task.kickoff_held": { nl: "Kick-off meeting gehouden", en: "Kick-off meeting held" },
  "client.onboarding.task.marketing_angles": { nl: "Marketing angles gekozen", en: "Marketing angles chosen" },
  "client.onboarding.task.video_scripts": { nl: "Video scripts geschreven", en: "Video scripts written" },
  "client.onboarding.task.content_delivered": { nl: "Content geleverd door klant", en: "Content delivered by client" },
  "client.onboarding.task.landing_page": { nl: "Landingspagina gebouwd", en: "Landing page built" },
  "client.onboarding.task.creatives_ready": { nl: "Ad copy + creatives klaar", en: "Ad copy + creatives ready" },
  "client.onboarding.task.client_feedback_done": { nl: "Feedback ronde met klant afgerond", en: "Client feedback round completed" },
  "client.onboarding.task.zapier_flows": { nl: "Zapier flows actief (lead → WhatsApp/email)", en: "Zapier flows live (lead → WhatsApp/email)" },

  "client.onboarding.task.meta_campaign_built": { nl: "Campagne gebouwd in Meta", en: "Campaign built in Meta" },
  "client.onboarding.task.campaign_scheduled": { nl: "Campagne ingepland voor go-live", en: "Campaign scheduled for go-live" },

  // Onboarding panel chrome
  "client.onboarding.panel.title": { nl: "Onboarding", en: "Onboarding" },
  "client.onboarding.panel.critical_missing": {
    nl: "Kritieke items ontbreken - klant kan niet Live worden gezet voordat deze gedaan zijn:",
    en: "Critical items missing - client cannot go Live until these are done:",
  },
  "client.onboarding.panel.all_done": { nl: "Klant is klaar om Live te gaan.", en: "Client is ready to go Live." },
  "client.onboarding.panel.auto_derived": { nl: "Automatisch", en: "Auto" },
  "client.onboarding.panel.critical_pill": { nl: "Kritiek", en: "Critical" },

  // ─── Onboarding wizard (per-client at /onboarding/[id]) ───────────────
  // Rail / shell chrome
  "onboarding.wizard.back_to_overview": { nl: "← Onboarding overzicht", en: "← Onboarding overview" },
  "onboarding.wizard.subtitle": { nl: "Loop deze stappen door om de klant klaar te zetten voor de campagnemanager.", en: "Walk through these steps to prepare the client for the campaign manager." },
  "onboarding.wizard.progress": { nl: "Voortgang", en: "Progress" },
  "onboarding.wizard.loading": { nl: "Wizard laden…", en: "Loading wizard…" },
  "onboarding.wizard.no_active_step": { nl: "Geen actieve stap - alle stappen zijn voltooid.", en: "No active step - all steps complete." },
  "onboarding.wizard.step_label": { nl: "Stap", en: "Step" },
  "onboarding.wizard.critical_pill": { nl: "Kritiek", en: "Critical" },
  "onboarding.wizard.rail.locked_tooltip": { nl: "Vorige stap eerst afronden", en: "Finish the previous step first" },
  "onboarding.wizard.rail.done_tooltip": { nl: "Voltooid - klik om opnieuw te bekijken", en: "Done - click to revisit" },

  // v3 step labels - the kick-off is now a LIVE tool the AM uses during
  // the meeting, not a post-meeting checklist.
  "onboarding.wizard.step.kickoff_live.label": { nl: "Kick-off meeting (live)", en: "Kick-off meeting (live)" },
  "onboarding.wizard.step.kickoff_live.desc": { nl: "Deel direct vanuit het gesprek de Drive folder, Meta BM link en Stripe link. Vul de brief alvast in terwijl je luistert.", en: "Share Drive, Meta BM link and Stripe link straight from the call. Fill the brief live while you listen." },

  "onboarding.wizard.step.transcript_link.label": { nl: "Transcript koppelen", en: "Link transcript" },
  "onboarding.wizard.step.transcript_link.desc": { nl: "Fathom-recording wordt automatisch aan deze klant gekoppeld zodra het transcript klaar is.", en: "Fathom recording is auto-linked to this client as soon as the transcript is ready." },

  "onboarding.wizard.step.brief_enrichment.label": { nl: "Brief verrijken (AI)", en: "Enrich brief (AI)" },
  "onboarding.wizard.step.brief_enrichment.desc": { nl: "AI scant het transcript en stelt extra info voor per veld. Accept / reject per suggestie.", en: "AI scans the transcript and suggests additions per field. Accept / reject per suggestion." },

  "onboarding.wizard.step.competitors.label": { nl: "Concurrentie + winning ads", en: "Competitors + winning ads" },
  "onboarding.wizard.step.competitors.desc": { nl: "AI vindt concurrenten in dezelfde regio + sector. Apify scrapet hun lopende Meta ads. AM kiest de winners.", en: "AI finds competitors in the same region + sector. Apify scrapes their live Meta ads. AM picks the winners." },

  // KickoffLiveStep chrome
  "onboarding.wizard.kickoff.setup.running": { nl: "Resources klaarzetten… (Drive folder + links)", en: "Setting up resources… (Drive folder + links)" },
  "onboarding.wizard.kickoff.setup.retry": { nl: "Opnieuw proberen", en: "Retry" },

  "onboarding.wizard.kickoff.hub_connections.title": { nl: "Hub connections", en: "Hub connections" },
  "onboarding.wizard.kickoff.picker.trengo": { nl: "Trengo contact", en: "Trengo contact" },
  "onboarding.wizard.kickoff.picker.stripe": { nl: "Stripe customer", en: "Stripe customer" },
  "onboarding.wizard.kickoff.picker.monday_board": { nl: "Monday lead-board", en: "Monday lead board" },
  "onboarding.wizard.kickoff.picker.drive": { nl: "Google Drive folder", en: "Google Drive folder" },

  "onboarding.wizard.kickoff.resources.title": { nl: "Klant-acties — check af wat de klant heeft gedaan", en: "Client actions — check what the client has done" },
  "onboarding.wizard.kickoff.resource.drive": { nl: "Drive folder", en: "Drive folder" },
  "onboarding.wizard.kickoff.resource.meta_bm": { nl: "Meta Business Manager connect", en: "Meta Business Manager connect" },
  "onboarding.wizard.kickoff.meta_connected.label": {
    nl: "Klant heeft Rocket Leads als partner toegevoegd",
    en: "Client has added Rocket Leads as partner",
  },
  "onboarding.wizard.kickoff.resource.meta_bm.hint": {
    nl: "Vaste uitleg-link voor klanten. Vink hieronder af zodra de klant de partner-koppeling bevestigt.",
    en: "Fixed explainer link for clients. Tick the box below once the client confirms the partner connection.",
  },
  // Resource-row checkboxes (Drive content + Meta BM confirmation) +
  // RL ad-account fallback toggle. Added 2026-06-11 to back the kickoff
  // step's new CheckboxResourceRow + RL ad-account opt-in.
  "onboarding.wizard.kickoff.resource.drive.checkbox": {
    nl: "Klant heeft content geüpload naar Drive",
    en: "Client uploaded content to Drive",
  },
  "onboarding.wizard.kickoff.resource.drive.open": { nl: "Open Drive", en: "Open Drive" },
  "onboarding.wizard.kickoff.resource.meta_bm.checkbox": {
    nl: "Klant heeft Meta Business Manager gekoppeld",
    en: "Client linked Meta Business Manager",
  },
  "onboarding.wizard.kickoff.resource.meta_bm.open": { nl: "Open connect link", en: "Open connect link" },
  "onboarding.wizard.kickoff.rl_ad_account.label": {
    nl: "Gebruik RL ad-account (klant kan Meta BM niet koppelen)",
    en: "Use RL ad-account (client can't link Meta BM)",
  },
  "onboarding.wizard.kickoff.rl_ad_account.hint": {
    nl: "Hub gebruikt het Rocket Leads ad-account voor deze klant. Ad budget wordt apart gefactureerd.",
    en: "Hub uses the Rocket Leads ad-account for this client. Ad budget is invoiced separately.",
  },
  "onboarding.wizard.kickoff.ad_budget.label": {
    nl: "Ad budget (€ per maand)",
    en: "Ad budget (€ per month)",
  },
  "onboarding.wizard.kickoff.ad_budget.per_month": { nl: "/ maand", en: "/ month" },
  "onboarding.wizard.kickoff.ad_budget.hint": {
    nl: "Wordt automatisch op Monday gezet. Bevestigt richting finance hoeveel ze maandelijks doorfactureren.",
    en: "Written through to Monday automatically. Tells finance how much to invoice through each month.",
  },
  // Live-status panel (payment indicator + Drive activity + Meta connect)
  "onboarding.wizard.kickoff.status.title": { nl: "Live status", en: "Live status" },
  "onboarding.wizard.kickoff.status.payment.label": { nl: "Betaling", en: "Payment" },
  "onboarding.wizard.kickoff.status.payment.paid": { nl: "Betaald", en: "Paid" },
  "onboarding.wizard.kickoff.status.payment.unpaid": { nl: "Nog niet betaald", en: "Not paid yet" },
  "onboarding.wizard.kickoff.status.payment.checking": { nl: "Even checken…", en: "Checking…" },
  "onboarding.wizard.kickoff.status.payment.no_customer": {
    nl: "Geen Stripe customer gekoppeld - koppel er één via Hub connections hierboven.",
    en: "No Stripe customer linked - pick one via Hub connections above.",
  },

  // Aanbod sectie — wat we leveren + prijs per maand
  "onboarding.wizard.kickoff.aanbod.title": { nl: "Aanbod — wat we leveren", en: "Offer — what we deliver" },
  "onboarding.wizard.kickoff.aanbod.hint": {
    nl: "Vink aan wat we leveren en vul de maandelijkse prijs in. Ad budget altijd invullen, ook als de klant op eigen ad account draait.",
    en: "Tick what we deliver and fill the monthly price. Always fill ad budget, even when the client runs on their own ad account.",
  },
  "onboarding.wizard.kickoff.aanbod.meta_ads": { nl: "Meta Ads management", en: "Meta Ads management" },
  "onboarding.wizard.kickoff.aanbod.google_ads": { nl: "Google Ads management", en: "Google Ads management" },
  "onboarding.wizard.kickoff.aanbod.content_shoot": { nl: "Content shoot (kwartaal videoshoot + AI avatar)", en: "Content shoot (quarterly videoshoot + AI avatar)" },
  "onboarding.wizard.kickoff.aanbod.lead_opvolging": { nl: "Lead opvolging", en: "Lead follow-up" },
  "onboarding.wizard.kickoff.aanbod.ad_budget": { nl: "Ad budget", en: "Ad budget" },

  // Cycle picker + setup fee + totalen
  "onboarding.wizard.kickoff.aanbod.cycle.label": { nl: "Facturatie ritme", en: "Billing cycle" },
  "onboarding.wizard.kickoff.aanbod.cycle.monthly": { nl: "Per maand", en: "Monthly" },
  "onboarding.wizard.kickoff.aanbod.cycle.two_months": { nl: "Per 2 mnd", en: "Per 2 mo" },
  "onboarding.wizard.kickoff.aanbod.cycle.quarterly": { nl: "Per kwartaal", en: "Quarterly" },
  "onboarding.wizard.kickoff.aanbod.setup_fee.label": {
    nl: "Setup fee (optioneel)",
    en: "Setup fee (optional)",
  },
  "onboarding.wizard.kickoff.aanbod.totals.per_month": { nl: "Per maand", en: "Per month" },
  "onboarding.wizard.kickoff.aanbod.totals.per_2_months": { nl: "Per 2 maanden", en: "Per 2 months" },
  "onboarding.wizard.kickoff.aanbod.totals.per_quarter": { nl: "Per kwartaal", en: "Per quarter" },
  "onboarding.wizard.kickoff.aanbod.totals.setup_fee": { nl: "Setup fee", en: "Setup fee" },
  "onboarding.wizard.kickoff.aanbod.totals.first_invoice": {
    nl: "Eerste factuur",
    en: "First invoice",
  },

  // Formulier leads — landingspagina velden
  "onboarding.wizard.kickoff.form_fields.title": { nl: "Formulier leads", en: "Lead form fields" },
  "onboarding.wizard.kickoff.form_fields.hint": {
    nl: "Vragen op de landingspagina. Naam/telefoon/email zijn standaard; voeg custom vragen toe (bedrijfsnaam, budget, branche, …).",
    en: "Questions on the landing page. Name/phone/email are default; add custom questions (company name, budget, industry, …).",
  },
  "onboarding.wizard.kickoff.form_fields.add": { nl: "Voeg vraag toe", en: "Add question" },
  "onboarding.wizard.kickoff.form_fields.label_placeholder": { nl: "Bv. Wat is je budget?", en: "E.g. What is your budget?" },

  // Automations — Zapier flows die afgaan op nieuwe lead
  "onboarding.wizard.kickoff.automations.title": { nl: "Automations", en: "Automations" },
  "onboarding.wizard.kickoff.automations.hint": {
    nl: "Standaard alles aan. Untick wat niet van toepassing is. Lead → Monday CRM is altijd nodig voor data.",
    en: "All on by default. Untick what doesn't apply. Lead → Monday CRM is always needed for data.",
  },
  "onboarding.wizard.kickoff.automations.monday": { nl: "Lead → Monday CRM", en: "Lead → Monday CRM" },
  "onboarding.wizard.kickoff.automations.gmail": { nl: "Lead → Gmail notificatie naar klant", en: "Lead → Gmail notification to client" },
  "onboarding.wizard.kickoff.automations.wa_client": {
    nl: "WhatsApp naar klant bij nieuwe lead",
    en: "WhatsApp to client on new lead",
  },
  "onboarding.wizard.kickoff.automations.wa_lead": {
    nl: "WhatsApp naar lead — bevestiging aanvraag",
    en: "WhatsApp to lead — request confirmation",
  },

  "onboarding.wizard.kickoff.brief.title": { nl: "Client brief (vul live in)", en: "Client brief (fill live)" },
  "onboarding.wizard.kickoff.brief.saving": { nl: "Opslaan…", en: "Saving…" },
  "onboarding.wizard.kickoff.brief.saved": { nl: "Auto-saved", en: "Auto-saved" },
  "onboarding.wizard.kickoff.brief.prefill.btn": { nl: "Pre-fill uit Monday", en: "Pre-fill from Monday" },
  "onboarding.wizard.kickoff.brief.prefill.hint": {
    nl: "AI leest Monday updates + Trengo + meetings en vult lege velden in. Bestaande input wordt nooit overschreven.",
    en: "AI reads Monday updates + Trengo + meetings and fills empty fields. Existing input is never overwritten.",
  },
  "onboarding.wizard.kickoff.brief.needs_fields": {
    nl: "Vul minimaal 5 velden in voor je verder gaat.",
    en: "Fill at least 5 fields before continuing.",
  },

  "onboarding.wizard.kickoff.send_recap": { nl: "Stuur recap naar klant", en: "Send recap to client" },
  "onboarding.wizard.kickoff.send_recap.again": { nl: "Stuur recap opnieuw", en: "Resend recap" },

  // Recap dialog
  "onboarding.wizard.kickoff.recap.title": { nl: "Post-kick-off recap", en: "Post kick-off recap" },
  "onboarding.wizard.kickoff.recap.description": {
    nl: "AI leest het transcript en schrijft een korte recap. Edit, kopieer naar Trengo, markeer als verzonden.",
    en: "AI reads the transcript and writes a short recap. Edit, copy to Trengo, mark as sent.",
  },
  "onboarding.wizard.kickoff.recap.source.ai": {
    nl: "AI-gegenereerd uit kick-off transcript",
    en: "AI-generated from kick-off transcript",
  },
  "onboarding.wizard.kickoff.recap.source.no_transcript": {
    nl: "Geen transcript gekoppeld — fallback template. Vul de placeholder zelf in of koppel eerst de Fathom recording in Stap 2.",
    en: "No transcript linked — fallback template. Fill the placeholder yourself or link the Fathom recording in Stap 2 first.",
  },
  "onboarding.wizard.kickoff.recap.source.short_transcript": {
    nl: "Transcript te kort — fallback template. Wacht tot Fathom het volledige transcript heeft opgeleverd en klik 'Opnieuw genereren'.",
    en: "Transcript too short — fallback template. Wait for Fathom to deliver the full transcript and click 'Re-generate'.",
  },
  "onboarding.wizard.kickoff.recap.generating": {
    nl: "AI schrijft je recap…",
    en: "AI writing your recap…",
  },
  "onboarding.wizard.kickoff.recap.regenerate": { nl: "Opnieuw genereren", en: "Re-generate" },
  "onboarding.wizard.kickoff.recap.copy": { nl: "Kopieer naar clipboard", en: "Copy to clipboard" },
  "onboarding.wizard.kickoff.recap.copied": { nl: "Gekopieerd", en: "Copied" },
  "onboarding.wizard.kickoff.recap.mark_sent": { nl: "Markeer als verzonden", en: "Mark as sent" },
  "onboarding.wizard.kickoff.recap.sent_at": { nl: "Eerder verzonden op ", en: "Previously sent at " },

  // Brand identity - captured live from the client's website. Pedro
  // pre-fills its `brand_style` from this when the CM opens the client
  // for the first time, so colors / fonts never have to be re-entered.
  "onboarding.wizard.kickoff.brand.title": { nl: "Huisstijl", en: "Brand identity" },
  "onboarding.wizard.kickoff.brand.analyze_hint": {
    nl: "Trek primaire, secundaire en accentkleur + lettertypes uit de website. Hexcodes blijven aanpasbaar.",
    en: "Pull primary, secondary and accent color + fonts from the website. Hex codes stay editable.",
  },
  "onboarding.wizard.kickoff.brand.analyze_btn": { nl: "Analyseer website", en: "Analyze website" },
  "onboarding.wizard.kickoff.brand.analyzing": { nl: "Analyseren…", en: "Analyzing…" },
  "onboarding.wizard.kickoff.brand.no_url": {
    nl: "Vul eerst de website URL hierboven in.",
    en: "Fill the website URL above first.",
  },
  "onboarding.wizard.kickoff.brand.color.primary": { nl: "Primair (CTA)", en: "Primary (CTA)" },
  "onboarding.wizard.kickoff.brand.color.secondary": { nl: "Secundair", en: "Secondary" },
  "onboarding.wizard.kickoff.brand.color.accent": { nl: "Accent", en: "Accent" },
  "onboarding.wizard.kickoff.brand.font.heading": { nl: "Heading font", en: "Heading font" },
  "onboarding.wizard.kickoff.brand.font.body": { nl: "Body font", en: "Body font" },
  "onboarding.wizard.kickoff.brand.captured_from": { nl: "Uit", en: "From" },
  "onboarding.wizard.kickoff.brand.swatches_hint": {
    nl: "Klik een swatch om primair te wijzigen, shift+klik voor secundair.",
    en: "Click a swatch to set primary, shift+click for secondary.",
  },

  // Stap 2 - transcript link
  "onboarding.wizard.transcript.hint": {
    nl: "Selecteer welke recording de kick-off van deze klant was. Fathom kandidaten verschijnen 5-15 min na het einde van de meeting.",
    en: "Pick the recording that was this client's kick-off. Fathom candidates appear 5-15 min after the meeting ends.",
  },
  "onboarding.wizard.transcript.refresh": { nl: "Ververs", en: "Refresh" },
  "onboarding.wizard.transcript.loading": { nl: "Kandidaten ophalen…", en: "Loading candidates…" },
  "onboarding.wizard.transcript.empty.title": {
    nl: "Nog geen recording binnen",
    en: "No recording yet",
  },
  "onboarding.wizard.transcript.empty.body": {
    nl: "Fathom heeft het transcript nog niet opgeleverd. Wacht 5-15 min na het einde van je meeting en klik dan op Ververs.",
    en: "Fathom hasn't delivered the transcript yet. Wait 5-15 min after your meeting ends, then click Refresh.",
  },
  "onboarding.wizard.transcript.use_this": { nl: "Gebruik deze", en: "Use this" },
  "onboarding.wizard.transcript.most_likely": { nl: "Meest waarschijnlijk", en: "Most likely" },
  "onboarding.wizard.transcript.untitled": { nl: "(geen titel)", en: "(untitled)" },
  "onboarding.wizard.transcript.linked.title": { nl: "Recording gekoppeld", en: "Recording linked" },
  "onboarding.wizard.transcript.linked.summary_yes": { nl: "Summary aanwezig", en: "Summary present" },
  "onboarding.wizard.transcript.linked.summary_no": { nl: "Geen summary nog", en: "No summary yet" },
  "onboarding.wizard.transcript.linked.open_fathom": { nl: "Open in Fathom", en: "Open in Fathom" },
  "onboarding.wizard.transcript.change": { nl: "Wijzigen", en: "Change" },

  // Stap 3 - brief enrichment diff
  "onboarding.wizard.enrich.start.title": {
    nl: "AI brief enrichment",
    en: "AI brief enrichment",
  },
  "onboarding.wizard.enrich.start.body": {
    nl: "AI scant het transcript van de kick-off en stelt per veld additionele info voor. Jij accepteert of weigert per suggestie.",
    en: "AI scans the kick-off transcript and proposes additions per field. You accept or reject per suggestion.",
  },
  "onboarding.wizard.enrich.start.btn": {
    nl: "Genereer AI suggesties",
    en: "Generate AI suggestions",
  },
  "onboarding.wizard.enrich.regenerate": { nl: "Opnieuw genereren", en: "Re-generate" },
  "onboarding.wizard.enrich.insufficient": {
    nl: "Transcript nog te kort of leeg. Wacht tot Fathom het volledige transcript heeft opgeleverd (5-15 min na de meeting).",
    en: "Transcript still too short or empty. Wait for Fathom to deliver the full transcript (5-15 min after the meeting).",
  },
  "onboarding.wizard.enrich.no_suggestions": {
    nl: "AI vond geen aanvullingen voor je brief. Skip & ga verder.",
    en: "AI found no additions for your brief. Skip & continue.",
  },
  "onboarding.wizard.enrich.diff.hint": {
    nl: "Per veld: jouw live ingevoerde tekst + AI's voorstel. Accept of reject per veld.",
    en: "Per field: your live input + AI's proposal. Accept or reject each.",
  },
  "onboarding.wizard.enrich.decided_count": {
    nl: "{decided} / {total} beslist",
    en: "{decided} / {total} decided",
  },
  "onboarding.wizard.enrich.decide_first": {
    nl: "Beslis eerst per suggestie of je accept of reject klikt.",
    en: "Decide per suggestion before continuing - accept or reject each.",
  },
  "onboarding.wizard.enrich.save_draft": { nl: "Concept opslaan", en: "Save draft" },
  "onboarding.wizard.enrich.approve_and_continue": {
    nl: "Goedkeuren & verder",
    en: "Approve & continue",
  },
  "onboarding.wizard.enrich.skip_and_continue": {
    nl: "Skip & verder",
    en: "Skip & continue",
  },
  "onboarding.wizard.enrich.am_filled": { nl: "Jouw input (live)", en: "Your input (live)" },
  "onboarding.wizard.enrich.am_empty": { nl: "(leeg gelaten)", en: "(left empty)" },
  "onboarding.wizard.enrich.ai_add": { nl: "AI voegt toe", en: "AI adds" },
  "onboarding.wizard.enrich.ai_replace": { nl: "AI corrigeert", en: "AI corrects" },
  "onboarding.wizard.enrich.accept": { nl: "Accept", en: "Accept" },
  "onboarding.wizard.enrich.reject": { nl: "Reject", en: "Reject" },
  "onboarding.wizard.enrich.mode.add": { nl: "toevoeging", en: "addition" },
  "onboarding.wizard.enrich.mode.replace": { nl: "correctie", en: "correction" },

  // Stap 4 - wait on client
  "onboarding.wizard.wait.hint": {
    nl: "Hub poll't elke minuut. Stap voltooit zichzelf wanneer alle 3 de signalen groen zijn.",
    en: "Hub polls every minute. Step auto-completes when all 3 signals turn green.",
  },
  "onboarding.wizard.wait.refresh": { nl: "Ververs nu", en: "Refresh now" },
  "onboarding.wizard.wait.loading": { nl: "Status ophalen…", en: "Checking status…" },
  "onboarding.wizard.wait.all_green": {
    nl: "Alle 3 signalen groen - stap is automatisch voltooid. Klant kan over naar de campagnemanager.",
    en: "All 3 signals green - step auto-completed. Client ready for handoff to CM.",
  },

  "onboarding.wizard.wait.drive.label": { nl: "Content op Drive", en: "Content on Drive" },
  "onboarding.wizard.wait.drive.files": { nl: "bestanden", en: "files" },
  "onboarding.wizard.wait.drive.waiting": {
    nl: "Wachten op upload door klant",
    en: "Waiting for client upload",
  },
  "onboarding.wizard.wait.drive.no_folder": {
    nl: "Auto-setup heeft de subfolder nog niet vastgelegd - wacht tot Stap 1 setup klaar is.",
    en: "Auto-setup hasn't captured the subfolder yet - wait until Stap 1 setup completes.",
  },

  "onboarding.wizard.wait.meta.label": { nl: "Meta Business Manager", en: "Meta Business Manager" },
  "onboarding.wizard.wait.meta.linked": { nl: "Verbonden", en: "Connected" },
  "onboarding.wizard.wait.meta.waiting": {
    nl: "Wachten op partner-acceptatie door klant",
    en: "Waiting for client to accept partner request",
  },

  "onboarding.wizard.wait.payment.label": { nl: "Betaling", en: "Payment" },
  "onboarding.wizard.wait.payment.paid": { nl: "Ontvangen", en: "Received" },
  "onboarding.wizard.wait.payment.waiting": { nl: "Wachten op betaling", en: "Waiting on payment" },
  "onboarding.wizard.wait.payment.no_customer": {
    nl: "Geen Stripe customer gekoppeld",
    en: "No Stripe customer linked",
  },

  "onboarding.wizard.wait.skip.hint": {
    nl: "Klant deed iets buiten Hub om (offline betaald, content via WhatsApp gestuurd)? Skip handmatig.",
    en: "Client did something out-of-band (paid offline, sent content via WhatsApp)? Skip manually.",
  },
  "onboarding.wizard.wait.skip.btn": { nl: "Skip stap", en: "Skip step" },

  // Stap 5 - handoff to CM
  "onboarding.wizard.handoff.summary.hint": {
    nl: "Alle kritieke stappen zijn klaar. Klik op de knop om de klant op Live te zetten en de campagnemanager te alerten.",
    en: "All critical steps done. Click to flip the client to Live and notify the campaign manager.",
  },
  "onboarding.wizard.handoff.summary.cm": { nl: "Campagne manager", en: "Campaign manager" },
  "onboarding.wizard.handoff.summary.am": { nl: "Account manager", en: "Account manager" },
  "onboarding.wizard.handoff.summary.drive": { nl: "Drive folder", en: "Drive folder" },
  "onboarding.wizard.handoff.summary.meta": { nl: "Meta ad account", en: "Meta ad account" },
  "onboarding.wizard.handoff.summary.stripe": { nl: "Stripe customer", en: "Stripe customer" },
  "onboarding.wizard.handoff.summary.trengo": { nl: "Trengo contact", en: "Trengo contact" },
  "onboarding.wizard.handoff.summary.no_cm": {
    nl: "Geen CM toegewezen",
    en: "No CM assigned",
  },
  "onboarding.wizard.handoff.no_cm_warning": {
    nl: "Er is nog geen campagnemanager toegewezen op Monday. Zet er één op voordat je handoff doet, anders krijgt niemand de notificatie.",
    en: "No campaign manager assigned on Monday yet. Assign one before handoff or nobody gets the notification.",
  },
  "onboarding.wizard.handoff.cta": { nl: "Klaar voor CM - flip naar Live", en: "Ready for CM - flip to Live" },
  "onboarding.wizard.handoff.done.title": { nl: "Onboarding voltooid", en: "Onboarding complete" },
  "onboarding.wizard.handoff.done.body": {
    nl: "Klant staat op Live sinds {when}. {cm} heeft een Slack-DM gekregen.",
    en: "Client went Live at {when}. {cm} got a Slack DM.",
  },
  "onboarding.wizard.handoff.done.cm_notified": {
    nl: "CM is gepingd op Slack",
    en: "CM pinged on Slack",
  },
  "onboarding.wizard.handoff.done.cm_not_notified": {
    nl: "CM-notificatie mislukt",
    en: "CM notification failed",
  },
  "onboarding.wizard.handoff.done.open_client": {
    nl: "Open klant in Hub",
    en: "Open client in Hub",
  },

  "onboarding.wizard.kickoff.mark_done": { nl: "Stap voltooien", en: "Mark step done" },
  "onboarding.wizard.kickoff.save_and_continue": { nl: "Opslaan & verder", en: "Save & continue" },

  // Legacy v2 step labels - referenced nowhere after the v3 refactor,
  // but kept in the dictionary so a stale browser tab on the old build
  // doesn't 404 on the lookup until the deploy rolls forward.
  "onboarding.wizard.step.kickoff_link.label": { nl: "Kick-off recording koppelen", en: "Link kick-off recording" },
  "onboarding.wizard.step.kickoff_link.desc": { nl: "Koppel de Fathom-opname van de kick-off aan deze klant.", en: "Link the Fathom kick-off recording to this client." },

  "onboarding.wizard.step.drive_setup.label": { nl: "Drive folder", en: "Drive folder" },
  "onboarding.wizard.step.drive_setup.desc": { nl: "Maak een Drive folder aan voor deze klant en deel hem met het service account.", en: "Create a Drive folder for this client and share it with the service account." },

  "onboarding.wizard.step.client_brief.label": { nl: "Client brief + concurrentie-analyse", en: "Client brief + competitor analysis" },
  "onboarding.wizard.step.client_brief.desc": { nl: "AI genereert een brief op basis van de kick-off; jij vult aan en keurt goed. Opgeslagen in Drive.", en: "AI drafts a brief from the kick-off; you augment and approve. Saved to Drive." },

  "onboarding.wizard.step.onboarding_email.label": { nl: "Onboarding-email naar klant", en: "Onboarding email to client" },
  "onboarding.wizard.step.onboarding_email.desc": { nl: "Stuur de klant alles wat ze nodig hebben: Drive URL, Meta BM instructies, content-lijst.", en: "Send the client everything they need: Drive URL, Meta BM instructions, content checklist." },

  "onboarding.wizard.step.wait_on_client.label": { nl: "Wachten op klant", en: "Wait on client" },
  "onboarding.wizard.step.wait_on_client.desc": { nl: "Klant levert content + Meta BM toegang + betaling. Hub tracked dit automatisch waar mogelijk.", en: "Client delivers content + Meta BM access + payment. Hub tracks this automatically where possible." },

  "onboarding.wizard.step.hub_wiring.label": { nl: "Hub wiring", en: "Hub wiring" },
  "onboarding.wizard.step.hub_wiring.desc": { nl: "Koppel alle IDs: Meta ad account, Stripe, Trengo, lead-board, pixel + page.", en: "Link every ID: Meta ad account, Stripe, Trengo, lead board, pixel + page." },

  "onboarding.wizard.step.handoff.label": { nl: "Klaar voor CM", en: "Ready for CM" },
  "onboarding.wizard.step.handoff.desc": { nl: "Markeer klant klaar voor campagnemanager - status flipt naar Live.", en: "Mark client ready for the campaign manager - status flips to Live." },

  // v4 step labels (Roy 2026-06-11) — AM + CM unified
  "onboarding.wizard.section.am": { nl: "Account Manager", en: "Account Manager" },
  "onboarding.wizard.section.cm": { nl: "Campagne Manager", en: "Campaign Manager" },
  "onboarding.wizard.combined.transcript_section": { nl: "Transcript koppelen", en: "Link transcript" },
  "onboarding.wizard.combined.enrichment_section": { nl: "Brief verrijken met AI", en: "Enrich brief with AI" },

  "onboarding.wizard.step.transcript_brief.label": {
    nl: "Transcript + brief verrijken",
    en: "Transcript + brief enrichment",
  },
  "onboarding.wizard.step.transcript_brief.desc": {
    nl: "Koppel de Fathom-recording en laat AI de brief verrijken met wat er besproken is.",
    en: "Link the Fathom recording and let AI enrich the brief with what was discussed.",
  },
  "onboarding.wizard.step.am_checklist.label": { nl: "AM checklist + klaar voor CM", en: "AM checklist + ready for CM" },
  "onboarding.wizard.step.am_checklist.desc": {
    nl: "Check alle signalen: brief af, Drive content, Meta connect, betaling. Flipt status naar Live + draagt over aan CM.",
    en: "Verify all signals: brief done, Drive content, Meta connect, payment. Flips status to Live + hands off to CM.",
  },
  "onboarding.wizard.step.cm_brief.label": { nl: "Creative briefing", en: "Creative briefing" },
  "onboarding.wizard.step.cm_brief.desc": {
    nl: "Verrijk de brief van AM met invalshoeken. Geen leeg blad — bouw op wat de AM al heeft.",
    en: "Augment the AM's brief with campaign angles. No blank slate — build on what the AM produced.",
  },
  "onboarding.wizard.step.cm_competitors.label": { nl: "Concurrentie research", en: "Competitor research" },
  "onboarding.wizard.step.cm_competitors.desc": {
    nl: "Scrape winning ads van concurrenten via Apify. Output landt in Drive 'Winning Ads/'.",
    en: "Scrape competitor winning ads via Apify. Output lands in Drive 'Winning Ads/'.",
  },
  "onboarding.wizard.step.cm_angles.label": { nl: "Marketing angles", en: "Marketing angles" },
  "onboarding.wizard.step.cm_angles.desc": {
    nl: "Genereer 5-10 angles op basis van brief + concurrentie. Pak de winnende invalshoeken.",
    en: "Generate 5-10 angles from brief + competitor research. Pick the winning approaches.",
  },
  "onboarding.wizard.step.cm_scripts.label": { nl: "Video scripts", en: "Video scripts" },
  "onboarding.wizard.step.cm_scripts.desc": {
    nl: "AI scripts per angle, klaar voor klant-feedback en opname.",
    en: "AI scripts per angle, ready for client feedback and recording.",
  },
  "onboarding.wizard.step.cm_landing_page.label": { nl: "Landing page", en: "Landing page" },
  "onboarding.wizard.step.cm_landing_page.desc": {
    nl: "Loveable prompts genereren + URL koppelen.",
    en: "Generate Loveable prompts + link the URL.",
  },
  "onboarding.wizard.step.cm_creatives.label": { nl: "Creatives & ads", en: "Creatives & ads" },
  "onboarding.wizard.step.cm_creatives.desc": {
    nl: "Image creatives + Meta ad copy. Push naar Meta wanneer goedgekeurd.",
    en: "Image creatives + Meta ad copy. Push to Meta when approved.",
  },

  // CmBriefStep — read-only preview van AM's brief
  "onboarding.wizard.cm_brief.source.enriched": {
    nl: "Brief geladen vanuit Stap 1 (kick-off) + Stap 2 (AI verrijking). Hieronder wat de AM heeft samengesteld.",
    en: "Brief loaded from Stap 1 (kick-off) + Stap 2 (AI enrichment). Below is what the AM put together.",
  },
  "onboarding.wizard.cm_brief.source.draft": {
    nl: "Brief geladen vanuit Stap 1 (live ingevuld door AM tijdens kick-off). AI verrijking nog niet uitgevoerd — wat hieronder staat komt uit de live notities.",
    en: "Brief loaded from Stap 1 (AM filled it live during kick-off). AI enrichment not yet done — what's below is the live notes.",
  },
  "onboarding.wizard.cm_brief.source.empty": {
    nl: "Nog geen brief beschikbaar. Wacht tot de AM de kick-off heeft afgerond en de brief in Stap 1 heeft ingevuld.",
    en: "No brief available yet. Wait for the AM to finish the kick-off and fill the brief in Stap 1.",
  },
  "onboarding.wizard.cm_brief.field.empty": { nl: "(nog niet ingevuld)", en: "(not yet filled in)" },
  "onboarding.wizard.cm_brief.empty.title": { nl: "Brief is nog leeg", en: "Brief is still empty" },
  "onboarding.wizard.cm_brief.empty.body": {
    nl: "AM moet eerst de kick-off afronden en de brief invullen voordat je hier wat kunt doen.",
    en: "AM needs to finish the kick-off and fill the brief before there's anything actionable here.",
  },
  "onboarding.wizard.cm_brief.future_tool": {
    nl: "Volgende sprint: tool om de brief te verrijken met campagne-angles, concurrenten en USPs vanuit CM-perspectief.",
    en: "Coming next sprint: a tool to enrich the brief with campaign angles, competitors and USPs from a CM perspective.",
  },

  // CM Stap 5 — concurrentie research (Apify foundation)
  "onboarding.wizard.cm_comp.intro": {
    nl: "AI vindt concurrenten in dezelfde sector + regio op basis van de brief. Apify scrapet hun lopende Meta ads. Jij vinkt de winners aan — Pedro hergebruikt ze in de angles & creatives stappen.",
    en: "AI finds competitors in the same sector + region based on the brief. Apify scrapes their live Meta ads. You tick the winners — Pedro reuses them in the angles & creatives steps.",
  },
  "onboarding.wizard.cm_comp.find.title": { nl: "Vind concurrenten", en: "Find competitors" },
  "onboarding.wizard.cm_comp.find.body": {
    nl: "Op basis van bedrijf, sector en doelgroep uit de brief.",
    en: "Based on company, sector and audience from the brief.",
  },
  "onboarding.wizard.cm_comp.find.btn": { nl: "Vind concurrenten", en: "Find competitors" },
  "onboarding.wizard.cm_comp.country": { nl: "Land", en: "Country" },
  "onboarding.wizard.cm_comp.suggested.title": {
    nl: "{count} concurrenten gevonden",
    en: "{count} competitors found",
  },
  "onboarding.wizard.cm_comp.suggested.body": {
    nl: "Uncheck wat je niet wil scrapen — Apify rekent per concurrent.",
    en: "Uncheck what you don't want to scrape — Apify charges per competitor.",
  },
  "onboarding.wizard.cm_comp.reset": { nl: "Opnieuw zoeken", en: "Find again" },
  "onboarding.wizard.cm_comp.scrape.btn": {
    nl: "Scrape {count} concurrenten",
    en: "Scrape {count} competitors",
  },
  "onboarding.wizard.cm_comp.ads.title": {
    nl: "{count} ads gevonden",
    en: "{count} ads found",
  },
  "onboarding.wizard.cm_comp.ads.body": {
    nl: "{selected} geselecteerd. Lang-lopende ads (≥30d) zijn waarschijnlijk winners.",
    en: "{selected} selected. Long-running ads (≥30d) are likely winners.",
  },
  "onboarding.wizard.cm_comp.ads.no_preview": {
    nl: "Geen preview beschikbaar",
    en: "No preview available",
  },
  "onboarding.wizard.cm_comp.find_more": { nl: "Meer concurrenten vinden", en: "Find more competitors" },

  // CM Stap 8 — landingspagina (Lovable prompt generator)
  "onboarding.wizard.cm_lp.intro": {
    nl: "Pedro genereert één Lovable prompt voor de landingspagina op basis van brief + geselecteerde angles. Kies stijl + lengte, vul tracking in, paste 'm in Lovable.",
    en: "Pedro generates one Lovable prompt for the landing page based on brief + selected angles. Pick style + length, fill in tracking, paste it into Lovable.",
  },
  "onboarding.wizard.cm_lp.stijl.title": { nl: "Stijl", en: "Style" },
  "onboarding.wizard.cm_lp.stijl.body": {
    nl: "Bepaalt toon en visuele richting van de pagina.",
    en: "Sets tone and visual direction of the page.",
  },
  "onboarding.wizard.cm_lp.lengte.title": { nl: "Lengte", en: "Length" },
  "onboarding.wizard.cm_lp.lengte.body": {
    nl: "Korter = sneller laden, minder ruis. Langer = meer overtuiging voor high-ticket.",
    en: "Shorter = faster load, less noise. Longer = more persuasion for high-ticket.",
  },
  "onboarding.wizard.cm_lp.tracking.title": { nl: "Pixel & tracking", en: "Pixel & tracking" },
  "onboarding.wizard.cm_lp.tracking.body": {
    nl: "Wordt direct in de Lovable prompt verwerkt — fbq init + Lead event + form-POST.",
    en: "Wired into the Lovable prompt directly — fbq init + Lead event + form-POST.",
  },
  "onboarding.wizard.cm_lp.tracking.pixel": { nl: "Meta Pixel ID", en: "Meta Pixel ID" },
  "onboarding.wizard.cm_lp.tracking.webhook": { nl: "Zapier webhook URL", en: "Zapier webhook URL" },
  "onboarding.wizard.cm_lp.tracking.utm": { nl: "UTM structuur", en: "UTM structure" },
  "onboarding.wizard.cm_lp.generate.title": { nl: "Genereer prompt", en: "Generate prompt" },
  "onboarding.wizard.cm_lp.generate.body": {
    nl: "Pedro leest brief + angles uit eerdere stappen.",
    en: "Pedro pulls brief + angles from earlier steps.",
  },
  "onboarding.wizard.cm_lp.generate.btn": { nl: "Genereer Lovable prompt", en: "Generate Lovable prompt" },
  "onboarding.wizard.cm_lp.generate.regenerate": {
    nl: "Opnieuw genereren",
    en: "Re-generate",
  },
  "onboarding.wizard.cm_lp.steering.placeholder": {
    nl: "Optionele steering — bv. 'meer urgentie', 'korter onder de fold'",
    en: "Optional steering — e.g. 'more urgency', 'shorter below the fold'",
  },
  "onboarding.wizard.cm_lp.copy": { nl: "Kopieer prompt", en: "Copy prompt" },
  "onboarding.wizard.cm_lp.open_lovable": { nl: "Open Lovable", en: "Open Lovable" },
  "onboarding.wizard.cm_lp.mark_done": { nl: "Markeer als klaar", en: "Mark as done" },

  // Sidebar entries Roy 2026-06-11
  "nav.optimize": { nl: "Optimaliseer", en: "Optimize" },

  // Brief step copy
  "onboarding.wizard.brief.generate_hint": { nl: "Genereer een AI-draft op basis van kick-off + Trengo + Monday.", en: "Generate an AI draft from kick-off + Trengo + Monday." },
  "onboarding.wizard.brief.regenerate_hint": { nl: "Opnieuw genereren overschrijft de huidige velden.", en: "Re-generating overwrites the current fields." },
  "onboarding.wizard.brief.generate_btn": { nl: "Genereer brief", en: "Generate brief" },
  "onboarding.wizard.brief.regenerate_btn": { nl: "Opnieuw genereren", en: "Re-generate" },
  "onboarding.wizard.brief.competitor_generate_btn": { nl: "Genereer (AI)", en: "Generate (AI)" },
  "onboarding.wizard.brief.save_draft": { nl: "Concept opslaan", en: "Save draft" },
  "onboarding.wizard.brief.approve_and_continue": { nl: "Goedkeuren & verder", en: "Approve & continue" },
  "onboarding.wizard.brief.save_and_continue": { nl: "Opslaan & verder", en: "Save & continue" },

  "onboarding.wizard.brief.field.bedrijf": { nl: "Bedrijf", en: "Company" },
  "onboarding.wizard.brief.field.sector": { nl: "Sector", en: "Sector" },
  "onboarding.wizard.brief.field.websiteUrl": { nl: "Website", en: "Website" },
  "onboarding.wizard.brief.field.driveLink": { nl: "Drive folder", en: "Drive folder" },
  "onboarding.wizard.brief.field.doelgroep": { nl: "Doelgroep / ICP", en: "Target audience / ICP" },
  "onboarding.wizard.brief.field.pijnpunten": { nl: "Pijnpunten", en: "Pain points" },
  "onboarding.wizard.brief.field.aanbod": { nl: "Aanbod / propositie", en: "Offer / proposition" },
  "onboarding.wizard.brief.field.usps": { nl: "USPs", en: "USPs" },
  "onboarding.wizard.brief.field.marketingHooks": { nl: "Marketing hooks / angles", en: "Marketing hooks / angles" },
  "onboarding.wizard.brief.field.concurrentieAnalyse": { nl: "Concurrentie-analyse", en: "Competitor analysis" },

  "onboarding.wizard.brief.placeholder.doelgroep": { nl: "Wie is de ideale klant? Demografisch, psychografisch, in welke fase…", en: "Who is the ideal client? Demographic, psychographic, what stage…" },
  "onboarding.wizard.brief.placeholder.pijnpunten": { nl: "Wat houdt deze doelgroep wakker? Welke frustraties / kosten / risico's…", en: "What keeps this audience up at night? Which frustrations / costs / risks…" },
  "onboarding.wizard.brief.placeholder.aanbod": { nl: "Wat verkoopt de klant precies? Prijs, looptijd, garanties, leveringsmodel…", en: "What does the client sell exactly? Price, term, guarantees, delivery model…" },
  "onboarding.wizard.brief.placeholder.usps": { nl: "Waarom kiest een lead voor deze klant en niet voor de concurrent?", en: "Why does a lead pick this client over the competitor?" },
  "onboarding.wizard.brief.placeholder.marketingHooks": { nl: "Concrete invalshoeken voor advertenties. Eén per regel.", en: "Concrete angles for ads. One per line." },
  "onboarding.wizard.brief.placeholder.concurrentieAnalyse": { nl: "Top 3 concurrenten in regio + branche, hun positionering, hun ads (Meta Ad Library), het gat in de markt.", en: "Top 3 competitors in region + industry, their positioning, their ads (Meta Ad Library), the gap in the market." },

  // Placeholder step copy
  "onboarding.wizard.placeholder.coming": { nl: "De tools voor deze stap komen er nog aan. Voor nu kun je hem handmatig afvinken.", en: "The tooling for this step is on the way. For now, mark it done manually." },
  "onboarding.wizard.placeholder.mark_manually": { nl: "Werk gedaan? Markeer als voltooid.", en: "Work done? Mark as complete." },
  "onboarding.wizard.placeholder.mark_done": { nl: "Markeer voltooid", en: "Mark done" },
  "onboarding.wizard.placeholder.done_label": { nl: "Voltooid", en: "Done" },
  "onboarding.wizard.placeholder.undo": { nl: "Ongedaan maken", en: "Undo" },

  // Cross-client overview at /onboarding
  "nav.onboarding": { nl: "Onboarding", en: "Onboarding" },
  "onboarding.overview.title": { nl: "Onboarding", en: "Onboarding" },
  "onboarding.overview.subtitle": {
    nl: "Klanten die nog niet Live zijn - sorteer op voortgang of dagen sinds start.",
    en: "Clients not yet Live - sorted by progress or days since start.",
  },
  "onboarding.overview.empty": {
    nl: "Geen klanten in onboarding.",
    en: "No clients in onboarding.",
  },
  "onboarding.overview.col.client": { nl: "Klant", en: "Client" },
  "onboarding.overview.col.am": { nl: "AM", en: "AM" },
  "onboarding.overview.col.cm": { nl: "CM", en: "CM" },
  "onboarding.overview.col.phase": { nl: "Fase", en: "Phase" },
  "onboarding.overview.col.progress": { nl: "Voortgang", en: "Progress" },
  "onboarding.overview.col.next": { nl: "Eerstvolgende open taak", en: "Next open task" },
  "onboarding.overview.col.critical": { nl: "Kritiek open", en: "Critical open" },
  "onboarding.overview.col.days": { nl: "Dagen", en: "Days" },

  // ─── Client detail page ───────────────────────────────────────────────
  // Legacy per-section labels - used by sub-toggles inside the 4 top
  // groups (Performance → Overview vs Campaigns, Admin → Billing vs
  // Settings, etc). The flat 7-tab strip these once labelled is gone.
  "client.tab.home": { nl: "Home", en: "Home" },
  "client.tab.campaigns": { nl: "Campagnes", en: "Campaigns" },
  "client.tab.inbox": { nl: "Inbox", en: "Inbox" },
  "client.tab.timeline": { nl: "Timeline", en: "Timeline" },
  "client.tab.pedro": { nl: "Pedro", en: "Pedro" },
  "client.tab.billing": { nl: "Facturatie", en: "Billing" },
  "client.tab.settings": { nl: "Instellingen", en: "Settings" },

  // 4 top-level tab groups
  "client.tab.group.performance": { nl: "Performance", en: "Performance" },
  "client.tab.group.conversations": { nl: "Communicatie", en: "Conversations" },
  "client.tab.group.pedro": { nl: "Pedro", en: "Pedro" },
  "client.tab.group.admin": { nl: "Beheer", en: "Admin" },

  // Sub-view labels inside each group (segmented control)
  "client.tab.sub.overview": { nl: "Overzicht", en: "Overview" },
  "client.tab.sub.campaigns": { nl: "Campagnes", en: "Campaigns" },
  "client.tab.sub.inbox": { nl: "Inbox", en: "Inbox" },
  "client.tab.sub.timeline": { nl: "Activiteit", en: "Activity" },
  "client.tab.sub.billing": { nl: "Facturatie", en: "Billing" },
  "client.tab.sub.settings": { nl: "Instellingen", en: "Settings" },
  "client.tab.refresh_title": { nl: "Data verversen en analyse opnieuw genereren", en: "Refresh data and regenerate analysis" },
  "client.no_access": { nl: "Je hebt geen toegang tot deze sectie.", en: "You do not have access to this section." },

  // Header - meta row labels + payment summary
  "client.header.am": { nl: "AM", en: "AM" },
  "client.header.cm": { nl: "CM", en: "CM" },
  "client.header.budget": { nl: "Budget", en: "Budget" },
  "client.header.payment": { nl: "Betaling", en: "Payment" },
  "client.header.payment.paid": { nl: "Betaald", en: "Paid up" },
  "client.header.payment.open": { nl: "{count} openstaand · {amount}", en: "{count} open · {amount}" },
  "client.header.payment.overdue": { nl: "{count} achterstallig · {amount}", en: "{count} overdue · {amount}" },

  // ─── Watch List sparkline tooltip ─────────────────────────────────────
  // The rest of the Watch List is already wired through t() - these are
  // the leftover hardcoded English strings inside the CPL trend tooltip.
  "watchlist.sparkline.trending_up": { nl: "CPL stijgt ({pct}% over de periode)", en: "CPL trending up ({pct}% over the window)" },
  "watchlist.sparkline.trending_down": { nl: "CPL daalt ({pct}% over de periode)", en: "CPL trending down ({pct}% over the window)" },
  "watchlist.sparkline.stable": { nl: "CPL stabiel over de periode", en: "CPL stable over the window" },
  "watchlist.sparkline.no_leads": { nl: "{date}: geen leads (carry €{cpl})", en: "{date}: no leads (carry €{cpl})" },
  "watchlist.sparkline.no_spend": { nl: "{date}: geen spend", en: "{date}: no spend" },
  "watchlist.sparkline.day_summary": { nl: "{date}: €{cpl} CPL · {leads} leads · €{spend} spend", en: "{date}: €{cpl} CPL · {leads} leads · €{spend} spend" },

  // ─── Calendar page ────────────────────────────────────────────────────
  "calendar.title": { nl: "Kalender", en: "Calendar" },

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
  "meetings.empty.unlinked": { nl: "Niks te triagen - alle recente meetings zijn gekoppeld.", en: "Nothing to triage - all recent meetings are matched." },
  "meetings.empty.recent": { nl: "Nog geen gekoppelde meetings.", en: "No linked meetings yet." },
  "meetings.empty.internal": { nl: "Geen interne team meetings opgenomen in de laatste 60 dagen.", en: "No internal team meetings recorded in the last 60 days." },
  "meetings.empty.archived": { nl: "Niks gearchiveerd.", en: "Nothing archived." },

  // ─── Clients overview page ────────────────────────────────────────────
  "clients.title": { nl: "Klanten", en: "Clients" },
  "clients.error.failed_to_load": { nl: "Klanten konden niet geladen worden", en: "Failed to load clients" },
  "clients.error.go_to_settings": { nl: "Ga naar Instellingen", en: "Go to Settings" },

  // ─── Pedro page ───────────────────────────────────────────────────────
  "pedro.title": { nl: "Pedro", en: "Pedro" },
  "pedro.subtitle": { nl: "Genereer brief, angles, scripts en creatives voor één klant.", en: "Generate brief, angles, scripts and creatives for one client." },
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
  // Merged label (2026-06-11) — creatives + ad copy live on one tab now.
  "pedro.tab.creatives_ads": { nl: "Creatives & Ads", en: "Creatives & Ads" },
  "pedro.tab.lp": { nl: "LP prompts", en: "LP prompts" },
  "pedro.tab.ad_copy": { nl: "Ad copy", en: "Ad copy" },
  "pedro.tab.refresh": { nl: "Verversen", en: "Refresh" },
  "pedro.tab.insights": { nl: "Insights", en: "Insights" },
  "pedro.phase.preparation": { nl: "Voorbereiding", en: "Preparation" },
  "pedro.phase.deliverables": { nl: "Deliverables", en: "Deliverables" },
  "pedro.phase.tools": { nl: "Tools", en: "Tools" },

  // No-client-selected state
  "pedro.no_client.title": { nl: "Selecteer een klant om te starten", en: "Select a client to start" },
  "pedro.no_client.body": { nl: "Pedro's output - brief, research, angles, scripts, creatives, LP, ad copy, refreshes - wordt allemaal opgeslagen bij de actieve klant. Kies hierboven een klant zodat Pedro weet voor wie hij werkt.", en: "Pedro's output - brief, research, angles, scripts, creatives, LP, ad copy, refreshes - is all stored on the active client. Pick a client above so Pedro knows who he's working for." },

  // ─── Pedro Optimize wizard chrome ─────────────────────────────────────
  "pedro.optimize.header.label": { nl: "Pedro Optimize", en: "Pedro Optimize" },
  "pedro.optimize.header.no_client": { nl: "Geen klant geselecteerd", en: "No client selected" },
  "pedro.optimize.progress.label": { nl: "Voortgang", en: "Progress" },
  "pedro.optimize.rail.iteration_flow": { nl: "Iteratie flow", en: "Iteration flow" },
  "pedro.optimize.rail.other": { nl: "Overig", en: "Other" },
  "pedro.optimize.step.label": { nl: "Stap {n} / {total}", en: "Step {n} / {total}" },
  "pedro.optimize.step.label.other": { nl: "Overig", en: "Other" },
  "pedro.optimize.step.pick_ad.title": { nl: "Kies winning ad", en: "Pick winning ad" },
  "pedro.optimize.step.angles.title": { nl: "Angles refresh", en: "Angles refresh" },
  "pedro.optimize.step.ads.title": { nl: "Creatives + ad copy", en: "Creatives + ad copy" },
  "pedro.optimize.step.lp_prompt.title": { nl: "LP prompt", en: "LP prompt" },
  "pedro.optimize.step.video_scripts.title": { nl: "Video scripts", en: "Video scripts" },
  "pedro.optimize.source_ad.label": { nl: "Bron-ad:", en: "Source ad:" },
  "pedro.optimize.source_ad.change": { nl: "Andere ad kiezen", en: "Pick a different ad" },
  "pedro.optimize.source_ad.screenshot": { nl: "screenshot", en: "screenshot" },
  "pedro.optimize.gate.no_client": { nl: "Selecteer eerst een klant.", en: "Select a client first." },
  "pedro.optimize.gate.no_ad": { nl: "Stap 1 nog niet voltooid - kies eerst een winning ad. De iteraties die je daarna genereert zijn dan herleidbaar naar die bron-ad.", en: "Step 1 not complete yet - pick a winning ad first. The iterations you generate after that will all trace back to that source ad." },
  "pedro.optimize.pick_ad.current": { nl: "Huidige bron-ad", en: "Current source ad" },
  "pedro.optimize.pick_ad.confirm_hint": { nl: "Kies hieronder een andere of bevestig met opnieuw klikken op \"Genereer\".", en: "Pick another below or confirm by clicking \"Generate\" again." },

  // ─── Client detail - Settings tab sections ────────────────────────────
  "client.settings.info.title": { nl: "Klantgegevens", en: "Client Information" },
  "client.settings.info.description": { nl: "Bewerk de klantgegevens. Wijzigingen worden teruggeschreven naar Monday en gesynchroniseerd met de Hub.", en: "Edit the client's details. Changes write back to Monday and sync to the Hub." },
  "client.settings.kpi.title": { nl: "KPI-secties", en: "KPI Sections" },
  "client.settings.kpi.description": { nl: "Kies welke KPI-secties zichtbaar zijn voor deze klant. Leads staat altijd aan. Zet Afspraken en Deals aan zodra Monday CRM-data beschikbaar is.", en: "Choose which KPI sections are visible for this client. Leads is always on. Enable Afspraken and Deals when Monday CRM data is available." },
  "client.settings.campaigns.title": { nl: "Campagne selectie", en: "Campaign Selection" },
  "client.settings.campaigns.description": { nl: "Kies welke campagnes meetellen in de KPI-berekeningen. Alleen geselecteerde campagnes worden gebruikt voor de Campagnes tab.", en: "Select which campaigns to include in KPI calculations. Only selected campaigns are used for the Campaigns tab." },
  "client.settings.columns.title": { nl: "Board kolom-IDs", en: "Board Column IDs" },
  "client.settings.columns.description": { nl: "Overschrijf de standaard Monday kolom-IDs voor deze klant. Laat leeg om de globale defaults uit Instellingen te gebruiken.", en: "Override default Monday column IDs for this client. Leave empty to use the global defaults from Settings." },

  // ─── Client detail - Meetings tab (per-client view) ───────────────────
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

  // ─── Targets - Marketing tab chrome ───────────────────────────────────
  // KPI metric labels (Ad Spend, Booked Calls, CBC, CQC, etc.) stay English
  // in both locales - they're agreed RL jargon used in Slack + Settings.
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
  "targets.kpi.not_updated_title": { nl: "{n} van deze afgelopen afspraken staan nog op Qualified / Gepland status. Geteld als taken zodat de conversion rate niet gespeeld wordt, maar gemarkeerd zodat closers hun statussen bijwerken.", en: "{n} of these past appointments are still in Qualified / Planned status. Counted as taken so the conversion rate isn't gamed, but flagged so closers update their statuses." },
  "targets.kpi.target_of": { nl: "{value} van {target}", en: "{value} of {target}" },
  "targets.kpi.opt_ins": { nl: "Opt-ins", en: "Opt-ins" },
  "targets.kpi.cost_per_opt_in": { nl: "Kosten per opt-in", en: "Cost per opt-in" },
  "targets.kpi.appointment_booking_rate": { nl: "Appointment Booking Rate", en: "Appointment Booking Rate" },

  // Stripe gap modal (admin drilldown)
  "targets.stripe.title": { nl: "Monday vs Stripe - Revenue cross-check", en: "Monday vs Stripe - Revenue cross-check" },
  "targets.stripe.subtitle": { nl: "Toont alleen items zonder tegenhanger aan de andere kant. Gematchte paren zijn standaard verborgen - gebruik de toggle om alles te zien.", en: "Showing only items without a counterpart on the other side. Matched pairs are hidden by default - toggle below to see everything." },
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

  // ─── Client detail - Home tab ─────────────────────────────────────────
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
  "client.home.lead_analysis.empty": { nl: "Nog geen lead-analyse beschikbaar - open Campagnes om te genereren.", en: "No lead analysis available yet - open Campaigns to generate." },
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
  "client.home.payment.paid": { nl: "Betaald - geen open of achterstallige facturen", en: "Paid up - no open or overdue invoices" },
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
  // Group titles - KPI labels themselves stay English (RL jargon).
  "kpi.group.leads": { nl: "Leads", en: "Leads" },
  "kpi.group.deals": { nl: "Deals", en: "Deals" },

  // ─── Client detail - Campaigns tab ────────────────────────────────────
  "client.campaigns.empty.no_link": { nl: "Geen Meta-advertentieaccount of klantbord gekoppeld in Monday.com voor deze klant.", en: "No Meta Ad Account or Client Board linked in Monday.com for this client." },
  "client.campaigns.empty.no_selection": { nl: "Nog geen campagnes geselecteerd. Kies welke campagnes worden bijgehouden in Instellingen.", en: "No campaigns selected yet. Select which campaigns to track in Settings." },
  "client.campaigns.empty.go_settings": { nl: "Ga naar instellingen", en: "Go to Settings" },
  "client.campaigns.error.kpi": { nl: "KPI-data kon niet geladen worden. Controleer je API-tokens.", en: "Failed to load KPI data. Check your API tokens." },
  "client.campaigns.utm.title": { nl: "UTM / Ad performance breakdown", en: "UTM / Ad Performance Breakdown" },

  // ─── Client detail - Billing tab ──────────────────────────────────────
  // Invoice status pills
  "client.billing.status.paid": { nl: "Betaald", en: "Paid" },
  "client.billing.status.open": { nl: "Open", en: "Open" },
  "client.billing.status.overdue": { nl: "Achterstallig", en: "Overdue" },
  "client.billing.status.void": { nl: "Vervallen", en: "Void" },
  "client.billing.status.draft": { nl: "Concept", en: "Draft" },

  // Next invoice date section
  "client.billing.next_invoice.title": { nl: "Volgende factuur", en: "Next invoice" },
  "client.billing.next_invoice.subtitle": { nl: "Wanneer de volgende factuur de deur uit moet. Op deze datum verschijnt automatisch een taak in de inbox van finance.", en: "When the next invoice should go out. A task lands in finance's inbox automatically on this date." },
  // Variants used when fee + ad budget invoices run on different cadences
  // (RL-ad-account clients who paid the fee upfront but still get monthly
  // ad-budget invoices). The plain "next_invoice" labels above are kept for
  // clients with a single cadence.
  "client.billing.next_invoice.fee.title": { nl: "Volgende factuur - service fee", en: "Next invoice - service fee" },
  "client.billing.next_invoice.fee.subtitle": { nl: "Wanneer de volgende fee-factuur de deur uit moet. Bij kwartaalbetaling zet je deze datum op het einde van het kwartaal.", en: "When the next service-fee invoice should go out. For quarterly-paid clients, set this to the end of the prepaid quarter." },
  "client.billing.next_invoice.ad_budget.title": { nl: "Volgende factuur - ad budget", en: "Next invoice - ad budget" },
  "client.billing.next_invoice.ad_budget.subtitle": { nl: "Wanneer de volgende ad-budget factuur de deur uit moet. Alleen relevant als wij het ad budget voorschieten en doorbelasten - meestal maandelijks, ongeacht of de fee voor een kwartaal vooruit is betaald.", en: "When the next ad-budget invoice should go out. Only relevant when RL fronts the ad budget - typically monthly, even when the fee is prepaid for a quarter." },
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
  // Billing / agreement summary tiles (MRR + ad budget)
  "client.billing.summary.mrr": { nl: "MRR", en: "MRR" },
  "client.billing.summary.mrr.sub": { nl: "terugkerend per maand", en: "recurring per month" },
  "client.billing.summary.ad_budget": { nl: "Advertentiebudget", en: "Ad budget" },
  "client.billing.summary.ad_budget.sub": { nl: "per maand", en: "per month" },

  // Agreement section (top of Billing tab)
  "client.agreement.title": { nl: "Overeenkomst", en: "Agreement" },
  "client.agreement.subtitle": { nl: "Wat deze klant per maand betaalt voor deze campagne.", en: "What this client pays per month for this campaign." },
  "client.agreement.field.ad_budget": { nl: "Advertentiebudget", en: "Ad budget" },
  "client.agreement.field.platforms": { nl: "Platforms", en: "Platforms" },
  "client.agreement.field.platform_fee": { nl: "{platform} fee", en: "{platform} fee" },
  "client.agreement.field.follow_up": { nl: "Leadopvolging", en: "Lead follow-up" },
  "client.agreement.follow_up.by_rl": { nl: "Door Rocket Leads", en: "Done by Rocket Leads" },
  "client.agreement.follow_up.by_client": { nl: "Door klant", en: "Done by client" },
  "client.agreement.field.follow_up_fee": { nl: "Opvolg fee", en: "Follow-up fee" },
  "client.agreement.field.notes": { nl: "Notities", en: "Notes" },
  "client.agreement.notes.optional": { nl: "Optioneel", en: "Optional" },
  "client.agreement.error.load_failed": { nl: "Overeenkomst kon niet geladen worden.", en: "Failed to load agreement." },
  "client.agreement.error.save_failed": { nl: "Opslaan mislukt", en: "Save failed" },
  "client.agreement.status.saved": { nl: "Opgeslagen", en: "Saved" },
  "client.agreement.status.unsaved": { nl: "Niet-opgeslagen wijzigingen", en: "Unsaved changes" },
  "client.agreement.action.discard": { nl: "Verwerpen", en: "Discard" },
  "client.agreement.action.save": { nl: "Opslaan", en: "Save" },

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

  // ─── Client detail - Timeline tab ─────────────────────────────────────
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

  // ─── Client detail - Pedro tab (per-client) ───────────────────────────
  // Status pills
  // Inline demarcation note in the slide-over Pedro tab - clarifies this is
  // the *insight-mode* surface for this client (status, brief snapshot,
  // refresh history) versus the *build-mode* /pedro route (generators,
  // creatives, scripts). Without this hint users with both surfaces open
  // mix up where to do what.
  "client.pedro.mode_hint": { nl: "Inzicht-modus - voor build-tools (creatives, scripts, refreshes), open Pedro.", en: "Insight mode - for build tools (creatives, scripts, refreshes), open Pedro." },

  "client.pedro.status.not_started": { nl: "Pedro nog niet gestart", en: "Pedro not started yet" },
  "client.pedro.status.auto_draft": { nl: "Auto-draft (nog niet bewerkt)", en: "Auto-draft (not edited yet)" },
  "client.pedro.status.active": { nl: "Pedro actief - campagne #{n}", en: "Pedro active - campaign #{n}" },

  // Header card
  "client.pedro.header.last_edited_one": { nl: "Laatst bewerkt {date} · {n} refresh", en: "Last edited {date} · {n} refresh" },
  "client.pedro.header.last_edited_many": { nl: "Laatst bewerkt {date} · {n} refreshes", en: "Last edited {date} · {n} refreshes" },
  "client.pedro.header.empty": { nl: "Nog geen brief, angles of refreshes voor deze klant gegenereerd.", en: "No brief, angles or refreshes generated for this client yet." },
  "client.pedro.action.open": { nl: "Open in Pedro", en: "Open in Pedro" },
  "client.pedro.action.refresh": { nl: "Verversen", en: "Refresh" },
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
  "client.pedro.refresh.title": { nl: "Refresh-geschiedenis", en: "Refresh history" },
  "client.pedro.refresh.total": { nl: "{n} totaal", en: "{n} total" },
  "client.pedro.refresh.empty_lead": { nl: "Nog geen refresh-rondes gedraaid.", en: "No refresh rounds run yet." },
  "client.pedro.refresh.empty_cta": { nl: "Genereer er nu één →", en: "Generate one now →" },
  "client.pedro.refresh.window": { nl: "{days}d window ({start} → {end})", en: "{days}d window ({start} → {end})" },
  "client.pedro.refresh.winners_losers": { nl: "{w} winners / {l} losers", en: "{w} winners / {l} losers" },
  "client.pedro.refresh.stat.spend": { nl: "Spend", en: "Spend" },
  "client.pedro.refresh.stat.leads": { nl: "Leads", en: "Leads" },
  "client.pedro.refresh.stat.avg_cpl": { nl: "Avg CPL", en: "Avg CPL" },
  "client.pedro.refresh.trend.flat": { nl: "stabiel", en: "flat" },
  "client.pedro.refresh.proposals_one": { nl: "{n} proposal - itereren op:", en: "{n} proposal - iterate on:" },
  "client.pedro.refresh.proposals_many": { nl: "{n} proposals - itereren op:", en: "{n} proposals - iterate on:" },
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

  // ─── Settings - API Tokens tab ────────────────────────────────────────
  // Service descriptions kept English in both locales - they're admin
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

  // ─── Settings - Board Config tab ──────────────────────────────────────
  // Field labels (Monday column mappings) stay English in both locales -
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

  // ─── Settings - Users tab ─────────────────────────────────────────────
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
  "settings.users.row.wa_tooltip": { nl: "Trengo WhatsApp template-naam (bv. rl_universal_roel) - gebruikt voor outbound buiten 24u session window", en: "Trengo WhatsApp template name (e.g. rl_universal_roel) - used for outbound buiten 24u session window" },

  // Footer
  "settings.users.footer": { nl: "Hub rol bepaalt toegang. Monday rol bepaalt wat deze gebruiker doet - voor AM/CM/Setter pikt de Monday naam welke klanten ze zien (admins zien altijd alles). Finance is org-breed en heeft geen Monday naam nodig; triggert factuur-taken via de inbox automation. Slack ID wordt gebruikt voor DM-notificaties. Fathom e-mail koppelt deze Hub-gebruiker aan hun Fathom-account zodat de meeting matcher weet wie er in een opgenomen call zat. Alle velden auto-saven.", en: "Hub role controls access. Monday role decides what this user does - for AM/CM/Setter, the Monday name picks which clients they see (admins always see all). Finance is org-level and doesn't need a Monday name; it triggers invoice tasks via the inbox automation. Slack ID is used for DM notifications. Fathom email maps this Hub user to their Fathom account so the meeting matcher knows who was in a recorded call. All fields autosave." },

  // ─── Settings - Inbox Automations tab ─────────────────────────────────
  // Per-rule descriptions (title/description/trigger/effect) intentionally
  // stay English - admin operator docs full of code-flow terminology
  // (cron, idempotent, source_ref, etc.) that maps to the implementation.
  // Translating would break the mental model with code/UI.
  "settings.inbox.title": { nl: "Inbox automatiseringen", en: "Inbox Automations" },
  "settings.inbox.subtitle": { nl: "Regels die automatisch inbox-taken of updates aanmaken op basis van data-signalen uit de Hub. Elke regel draait dagelijks via cron en is volledig idempotent - opnieuw draaien levert geen duplicaten.", en: "Rules that automatically create inbox tasks or updates based on data signals across the Hub. Each rule runs once daily via cron and is fully idempotent - re-running won't create duplicates." },
  "settings.inbox.trigger": { nl: "Trigger", en: "Trigger" },
  "settings.inbox.effect": { nl: "Effect", en: "Effect" },
  "settings.inbox.footer_more": { nl: "Meer regels landen hier zodra we signalen uit Monday updates, Trengo conversaties en Watch List events verbinden met geautomatiseerde taken.", en: "More rules will land here as we wire signals from Monday updates, Trengo conversations and Watch List events into automated tasks." },

  // Run-as-test panel
  "settings.inbox.run.title": { nl: "Test draaien (toegewezen aan jou)", en: "Run as test (assigned to you)" },
  "settings.inbox.run.subtitle_before": { nl: "Zelfde code-pad als de dagelijkse cron, maar taken worden toegewezen aan ", en: "Same code path as the daily cron, but tasks are assigned to " },
  "settings.inbox.run.subtitle_you": { nl: "jou", en: "you" },
  "settings.inbox.run.subtitle_with": { nl: " met een ", en: " with a " },
  "settings.inbox.run.subtitle_after": { nl: " prefix - zodat je AI-output en regel-logica kunt valideren zonder het team te spammen. Idempotency check is uit, dus opnieuw draaien levert altijd verse items.", en: " prefix - so you can validate AI output and rule logic without spamming the team. Idempotency check is skipped, so re-running always produces fresh items." },
  "settings.inbox.run.action.run": { nl: "Test draaien", en: "Run test" },
  "settings.inbox.run.action.running": { nl: "Draait...", en: "Running..." },
  "settings.inbox.run.error.failed": { nl: "Draaien mislukt", en: "Run failed" },

  // Result summary
  "settings.inbox.result.last_run": { nl: "Laatste run · {duration}", en: "Last run · {duration}" },
  "settings.inbox.result.created": { nl: "aangemaakt", en: "created" },
  "settings.inbox.result.skipped": { nl: "overgeslagen", en: "skipped" },
  "settings.inbox.result.section_created": { nl: "Aangemaakt ({n})", en: "Created ({n})" },
  "settings.inbox.result.section_skipped": { nl: "Overgeslagen ({n})", en: "Skipped ({n})" },
  "settings.inbox.result.empty": { nl: "Geen acties ondernomen - niks paste vandaag bij een regel.", en: "No actions taken - nothing matched any rule today." },
  "settings.inbox.result.truncated": { nl: "+{n} meer (afgekapt)", en: "+{n} more (truncated)" },

  // Created-row labels
  "settings.inbox.row.payment_overdue": { nl: "Betaling achterstallig", en: "Payment overdue" },
  "settings.inbox.row.auto_completed": { nl: "Auto-completed factuurtaak", en: "Auto-completed invoice task" },
  "settings.inbox.row.deduped": { nl: "Taken gededupliceerd", en: "Deduped tasks" },
  "settings.inbox.row.cpl_drop": { nl: "CPL daling {period}", en: "CPL drop {period}" },
  "settings.inbox.row.invoice_short": { nl: "factuur {id}…", en: "invoice {id}…" },

  // ─── Settings - Pedro tab (admin pipeline observability) ──────────────
  "settings.pedro.error.title": { nl: "Pedro health niet beschikbaar - {message}", en: "Pedro health unavailable - {message}" },
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
  "settings.pedro.evals.description": { nl: "Pedro leest elke evaluatie en flagt alleen wanneer Claude iets actionable detecteert. Lage conversion is normaal - routine evals produceren geen task.", en: "Pedro reads every evaluation and only flags when Claude detects something actionable. Low conversion is normal - routine evals produce no task." },
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

  // ─── Settings - Notifications tab ─────────────────────────────────────
  // Per-notification descriptions + example bodies stay in their authored
  // mix of EN/NL - they're admin-docs about a multilingual product.
  "settings.notifications.intro": { nl: "Beheer geautomatiseerde notificaties die de Hub verstuurt. Elke notificatie heeft een preview-knop die naar je eigen Slack DM stuurt - veilig om te testen zonder het team te spammen.", en: "Manage automated notifications sent from the Hub. Each notification has a preview button that posts to your own Slack DM - safe to test without spamming the team." },
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
  "settings.notifications.recipients.empty": { nl: "Nog geen gebruikers hebben een Slack ID - voeg er één toe in Kolom mapping.", en: "No users have a Slack ID configured yet - add one in Column Mapping." },
  "settings.notifications.recipients.no_slack": { nl: "(geen Slack ID)", en: "(no Slack ID)" },
  "settings.notifications.recipients.no_slack_title": { nl: "Geen Slack ID ingesteld - ontvangt geen notificaties", en: "No Slack ID set - won't receive notifications" },
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

  // ─── Targets - Delivery tab ───────────────────────────────────────────
  // Section headers (the KPI metric labels themselves stay English - RL jargon)
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
  "targets.delivery.more_results": { nl: "+ {n} meer - verfijn je zoekopdracht.", en: "+ {n} more - refine your search to narrow down." },
  "targets.delivery.assigning": { nl: "Toewijzen…", en: "Assigning…" },
  "targets.delivery.assign_failed": { nl: "Toewijzen mislukt", en: "Failed to assign" },

  // ─── Targets - Finance tab ────────────────────────────────────────────
  // Section headers - KPI labels stay English (RL jargon).
  "targets.finance.section.revenue_service_fee": { nl: "Omzet - Service Fee", en: "Revenue - Service Fee" },
  "targets.finance.section.revenue_ad_budget": { nl: "Omzet - Ad Budget", en: "Revenue - Ad Budget" },
  "targets.finance.section.costs": { nl: "Kosten (volledige maand)", en: "Costs (Full Month)" },
  "targets.finance.section.profit": { nl: "Winst", en: "Profit" },

  // ─── Targets - Settings tab (per-month targets config) ────────────────
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
  "pedro.stage.unsaved_lead": { nl: "Nog niet opgeslagen - werkt in", en: "Not yet saved - working in" },
  "pedro.stage.draft_mode": { nl: "draft mode", en: "draft mode" },
  "pedro.stage.draft_hint": { nl: "(auto-save aan, niet zichtbaar voor klant-record)", en: "(auto-save on, not visible to client record)" },
  "pedro.stage.saving": { nl: "Opslaan...", en: "Saving..." },
  "pedro.stage.save_as_next": { nl: "Save als v{n}", en: "Save as v{n}" },
  "pedro.stage.save_initial": { nl: "Save naar klant", en: "Save to client" },
  "pedro.stage.saved_as": { nl: "Opgeslagen als v{n}", en: "Saved as v{n}" },
  "pedro.stage.unchanged": { nl: "v{n} ongewijzigd - geen nieuwe versie", en: "v{n} unchanged - no new version" },
  "pedro.stage.save_failed": { nl: "Opslaan mislukt", en: "Save failed" },

  // ─── AI Co-pilot confirm dialog (create_task / create_reminder / pedro / nav) ──
  "copilot.confirm.title": { nl: "Bevestig actie", en: "Confirm action" },
  "copilot.confirm.ai_parsed": { nl: "AI begreep", en: "AI parsed" },
  "copilot.confirm.context_used": { nl: "Context gebruikt", en: "Context used" },
  "copilot.confirm.cancel": { nl: "Annuleer", en: "Cancel" },
  "copilot.confirm.working": { nl: "Bezig...", en: "Working..." },
  "copilot.confirm.btn.create_task": { nl: "Goedkeuren & taak aanmaken", en: "Approve & create" },
  "copilot.confirm.btn.schedule_reminder": { nl: "Reminder inplannen", en: "Schedule reminder" },
  "copilot.confirm.btn.run_pedro": { nl: "Goedkeuren & Pedro draaien", en: "Approve & run Pedro" },
  "copilot.confirm.btn.open": { nl: "Open", en: "Open" },
  "copilot.confirm.dismiss": { nl: "Verwijder", en: "Dismiss" },
  "copilot.confirm.close": { nl: "Sluiten", en: "Close" },
  "copilot.confirm.back": { nl: "Terug naar drafts", en: "Back to drafts" },
  "copilot.confirm.status_ready": { nl: "Klaar", en: "Ready" },
  "copilot.confirm.chip": { nl: "AI Draft", en: "AI Draft" },
  "copilot.field.title": { nl: "Titel", en: "Title" },
  "copilot.field.body_optional": { nl: "Toelichting (optioneel)", en: "Body (optional)" },
  "copilot.field.body_placeholder_task": {
    nl: "Extra context - KPI-getallen, ad-namen, waarom dit belangrijk is",
    en: "Extra context - KPI numbers, ad names, why this matters",
  },
  "copilot.field.body_placeholder_reminder": {
    nl: "Extra context voor toekomstige-jij",
    en: "Extra context for future-you",
  },
  "copilot.field.client": { nl: "Klant", en: "Client" },
  "copilot.field.client_none": { nl: "- Geen klant -", en: "- No client -" },
  "copilot.field.assignee": { nl: "Toewijzen aan", en: "Assignee" },
  "copilot.field.assignee_none": { nl: "- Kies iemand -", en: "- Pick someone -" },
  "copilot.field.due_date": { nl: "Deadline", en: "Due date" },
  "copilot.field.priority": { nl: "Prioriteit", en: "Priority" },
  "copilot.field.priority_low": { nl: "Laag", en: "Low" },
  "copilot.field.priority_normal": { nl: "Normaal", en: "Normal" },
  "copilot.field.priority_high": { nl: "Hoog", en: "High" },
  "copilot.field.kind": { nl: "Type", en: "Kind" },
  "copilot.field.kind_task": { nl: "Taak - iets dat ik moet aftikken", en: "Task - something I need to tick off" },
  "copilot.field.kind_update": { nl: "Update - alleen een seintje", en: "Update - just a heads-up" },
  "copilot.field.remind_on": { nl: "Herinner op", en: "Remind on" },
  "copilot.field.tab": { nl: "Tabblad", en: "Tab" },
  "copilot.field.tab.campaigns": { nl: "Campagnes", en: "Campaigns" },
  "copilot.field.tab.billing": { nl: "Facturatie", en: "Billing" },
  "copilot.field.tab.communication": { nl: "Communicatie", en: "Communication" },
  "copilot.field.tab.settings": { nl: "Instellingen", en: "Settings" },
  "copilot.field.lookback_days": { nl: "Terugblik (dagen)", en: "Lookback (days)" },
  "copilot.reminder.surface_hint_task": {
    nl: "Verschijnt in je Inbox › Taken om 09:00 op de gekozen dag.",
    en: "Surfaces in your Inbox › Tasks at 09:00 on the chosen day.",
  },
  "copilot.reminder.surface_hint_update": {
    nl: "Verschijnt in je Inbox › Updates om 09:00 op de gekozen dag.",
    en: "Surfaces in your Inbox › Updates at 09:00 on the chosen day.",
  },
  "copilot.pedro.eta_hint": {
    nl: "Dit duurt 40-90 seconden. Het resultaat wordt opgeslagen als Pedro-deliverable en getoond op het Campagnes-tabblad van de klant.",
    en: "This can take 40-90 seconds. The result will be saved as a Pedro deliverable and shown on the client's Campaigns tab.",
  },
  "copilot.confirm.btn.create_event": {
    nl: "Verstuur uitnodiging",
    en: "Send invite",
  },
  "copilot.field.start_at": { nl: "Start", en: "Start" },
  "copilot.field.duration_min": { nl: "Duur (min)", en: "Duration (min)" },
  "copilot.field.add_meet_link": {
    nl: "Google Meet-link toevoegen",
    en: "Add Google Meet link",
  },
  "copilot.calendar.invitee_hint": {
    nl: "Uitnodiging gaat naar het e-mailadres uit Monday (Client › Settings › Contact). Geen e-mail bekend → vul 'm in op de klant of voeg 'm later toe in Google Calendar.",
    en: "Invite goes to the client's Monday email (Client › Settings › Contact). Missing → fill it in there, or add the attendee manually in Google Calendar later.",
  },
  "copilot.calendar.invitee_external": {
    nl: "Externe genodigde — uitnodiging gaat naar het e-mailadres hieronder.",
    en: "External attendee — the invite goes to the email above.",
  },
  "copilot.calendar.invitee_missing": {
    nl: "Geen e-mail ingevuld — event wordt aangemaakt zonder genodigde tenzij je 'm hierboven toevoegt.",
    en: "No email filled in — the event is created without an invitee unless you add one above.",
  },
  "copilot.field.attendee_name": { nl: "Naam genodigde", en: "Attendee name" },
  "copilot.field.attendee_name_placeholder": { nl: "Pieter, Lisa, …", en: "Pieter, Lisa, …" },
  "copilot.field.attendee_email": { nl: "E-mail genodigde", en: "Attendee email" },
  "copilot.confirm.btn.prepare_update": {
    nl: "Update klaarzetten",
    en: "Queue update",
  },
  "copilot.client_update.hint": {
    nl: "Kanaal (WhatsApp-template of e-mail) wordt automatisch gekozen op basis van de preferred contact van de klant. Na 'Update klaarzetten' opent de queue met deze draft bovenaan — daar kun je 'm controleren, aanpassen en versturen.",
    en: "Channel (WhatsApp template or email) is picked automatically from the client's preferred contact. After queuing, the queue sheet opens with this draft pre-selected so you can review, edit, and send.",
  },
} as const satisfies Record<string, LocalizedString>

export type DictionaryKey = keyof typeof DICTIONARY
