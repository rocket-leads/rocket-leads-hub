# Vision Document: Rocket Leads Hub v3.0 - De Operationele Hub

> **Last updated:** 2026-05-02 CET

> **Let op:** Dit document beschrijft de lange-termijn visie en strategische richting voor de Rocket Leads Hub. Het dient als inspiratiebron en context voor toekomstige ontwikkeling, niet als directe implementatie-instructies. Bouw features alleen wanneer expliciet gevraagd.

---

## Kernverschuiving: Van Analyselaag naar Operationele Hub

De Hub begon als analytisch dashboard bovenop Trengo, Monday en Slack - een extra venster waarin AM's en CM's data konden inzien. Het probleem: het team werkt nu op vier plekken in plaats van drie. De Hub is een aanvulling, geen vervanging.

**De nieuwe visie:** de Hub wordt de single source of truth waarin het hele team opereert. Trengo, Monday en Slack zakken weg naar de onderkant van de stack en functioneren alleen nog als onderliggende databases en transport layers. Het dagelijkse werk - communicatie, to-do's, updates, coördinatie - gebeurt 100% in de Hub.

**Eindbeeld:** een AM of CM opent op maandag de Hub en heeft daar alles: alle inkomende klantvragen, alle interne updates, alle to-do's, alle data. Trengo/Monday/Slack worden hooguit één keer per week geopend, niet meer dagelijks.

---

## Het Probleem: Drie Versplinterde Workflows

### 1. Versplinterde inbox
Een klantvraag of intern signaal komt binnen via:
- **Trengo** - WhatsApp/email van klanten
- **Monday** - update op een lead-item, vaak met @mention naar AM of CM
- **Slack** - DM tussen teamleden, of een #client-x kanaal

Een AM moet drie inboxen op orde houden om niets te missen. Eén kanaal vergeten = ticket valt door de mand.

### 2. Versplinterde to-do's
To-do's ontstaan op alle drie plekken:
- Trengo: klant vraagt iets → AM moet actie nemen, vaak in samenspraak met CM
- Monday: AM vraagt CM om een aanpassing via een update
- Slack: heen-en-weer gesprek waar uiteindelijk een actie uit volgt

Geen centrale lijst van "wat moet ik vandaag doen". Geen overzicht per klant. To-do's verdwijnen tussen kanalen.

### 3. Versplinterde interne communicatie tussen AM en CM
Coördinatie tussen account manager en campaign manager loopt door alle drie de tools, vaak voor dezelfde klant tegelijk:
- Slack DM voor snelle vragen
- Monday updates voor formele to-do's
- Trengo notes voor klant-context

Niemand heeft één plek waar de volledige context per klant samenkomt. Een nieuwe teamlid kan onmogelijk de geschiedenis van een klant teruglezen zonder drie tools te doorzoeken.

---

## Strategische Visie

De Hub neemt de operationele controle. De andere tools zakken naar de transportlaag.

**Trengo wordt** de transport layer voor externe klantcommunicatie. WhatsApp en email blijven via Trengo verstuurd, maar conversaties worden gevoerd in de Hub. Niemand opent meer de Trengo UI.

**Monday wordt** de canonical database voor leads, deals en pipeline-data. De CRM-rol blijft, maar updates en interne to-do's verhuizen naar de Hub. Monday wordt alleen nog door Zapier-flows beschreven, niet door mensen.

**Slack wordt** een notificatie-kanaal in de transitiefase en eventueel volledig vervangen door Hub-native chat (per-klant threads, @mentions, reacties). Slack blijft eventueel actief voor externe integraties en niet-klantgerelateerde chat.

**De Hub wordt** de single pane of glass waar het team werkt: unified inbox, unified to-do's, unified per-klant communicatie, unified team chat.

---

## Capability Roadmap (Gefaseerd)

### FASE 0 - Client Edit Layer (Fundament)

Voordat de Hub inboxes en to-do's overneemt, moet eerst de basis kloppen: klantmetadata Hub-canonical maken. Het probleem dat dit oplost is klein maar fundamenteel - een AM/CM moet voor het wijzigen van AM-toewijzing, status, ad budget of Meta ad account ID niet meer Monday hoeven openen.

