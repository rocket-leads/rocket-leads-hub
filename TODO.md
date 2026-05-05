# TODO — Rocket Leads Hub

> Stand van zaken: **2026-05-05** EOD.

---

## 🎉 Wat staat er nu in de Hub

Snelle tour. Per stuk: wat doet het?

### Sidebar (links in beeld)
Watch List · Clients · Inbox · Meetings · Targets · **Billing (NIEUW, admin)** · My Account · Settings

### 1. Watch List
> *"Welke klanten gaan niet goed?"*

Triage scherm. Rood = nu iets doen. Geel = in de gaten houden. Groen = lekker bezig. AI geeft korte tip per klant wat er aan de hand is en wat te doen.

### 2. Clients lijst
> *"Wie zijn al onze klanten?"*

Zoeken, filteren, doorklikken naar één klant. **Nieuw:** MRR-kolom (uit Hub agreement) met ad-budget en next-invoice-datum als sub-regels.

### 3. Klant detail page (klik op een klant)
> *"Alles over deze ene klant op één plek."*

Tabs:
- **Home** — overzicht
- **Campaigns** — Meta ads, KPI's, AI analyses, ad performance
- **Inbox** — berichten over deze klant
- **Billing** — Stripe facturen + per-campagne wat ze betalen + MRR + **next-invoice datepicker (NIEUW)**
- **Communication** — WhatsApp + email gesprekken via Trengo
- **Meetings** — Fathom calls van deze klant
- **Settings** — alle ID's en koppelingen

### 4. Inbox (`/inbox`)
> *"Wat moet ik vandaag doen of lezen?"*

Eén plek voor alles. AI sorteert berichten uit Trengo, Slack en Monday in **Tasks**, **Updates** en **Chat**. **Nieuw:** ingest-events worden automatisch naar de juiste AM gerouteerd (geen poel meer op het HQ-account). Trengo-berichten zonder gekoppelde klant kun je via "Link to client"-dialog ter plekke aan de juiste klant hangen.

### 5. Meetings (`/meetings`)
> *"Al onze Fathom calls op één plek."*

Fathom opnames komen vanzelf binnen. Vier tabs: Unlinked / Recent / Internal / Archived. Per opname: titel + datum + Fathom AI summary + action items + knop terug naar Fathom voor de video.

### 6. Targets (`/targets`)
> *"Hoe goed gaan we deze maand?"*

Maand-doelen vs werkelijkheid. Vier pijlers: CBC, kwalificatie, show-up, conversie. Pro-rata berekend.

### 7. Billing (`/billing`) ✨ NIEUW
> *"Welke facturen moeten deze week eruit?"*

Admin-only overzichtspagina. Alle klanten met een `next_invoice_date` ingesteld, gegroepeerd in Overdue / Today / This week / Next week / Later. Per rij: klantnaam, datum, MRR, ad-budget, Stripe deeplink. Top: 4 summary cards (scheduled clients, due this week, total MRR, run rate).

### 8. My Account (`/account`)
> *"Mijn eigen koppelingen."*

Koppel je eigen Slack/Trengo/Monday tokens → replies vanuit de Hub komen op naam van jou, niet van een bot. Sidebar avatar toont een paars puntje als één van de drie nog niet is geconnect.

### 9. Settings (alleen admin)
API keys beheren, gebruikers, board config (Monday kolommen), notificatie-instellingen. **Nieuw:** Finance is een Monday role geworden — geen aparte kolom meer. Board config laat nu ook `follow_up_status`, `follow_up_fee` en `next_invoice_date` aanpassen.

---

## 🆕 Wat is er deze sprint live gegaan

In willekeurige volgorde:

