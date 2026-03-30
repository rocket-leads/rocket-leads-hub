# Rocket Leads — Process

> **Last updated:** 2026-03-29
> Dit document beschrijft het volledige klantproces van Rocket Leads: van betaling tot offboarding. Gebruik dit als referentie voor AI agents, onboarding van teamleden, en procesoptimalisatie.

---

## Samenvatting

Het Rocket Leads proces loopt van betaling → kick-off → campagne opzet → livegang → dagelijkse optimalisatie → wekelijks klantcontact → maandelijkse rapportage. De account manager is het enige contactpunt voor de klant. De campagnemanager werkt op de achtergrond en heeft nooit direct klantcontact. Onboarding kan binnen een week maar duurt gemiddeld 4-6 weken (afhankelijk van content productie door de klant).

---

## Fase 1: Betaling & Start

- Er wordt **absoluut niets** gedaan voordat de klant heeft betaald
- Klant betaalt de eerste maand óf het eerste kwartaal vooruit
- Zodra betaling binnen is → kick-off meeting wordt ingepland

---

## Fase 2: Kick-off Meeting

**Wie:** Account manager host de meeting. Campagnemanager zit niet bij de call.

**Voorbereiding:**
- Account manager bespreekt vooraf kort met de klant wat er gaat gebeuren
- Account manager brieft de campagnemanager: "Hé, dit is de klant, dit gaan we hier doen"
- Campagnemanager bereidt zich voor op basis van deze briefing

**Structuur van de kick-off:**
1. **Relatie opbouwen** — We beginnen altijd vriendelijk en persoonlijk
2. **Diepte in de campagne** — Alles wordt besproken:
   - ICP (Ideal Customer Profile) — wie is de ideale klant van de klant?
   - Pijnpunten van de doelgroep
   - Objections die de doelgroep heeft
   - Unique selling points van de klant
   - Propositie en aanbod
   - Advertentiebudget
   - Salesproces van de klant
   - Koppelingen en technische setup
3. **Technische zaken & verwachtingen** — Toegang, systemen, tijdlijn, verwachtingen uitspreken

**Na de kick-off:**
- Google Drive wordt aangemaakt voor de klant
- Klant levert content aan: logo's, afbeeldingen, beeldmateriaal, bestanden
- Klant geeft toegang tot Meta Business Manager
  - Indien klant geen Meta Business Manager heeft of er bugs/errors zijn → Rocket Leads biedt de mogelijkheid om het eigen advertentieaccount te gebruiken (advertentiebudget wordt dan naar de klant gefactureerd)

<!-- TODO: Roy stuurt het kick-off meeting script nog door -->
<!-- TODO: Roy stuurt kick-off meeting recordings/transcripts door -->

---

## Fase 3: Campagne Opzet

**Stap 1 — Marketing angles bepalen**
- Op basis van ervaring en een interne sheet met winning marketing angles per branche
- Vast framework voor het kiezen van de juiste hooks en invalshoeken

<!-- TODO: Roy stuurt de sheet met winning marketing angles door -->

**Stap 2 — Video scripts schrijven**
- Scripts worden geschreven op basis van de gekozen marketing angles
- Klant krijgt scripts ter feedback om te checken of positionering en doelgroep kloppen

**Stap 3 — Content productie**
- Klant neemt video's op (zelf, door Rocket Leads op locatie, of door een derde partij)
- Dit is vaak de fase waar de meeste vertraging zit — afhankelijk van de klant

**Stap 4 — Landingspagina bouwen**
- Gebouwd via **Loveable**
- Er is een standaard prompt (gebouwd in Claude Chat) die in Loveable wordt ingevoerd
- Hieruit komt de landingspagina
- Geen Loveable template, wel een vaste prompt

<!-- TODO: Landingspagina-prompt documenteren of linken -->

**Stap 5 — Ad copy & creatives maken**
- Ad copy wordt geschreven door het team
- Creatives worden gemaakt door Shanna (graphic designer)

**Stap 6 — Feedback ronde**
- Alles wordt voorgelegd aan de klant: ad copies, ad creatives, landingspagina's
- Meestal één feedbackronde, soms meer
- Als de klant feedback geeft die ingaat tegen wat wij weten dat werkt, leggen we uit waarom we bepaalde keuzes maken