**Wat:**
- Bewerkbare velden vanuit de Hub: company name, live status, AM, CM, appointment setter, ad budget, service fee, alle 5 IDs (Monday client board, Meta ad account, Stripe customer, Trengo contact, Google Drive folder).
- Edit-locaties:
  - **Clients overview tabel** - inline dropdowns voor live status, AM, CM, setter
  - **Client detail header** - status edit + naam + AM/CM via meta-row
  - **Client detail Settings tab** - volledig "Client Information" panel met alle velden
  - **Global Settings → Clients tab** - zelfde panel, voor alle klanten in één lijst (admin)
- Hub-canonical statussen: `Onboarding` / `Live` / `On Hold` / `Churned`. Monday-varianten ("Subcampaigns only", "Stopt - X", "Debt collecting agency", etc.) collapsen via een mapping naar deze 4. Onboarding-board clients zijn altijd "Onboarding" - afgeleid uit board-membership.
- Auto-update van campaign status: cron checkt dagelijks per Live/On Hold-klant of er actieve Meta campagnes draaien - flipt automatisch tussen `Live` en `On Hold`. `Onboarding` (manual setup) en `Churned` (manual termination) worden nooit overschreven.

**Architectuur:**
- Bestaande `setItemColumnValue()` en nieuwe `setItemColumnValueRaw()` in [src/lib/integrations/monday.ts](src/lib/integrations/monday.ts) - schrijven naar Monday via `change_simple_column_value` (text/number/date) en `change_column_value` (status/person/dropdown).
- `updateClientField()` in [src/lib/clients/edit.ts](src/lib/clients/edit.ts) - high-level helper die de juiste mutation kiest, naar Monday schrijft, en mirrored Supabase-kolommen resyncrt.
- `PATCH /api/clients/[id]` - single endpoint, accepteert discriminated union van field updates.
- `/api/monday/users` + `fetchMondayUsers()` - cached lijst van Monday users zodat AM/CM/setter dropdowns op naam tonen maar IDs sturen.
- Status mapping in [src/lib/clients/status.ts](src/lib/clients/status.ts) - single source of truth voor Hub↔Monday status conversie.

**Status:** Geïmplementeerd. Vormt het fundament waarop Fase A-G voortbouwen.

---

### FASE A - Mirror In (Lees Alles)

Hub laadt alle relevante data uit Trengo, Monday en Slack en presenteert het uniform.

**Wat:**
- Trengo conversations + messages per klant (gedeeltelijk al gebouwd: communication-tab + dedicated inbox page)
- Monday item updates en @mentions per lead, voor alle klanten waar de gebruiker toegang toe heeft
- Slack berichten uit relevante #client-* kanalen + DM's met team
- Per-klant unified view: alle communicatie over klant X in chronologische volgorde, ongeacht kanaal

**Doel:** team kan vanuit één scherm alle context voor een klant zien zonder te switchen.

**Webhooks:** real-time inbound via Trengo webhooks, Monday webhooks, Slack Events API. Geen polling.

---

### FASE B - Reply Out (Schrijf Terug)

Hub mag namens de gebruiker terugschrijven naar de bron. De gebruiker hoeft de bron-UI nooit meer te openen.

**Wat:**
- Reply op Trengo conversation vanuit Hub composer → Trengo API → klant ontvangt WhatsApp/email zoals normaal
- Post Monday update vanuit Hub → Monday API → update verschijnt op het lead-item
- Post Slack message vanuit Hub → Slack API → bericht in kanaal/DM

**Plus:**
- Tone-of-voice templates per AM (Roy WhatsApp ≠ Danny email)
- AI-draft assistance: "draft a reply" → Claude API met klantcontext + AM's tone
- Bijlagen, emoji, reacties

**Doel:** vanaf nu hoeft een AM Trengo niet meer te openen om een klant te beantwoorden.

---

### FASE C - Unified Inbox

Eén inbox, één feed, voor alles wat aandacht vraagt.

**Wat:**
- Eén feed met alle ongelezen items uit Trengo + Monday + Slack
- Filterbaar per kanaal, per klant, per type
- "Mijn inbox" filter: alleen items waarvoor jij verantwoordelijk bent
- Read/unread state gesynced naar bron (Trengo conversation gemarkeerd als gelezen, Slack thread gemarkeerd als read, etc.)
- Snooze, archive, mark-as-read direct vanuit Hub

