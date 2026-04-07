# Rocket Leads — Tools & Stack

> **Last updated:** 2026-04-04 05:30 CET
> Dit document beschrijft alle tools, platformen en koppelingen die Rocket Leads gebruikt. Gebruik dit als referentie voor AI agents, onboarding van teamleden, en bij het opzetten van automatiseringen.

---

## Samenvatting

Rocket Leads draait op Meta Ads, Google Ads en TikTok Ads als advertentieplatforms, Monday.com als CRM, Trengo voor klantcommunicatie (WhatsApp + email), Zapier voor alle automatiseringen, Loveable voor landingspagina's, Stripe voor betalingen, PandaDoc voor offertes, Fathom voor meeting recordings, en Google Drive voor klantbestanden. Interne communicatie loopt via Slack.

---

## Advertentieplatforms

### Meta Ads (primair)
- Campagnes worden beheerd via **Meta Ads Manager**
- Toegang loopt via de **Rocket Leads Business Manager** — teamleden zijn hieraan toegevoegd als personen
- **Standaard:** klant voegt hun eigen ad account, pagina, pixel etc. toe door het Business ID van Rocket Leads als partner te koppelen. Rocket Leads teamleden worden dan toegewezen aan het ad account van de klant
- **Alternatief:** als de klant technische problemen heeft (errors, payment issues, niet technisch genoeg) → Rocket Leads gebruikt het eigen vaste ad account (1 account, 1 account ID). Advertentiebudget wordt dan naar de klant gefactureerd
- Voorkeur is altijd het account van de klant — klanten betalen en willen hun eigen data verzamelen

### Google Ads (secundair)
- Zelfde principe: klant heeft eigen Google Ads account en nodigt Rocket Leads uit per email

### TikTok Ads (tertiair)
- Zelfde principe: eigen business manager account per klant, klant nodigt Rocket Leads uit
- Sommige klanten gebruiken het Rocket Leads account — budget wordt dan gefactureerd

---

## CRM & Project Management

### Monday.com
- Gebruikt als **CRM voor klanten** — 1 Monday-bord per klant (soms meerdere borden als klant meerdere bedrijven/producten/diensten heeft)
- Leads komen binnen vanuit Meta Lead Forms, Loveable, of Typeform (via Zapier) → Monday CRM
- Klanten kunnen hun eigen resultaten inzien in hun Monday-bord
- **Updates:** Monday wordt gebruikt met het updates-systeem — taken worden als update in een item gezet, updates kunnen worden afgevinkt
- Sommige grotere klanten hebben hun eigen CRM — dan koppelen we Monday eraan, maar **Rocket Leads werkt nooit in het systeem van de klant**. Altijd in ons eigen Monday-bord
- Bij leadopvolging door Rocket Leads: Monday-bord wordt bovenop het klant-CRM gebruikt voor leadkwalificatie
- In de Rocket Leads Hub: Client Specific Dashboard combineert KPI's van Monday en Meta

<!-- TODO: Roy stuurt een CSV export van een Monday-bord met kolommen en statussen -->

---

## Communicatie

### Trengo (klantcommunicatie)
- Alle klantcommunicatie loopt via Trengo
- Kanalen: **WhatsApp** (via WhatsApp Business API) en **email** — uitsluitend deze twee
- Geen groepsapps
- Elke account manager heeft zijn eigen inbox (WhatsApp inbox + mail inbox)
- Inboxen kunnen makkelijk gedeeld worden (bijv. bij vakantie)

### Google Meet
- Gebruikt voor evaluatie calls en klantmeetings
- Voorkeur boven telefonisch — helpt bij relatieopbouw

### Slack (interne communicatie)
- Alle interne communicatie loopt via Slack
- Communicatie met klanten, partners en leads ook in Slack

---

## Automatisering

### Zapier
- Enige automatiseringstool — geen Make, geen n8n
- Honderden zaps actief (intern + extern voor alle klanten)
- Tier: 50.000 tasks
- **Standaard lead flow per klant:**
  - Trigger: Loveable form (webhook), Meta Lead Form, of Typeform
  - → Zapier
  - → Monday CRM-bord van de klant
  - → Automatisch WhatsApp-bericht naar klant: "Nieuwe lead binnen"
  - → Automatische email naar klant
  - → Automatisch WhatsApp-bericht naar de lead: "Bedankt voor je aanvraag"
- **Calendly-koppeling:** klant koppelt hun Calendly → trigger bij inplannen afspraak → Monday wordt automatisch bijgewerkt, lead krijgt reminder, klant krijgt reminder
- **Email automatiseringen:** per klant bekeken wat relevant is (online afspraken vs showroom afspraken etc.)
- Daarnaast per klant **maatwerk automatiseringen**
- **Transitie:** Rocket Leads maakt de transitie om volledig op Typeform over te stappen als formulierentool

---

## Landingspagina's & Content

### Loveable (landingspagina's)
- Alle klant-landingspagina's worden gebouwd via Loveable
- Betaald account: ~€200 per maand
- ~25 pagina's staan live op dit moment
- Werkwijze: standaard prompt (gebouwd in Claude Chat) → invoeren in Loveable → landingspagina
- Geen Loveable template, wel een vaste prompt
- Landingspagina's staan op Rocket Leads infrastructuur (klant krijgt deze niet mee bij offboarding)
- **Landing.ai** wordt ook nog gebruikt voor sommige landingspagina's — draait nog door, maar transitie gaat volledig naar Loveable