**Stap 7 — Automatiseringen & koppelingen opzetten**
- Gedaan via **Zapier**
- Standaard flow: Loveable form (webhook) of Meta Lead Form → Zapier → Monday CRM-bord van de klant
- Vanuit Monday CRM:
  - Automatisch WhatsApp-bericht naar de klant: "Er is een nieuwe lead binnen"
  - Automatische email naar de klant met dezelfde notificatie
  - Automatisch WhatsApp-bericht naar de lead: "Bedankt voor je aanvraag, we nemen zo snel mogelijk contact met je op"
- Daarnaast worden er per klant **op maat gemaakte automatiseringen** gebouwd — dit is niet copy-paste, verschilt per klant

**Stap 8 — Campagne bouwen in Meta**
- Vaste campagnestructuur (zie hieronder)
- Campagne wordt gebouwd en ingepland voor **de volgende dag** — nooit dezelfde avond live

---

## Vaste Campagnestructuur (Meta)

**Standaard setup:**
- **1 campagne** — ABO (Ad Set Budget Optimization)
- **1 ad set** — volledig open targeting:
  - Geen interesses
  - Advantage+ aan
  - Leeftijd open (tenzij echt relevant voor de klant)
  - Locatie: afhankelijk van klant (vaak heel Nederland, soms + Vlaanderen, soms lokaal/regionaal)
- **4-5 ads** onder de ad set
- Extra ads worden achter de hand gehouden om later te testen

**Voor klanten met meer budget (€100+/dag, €3.000+/maand):**
- Aanvullend een **CBO-campagne** (Campaign Budget Optimization)
- Alle winnende ads en ad sets worden hierin samengevoegd op een hoger budget
- Doel: sneller opschalen in budget

---

## Fase 4: Dagelijkse Optimalisatie

De campagnemanager kijkt **elke dag** naar alle accounts en ad sets.

**Optimalisatie-acties (3 opties):**

1. **Nieuwe doelgroepen toevoegen**
   - Ad set dupliceren en interesses toevoegen (gerelateerd aan de ICP)
   - Soms is het opnieuw publiceren van ads al voldoende voor een boost

2. **Nieuwe ads toevoegen**
   - Nieuwe creatives in dezelfde ad set lanceren
   - Of een nieuwe ad set maken met nieuwe creatives

3. **Budget verhogen**
   - Maximaal **20% per dag** in dezelfde ad set
   - Of de ad set dupliceren met een hoger budget (zelfde ads)

**Wanneer een nieuwe marketing angle nodig is:**
- Als meerdere creatives op dezelfde invalshoek zijn getest en geen daarvan werkt
- Soms is het niet een compleet nieuwe angle maar dezelfde angle met een andere copy of creatieve uitvoering

**Creative refresh:**
- Klanten krijgen **elke maand** nieuwe creatives en ad copy
- Focus ligt op creatives — ad copy heeft minder impact dan de creative zelf

---

## Fase 5: Klantcontact & Evaluatie

**Frequentie:** Wekelijks contact met de klant

**Kanalen (verschilt per klant):**
- Google Meet (voorkeur — helpt bij relatieopbouw)
- Telefonisch
- WhatsApp (via Trengo, WhatsApp Business API)
- Email (via Trengo)
- Geen groepsapps — alles via Trengo tickets

**Evaluatie calls:**
- ~30 minuten
- Format: "Wat gaat er goed? Wat kan er beter?"
- Feedback van klant wordt opgehaald
- Account manager stelt aanpassingen voor op basis van feedback
- **Campagnemanager zit hier nooit bij** — campagnemanager heeft nooit direct contact of meetings met de klant

**Wie doet wat:**
- Account manager = enige klantcontactpunt
- Campagnemanager = achter de schermen, geen klantcontact

---

## Fase 6: Rapportage

**Wekelijks:**
- Elke maandag worden de resultaten van de afgelopen week naar de klant gestuurd
- Doel: professionelere aanpak via de Rocket Leads Hub