**Layout:** linksbalk met klanten + badge counts, midden inbox feed, rechts thread view + composer.

**Doel:** "ik open de Hub en zie wat er moet gebeuren" - vervangt het openen van Trengo/Monday/Slack apart.

---

### FASE D - Unified To-Do System

To-do's worden Hub-native. Geen Monday updates of Slack berichten als de-facto to-do-systeem meer.

**Datamodel (Supabase):**
- `tasks` tabel
- Velden: `title`, `description`, `assignee_id`, `client_id`, `status` (open / in_progress / waiting_on / done), `due_date`, `source` (trengo / monday / slack / manual), `source_ref` (URL of ID terug naar bron), `created_by`
- Comments thread per task

**Capabilities:**
- Convert any inbox item naar task in één klik ("Klant vraagt om creatives refresh, deadline vrijdag" → task voor CM)
- Per-klant task lijst zichtbaar op client detail page
- "Mijn to-do's" lijst over alle klanten heen
- AM en CM kunnen elkaar tasks toewijzen
- Optioneel mirroren tijdens transitie: een task in de Hub kan een Monday update mirroren zodat niemand iets mist

**Doel:** elke AM/CM heeft één to-do-lijst, geen inbox-duiken meer om te weten wat te doen.

---

### FASE E - Native Internal Communication

Slack als operationele tool wordt vervangen door Hub-native chat.

