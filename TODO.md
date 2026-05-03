# TODO — Rocket Leads Hub

> Stand van zaken: **2026-05-03** EOD.

---

## 🎉 Wat staat er nu in de Hub

Snelle tour. Per stuk: wat doet het?

### Sidebar (links in beeld)
Watch List · Clients · Inbox · **Meetings (NIEUW)** · Targets · My Account · Settings

### 1. Watch List
> *"Welke klanten gaan niet goed?"*

Triage scherm. Rood = nu iets doen. Geel = in de gaten houden. Groen = lekker bezig. AI geeft korte tip per klant wat er aan de hand is en wat te doen.

### 2. Clients lijst
> *"Wie zijn al onze klanten?"*

Zoeken, filteren, doorklikken naar één klant.

### 3. Klant detail page (klik op een klant)
> *"Alles over deze ene klant op één plek."*

Tabs:
- **Home** — overzicht
- **Campaigns** — Meta ads, KPI's, AI analyses, ad performance
- **Inbox** — berichten over deze klant
- **Billing** — Stripe facturen + per-campagne wat ze betalen + MRR
- **Communication** — WhatsApp + email gesprekken via Trengo
- **Meetings** ✨ NIEUW — Fathom calls van deze klant
- **Settings** — alle ID's en koppelingen

### 4. Inbox (`/inbox`)
> *"Wat moet ik vandaag doen of lezen?"*

Eén plek voor alles. AI sorteert berichten uit Trengo, Slack en Monday in **Tasks**, **Updates** en **Chat**.

### 5. Meetings (`/meetings`) ✨ NIEUW deze sessie
> *"Al onze Fathom calls op één plek."*

Fathom opnames komen vanzelf binnen. Vier tabs:
- **Unlinked** — nog niet aan een klant gekoppeld (rode bolletje als er werk ligt)
- **Recent** — al gekoppeld aan een klant
- **Internal** — interne RL teammeetings
- **Archived** — opzij gezet (sales calls die niet door zijn gegaan etc.)

Per opname: titel + datum + Fathom AI summary + action items + knop terug naar Fathom voor de video.

### 6. Targets (`/targets`)
> *"Hoe goed gaan we deze maand?"*

Maand-doelen vs werkelijkheid. Vier pijlers: CBC, kwalificatie, show-up, conversie. Pro-rata berekend.

### 7. My Account (`/account`)
> *"Mijn eigen koppelingen."*

Koppel je eigen Slack/Trengo/Monday tokens → replies vanuit de Hub komen op naam van jou, niet van een bot.

### 8. Settings (alleen admin)
API keys beheren, gebruikers, board config (Monday kolommen), notificatie-instellingen.

---

## 🔥 Morgen — concrete klusjes

Vier dingen. Geen code. Alleen klikken en invullen.

### Klus 1 — Klanten met meerdere campagnes invullen 🟡 (~30 min)

**Wat is er aan de hand:** Ongeveer 20% van klanten heeft meer dan 1 Meta-campagne. De Hub heeft nu voor iedereen 1 standaard campagne aangemaakt met de service fee uit Monday. De splitsing per campagne moet je zelf invullen.

**Hoe los je het op:**
1. Open Monday → filter op klanten met `status__1 = "Rocket Leads"`
2. Voor elke klant: ga naar de Hub → klant openen → **Billing** tab
3. Klik **Add campaign** → vul ad-budget + service fee in per campagne
4. Check **Varel** even ter referentie — die staat goed (€1950 MRR is de blauwdruk)

### Klus 2 — Monday opschonen 🧹 (~20 min)

**Wat is er aan de hand:**
- De Hub leest sub-items niet meer, dus die mogen weg (op alle 762 klanten).
- 38 klanten hebben een lege `status__1` — die moet "Client" of "Rocket Leads" zijn.

**Hoe los je het op:**
1. In Monday: selecteer alle sub-items op de 762 klanten → **Delete**
2. Filter op klanten met empty `status__1` → vul in: **"Client"** of **"Rocket Leads"**

### Klus 3 — Fathom emails koppelen aan teamleden 👥 (~5 min)

**Wat is er aan de hand:** De Hub weet nog niet wie wie is in Fathom. Hub email (`@rocketleads.com`) ≠ Fathom email. Zonder mapping kan de matcher (later) niet zien welke AM in welke call zat.