**Klant dashboard:**
- Klanten kunnen resultaten inzien in hun eigen Monday-bord
- In de Hub: Client Specific Dashboard waar KPI's van Monday en Meta worden samengebracht
- Geen screenshots — alles via dashboards

---

## Fase 7: Offboarding

Als een klant opzegt:
- Automatiseringen worden uitgezet
- Landingspagina's gaan offline
- Monday-bord wordt losgekoppeld
- De volledige stack wordt eruit getrokken

**Wat de klant WEL behoudt:**
- Toegang tot hun eigen ad account (als campagnes via hun Meta Business Manager draaiden)

**Wat de klant NIET meekrijgt:**
- Landingspagina's
- Creatives
- Automatiseringen (Zapier flows)
- Monday CRM-bord
- Alles wat Rocket Leads heeft gebouwd

---

## Client Dependency (strategisch principe)

Klantafhankelijkheid is een kernprincipe van Rocket Leads. Alles wat we bouwen is erop gericht om klanten zo afhankelijk mogelijk van ons te maken:

- Landingspagina's staan op onze infrastructuur
- Automatiseringen draaien via onze Zapier
- CRM-bord is door ons opgezet en beheerd
- Creatives en content blijven bij ons

**Waarom:** Als een klant stopt, wordt de hele strategie eruit getrokken. Dit beschermt onze MRR en zorgt voor klantretentie. Zonder Rocket Leads kan de klant niet zelfstandig verder draaien — en dat is by design.

Dit principe wordt doorgevoerd in alles: de Hub, de automatiseringen, de tooling. Hoe meer we bouwen, hoe afhankelijker de klant wordt.

---

## Fase 8: Escalatie

**Bij klantontevredenheid:**
- **Snelheid is alles** — direct de telefoon pakken en bellen
- Account manager is zelf verantwoordelijk om ontevredenheid op te pakken
- Bij verdere escalatie: Arno (Finance) kan meekijken
- Roel is eindverantwoordelijk voor de hele delivery en neemt ownership als het nodig is

**Wanneer Rocket Leads zelf de samenwerking beëindigt:**
- Als een klant **disrespectvol** is — dat wordt niet geaccepteerd
- Als een klant **onrealistische verwachtingen** heeft voor de prijs die ze betalen
- Als verwachtingen fundamenteel niet in lijn liggen met wat Rocket Leads kan leveren

---

## Tijdlijn overzicht

| Fase | Doorlooptijd | Afhankelijk van |
|------|-------------|-----------------|
| Betaling → Kick-off | 1-3 dagen | Planning account manager |
| Kick-off → Campagne opzet | 3-7 dagen | Snelheid team |
| Content productie | 1-3 weken | Klant (grootste vertraging) |
| Feedback ronde | 1-3 dagen | Klant responstijd |
| Campagne live | Volgende dag na goedkeuring | Meta review |
| **Totaal: tekenen → live** | **1-6 weken** | **Vooral afhankelijk van klant** |

---

## Belangrijke nuances voor AI agents