- **Next invoice date tracker** — per-klant datum, bidi sync met Monday `date3`, datepicker op Billing tab, sortable kolom op /clients overview, dedicated /billing overview pagina
- **Finance-rol via Monday role** — geen `is_finance` boolean meer, gewoon een waarde in `monday_column_role`
- **Auto-task voor finance** — daily cron creëert "Send invoice for {klant}"-task wanneer `next_invoice_date <= today`, geassigneerd aan de finance user, met MRR + Stripe customer ID in de body
- **Auto-complete via Stripe** — task gaat automatisch op done zodra Stripe `invoice.finalized` of `invoice.sent` event vuurt voor die klant. Cron is backup. Lag van 24u → seconden
- **MRR-kolom op /clients** — sortable, met budget en next-invoice als sub-regels
- **Sidebar platform-token indicator** — paars puntje wanneer Slack/Trengo/Monday niet geconnect is
- **Slack OAuth fix** — geen 500 meer wanneer `SLACK_CLIENT_ID` ontbreekt; redirect met readable error
- **Inbox AM-routing** — Trengo + Monday webhook ingesters resolven nu de juiste AM via `user_column_mappings`
- **Trengo contact linking** — koppel ongelinkte Trengo-berichten ter plekke aan de juiste klant
- **Source pills op inbox-rijen** — Trengo/Slack/Monday/automation/watchlist/meeting markers
- **Board config polish** — `follow_up_status`, `follow_up_fee`, `next_invoice_date` configureerbaar
- **Cleanup** — throwaway admin endpoints `fathom-fetch` + `meetings-debug` weg

---

## 🛠️ Eénmalig nog door jou in te richten

Geen code, wel klikken/invullen.

### A. Klanten met meerdere campagnes invullen 🟡 (~30 min)
Ongeveer 20% van klanten heeft >1 Meta-campagne. Hub heeft voor iedereen 1 standaard agreement aangemaakt. Splits per campagne moet je zelf invullen via Hub → klant → Billing → Add campaign. Varel staat goed (€1950 MRR is de blauwdruk).

### B. Monday opschonen 🧹 (~20 min)
- Sub-items op alle 762 klanten verwijderen (Hub leest ze niet meer)
- 38 klanten met lege `status__1` → invullen "Client" of "Rocket Leads"

---

## 🟢 Volgende — wat er nog aankomt

### Phase D — Centraal taken-systeem
> *"Eén Hub-takenlijst voor alles."*

Action items uit Fathom + tickets uit Trengo + updates uit Monday + auto-tasks uit cron → één gezamenlijke takenlijst per persoon. AI dedupliceert ("Arno moet factuur sturen voor Klant X" via Trengo + via cron = één task). Vraagt 30 min alignment voor we beginnen: welke sources zijn first-class, hoe AI items dedupliceert, wat de UX is.

### Stripe subscription auto-send (later)
Nu: finance maakt invoice handmatig in Stripe → webhook auto-completet de task. Volgende stap: de Hub triggert de invoice-creatie via Stripe subscription, met optionele approval-knop in de inbox-task. Wachten tot het huidige flow comfortabel zit.

### Phase E-G — Veel later
Slack als operationele tool vervangen, push notificaties, Trengo/Monday/Slack daily-decommissioning. Visie staat in `vision-rocketleads-hub.md`.

---

## 📌 Open vragen — reeds beantwoord

- ~~Quick-link logos op de Clients overview tabel?~~ → Nee, clutter
- ~~Multi-campagne KPIs splitsen?~~ → Niet nu; in de toekomst krijgt iedere campagne een eigen Monday item
- ~~Meetings access control per-klant?~~ → Nee, iedereen mag alles zien

---

## 🧹 Klein opruimwerk

Niet urgent, mag op een rustige dag.

- **Test-opname** "Impromptu Google Meet Meeting" (team Delivery Founder Download) staat nog in `meetings` tabel. Mag via Supabase weg.
- **`seed-agreements` endpoint** blijft staan voor toekomstige re-seeds (bv. na schema wijzigingen).
- **`fathom-backfill` endpoint** blijft staan zolang we niet zeker weten dat de webhook 100% reliable is.