### Content & Creatives
- **Shanna** maakt alle ad creatives, edit video's, en gaat op locatie voor content
- **CapCut** — video editing
- **InVideo Pro** — video editing
- **Canva** — static ads (foto's, afbeeldingen)
- **Manus** (AI tool van Meta) — automatisch advertenties maken
- Bij HTO-pakket: 1x per kwartaal videoshoot op locatie door videograaf
- AI Avatar + onbeperkte high-end variaties (onderdeel van HTO)

### AI Tools
- **ChatGPT** — brainstormen
- **Claude** — diverse taken
- **ElevenLabs** — voiceovers
- **HeyGen / HeyGen Suite** — AI avatars

---

## Betalingen & Facturatie

### Stripe
- Alle betalingen lopen via Stripe
- **Eerste betaling:** altijd via een Payment Link (op aanvraag soms via factuur)
- Flow: klant tekent offerte (PandaDoc) → wordt doorgestuurd naar Payment Link → eerste betaling
- Na eerste betaling: alle klantdetails worden opgeslagen in Stripe
- **Arno (Finance)** pakt het op voor daaropvolgende facturen:
  - Maakt een subscription aan
  - Factuur wordt 7 dagen voor vernieuwing van de maand verstuurd
  - Klant heeft 7 dagen om te betalen
  - Als niet betaald → campagne op hold
- **Opzegtermijn:** 7 dagen — zodra de factuur verzonden is, is het opzegtermijn verlopen

### PandaDoc
- Gebruikt voor het tekenen van offertes en algemene voorwaarden
- Na tekenen → direct doorgestuurd naar Stripe Payment Link

### Beleid bij betalingsproblemen
- We zijn klantvriendelijk — altijd meedenken in het belang van Rocket Leads op de langere termijn
- Soms is het beter om een factuur te crediteren en de campagne op hold te zetten dan hard op de algemene voorwaarden te staan
- Per klant en per case bekijken: wat heeft de klant al gefactureerd, hoe staan ze in de wedstrijd
- Doel: klant komt later terug voor opnieuw een half jaar of jaar samenwerking

---

## Meeting & Recording

### Fathom
- Alle meetings worden opgenomen en getranscribeerd via Fathom
- Transcripts worden op dit moment alleen opgeslagen in Fathom zelf — worden nog nergens naartoe gepusht
- **Plan:** transcripts gaan gecentraliseerd worden voor sales meetings, kick-off meetings en evaluatie meetings om meer data te verzamelen over het salesproces en klanttevredenheid

---

## Bestanden & Opslag

### Google Drive
- Per klant wordt een Google Drive map aangemaakt
- Klant levert hier content aan: logo's, afbeeldingen, beeldmateriaal, bestanden
- Sommige klanten hebben eigen Dropbox of sturen WeTransfer-links
- Google Drive capaciteit: 100 GB — raakt af en toe vol, dan worden oude klanten met grote bestanden opgeruimd (taak van account manager)

---

## Overige tools

- **Rocket Leads Hub** — eigen dashboard/platform
- **Calendly** — klanten koppelen hun Calendly voor afspraakinplanning

---

## Overzicht: Dataflow per klant

```
Klant tekent offerte (PandaDoc)
        ↓
Doorgestuurd naar Stripe Payment Link → eerste betaling
        ↓
Klantdetails opgeslagen in Stripe → Arno regelt subscription
        ↓
Kick-off meeting ingepland (Fathom recording)
        ↓
Google Drive map aangemaakt → klant levert content aan
        ↓
Klant koppelt Meta Business Manager (partner via Business ID)
        ↓
Landingspagina gebouwd (Loveable)
        ↓
Automatiseringen opgezet (Zapier):
    Loveable/Meta Lead Form/Typeform → Zapier → Monday CRM
                                             → WhatsApp naar klant (Trengo)
                                             → Email naar klant (Trengo)
                                             → WhatsApp naar lead (Trengo)
    Calendly koppeling → Monday update + reminders
        ↓
Campagne live in Meta Ads Manager
        ↓
Dagelijkse optimalisatie (Meta Ads Manager)
        ↓
Wekelijks klantcontact (Trengo + Google Meet)
        ↓
Maandags rapportage (Monday dashboard / Hub)
```

---

## Belangrijke nuances voor AI agents

- **Zapier is de enige automatiseringstool** — geen Make, geen n8n
- **Rocket Leads werkt NOOIT in het systeem van de klant** — altijd in eigen Monday-bord
- Landingspagina's staan op **Rocket Leads infrastructuur** — bewust voor client dependency
- **Trengo is het enige kanaal** voor klantcommunicatie (WhatsApp + email)
- Transitie naar **Typeform** als standaard formulierentool is gaande
- **Stripe** is het enige betalingssysteem — eerste betaling altijd via Payment Link
- Elke account manager heeft een eigen Trengo inbox die gedeeld kan worden
- Fathom transcripts worden nog niet automatisch verwerkt — dit is een toekomstig project