- **Er wordt NIETS gedaan zonder betaling** — dit is niet onderhandelbaar
- De **account manager is het enige klantcontactpunt** — campagnemanager werkt altijd op de achtergrond
- Vertraging in onboarding ligt **vrijwel altijd bij de klant** (content aanleveren, video's opnemen)
- Automatiseringen zijn **per klant maatwerk** — er is een standaard basisflow maar elke klant heeft custom koppelingen
- Optimalisatie is **dagelijks** — niet wekelijks of maandelijks
- Budget wordt maximaal **20% per dag** verhoogd
- Bij offboarding krijgt de klant **niets mee** — geen campagnes, geen landingspagina's, geen creatives

---

## Onboarding Roadblocks & Oplossingen

### 1. Klant heeft geen goede marketing angles
- Bespreek met campagnemanager en brainstorm nieuwe angles op basis van ervaring
- Account manager stelt nieuwe angles voor aan de klant (dit is een onderhandeling)
- Educeer de klant over het belang van een goed aanbod en goede angles
- Laatste optie: testen met de "matige" angles, maar maak klant bewust dat resultaat niet gegarandeerd is — eventueel garantie intrekken wegens "geen vrijheid in strategie"

### 2. Klant heeft geen goede foto's/video's
- **Optie A:** Push klant om betere content aan te leveren. Alles is beter dan stock (kantoor, team, zijzelf)
- **Optie B:** Laat klant video's opnemen op basis van onze scripts (telefoon is prima). Wij editen + ondertiteling
- **Optie C (laatste optie):** Stock content via Canva of ChatGPT-gegenereerde afbeeldingen. Maak klant bewust dat dit niet goed is voor resultaat

### 3. Klant kan Meta Business Manager niet koppelen (restricted/no access/incapable)
- Gebruik het Rocket Leads ad account ("Clients Rocket Leads")
- Communiceer dit met de klant: wij koppelen onze credit card en factureren het adbudget
- In Monday: status aanpassen naar "Rocket Leads" + adbudget van "Client" naar "RL"
- Pagina & pixel worden door ons aangemaakt, geen koppeling nodig

### 4. Betalingsmethode problemen in Meta
- Ga naar de payment settings in Meta Business Settings
- Check of klant een betaalmethode heeft (voorkeur: credit card of PayPal, bankoverschrijving is lastiger)

### 5. Ad account disabled tijdens onboarding
- Dit is **normaal** — security maatregel van Meta, gebeurt bij 1 op de 3 nieuwe accounts
- Klant moet identiteit verifiëren via Meta Business Settings → Ad accounts → "See details"
- Na verificatie verdwijnt de restrictie. Zo niet → contact Meta

### 6. Klant reageert niet meer tijdens onboarding
- Probeer meerdere keren via telefoon, mail en WhatsApp (minimaal 3-4 pogingen per kanaal)
- Laatste bericht: "Ik heb meerdere keren geprobeerd contact op te nemen. Ik begin me een beetje zorgen te maken. Kun je even laten weten of je de samenwerking wilt voortzetten ja/nee?"
- Heeft betaald? → Wachten tot ze reageren, hun verlies
- Heeft niet betaald? → Niet meer geïnteresseerd. Contact sales (de closer die de deal sloot) en samen oplossen

### 7. Klant micromanaged de deliverables te veel
- Account manager moet "leading" zijn, niet "being led"
- Frame: "Wij schrijven onze copies en bouwen onze landingspagina's op basis van ervaring en wat werkt bij andere campagnes"
- Bij garantie: "Het wordt lastig een garantie te geven op een campagne die wij niet volledig zelf hebben opgezet"
- Samen met campagnemanager beslissen welke aanpassingen wel/niet implementeren
- Soms is het goed om de klant te pleasen, soms is het beter om bij de strategie te blijven

### 8. Video opname door klant duurt te lang
- Start met andere creatives als de klant akkoord is → voorkom dat onboarding maanden duurt
- Vaak een teken van uitstelgedrag of perfectionisme
- Geef aan dat filmen met een telefoon al voldoende is

---

## Customer Journey — Contactmomenten

### Tijdens onboarding (overcommuniceer!)
1. **Kick-off meeting** (1 uur) → vertel klant dat het max 1 week duurt voor eerste draft
2. **Facebook BM koppeling** → als het na 2-3 dagen niet gelukt is, stuur een bericht
3. **PDF doorsturen** → zodra landingspagina + advertenties klaar zijn. Duurt het langer dan 1 week? Informeer de klant!
4. **Feedback verwerkt** → informeer klant dat het verwerkt is en wanneer ads LIVE gaan

### Eerste 5 dagen na livegang — ELKE DAG contact
- **Leads binnen?** → Vertel dat er leads zijn en vraag update over kwaliteit
- **Geen leads?** → Geef update over campagne en optimalisatie. Leg uit wat je doet en waarom. Dit stelt de klant gerust

### Evaluatie momenten
- **Binnen 7 dagen:** Korte evaluatie eerste 2 weken (Zoom of telefoon)
- **Later in eerste maand:** Evaluatie van de afgelopen maand + wat gaan we verbeteren
- **Einde elke maand:** Maandelijkse evaluatie + plan voor komende maand

### Tussentijds contact
- Wekelijks of tweewekelijks een bericht: hoe gaat het, zijn de leads goed, tevreden?
- Kan ook iets persoonlijks zijn om relatie op te bouwen (weekend, vakantie, F1, voetbal)

---

## Account Manager Kernprincipes

### Communicatieregels
- **Nooit langer dan 24 uur wachten** met reageren — ook als je geen tijd hebt, vertel wanneer je terugkomt
- **Altijd één stap voor op de klant** — klant mag nooit het gevoel hebben dat ze ons moeten trekken
- **Overcommuniceer** — klant moet altijd weten wat we doen. Als we niets laten horen, denkt de klant dat we niets doen
- **Gemiste oproep?** Binnen 24 uur terugbellen of bericht sturen
- **Beloftes nakomen** — als je zegt dat je iets doet, doe het. Lukt het niet? Communiceer dat

### Resultaat tonen
- Goed werk is niet genoeg — **laat zien** dat we goed werk leveren
- Bij wekelijkse calls: benadruk de wins, focus op wat goed ging
- Bij teleurstellende resultaten: zorg voor een duidelijk plan en toon vertrouwen
- Je mag een beetje overdrijven als het goed gaat — laat de waarde zien

### Relatie opbouwen (word vrienden met klanten)
- Gebruik kick-off om ijs te breken — gooi er een grapje in
- Zoek naar gedeelde interesses (F1, voetbal, reizen, etc.)
- Maak het persoonlijk — praat over je eigen leven, vraag naar hun leven
- Complimenteer hun bedrijf (klanten vinden dit altijd leuk)
- **Maak Rocket Leads onvervangbaar:** help met sales tips, bedrijfsadvies, automatiseringen, referrals uit eigen netwerk — weinig moeite maar toont betrokkenheid

### Omgaan met verwachtingen
- Wees eerlijk over tijdlijnen en wat realistisch is
- Frame al vroeg dat het even kan duren om de perfecte marketing angle te vinden
- Zelfs als er geen resultaat is: laat de klant weten wat er gebeurt
- **Underpromise, overdeliver** — doe altijd meer dan de klant verwacht

### Samenwerking met campagnemanager
- Regelmatige interne meetings om aligned te blijven
- Als je klant een deadline belooft (bijv. vrijdag) → zeg tegen campagnemanager dat het woensdag af moet zijn (flexibiliteit)
- Communiceer duidelijk wat de klant verwacht zodat de campagnemanager daarop kan sturen

### Potentiële bottlenecks als account manager
- Meerdere klantrelaties managen → gebruik Monday updates, plan check-ins, gebruik templates
- Juiste verwachtingen zetten → eerlijk over tijdlijnen, frame vroeg
- Communicatie met campagnemanager → regelmatige interne meetings
- Deadlines en deliverables bijhouden → niet overpromisen, buffer inbouwen
- Teleurstellende campagnes → proactief issues benoemen, oplossingen bieden, vertrouwen tonen
- Rocket Leads processen leren → vraag altijd vragen, nooit te veel vragen

---

## Juridische context

### Bedrijfsgegevens
- **Entiteit:** Rocket Leads Ltd.
- **Geregistreerd in:** Bulgarije
- **UIC:** 208169940
- **Adres:** Lavele Str. 19, 1000 Sofia, Bulgarije

### BTW
- Klant met geldig BTW-nummer (goedgekeurd door Stripe) → 0% BTW
- Klant zonder geldig BTW-nummer → 20% BTW (Bulgarije = HQ)
- Klant moet ALTIJD bij betaling het formulier invullen als zakelijke klant + BTW-nummer invoeren
- Als BTW-nummer niet werkt in Stripe → handmatige factuur maken, BTW-nummer opvragen en verifiëren

### Contractueel
- Offerte: 60 dagen geldig
- Minimale contractduur: 1 maand (tenzij anders afgesproken)
- Na contractperiode: automatisch voortgezet als onbepaalde tijd
- Opzegtermijn: 7 dagen voor einde van de maand
- Annulering na tekenen maar vóór kick-off: 25% creditering
- Annulering ná kick-off: volledige betaling verschuldigd
- Alle IP-rechten blijven eigendom van Rocket Leads
