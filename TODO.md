# TODO — Rocket Leads Hub

> Stand van zaken: **2026-05-05** EOD.

---

## 🎉 Wat staat er nu in de Hub

Snelle tour. Per stuk: wat doet het?

### Sidebar (links in beeld)
Watch List · Clients · Inbox · Meetings · Targets · Billing (admin) · My Account · Settings

### 1. Watch List
> *"Welke klanten gaan niet goed?"*

Triage scherm. Rood = nu iets doen. Geel = in de gaten houden. Groen = lekker bezig. AI geeft korte tip per klant wat er aan de hand is en wat te doen.

### 2. Clients lijst
> *"Wie zijn al onze klanten?"*

Zoeken, filteren, doorklikken. MRR-kolom (uit Hub agreement) met ad-budget en next-invoice-datum als sub-regels.

### 3. Klant detail page
> *"Alles over deze ene klant op één plek."*

Tabs: Home · Campaigns · Inbox · Billing · Communication · Meetings · Settings. Billing tab heeft per-klant next-invoice datepicker.

### 4. Inbox (`/inbox`)
> *"Wat moet ik vandaag doen of lezen?"*

Eén plek voor alles uit Trengo, Slack, Monday, Fathom action items, automation cron en handmatige creaties. Ingest events worden auto-gerouteerd naar de juiste AM. Snooze beschikbaar op alle open tasks. AI dedup tussen bronnen (opt-in).

### 5. Meetings (`/meetings`)
> *"Al onze Fathom calls op één plek."*

Vier tabs (Unlinked / Recent / Internal / Archived). Action items uit elke meeting komen automatisch als bundled Hub-task (split in team-taken vs klant-taken).

### 6. Targets (`/targets`)
> *"Hoe goed gaan we deze maand?"*

Maand-doelen vs werkelijkheid. Vier pijlers: CBC, kwalificatie, show-up, conversie. Pro-rata berekend.

### 7. Billing (`/billing`)
> *"Welke facturen moeten deze week eruit?"*

Admin-only finance dashboard. Klanten met `next_invoice_date`, gegroepeerd in Overdue / Today / This week / Next week / Later. Top: 4 summary cards. Auto-task voor finance op de vervaldatum + auto-complete via Stripe webhook (instant) of cron-fallback.

### 8. My Account (`/account`)
> *"Mijn eigen koppelingen."*

Persoonlijke Slack/Trengo/Monday tokens → replies vanuit de Hub komen op naam van jou. Sidebar avatar toont een paars puntje als één van de drie nog niet is geconnect.

### 9. Settings (alleen admin)
API keys, gebruikers (incl. finance Monday role), board config (alle Monday kolommen incl. `follow_up_status` / `follow_up_fee` / `next_invoice_date`), inbox automation rules, notificaties.

---

## 🛠️ Eénmalig nog door jou in te richten

Geen code, wel klikken/invullen.

### A. Klanten met meerdere campagnes invullen 🟡 (~30 min)
Ongeveer 20% van klanten heeft >1 Meta-campagne. Hub heeft voor iedereen 1 standaard agreement aangemaakt. Splits per campagne moet je zelf invullen via Hub → klant → Billing → Add campaign. Varel staat goed (€1950 MRR is de blauwdruk).

### B. Monday opschonen 🧹 (~20 min)
- Sub-items op alle 762 klanten verwijderen (Hub leest ze niet meer)
- 38 klanten met lege `status__1` → invullen "Client" of "Rocket Leads"

### C. AI dedup live zetten (~5 min, na test-run)
- Settings → Inbox automations → "Run now (test mode)" → review de paarse "Deduped tasks" rijen
- Tevreden? → toggle `dedup_overlapping_tasks` aan → kandelt vanaf de volgende cron echt

---

## 🟢 Volgende — wat er nog aankomt

Phase A-D zijn af. Volgorde van prioriteit:

### 1. Stripe subscription auto-send (klein, scope met Arno)
Nu: finance maakt invoice handmatig in Stripe → webhook auto-completet de task. Volgende stap: de Hub triggert de invoice-creatie via een Stripe subscription, met optionele approval-knop in de inbox-task. Roy bespreekt scope eerst met Billing voordat we bouwen — beslissingen die nog open zijn: pure auto-send vs. approval-flow, hoe omgaan met klanten met variabele bedragen per maand, prorate-handling.

### 2. Phase F — Push notificaties
> *"De Hub pingt jou, in plaats van dat jij steeds moet kijken."*

Browser push (native OS-level notificaties die ook verschijnen als de Hub-tab dicht is — zelfde tech als WhatsApp Web / Linear / Slack web). Plus optioneel email digest voor wie geen real-time pings wil.

**Triggers (per-persoon configureerbaar):**
- Je wordt @mentioned in een task/comment
- Een task wordt aan je toegewezen
- Nieuwe inbox-event landt op je "Assigned to me"-filter
- Automation creëert iets voor jou (payment overdue, finance task)
- Een snoozed task wordt wakker

**Implementatie:** Service Worker + Web Push (VAPID keys), one-time browser permission prompt. Email digest via een dagelijkse cron rond 09:00 NL. Phase F is klein-tot-medium — geen schemawijzigingen, alleen een `push_subscriptions` tabel + cron + frontend permission flow.

### 3. Phase G — Daily decommissioning van Trengo / Monday / Slack
> *"Niemand opent deze tools nog dagelijks."*

**Geen code-fase, een gedragsverandering.** Eindstation uit `vision-rocketleads-hub.md`: het team werkt 100% in de Hub; Trengo/Monday/Slack zakken naar de onderste laag als transport/storage. Hoogstens 1× per week openen voor admin (Trengo: WhatsApp Business settings, Monday: data audit, Slack: externe integraties).

**Wat het vraagt:**
- Audit: hoe vaak opent elk teamlid nog Trengo/Monday/Slack?
- Voor élke workflow die ze daar nog doen → bouw de Hub-equivalent (of accepteer 1× per week als acceptabel)
- Onboarding-doc: "vanaf nu doe je X in de Hub, niet in Slack"
- Slack-kanalen archiveren of read-only zetten

Hangt af van Phase E (chat) voordat het écht volledig kan.

### 4. Phase E — Hub-native team chat (Slack-vervanger) — HELEMAAL ACHTERAAN
> *"In het begin werken we gewoon door in Slack."*

Geen prioriteit nu. Te grote klus om aan het begin op te pakken. Slack blijft de chat-tool tot we hier verder mee gaan.

**Wanneer we 't ooit doen:** Slack als operationele tool vervangen door chat in de Hub. Per-klant interne thread (op de klantpagina), team-brede kanalen, DM's tussen teamleden, @mentions, reacties, threading. Snelle Google Meet-knop voor Huddle-vervanging. Reden om eigen te bouwen i.p.v. Slack te integreren: Slack DM's tussen teamleden zijn niet leesbaar via de Slack API (privacy-by-design).

Visie voor het hele plaatje staat in `vision-rocketleads-hub.md`.

---

## 📌 Open vragen — reeds beantwoord

- ~~Quick-link logos op de Clients overview tabel?~~ → Nee, clutter
- ~~Multi-campagne KPIs splitsen?~~ → Niet nu; in de toekomst krijgt iedere campagne een eigen Monday item
- ~~Meetings access control per-klant?~~ → Nee, iedereen mag alles zien

---

## 🧹 Klein opruimwerk

Niet urgent.

- **Test-opname** "Impromptu Google Meet Meeting" (team Delivery Founder Download) staat nog in `meetings`. Mag via Supabase weg.
- **`seed-agreements` endpoint** blijft staan voor toekomstige re-seeds.
- **`fathom-backfill` endpoint** blijft staan zolang we niet zeker weten dat de webhook 100% reliable is.
- **`meetings-backfill-tasks` endpoint** — eenmalige bulk-ingest van Fathom action items voor historische meetings. Hit 'm één keer (`/api/admin/meetings-backfill-tasks`) als je alle bestaande meetings in de inbox wilt. Mag daarna weg, maar geen haast.