**Wat:**
- Per-klant interne thread (zichtbaar op client detail page) - alle AM↔CM gesprekken over die klant op één plek
- Team-brede kanalen (#general, #campaigns) als chat-functionaliteit in Hub
- DM's tussen teamleden
- @mentions, reacties, threading, file uploads
- Notificaties (browser push, email digest, optioneel mobile push)

**Transitie:**
- Eerst: Hub-chat mirrored naar Slack zodat niemand iets mist
- Daarna: Slack-mirror uit, Hub is canonical
- Slack blijft alleen draaien voor: incident notificaties, externe integraties (GitHub, Linear), legacy

**Doel:** klantcontext samenbrengen op de klantpagina i.p.v. verspreid over #client-x kanalen die niemand teruggevonden krijgt.

---

### FASE F - Notificaties die het Team naar de Hub Trekken

Zonder push notifications opent niemand de Hub spontaan. Dit is wat de gewoonte breekt.

**Wat:**
- Browser push notifications voor nieuwe inbox items en task assignments
- Email digest (configureerbaar per gebruiker: realtime / hourly / daily)
- Optionele mobile push (service worker, eventueel later native app)
- Slack-bridge: per gebruiker instelbaar - wil je nog Slack-pings? Aan/uit
- Daily morning digest: "Vandaag staan er 3 to-do's open en 2 nieuwe klantvragen"

**Doel:** team merkt dat ze in de Hub gemist worden als ze hem niet openen - andersom dan voorheen.

---

### FASE G - Decommissioning Daily Use

Trengo/Monday/Slack worden onzichtbare backends.

**Wat:**
- Audit: hoe vaak opent het team nog Trengo/Monday/Slack? (Self-report of via integratie)
- Migratie van workflows die nog in Slack/Monday gebeuren maar Hub-native moeten zijn
- Onboarding-document: "vanaf nu doe je X in de Hub, niet in Slack"
- Slack-channels worden archived of read-only voor klant-coördinatie
- Monday updates worden alleen nog gebruikt door geautomatiseerde flows (Zapier), niet door mensen
- Trengo wordt alleen geopend voor uitzonderingen (bv. WhatsApp Business settings)

**Eindstate:** team logt 1× per week max in op Trengo/Monday/Slack - meestal alleen voor admin of audit.

---

## Toekomstige capability - Appointments tracking (uit Hub gehaald 2026-05)

Per-klant afspraken (booked calls, taken calls, qualification rate, show-up rate, conversion rate, CPA) zijn in mei 2026 uit het klant-facing systeem verwijderd. Niet omdat het concept verkeerd is - het is letterlijk pilaar 2-4 uit het 4-pilaren framework - maar omdat de **onderliggende data niet betrouwbaar genoeg is** om beslissingen op te bouwen:

- Klanten houden Monday's lead-statussen (`Afspraak`, `Kennismaking gehad`, no-show, etc.) niet consistent bij. Sommige klanten doen niets, andere doen het 1 week wel en 2 weken niet.
- Setters / AM's gebruiken eigen kolommen of laten leads gewoon staan na de afspraak.
- Dezelfde "Afspraak" status kan in client A een appointment betekenen en in client B een lead die de telefoon opnam.
- Cost per appointment, show-up rate en conversion rate werden daardoor structureel verkeerd berekend → AI optimisation insights die hierop bouwden waren misleidend → CM's verloren vertrouwen in de cijfers → kolommen werden genegeerd → klutterde de UI alleen maar op.

**Wat eraan vooraf moet voordat we het terugbrengen:**

1. **Monday lead-board normalisatie per klant.** Eén gestandaardiseerd status-schema (`Nieuwe lead` / `Gebeld` / `Afspraak gepland` / `Afspraak gehad` / `No-show` / `Deal` / `Lost`) dat AM's verplicht aanhouden. Geen vrije variaties per klant meer.
2. **Setter/AM enforcement loop.** Hub flagt klanten waar lead-statussen 5+ dagen stilstaan na afspraak-datum, met directe nudge naar verantwoordelijke. Pas valide data leveren is een precondition voor het tonen ervan.
3. **Appointment events ipv status-derivation.** Liever een Calendly-webhook of Trengo-confirmation die direct in onze database een `appointment_event` schrijft, dan Monday status sniffen. Heldere, niet-interpretabele bron.
4. **Per-klant kalibratie van pilaar-benchmarks.** De 75% qualification rate / 80% show-up / 30% conversion benchmarks (knowledge/campaigns.md) zijn industrie-gemiddelden. Hub moet per klant zien wat realistisch is en daarop alarmeren - niet één-size-fits-all.

**Wanneer we het terug aanzetten ziet het er als volgt uit (eindstaat):**

- KPI cards op klantpagina krijgen weer een "Appointments" sectie met QR%, SU%, CR%, CPA - maar alleen wanneer dataquality-score voor die klant > drempel
- Watch List severity weegt CPA mee naast CPL (met recovery-window override zoals nu al voor CPL geldt)
- Pedro Optimisation Proposals genereren acties op basis van waar in de funnel de bottleneck zit (creative / messaging / lead-flow / sales-close) - niet alleen CPL
- Cron schrijft per-klant `kpi_funnel:{mondayItemId}` cache met de 4 pilaren

**Decommissioning (uitgevoerd 2026-05):** alle `appointments` / `costPerAppointment` / `bookedCalls` / `takenCalls` / `costPerBookedCall` / `costPerTakenCall` / `crPercent` velden + bijbehorende UI zijn verwijderd uit KpiSummary, KpiResult, UtmRow, cron, kpi-summaries route, Pedro insights/prompts, AI guardrails. Targets dashboard (RL's eigen sales funnel) is onaangeroerd - die heeft eigen, betrouwbare data via de centrale targets-board.

---

## Toekomstige capability - Meta Embedded Signup voor onboarding (geparkeerd 2026-06-11)

De onboarding-wizard (v3) heeft in Stap 1 een "Meta Business Manager connect" link die de AM met de klant deelt tijdens de kick-off. Vandaag wijst die link naar een Hub-hosted guide page (`/onboard/meta/[id]`) met drie manuele paden - geen BM aanmaken, BM zonder ad account, of klaar voor partner-invite - die de klant zelf doorklikt via Meta's UI.

**Eindstaat:** vervangen door Meta's officiële **Embedded Signup** flow zodat de klant in 60 seconden klaar is: één "Connect with Meta" knop → Meta hostet de hele wizard (BM kiezen of aanmaken, ad account picken, RL als partner accepteren) → callback wires de Meta IDs automatisch in Hub. Hetzelfde wat HubSpot, Klaviyo, Triple Whale gebruiken.

**Wat eraan vooraf moet:**
1. Bestaande Meta App uitbreiden met `business_management` permission (en `pages_manage_metadata` als we ook page-level toegang willen)
2. Per nieuwe permission: korte usecase + screencast (2-5 min) waarin AM Hub-flow demonstreert
3. App Review submission via developers.facebook.com - typisch 5-15 werkdagen doorlooptijd
4. Privacy Policy / ToS staan al; Business Verification al gedaan voor bestaande ads permissions

**Geparkeerd reden (2026-06-11):** App Review zou de huidige onboarding-wizard rollout vertragen. De Hub-hosted guide page werkt voor klant-facing flow, AM weet hoe het manuele pad in elkaar zit. Embedded Signup is een 60-seconden-vs-5-minuten verbetering, niet een capability blocker. Implementeren wanneer (a) we een paar klanten door de huidige flow hebben gehaald en weten waar mensen daadwerkelijk vastlopen, OF (b) we een sales-cycle horen waarin een prospect afhaakt op de Meta-koppeling.

**Swap-in punt** in de code: `src/lib/onboarding/auto-setup.ts` → `buildMetaBmPlaceholderUrl()`. Vervang de return URL met de echte Meta Embedded Signup URL + voeg webhook callback toe op `/api/webhooks/meta/embedded-signup` die de gedeelde ad account ID terugschrijft naar de klant. Geen wijzigingen aan UI nodig - Stap 1 "Resources" sectie blijft hetzelfde, alleen de link erachter verandert.

---

## Supporting Capabilities (Behouden uit v2.0)

De analytische en automatiseringslaag uit de vorige visie blijft, maar wordt ondergeschikt aan de operationele laag. Outputs van deze capabilities verschijnen nu als items in de unified inbox of als tasks in het unified to-do-systeem - niet als losse notificaties in Slack of mailtjes.

### Campaign Health & Watch List
Al gebouwd. Triages active clients per CPL/CPA trend met AI Notes, Insights en Optimisation Proposals. Blijft de "wat heeft mijn aandacht nodig op campagne-niveau" view.

### Automatische Facturatie Flow
Stripe → auto-pause Meta → multi-channel notificaties bij wanbetaling. Notificaties verschijnen in de unified inbox, niet als losse Slack-pings.

### AI Creative Generator
Bij performance-dip → AI genereert nieuwe scripts en copy. Resultaat verschijnt als task in het unified to-do-systeem ("Review nieuwe creatives voor klant X").

### Proactive Client Reporting
Wekelijkse/maandelijkse rapporten worden automatisch gegenereerd. AM krijgt task: "Review report Klant X voordat het verzonden wordt" - geen handmatige samenstelling meer.

### Churn Risk Scoring
Sentiment uit Trengo + payment history + campaign trends → ranglijst van klanten met churn-risico → tasks voor AM ("Inplannen check-in call met Klant X").

### Trengo AI Agent (gereframed)
70% van klantvragen krijgt een AI-draft die in de Hub composer verschijnt. AM reviewed in 5 seconden en stuurt af. AI is geen autonoom systeem dat klanten beantwoordt - het is een drafting layer binnen de Hub.

---

## Wat We NIET Bouwen (En Waarom)

| Feature | Reden |
|---------|-------|
| Eigen WhatsApp Business API | Trengo blijft de transport layer; geen reden om dat te vervangen |
| Eigen email infrastructuur | Idem - Trengo doet het al |
| Volledige Slack-vervanger voor non-RL communicatie | Slack blijft handig voor externe integraties en non-klant chat |
| Autonoom klantvragen beantwoorden zonder review | Te risicovol; AI drafts, mens stuurt af |
| Eigen videocalling | Google Meet/Zoom blijft |
| New Client Wizard in hub | Beter via dedicated onboarding tool |
| Google Ads integratie | Niet prioriteit, mogelijk later |

---

## Architecturale Bouwstenen

### Webhook Ingest Layer
- `POST /api/webhooks/trengo` - ontvangt nieuwe messages, conversation updates
- `POST /api/webhooks/monday` - ontvangt item updates, status changes, mentions
- `POST /api/webhooks/slack` - Events API, message events, mention events
- Elk webhook normaliseert payload → schrijft naar `inbox_events` tabel met source + source_ref

### Realtime Layer
- Supabase Realtime channels per user → frontend luistert op nieuwe inbox events en task changes
- Service Worker voor browser push notifications

### Unified Data Model (Supabase, nieuw)
- `inbox_events` - alle inkomende items, gekoppeld aan client + assignee + source
- `tasks` - Hub-native to-do's
- `threads` - Hub-native interne gesprekken (per-client of team-wide)
- `messages` - berichten binnen threads
- `notification_prefs` - per gebruiker: welke kanalen, welke frequentie
- Bestaande `clients`, `users`, `client_access`, etc. blijven

### Outbound Adapters
- `lib/integrations/trengo.ts` - uitbreiden met `sendMessage()`, `markAsRead()`, `sendInternalNote()`
- `lib/integrations/monday.ts` - uitbreiden met `postUpdate()`, `setStatus()`, `mention()`
- `lib/integrations/slack.ts` - nieuw: `postMessage()`, `replyInThread()`, `addReaction()`

### AI Layer
- Tone-of-voice templates per gebruiker (geleerd uit historische Trengo data)
- Reply drafting via Claude API met cache van klantcontext
- Task auto-creation suggestions: "Deze klantvraag lijkt op een task - aanmaken?"
- Inbox triage: prioriteit scoren, ICP-relevante items naar boven
- Cross-channel deduplication: zelfde klantvraag via Trengo én Slack → één inbox item

---

## Verwachte Impact

### Tijdsbesparing per Rol

| Rol | Huidig | Besparing | Target |
|-----|--------|-----------|--------|
| Account Managers | 40u/week | -20u | 20u/week |
| Campaign Managers | 40u/week | -12u | 28u/week |
| Finance (Arno) | 20u/week | -8u | 12u/week |

Belangrijkste winst: tool-switching elimineren. Een AM die nu tientallen keren per dag wisselt tussen Trengo/Monday/Slack/Hub bespaart structureel 1-2 uur per dag aan context-switching alleen al.

### Marge Impact
- Huidig: 25%
- Target: 60%
- Operationele Hub draagt naar schatting 30 procentpunten bij (rest via AI integraties zoals AI avatars en campagne-automatisering)

### Kwalitatieve Impact
- Snellere klantrespons (alles in één inbox, niets blijft liggen)
- Betere coördinatie AM↔CM (per-klant context volledig zichtbaar)
- Lagere onboarding tijd nieuwe teamleden (één tool leren ipv vier)
- Hogere klantretentie (geen gemiste tickets, betere opvolging)
- Volledige audit trail per klant - alle communicatie en beslissingen op één plek

---

## Ontwikkelprincipes

1. **Hub als canonical UI, externe tools als API:** alles wat een gebruiker doet gebeurt in de Hub; integraties blijven onder de motorkap.
2. **Bidirectionele sync:** Hub schrijft terug naar bron zodat data consistent blijft tijdens transitieperiode. Slack/Trengo/Monday blijven correct werken voor wie er nog inlogt.
3. **Geleidelijke migratie:** elke fase moet werken naast bestaande tools. Geen big-bang vervanging.
4. **Notificatie-gedreven adoptie:** team gebruikt de Hub omdat ze er gepingd worden, niet omdat het moet.
5. **Tone preservation:** AI helpt met drafts, mens stuurt af. Klant mag niets merken van de transitie.
6. **Fail-safe:** webhook-failure mag nooit een ticket laten verdwijnen. Daily reconciliation cron als backstop.

---

## Referentie: Mogelijke Build Volgorde

*Indicatief, geen directe instructie.*

| Sprint | Focus |
|---|---|
| 1-2 | Webhook ingest layer (Trengo + Monday + Slack) → `inbox_events` tabel |
| 3-4 | Per-klant unified view (lees-alles UI op client detail page) |
| 5-6 | Reply out - Trengo composer in Hub |
| 7-8 | Reply out - Monday + Slack composer |
| 9-10 | Unified inbox feed + filtering + read state sync |
| 11-12 | `tasks` tabel + create-from-inbox + per-klant task list |
| 13-14 | Hub-native internal chat (per-klant threads + team channels) |
| 15-16 | Notifications (browser push + email digest) |
| 17-18 | Slack mirror-in voor team chat + transition tooling |
| 19-20 | AI drafting + tone-of-voice templates |
| 21-22 | Decommissioning audit + onboarding docs + Slack mirror-out |

---

## Slotgedachte

De v2.0 visie zag de Hub als slim dashboard met automatiseringen erbovenop. De v3.0 visie ziet de Hub als de werkplek zelf - de plek waar AM's en CM's hun dag beginnen en eindigen. Trengo, Monday en Slack zakken weg naar de onzichtbare laag eronder.

Dit is geen analytics tool meer. Dit is de operationele cockpit voor het hele team.

**Build features alleen wanneer expliciet gevraagd. Dit document is context, geen takenlijst.**