**Hoe los je het op:**
1. Hub → **Settings** → **Users** tab
2. Bij jouw eigen rij: klik op de **Fathom email** dropdown → kies je Fathom account
3. Doe daarna Roel, Anel, Jill (senior AMs)
4. Rest van het team mag deze week

### Klus 4 — Test of Fathom webhook werkt 🧪 (~10 min)

**Wat is er aan de hand:** Webhook staat aan in Fathom (URL + alle scopes correct), maar we hebben nog geen bewijs dat hij echt fired bij een nieuwe opname. De vorige test zat in team **"Delivery Founder Download"** — die wordt nu terecht overgeslagen door de team-filter.

**Hoe los je het op:**
1. Start Fathom in een willekeurige meeting (2 min is genoeg)
2. ⚠️ **BELANGRIJK:** team moet **"Sales Rocket Leads"** of **"Delivery Rocket Leads"** zijn — anders skippen we de opname
3. Stop de opname → wacht 3–5 min (Fathom moet AI processing doen)
4. Open `https://hub.rocketleads.com/meetings` → **Unlinked** tab
5. **Zie je hem staan?** ✅ webhook werkt — klaar
6. **Zie je niets?** Open Vercel → Logs → filter op `/api/webhooks/fathom` → kijk of er een request binnenkwam
7. **Werkt het echt niet?** Workaround: ga naar `https://hub.rocketleads.com/api/admin/fathom-fetch?hours=4&ingest=1` — die haalt 'm alsnog binnen via de API

---

## 🟢 Volgende week / binnenkort

Niet morgen, wel binnenkort. Per stuk in één zin.

### Fathom matcher (C.5.b)
Hub gaat zelf klanten herkennen aan email + naam + bedrijf. Nu nog handmatig via "Link to client" knop op elke meeting card.

### Fathom backfill (C.5.e)
Alle Fathom opnames van afgelopen 90 dagen in één keer importeren + matchen tegen klanten.

### Fathom knowledge docs (C.5.f)
Drie templates schrijven: `sales-calls.md`, `kick-off-calls.md`, `evaluation-calls.md` — zodat AI weet welke patronen bij welke type call horen.

### Inbox uitbreiden (C.7 + C.8)
- **C.7** — Team Inbox (Slack DMs) + Client Inbox (Trengo merged per contact)
- **C.8** — Per-klant timeline op de klant detail page met alle events chronologisch

### Phase D — Centraal taken-systeem
Action items uit Fathom + tickets uit Trengo + updates uit Monday → één gezamenlijke Hub takenlijst.

### MRR kolom op Clients overview
Naast Budget kolom op `/clients` ook MRR uit `client_agreements` tonen (small win voor finance).

### Settings — board config voor follow-up velden
Hardcoded `status__1` en `numbers0__1` configureerbaar maken (niet urgent, ID's zijn stabiel).

### Phase E-G — Veel later
Slack als operationele tool vervangen, push notificaties, Trengo/Monday/Slack daily-decommissioning. Visie staat in `vision-rocketleads-hub.md`.

---

## 📌 Open vragen voor jou

Drie keuzes die ik niet voor je kan maken:

- **Quick-link logos op de Clients overview tabel?** Nu alleen op detail pagina zichtbaar. Op de overview ook handig?
- **Multi-campagne KPIs splitsen?** Nu rolt alles op per Meta ad-account. Wil je in de toekomst per-campagne KPI's apart kunnen zien?
- **Meetings access control?** Nu zien alle Hub-gebruikers alle meetings op `/meetings`. Moet dit per-klant beperkt worden zoals billing/communication? Transcripts kunnen gevoelige info bevatten.

---

## 🧹 Klein opruimwerk

Niet urgent, mag op een rustige dag.

- **Test-opname** "Impromptu Google Meet Meeting" (team Delivery Founder Download) staat nog in `meetings` tabel van vóór de team-filter. Mag via Supabase weg, of laten staan tot de matcher hem auto-archived.
- **Admin endpoints** `/api/admin/fathom-fetch` en `/api/admin/meetings-debug` zijn throwaway diagnostics. Opruimen zodra C.5.b matcher + cron-backfill live zijn.
- **`seed-agreements` endpoint** blijft staan voor toekomstige re-seeds (bv. na schema wijzigingen).
