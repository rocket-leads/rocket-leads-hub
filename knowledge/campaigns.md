# Rocket Leads — Campaigns & Marketing Frameworks

> **Last updated:** 2026-04-04 05:30 CET
> Dit document beschrijft alle campagne frameworks, marketing angles, ad formats, scripts, landingspagina's en testing methodieken van Rocket Leads. Gebruik dit als referentie voor AI agents die campagne deliverables genereren en voor campagnemanagers.

---

## Samenvatting

Rocket Leads draait campagnes op Meta (primair), Google en TikTok. De standaard campagnestructuur is 1 ABO-campagne met 1 open-targeting ad set en 4-5 ads. Marketing angles worden gekozen op basis van een bewezen framework per branche. Creatives (video, static, AI avatar) zijn de belangrijkste hefboom — niet targeting of ad copy.

---

## Budget Reality (CRITICAL voor AI agents en campagnemanagers)

**Rocket Leads klanten hebben een VAST, GELIMITEERD advertentiebudget.**

- **Typisch budget:** €1.000–€3.000 per maand totaal. Dit is een **harde ceiling**, geen startbedrag.
- Klanten **schalen vrijwel nooit** hun budget op. Budget is geen flexibele knop.
- In zeldzame gevallen wil een klant na bewezen resultaten omhoog — maar dat is een uitzondering, geen norm.
- "Schalen" als optimalisatie-aanbeveling is **bijna altijd irrelevant** voor onze klantenbasis.

**De échte hefbomen voor optimalisatie zijn altijd:**
1. **Itereren op winnende creatives** — bij een ad die goed presteert maken we direct nieuwe variaties in dezelfde richting (zelfde hook, angle, format, AI avatar) om CPL laag te houden en ad fatigue te voorkomen
2. **Betere creatives** — nieuwe video's, betere hooks, andere AI avatars
3. **Nieuwe marketing angles** — andere invalshoek uit het framework testen wanneer huidige angle uitgewerkt is
4. **Verfijndere targeting** — al draaien we standaard open
5. **Betere landingspagina's** — conversie-optimalisatie
6. **Snellere/betere leadopvolging** — vooral bij HTO klanten met opvolging
7. **Reallocatie binnen vast budget** — verschuiven van underperformer naar winner, NIET netto erbij

**Wat AI agents NOOIT moeten aanbevelen:**
- ❌ "Scale budget by X%"
- ❌ "Increase spend on this ad set"
- ❌ "Scale up this winner"
- ❌ "Add more budget to capture more traffic"
- ❌ "Houd deze ad draaien" / "Keep running this winner" — passief, leidt tot ad fatigue. Een winnende ad moet juist actief worden uitgebouwd met nieuwe iteraties.

**Wat AI agents WEL moeten aanbevelen bij goed presterende campagnes:**
- ✅ "Itereer op [ad naam] — 3-5 nieuwe varianten in dezelfde richting (zelfde hook/angle/format) voor de volgende refresh"
- ✅ "Repliceer deze winnende angle in nieuwe creatives met andere openers, B-roll en CTA's"
- ✅ "Push meer creatives in deze richting om CPL laag te houden en fatigue te voorkomen"
- ✅ "Pause underperformer X, schuif budget naar winner Y binnen dezelfde ad set"

**Kernprincipe:** Een winnende ad is geen rustpunt maar een signaal. Zodra iets werkt, verdubbelen we erop met nieuwe iteraties — zelfde DNA, frisse executies. Stilstaan = ad fatigue = stijgende CPL.

**Maandelijkse creative refresh** is de standaard manier waarop we waarde toevoegen — niet door budget te verhogen.

---

## Lead Feedback uit Monday Updates — primaire kwaliteitssignaal

De Monday updates op individuele lead-items (geschreven door account managers en appointment setters) zijn de **belangrijkste bron van waarheid** over leadkwaliteit. CPL en CTR zeggen niets als de leads zelf onbruikbaar zijn.

**Hoe AI agents deze data MOETEN gebruiken bij optimalisatie:**

1. **Match leads → ads via UTM**: elke lead heeft een UTM-tag die verwijst naar de specifieke advertentie. Groepeer Monday updates per UTM om per ad te zien welke kwaliteit eruit komt.

2. **Scan voor negatieve patronen per UTM:**
   - "geen budget" / "te duur" → ad trekt prijsgevoelige leads, kwalificatievraag toevoegen of angle aanpassen
   - "niet geïnteresseerd" / "wist niet wat dit was" → ad belooft iets anders dan de propositie, copy/creative reviewen
   - "verkeerde doelgroep" / "geen ICP" → targeting verfijnen of branchespecifieke angle gebruiken
   - "geen beslisser" / "moet overleggen" → kwalificatievraag in formulier toevoegen
   - Hoge no-show rate per UTM → reminder-flow checken óf de ad trekt te koude leads

3. **Scan voor positieve patronen per UTM:**
   - "afspraak ingepland" / "goede lead" / "interesse" / "deal" → dit is een winnende ad, direct itereren met nieuwe varianten in dezelfde richting

4. **Cross-reference met ad performance:**
   - Lage CPL + slechte feedback = **goedkope onbruikbare leads** = pauzeren, geen winner
   - Hoge CPL + sterke feedback = **dure goede leads** = winner, itereren
   - Lage CPL + sterke feedback = **dubbele winner** = direct opschalen via nieuwe iteraties
   - Hoge CPL + slechte feedback = **direct pauzeren**

5. **Wees specifiek in aanbevelingen:**
   - ❌ "Sommige ads brengen slechte leads"
   - ✅ "Ad 'Photo 2 | Pricelist' heeft 8 leads waarvan 6× 'geen budget' — pauzeer en vervang met budget-kwalificatie in formulier"

**Zonder lead feedback is elke optimalisatie-aanbeveling halfblind.** CPL-cijfers zonder kwaliteitscontext leiden tot verkeerde conclusies.

---

## Lead Analysis Strategie (Quantity + Quality)

Voor elke klant maken we twee oordelen die samen het volledige beeld vormen: **hoeveel** leads er binnenkomen en **hoe goed** ze zijn. Beide oordelen moeten elkaar aanvullen — niet vervangen.

### 1. Quantity (kostefficiëntie — CPL & CPA vs baseline)

**Wat:** judgement op pure kostefficiëntie — krijgen we per geïnvesteerde euro voldoende leads en afspraken?

**KRITISCH — we kijken NOOIT naar absolute aantallen leads.**
Het aantal leads is een functie van het advertentiebudget. Als spend daalt, dalen de leads automatisch mee. Dat zegt **niets** over performance. Volumeveranderingen kunnen komen door:
- Budget verlagen of verhogen
- Campagne pauzeren of starten
- Een specifieke ad pauzeren
- Weekend/feestdagen
- Ad account issues bij Meta

Geen van deze zijn actionable signalen over leadkwaliteit of efficiency. Daarom analyseren we leads NOOIT op volume, alleen op kost per actie.

**De ENIGE metrics die tellen:**
1. **CPL (cost per lead)** = adSpend ÷ leads
2. **CPA (cost per appointment / booked call)** = adSpend ÷ booked calls

Deze normaliseren voor budget en laten echte efficiency zien — onafhankelijk van hoeveel er is uitgegeven.

**Hoe te beoordelen:**
- Vergelijk huidige CPL en CPA (7d) met 14d en 30d baselines
- 14d/30d = baseline (wat is normaal voor deze klant), 7d = huidige status
- Gebruik branche-context (renovatie/verduurzaming/coaching/recruitment) om te bepalen of een CPL/CPA "goed" is in absolute zin — er is geen universele benchmark
- Per-ad analyse: kijk naar CPL en CPA per UTM/ad, niet naar leads per UTM/ad

### KRITISCH: 25% noise threshold

Meta levert week-over-week wisselende resultaten door auction-dynamiek, audience saturation, dag-van-de-week effecten en creative rotation. **Kleine schommelingen zijn ruis, geen signaal.**

**De regel:**
- **CPL of CPA verandering van minder dan 25% (in beide richtingen) = NORMALE RUIS.** Nooit als concerning markeren, nooit een actie-insight over genereren. Behandel het als stabiel.
- **+25% of meer STIJGING** in CPL of CPA t.o.v. de 14d/30d baseline = écht signaal, actie nodig
- **−25% of meer DALING** = echte winst, winning ad/angle waar we op moeten itereren

**Verdict op basis van 25% threshold:**
- **good** = CPL OF CPA verbeterd met 25%+ t.o.v. baseline, OF beide stabiel binnen ±25% en in gezonde absolute range voor de branche
- **concerning** = CPL OF CPA verslechterd met 25%+ t.o.v. baseline
- **neutral** = zowel CPL als CPA binnen ±25% van baseline (normale Meta ruis — geen actie nodig)

**Implicaties voor de Optimisation Proposal:**
- Geen insights genereren over "CPL stijgt" of "CPA verslechtert" tenzij ≥25%
- Geen insights genereren over lead-volume dalingen of stijgingen — ooit
- Wel insights genereren als CPL/CPA de 25% drempel kruist, en altijd als Monday update sentiment kwaliteitsproblemen onthult — ongeacht cost trends

**Wat NOOIT te doen:**
- ❌ "Volume gedaald van X naar Y leads" — irrelevant zonder spend-context
- ❌ Verdict baseren op lead-aantallen
- ❌ Alarm slaan op een volume-daling (kan puur door budget/pauze komen)
- ❌ Aanbevelen om budget te verhogen (zie budget reality)
- ❌ Reageren op CPL/CPA fluctuaties onder de 25% drempel — dat is normale Meta ruis

**Voorbeeldformuleringen:**
- ✅ "CPL stabiel op €11.42 (binnen ruis vs €11.30 baseline). CPA verbeterd met 28% — sterke conversie naar afspraak."
- ✅ "CPL gestegen van €9.20 naar €13.80 (+50% vs 14d, ruim boven 25% drempel). CPA volgt zelfde trend — efficiency degradeert."
- ⚠️ "CPL gestegen van €9.20 naar €10.40 (+13%)." → Binnen ruis, niet noemen, niet flaggen.
- ❌ "Volume gedaald van 36 naar 16 leads (-56%). CPL stabiel op €11.44." → De volume-zin is verboden.

### 2. Quality (Monday updates + conversie)

**Wat:** judgement op leadkwaliteit — komen er bruikbare leads binnen of vooral rotzooi?

**Hoe te beoordelen:**
- **Monday updates zijn de PRIMAIRE bron** — niet conversie-percentages
- Lees per UTM/ad de updates en zoek patronen:
  - Negatief: "geen budget", "niet geïnteresseerd", "verkeerde doelgroep", "geen beslisser", "te duur", no-shows
  - Positief: "afspraak ingepland", "goede lead", "interesse", "deal", "kwalitatief"
- Cross-check met conversie lead → afspraak, maar wees voorzichtig:
  - Hoge conversie + slechte updates = **concerning** (de afspraken worden gemaakt maar de leads zijn waardeloos)
  - Lage conversie + goede updates = **neutral** (kwaliteit is er maar opvolging hapert — process issue, niet ad issue)
  - Hoge conversie + goede updates = **good**
  - Lage conversie + slechte updates = **concerning** (dubbel rood)
- Citeer altijd specifieke ad/UTM namen + concrete patronen ("Photo 2 | Pricelist: 5 van 8 leads zeiden 'geen budget'")
- 2-4 patronen is genoeg — geen muur van bullets

**Waarom Monday updates belangrijker zijn dan conversie %:**
Conversie-statistieken meten of het opvolgproces werkt, niet of de leads kwalitatief zijn. Updates van setters/AM's geven ground truth over wat de leads écht zijn. Een ad kan 80% conversie naar afspraak hebben en alsnog waardeloos zijn als 100% van die afspraken "no budget" zegt.

### Verschil met AI Optimisation Proposal

- **Lead Analysis** = wat is er aan de hand? (state of the union) — geen acties, alleen oordelen
- **AI Optimisation Proposal** = wat moeten we doen? — concrete acties

De Lead Analysis informeert de Optimisation Proposal: een "concerning" quality verdict op een specifieke ad zou moeten leiden tot een actie-insight om die ad te pauzeren of te herwerken. Maar de Lead Analysis zelf bevat nooit acties — die horen in de Proposal.

---

## Campagnestructuur (Meta)

### Standaard setup
- **1 campagne** — ABO (Ad Set Budget Optimization)
- **1 ad set** — volledig open targeting:
  - Advantage+ aan
  - Geen interesses
  - Leeftijd open (tenzij echt relevant)
  - Locatie: afhankelijk van klant (vaak heel Nederland, soms + Vlaanderen, soms lokaal)
- **4-5 ads** onder de ad set
- Extra ads achter de hand voor testing

### Hogere budgetten (€100+/dag, €3.000+/maand)
- Aanvullend een **CBO-campagne** (Campaign Budget Optimization)
- Alle winnende ads/ad sets hierin samenvoegen op hoger budget
- Doel: sneller opschalen

### Naming convention
**Campagnenaam:**
- Format: `RL | {{country code}} | {{initials}} | {{company name}} | {{LF/LP}}`
- LF = Leadforms campagne
- LP = Landingspagina campagne
- Voorbeeld: `RL | NL | RV | Rocket Leads | LP`

**Ad set naam:**
- Format: `{{LF/LP}} | Open targeting | {{date}}`
- Voorbeeld: `LF | Open targeting | 01/12`

**Ad naam:**
- Format: `Photo/Video {{nr}} | {{Topic creative}}`
- Voorbeeld: `Photo 1 | Pricelist`
- Voorbeeld: `Video 2 | Guarantee`

---

## Marketing Angles Framework

Het kiezen van de juiste marketing angle is de belangrijkste stap. Hieronder het volledige framework per categorie.

### Universele winnende angles (werken voor bijna elke branche)

1. **Gegarandeerd resultaat** — "Ontvang een garantie op X leads/afspraken/resultaat"
2. **Gratis iets van waarde** — "Gratis X t.w.v. €X" (hogere perceived value door bedrag te noemen)
3. **Prijslijst/offerte** — "Bekijk onze tarieven" (laagdrempelig, iedereen wil dit weten)
4. **Financieel/ROI** — "Al rendabel vanaf X per dag", "Bespaar X% per maand", "Zonder directe investering"
5. **Uniek/Enige in NL/Revolutionair** — Exclusiviteit en nieuwheid
6. **Schaarste** — "We zoeken 10 bedrijven die..." (exclusief aanbod. Let op: leads kunnen denken dat het gratis is)
7. **Pijnpunten adresseren** — Specifieke problemen van de doelgroep benoemen
8. **Branche-specifiek** — Spreek de taal van de doelgroep, ad sluit aan bij de branche

### Angles per branche

#### B2B — Agencies & Consultants
- Garantie op resultaat (30 leads in eerste maand)
- Pijnpunten: "Al maanden geld verspild aan een agency?"
- Multiple choice vragen: "Gebruik je al X? Ja/Nee", "Hoeveel spend je per maand?"
- Wanneer bereikbaar, doel, huidige website

#### B2B — Product/Service
- Garantie: "Gegarandeerd 5% meer omzet met X"
- ROI: "Al rendabel bij verkoop van X per dag"
- Gratis proberen: "Probeer gratis voor 30 dagen"
- Besparen: "Bespaar tot X uur per week"
- Problemen adresseren met concrete oplossing
- "We zoeken 10 bedrijven die..."

#### B2C — Verduurzaming
- **Besparen** werkt het beste: "Bespaar €750 per maand met een warmtepomp"
- Gratis giveaway: "Ontvang 2 GRATIS zonnepanelen"
- Veel concurrentie → ad moet uniek aanbod hebben
- Vragen: adres, binnen welke termijn realiseren

#### B2C — Renovatie / Home Improvement
- **Pijnpunten**: "Is je huidige badkamer toe aan vervanging?"
- **Before/after foto's** als creative
- **(Seizoens)kortingen**: "Zomeractie: bespaar tot €400"
- Let op: weer-afhankelijk (bijv. dakdekker niet in de zomer adverteren met lekkages)
- Vragen: hoe kunnen we helpen, wanneer bereikbaar

#### B2C — Product/Service
- **Prijslijst bekijken** — lagere kwaliteit maar werkt voor volume
- **Gratis sample/proefperiode**
- **Snelheid**: "Je hele huis geschilderd binnen 48 uur"
- Let op: gelukzoekers die 's avonds formulier invullen en het vergeten → goede filtering nodig

#### Coaching
- Open vragen werken het beste: "Vertel over je huidige situatie"
- Garantie op resultaat
- Gratis giveaway (blueprint, training, video)
- Pijnpunten: "Stel je doelen maar haal je ze nooit?"
- **Uitdaging:** vaak mensen met weinig budget → startprijs in formulier opnemen als filter

#### Recruitment
- Garantie: "Binnen 3 weken een geschikte kandidaat"
- Branche-specifiek: "Horecaondernemer! Moeite met personeel?"
- Seizoensgebonden: "Voor/na de zomer nieuw personeel?"
- Verdiensten noemen: "€2.500 - €3.500 per maand verdienen"
- Let op: goede filtering want veel werkzoekenden

#### Events
- Prijslijst bekijken werkt goed voor volume
- Uniek in NL / exclusiviteit
- Goede content is cruciaal (laat locatie zien)
- Let op: bedrijven willen vaak alleen prijs vergelijken

#### Finance & Investeringen
- Garantie, gratis giveaway, branche-specifiek
- **Let op:** Meta keurt ads vaak af → vermijd overdrijving, niets dat "te mooi om waar te zijn" klinkt

---

## Formulier Vragen (Lead Forms)

### Standaard vragen
- Naam, telefoonnummer, e-mailadres, woonplaats/locatie

### Kwalificatievragen (afhankelijk van branche)
- "Binnen welke termijn wilt u dit realiseren?"
- "Wat maakt u geïnteresseerd?"
- "Hoeveel budget heeft u beschikbaar?"
- "Wanneer bent u het beste bereikbaar?"
- Multiple choice vragen om te filteren

### Filtervragen (om gelukzoekers eruit te halen)
- Budget-vraag: "Bent u in staat om minimaal €X te investeren?"
- Tijdlijn-vraag: "Zo snel mogelijk / Binnen 1 maand / Binnen 3 maanden / In overleg"
- Oppervlakte/omvang vragen (bijv. m² bij renovatie)

---

## Video Scripts & Hooks

### Script structuur
1. **Hook** (eerste 3 seconden) — stopper, moet scrollen doorbreken
2. **Body** — probleem benoemen, oplossing positioneren, social proof
3. **CTA** — duidelijke call to action

### Winnende hook-categorieën
1. **Provocerend/confronterend**: "Als je nog steeds dezelfde methodes gebruikt..."
2. **Financieel verlies**: "€3000, €4000, €5000 per maand en geen resultaat?"
3. **Schaarste**: "Wij zoeken 5 bedrijven in de [branche]..."
4. **Social proof/resultaat**: "Van €0 naar €1M omzet in het eerste jaar"
5. **AI/technologie**: "AI vervangt je team niet maar wél de taken waar je team niet consequent in is"
6. **Fake news/contrarian**: Begin met overdreven claim, dan ontkrachten en echte oplossing positioneren
7. **Pijnpunt CRM/opvolging**: "70% van je leads gaat verloren door trage opvolging"
8. **Branche-specifiek**: "[Branche] opgelet!" of "Ben jij eigenaar van een [branche]bedrijf?"

### Content types
1. **Professionele video op locatie** (1x per kwartaal bij HTO) — b-roll, testimonials, hooks, productvisuals
2. **AI Avatar video's** — schaalbaar, snel, goedkoop. 5x meer output, 85% lagere kosten
3. **Static ads** (Canva) — foto's, afbeeldingen
4. **Manus** (Meta AI tool) — automatisch advertenties genereren
5. **Stock content** (laatste optie als klant geen eigen content heeft)

---

## Volledige Video Scripts — RL 3.0 Campagnes

> Gebruik als referentie bij het schrijven van nieuwe ad copy of het briefen van video-opnames.

### PVA / Standaard Body (generiek inzetbaar na elke hook)

> De meesten zullen deze video negeren, maar als jij deze video tot het einde kijkt, hoor je waarschijnlijk bij de 10% die WEL meegaat. Jij zal niet alleen je concurrenten voorbijsteken, maar de online markt domineren door de marketing in je bedrijf naar een volledig automatische piloot te brengen.
>
> Met deze onontdekte methode kun jij op automatische piloot nieuwe offerte-aanvragen & betalende klanten aantrekken zonder dat je sales team elke dag achter leads aan hoeft te jagen. AI en automatiseringen zorgen ervoor dat jouw bedrijfsprocessen op volledige snelheid draaien, zodat je meer klanten krijgt, terwijl jij meer tijd overhoudt om je focus op groei te houden.
>
> We rollen momenteel een exclusieve methode uit voor een selecte groep bedrijven om te testen. Dit is jouw kans om als een van de eersten gebruik te maken van RL 3.0 die jouw agenda automatisch vult. We zitten nog in de startfase, dus de mogelijkheid is nu groter dan ooit dat jouw bedrijf hiervan kan profiteren voordat we de methode breder lanceren. Zodra we live gaan, is de kans om mee te doen veel kleiner, dus grijp deze kans nu en ontdek of jouw bedrijf geschikt is.

---

### Video 1 — AI/Automatisering angle

| # | Hook | Visuele richting |
|---|---|---|
| 1 | 90% van de bedrijven zijn nog niet op de hoogte van de revolutie die AI en automatiseringen teweegbrengen om jouw agenda vol afspraken te krijgen. | Roy met blinddoek op, verdwaald |
| 2 | Ondernemers die in 2025 nog steeds de marketing methodes van 2023 en eerder gebruiken lopen gigantisch veel omzet mis! | Roy bij bushokje, zwart-wit |
| 3 | Als je in 2025 geen AI en performance-driven systemen gebruikt, mis je tot 40% van je potentiële klanten en laat je 80% van je concurrentie achter je. Het is niet de toekomst, het is nu. | Roy die achter zelfrijdende Tesla aan rent |
| 4 | Als je nog steeds werkt met traditionele agencies die alles op de oude manier doen, ben je gewoon je tijd aan het verspillen. | Roy in sportoutfit, achteruit rennend |
| 5 | €3000, €4000, €5000 per maand aan marketingkosten en een strategie die niet werkt? | Biljet in de fik steken |
| 6 | Ik ken hét marketing geheim van 2025 waardoor bedrijven hun complete marketing/sales team kunnen automatiseren. | Tim op bureau, benen omhoog |
| 7 | Ik sprak 10 succesvolle ondernemers die minimaal 1 miljoen omzet per maand draaien, en ze hadden allemaal 1 ding gemeen… en dat is AI. | Roy in verschillende outfits (allemaal clowns) |
| 8 | Als je geen automatische afspraken hebt, dan draai je gewoon op het oude model. Iedereen die wel gebruikmaakt van geavanceerde technologie, doet het anders. Jij doet het verkeerd. | Schakelen vs automaat |

**Body:** → Gebruik PVA Standaard Body.

---

### Video 1 — Meta twijfel angle

**Hooks:**
1. Hoeveel keer ga je nog zeggen dat Facebook niet werkt, terwijl je het nooit écht goed hebt geprobeerd?
2. Je blijft zeggen dat Meta niet voor jouw niche werkt, maar ondertussen hebben wij voor al honderden bedrijven in dezelfde niche resultaat gegenereerd.
3. Denk je dat Meta niet werkt voor jouw doelgroep, of weet jij simpelweg niet hoe je je doelgroep moet bereiken?
4. Als je dit hoort, heb je al 3 potentiële klanten verloren aan je concurrent.
5. Er wordt elke dag €2,8 miljard uitgegeven aan advertenties, maar jij gelooft dat Meta niet voor jouw bedrijf werkt?

**Body:**
> Het is niet een kwestie van of Meta werkt, maar of je de juiste strategie hebt. Met Rocket Leads 3.0 hebben we een gloednieuwe marketing- en salesmachine ontwikkeld die bedrijven niet alleen helpt bij het genereren van leads en afspraken, maar die 24/7 draait en jouw markt domineert.
>
> Benieuwd hoe Rocket Leads 3.0 jouw bedrijf kan laten groeien? Plan vandaag nog een gratis strategiegesprek in!

---

### Video 1 — RL 3.0 angle

**Hooks:**
1. Wil je 24/7 grip op jouw marketing en sales?
2. Stel je voor dat je leads als hyena's opgevolgd worden, met 11 contactmomenten binnen 48 uur.
3. Als marketing voor jou altijd een gevecht is, waarom laat je jezelf dan niet eindelijk winnen?
4. Je zit vast in marketing die werkt als een onbetrouwbare vriendin. Het lijkt wel goed, maar faalt op het moment dat je het het meeste nodig hebt.
5. Je hebt net weer 5 potentiële klanten gemist. En je weet niet eens aan wie.

---

### Video 2 — Fake Nieuwsbericht

| # | Hook | Visuele richting |
|---|---|---|
| 1 | Jan ging met zijn bedrijf van nul naar 10.000 afspraken per maand zonder ook maar één telefoontje te plegen! | Roy op reuze-eenhoorn zwemband met laptop |
| 2 | Wist je dat Mark €500.000 omzet behaalde in 3 maanden tijd zonder ooit zijn agenda open te trekken? | Op de bank in pyjama in een freehouse |
| 3 | Deze B.V is van €10.000 naar €2.500.000 maandomzet gegaan met één simpele automatisering. Geen cold calling, geen urenlange meetings. | — |
| 4 | Ondernemers versterken elkaar en profiteren van een ROI van zo'n 80%! | — |
| 5 | Elke week 10 nieuwe klanten voor de rest van je leven met slechts 1 simpele software! | Maaltijd, chill met beentjes omhoog |

**Body:**
> Je hebt vast al vaker zulke ongelooflijke verhalen gehoord, maar helaas is het niet zo eenvoudig. Wat wel mogelijk is, is Rocket Leads 3.0. Dit is geen magische oplossing, maar wel een compleet systeem waarmee jij geautomatiseerd gekwalificeerde afspraken ontvangt, zonder dat je daar zelf veel voor hoeft te doen.
>
> We leveren meer dan alleen afspraken — wat we bieden is een module die bestaat uit automatiseringen, triggers, loops, e-mails en meer, waarmee warme leads continu aan je digitale dashboard komen. Je hoeft alleen maar te profiteren van een stijgende omzet.
>
> Benieuwd naar dit framework en of jouw bedrijf geschikt is? Klik op de knop en plan vrijblijvend een kennismaking in!

---

### Video 3 — Pijnpunt CRM

**Hooks:**
1. Wist je dat maar liefst 70% van je leads verloren gaat door trage opvolging in je CRM? Als je denkt dat je geen tijd hebt om het bij te houden, dan heb je waarschijnlijk gelijk — maar dat hoeft niet zo te blijven.
2. Waarom krijg jij je leads niet op tijd in gesprek? 67% van de ondernemers geeft aan dat het CRM-systeem hen juist tegenhoudt in plaats van helpt.
3. Heb jij ook last van leads die vast blijven hangen in je CRM en uiteindelijk nooit kopen?
4. Heb jij een bak aan leads die niet gekwalificeerd zijn of hun telefoon niet opnemen?
5. 90% van de ondernemers gebruiken hun CRM systeem niet goed waardoor het ze uiteindelijk meer tijd kost dan oplevert!

**Body:**
> Rocket Leads 3.0 verandert dit! Aanvragen komen direct in jouw marketing- en salesmachine. Wij zorgen voor meerdere contactmomenten voor de ultieme opvolging en automatiseren je sales zodra een afspraak is ingepland. Profiteer van een unieke afspraakloop op autopilot, terwijl jij je omzet ziet stijgen.
>
> Wij zijn een van de eersten die deze technieken toepassen in Nederland en gaan graag samen met jou in gesprek om te zien of deze gamechanger ook voor jou toepasbaar is. Plan een korte kennismaking in via onderstaande knop.

---

### Video 4 — Pijnpunt Oude Leads

| # | Hook | Visuele richting |
|---|---|---|
| 1 | Heb jij enorm veel (oude) leads in je CRM waar je niets mee doet? Dan laat je duizenden euro's liggen. | Geld in de lucht gooien |
| 2 | Waarom blijf je geld verbranden aan nieuwe leads als er nog goud in je CRM ligt? | Shot van geld dat verbrand wordt |
| 3 | Hoeveel leads in jouw CRM zijn na één belletje of mailtje nooit meer opgevolgd? | Telefoon neergelegd, CRM vol ongeopende leads |
| 4 | 80% van bedrijven benaderen hun oude leads niet en laten daar duizenden euro's mee liggen. | Geld in prullenbak gooien |
| 5 | Gratis afspraken of dure betaalde afspraken — de keuze lijkt simpel. Maar gek genoeg kiezen veel bedrijven voor het laatste. | — |
| 6 | Waarom zou je betalen voor afspraken als je ze ook gratis kunt krijgen? | — |
| 7 | Meer dan 33 gekwalificeerde afspraken in een maand zonder te adverteren! | — |

**Body:**
> Oude leads die ooit interesse hebben getoond, verdwijnen vaak na één belletje of mailtje in de vergetelheid. En juist dáár laat je omzet liggen.
>
> Het probleem is niet dat je te weinig leads hebt — het probleem is dat je niet alles uit de leads haalt die je al bezit. Met een gestructureerde opvolging kun je die slapende kansen wakker maken en direct omzetten in nieuwe afspraken en omzet.
>
> Dit levert je duizenden euro's extra op, zonder ook maar één euro extra aan advertenties uit te geven.
>
> Benieuwd hoe jouw bedrijf meer afspraken krijgt zonder te adverteren? Klik op onderstaande knop.

---

### Video 5 — Pijnpunt Bedrijf Staat Stil

**Hooks:**
1. Je hebt hard gewerkt om je bedrijf op te bouwen, maar het voelt alsof je maar op één plek blijft draaien. Wat als ik je vertel dat je bedrijf in één maand tijd volledig geautomatiseerd kan draaien?
2. Iedereen zegt dat je moet werken aan je bedrijf, niet in je bedrijf. Maar je blijft maar uren kwijt aan salesgesprekken, afspraken inplannen, en leads opvolgen.
3. Wat als ik je vertel dat 95% van de ondernemers nog steeds handmatig werk doen dat door één simpele automatisering volledig overgenomen kan worden?
4. Als je geen automatische afspraken hebt, dan draai je gewoon op het oude model. Iedereen die wel gebruikmaakt van geavanceerde technologie, doet het anders. Jij doet het verkeerd, en ja, dat betekent dat je achterblijft.
5. Deze methode zorgt ervoor dat jij geen leads meer verliest. We hebben een systeem gebouwd dat alles automatisch volgt, de leads binnenkrijgt, en jouw agenda vult.

**Body:**
> Wat ik je nu ga vertellen, is niet voor de luie ondernemers. Het is voor de ondernemers die klaar zijn om hun bedrijf naar een ander niveau te tillen. De oude manier van werken kost je tijd, geld, en leidt nergens naartoe.
>
> Waarom zou je blijven wachten op leads als ze automatisch naar je toe kunnen komen? Onze methode haalt leads voor je binnen, plant afspraken voor je in, en zorgt ervoor dat je 100% van je tijd kunt besteden aan groei in plaats van saaie, herhalende taken.
>
> Ik laat je zien hoe Rocket Leads 3.0 je bedrijf razendsnel kan laten draaien op autopilot. Benieuwd naar de mogelijkheden? Klik op de knop, plan een gratis kennismaking in.

**Doelgroepen:** Software/AI/SaaS, Financiële dienstverlening (fintech, verzekeringen, investeringen)

---

### Video 5 — Leo angle (branchespecifiek, professioneel)

**Hooks:**
1. Ben jij {functie} van een {branche} bedrijf? Dit is jouw unieke kans om marktleider binnen jouw regio te worden!
2. CEO's gezocht in de {branche}!
3. Wij zoeken 5 bijzondere bedrijven in de {branche}.

**Body:**
> Zet je bedrijf op een nationaal podium en krijg de aandacht die het verdient. Je zit stil terwijl jouw concurrenten de leads op automatische piloot binnenhalen. Waarom? Omdat jij nog niet gebruik maakt van een eigen marketing- en salesmachine.
>
> Stop met het verliezen van tijd en geld. Dit is de kans om je bedrijf echt te laten groeien. Wij selecteren slechts 5 bedrijven deze maand om onze methode te ontdekken. Klik op de knop voor meer informatie.

---

### Video 6 — Lege Agenda

**Hooks:**
1. Nog zo'n lead die zegt 'ik laat iets weten'… en daarna nooit meer reageert?
2. Je investeert in marketing, maar je agenda blijft leeg. Herkenbaar?
3. Lege agenda's, trage opvolging… en wéér een maand zonder resultaat?
4. Leads die niet opnemen, niet terugbellen en niet komen opdagen — het is om gek van te worden.
5. Je hebt een prachtige showroom, maar zonder afspraken is het gewoon dure opslagruimte. *(interieur angle)*

**Body:**
> Je krijgt wél leads, maar de helft reageert niet. De rest zegt dat ze 'nog even moeten nadenken'. En ondertussen betaal je voor advertenties die eigenlijk niets opleveren.
>
> Je team zit met gaten in hun agenda, je targets schuiven op, en de stress loopt op. Ondertussen zie je je concurrenten overal voorbij komen met wél volle agenda's.
>
> Bij Rocket Leads pakken we dat hele stuk voor je over. Wij bouwen een systeem dat niet alleen leads binnenhaalt, maar ze ook opvolgt tot er écht afspraken in je agenda staan.
>
> **CTA:** Wil je stoppen met jagen op klanten? Klik op 'Meer informatie' en ontdek hoe jouw agenda weer vanzelf gevuld raakt met échte, gekwalificeerde afspraken.

---

### Video 6 — AI UGC vorm

**Hooks:**
1. Dit is hoe AI de agenda van mijn bedrijf compleet veranderd heeft.
2. Waarom zouden wij nog wachten op nieuwe afspraken als AI het werk vanaf nu voor ons doet?
3. Wij werden zo moe van het handmatig opvolgen van leads, maar nu draait mijn bedrijf op volledig geautomatiseerde efficiëntie.
4. Ik ken hét marketing geheim van 2025 waardoor bedrijven hun complete marketing/sales team kunnen automatiseren.
5. Ik sprak 10 succesvolle ondernemers die minimaal 1 miljoen omzet per maand draaien, en ze hadden allemaal 1 ding gemeen… en dat is AI.
6. AI is niet alleen een hulpmiddel, het is de sleutel tot succes in 2026.
7. Leads komen binnen, afspraken worden ingepland, en jij doet helemaal niks. Ontdek hoe AI jouw bedrijf helpt groeien.

**Body:**
> We wisten dat AI de toekomst was, maar we hadden nooit gedacht dat het zo gemakkelijk zou zijn. Ons marketing- en salesproces wordt nu volledig aangestuurd door slimme technologie. Leads komen automatisch binnen, afspraken worden ingepland zonder dat we er een vinger voor hoeven uit te steken.
>
> De top bedrijven maken hier allemaal gebruik van, en jij laat gegarandeerd omzet liggen als dit nog onbekend terrein voor jou is.
>
> Benieuwd hoe AI jouw bedrijf kan ontzorgen? Klik op de knop voor meer informatie.

---

### Video 6.1 — AI UGC Iteratie

**Hooks:**
1. AI wordt in 2026 niet je voordeel… maar je concurrentie als je er geen gebruik van maakt!
2. AI vervangt je team niet maar het vervangt wél de taken waar je team niet consequent in is.
3. Hoeveel omzet heb jij dit jaar laten liggen doordat leads niet op tijd werden opgevolgd?
4. Dit is hoe AI de agenda van mijn bedrijf compleet veranderd heeft.

**Body:**
> De meeste bedrijven zien AI nog als een leuke gadget, maar echte groei ontstaat pas wanneer het zware werk overneemt. Juist daar gaat het mis voor veel ondernemers: ze weten dat het moet, maar niet waar ze moeten beginnen.
>
> Stel je voor dat je systeem 24/7 draait. Nieuwe leads komen automatisch binnen en worden opgevolgd. Afspraken worden ingepland, herinnerd én bevestigd… zonder dat jij iets handmatig hoeft te doen. Het beste? Je hoeft geen expert te zijn.
>
> Onze klanten zien hetzelfde patroon: meer afspraken, lagere kosten per lead, stabielere omzet, én vooral: rust. AI neemt de snelheid en discipline over waar teams vaak tekortschieten.
>
> Benieuwd hoe jouw bedrijf eruit ziet met een AI-motor erachter? Klik op de knop voor meer informatie.

---

### Video 6 V2 — Branchespecifiek

**Hooks:**
1. Ben jij eigenaar van een interieurbedrijf en wil jij je positioneren als dé partner in jouw regio? Dan is dit jouw kans om je omzet structureel te laten groeien!
2. Ben jij eigenaar van een bedrijf dat gespecialiseerd is in het verwarmen van woningen? Dan is dit jouw kans om je omzet structureel te laten groeien!
3. Wij zijn op zoek naar 5 renovatiebedrijven die nieuwe partners willen aantrekken! Ontdek de enige marketing- en salesmachine in Nederland die met behulp van AI jouw ideale klanten aantrekt.

**CTA:** Benieuwd naar de mogelijkheden? Klik hieronder en ontdek of jouw bedrijf geschikt is.

---

### Video 7 — Stabiele Stroom

**Hooks:**
1. Je kent het wel. Weken waarin jij en je team alles geven maar de agenda halfleeg blijft.
2. Je geeft elke week alles, maar toch blijft de agenda stiller dan je zou willen.

**Body:**
> Je team wacht op nieuwe leads, jij checkt de cijfers en denkt: waar blijft de groei die we verdienen? Het hoeft niet zo te zijn.
>
> Stel je voor: een stabiele stroom aan afspraken, elke week weer. Geen stress meer over waar de volgende deal vandaan komt, maar rust, focus en voorspelbaarheid.
>
> Bij Rocket Leads bouwen we dat systeem voor je. Geen loze beloftes, maar harde resultaten die je voelt in je omzet. Jij sluit de deals, wij zorgen dat je agenda vol blijft met de juiste gesprekken.
>
> Klinkt als de volgende stap die je bedrijf nodig heeft? Klik dan hieronder en ontdek hoe dat er voor jou uit kan zien.

---

### Video 8 — Druk maar Lege Agenda

**Hooks:**
1. Je dagen zitten vol, maar nieuwe klanten krijgen voelt nog steeds als losse flodders.
2. Hoe hard je ook werkt, het blijft lastig om een constante stroom klanten op te bouwen.
3. Je team draait wéér een drukke week, maar de agenda blijft leeg.

**Body:**
> Altijd bezig met klanten, personeel en offertes — en voor marketing is geen tijd. En die keren dat je het uitbesteedde? Mooie beloftes, weinig resultaat. Je wilt gewoon nieuwe klanten. Zonder gezeik.
>
> Maar zo doorgaan? De ene maand druk, de volgende stil. Geen rust. Geen voorspelbaarheid.
>
> Stel je voor dat dat verandert. Elke week kwalitatieve leads en afspraken in je inbox. Een volle agenda en een team dat continu aan het werk is.
>
> Bij Rocket Leads bouwen we dat systeem voor je. Geen marketingtaal, maar gewoon: meer klanten. Meer omzet. Minder gedoe.

---

### Video 9 — Agency vs In-house

**Hooks:**
1. Dure agencies slokken je budget op. In-house teams verbranden je tijd. Wat als je wél de resultaten kreeg zonder beide?
2. Groeien wordt een stuk makkelijker als je marketing eindelijk doet wat je bedrijf nodig heeft.
3. Je hoeft geen marketingexpert te zijn om consistent nieuwe klanten te krijgen.

**Body:**
> Premium agencies kosten je vaak duizenden euro's voor eindeloze meetings. En een intern team? Dat kost je maanden en salarissen voor één campagne. Je hebt geen team van tien nodig, maar één systeem dat wél presteert.
>
> Met Rocket Leads 3.0 zet je je aanbod in een geautomatiseerde marketing en sales machine: advertenties die precies afgestemd zijn op jouw doelgroep, opvolging waar je interne team nooit aan toekomt, en afspraken die direct in je agenda verschijnen. Geen eindeloze meetings. Geen briefings. Geen gedoe.
>
> Meer dan 2.000 bedrijven gebruiken Rocket Leads 3.0 om hun marketing en sales op te schalen en zien betere resultaten, zonder de overhead van een groot team.

---

### Video 10 — AI Avatar (generiek)

**Hooks:**
1. Stel je voor dat je nooit meer zelf voor de camera hoeft te staan, maar tóch elke week nieuwe video's hebt die jouw bedrijf laten groeien.
2. Geen zin en tijd om elke week video's op te nemen? Laat je AI-avatar het doen!
3. Hi, ik ben Twan — de AI-avatar die jouw content draait terwijl jij andere dingen doet.
4. Hoeveel tijd verlies je nog aan opnames en edits… terwijl je AI avatar in minuten nieuwe varianten maakt en tot 85% goedkoper is.

**Body:**
> Iedere ondernemer weet hoe belangrijk video is voor marketing, maar niemand heeft zin in de camera-stress, tijdsdruk en eindeloze retakes. Wat als dat hele proces voor altijd van je bord verdwijnt?
>
> Wij maken jouw AI-avatar en produceren alle video-ads ermee, zodat je content 24/7 blijft lopen zonder dat je zelf hoeft te filmen.
>
> De voordelen: onbeperkte variaties zonder extra kosten, 5x hogere output per week, 85% lagere productiekosten — en het belangrijkste: betere resultaten dan ooit tevoren.

---

### Video 10.1 — AI Avatar + Leadgeneratie combo

**Hooks:**
1. Geen zin en tijd om elke week video's op te nemen? Laat je AI-avatar het doen!
2. Hi, ik ben Linda — de AI-avatar die jouw leads binnenhaalt terwijl jij andere dingen doet.
3. Hoeveel tijd verlies je nog aan opnames én leadgeneratie… terwijl je AI-avatar beide automatiseert, 24/7 leads binnenhaalt en tot 85% goedkoper is.
4. Leads genereren kost tijd en video ads maken ook. Wat als één systeem beide regelt?

**Body:**
> Iedere ondernemer weet hoe belangrijk video ads zijn om leads te genereren, maar niemand heeft zin in de camera-stress, tijdsdruk en eindeloze retakes. En zodra je stopt met opnemen? Stoppen je leads ook.
>
> Wij maken jouw AI-avatar en zetten een systeem op dat continu kwalitatieve leads genereert, zodat je content én afspraken 24/7 blijft doorlopen zonder dat je zelf hoeft te filmen.
>
> De voordelen: onbeperkte video variaties, 5x hogere output per week, 85% lagere productiekosten — en kwalitatieve afspraken op de automatische piloot.

---

### Video 10 — AI Avatar Roy (studio versie)

**Hooks:**
1. Iedereen vertelt je dat video advertenties nodig zijn, maar jij wil liever de camera vermijden? Het kan nu met jouw eigen AI-avatar!
2. Heb jij geen zin en tijd om elke week video's op te nemen voor je advertenties? Laat je AI-avatar het doen!
3. Voel jij je oncomfortabel voor de camera, maar wil je wel video advertenties die werken? Laat je AI-avatar het werk voor je doen!
4. Niet goed voor mijn ego… maar bij Rocket Leads werken AI video's op dit moment beter dan zelf opgenomen video's zoals deze.
5. Ben ik AI of spreek ik dit echt zelf in? Het onderscheid is steeds lastiger te maken, en dat is in jouw voordeel! Met jouw eigen AI avatar hoef jij NOOIT meer zelf voor de camera te staan.

**Body 1.0:**
> Iedere ondernemer weet dat video ads het beste werken op Meta. Maar laten we eerlijk zijn: niet iedereen voelt zich comfortabel voor een camera. De spanning. De tijd die het kost. Het gevoel dat je "moet presteren". En precies dáár haken de meeste ondernemers af.
>
> Wij maken jouw persoonlijke AI-avatar en produceren al je video-ads daarmee. Zonder camera. Zonder opnames. Zonder stress. Jij levert de boodschap, wij zorgen dat je video's 24/7 blijven draaien.

**Body 2.0 (korter):**
> Jouw persoonlijke AI-avatar kan ervoor zorgen dat je aan de lopende band realistische en winnende video advertenties ontvangt. Zonder camera. Zonder kosten. Zonder stress. Resultaat: meer leads met minder tijd EN minder kosten.

---

### Video 11 — Roy Studio (FTC angle)

**Hooks — B-roll:**
1. {{Branche}} opgelet!
2. Ben jij op zoek naar leads voor {{branche}}?
3. Wij zoeken X {{branche}}-bedrijven die willen groeien.
4. Ben jij eigenaar van een interieurbedrijf met een salesteam? Dat kost je waarschijnlijk bakken met geld.

**Hooks — FTC (confronterend):**
1. De ene na de andere agency op je beeldscherm, maar wie kan het nou ECHT waarmaken?!
2. Je hebt toch geen FUCK [BLIEP in edit] aan "kwalitatieve leads"… Jij wilt gewoon betalende klanten.
3. Ik ken het marketing geheim van 2026 waardoor bedrijven hun gehele marketing en sales team kunnen automatiseren.
4. Als jij sceptisch bent over agencies die je volspammen met advertenties, zoals wij, dan heb ik wellicht iets voor je.
5. Moeite om je agenda gevuld te krijgen? Met Rocket Leads 3.0 is dat verleden tijd!

**Body:**
> Ontdek de enige marketing- en salesmachine in Nederland die met behulp van AI jouw ideale klanten aantrekt. Sneller, goedkoper, schaalbaarder, en dus beter dan ooit.
>
> Ben jij benieuwd naar de mogelijkheden voor jouw bedrijf? Klik dan hieronder om te zien of we een match zijn.

---

### Video 12 — Algemeen

**Hooks:**
1. Ben je het zat om tijd te verspillen aan leads die nergens naartoe leiden?
2. Ben jij eigenaar van een BV met een salesteam? Dat kost je waarschijnlijk bakken met geld.
3. Vraag je je af hoe je je agenda dit jaar vol krijgt?
4. Geen constante stroom aan afspraken?

---

### Video 13 — Groeicalculator

**Hooks:**
1. Benieuwd hoeveel extra leads en omzet er voor jouw bedrijf mogelijk zijn?
2. Wat als je kon berekenen hoeveel afspraken en omzet je structureel laat liggen?
3. Volgende week miljonair? Nee, dat beloven we niet. Wij laten liever zien wat er nú al mogelijk is in jouw markt — en dat is vaak meer dan gedacht.
4. 300% tot 900% rendement is wat wij gemiddeld realiseren voor onze klanten! Ontdek binnen 1 minuut of dit ook voor jou haalbaar is via onze gratis calculator.
5. Gemiddeld 25-80 extra afspraken en aanvragen per maand voor onze klanten. Check binnen 1 minuut wat voor jouw bedrijf mogelijk is.

**Body:**
> Veel ondernemers voelen dat er meer in zit. Meer aanvragen. Meer afspraken. Meer omzet. Maar het blijft vaag. En zonder duidelijke cijfers blijft groei een gok.
>
> Bij Rocket Leads beginnen we niet met campagnes. We beginnen met rekenen. Op basis van 8+ jaar ervaring, duizenden campagnes en 2000+ bedrijven geholpen te hebben, berekenen we hoeveel leads haalbaar zijn, hoeveel afspraken daaruit volgen, en wat dat betekent voor jouw omzet. Pas daarna bouwen we het systeem dat dit ook daadwerkelijk realiseert, elke week opnieuw.

---

### Video 14 — Seizoensgebonden

**Hooks:**
1. Heb jij een bedrijf dat in de winter amper groeit? Dan geef ik je de garantie: dit wordt een zwaar voorjaar.
2. Als je eerlijk bent levert dit seizoen je nauwelijks nieuwe klanten op. Maar dat tekort moet je de rest van het jaar inhalen.
3. Heb jij een bedrijf dat op koude dagen bijna geen nieuwe klanten ziet binnenkomen? Die stilte voel je straks gegarandeerd in je omzet.

**Body:**
> Maar wat als dit rustige seizoen juist het moment is om een voorsprong te bouwen — zonder meer uren, zonder extra personeel en zonder torenhoge advertentiekosten?
>
> Met dit systeem hebben we al meer dan 2000 ondernemers geholpen om het hele jaar door hun pipeline gevuld te houden. Zodat zij het voorjaar ingaan met aanvragen in plaats van stress.

---

## New Offer Scripts

### Video 1 — Eén aanspreekpunt / Totaalplaatje

**Hooks:**
1. 3 bureaus. Drie verschillende meningen. En uiteindelijk 0 resultaat.
2. Het feit dat je marketing niet werkt ligt niet aan jou of de partners… maar aan het feit dat je met meerdere partners werkt en niemand het totaalplaatje bewaakt.
3. Als jouw ads niet werken, je content niet converteert en je opvolging hapert… wie is er dan verantwoordelijk?
4. Je investeert steeds meer budget in marketing, je omzet stijgt niet, marges krimpen — en iedere partij geeft een andere oorzaak.

**Body:**
> Je hebt iemand voor je content, iemand anders voor je advertenties, de opvolging doe je in-house, en je hebt ergens nog iemand voor emailmarketing. Niemand pakt de regie. Iedere partij focust op zijn eigen stukje. Hierdoor zal je nooit echt doorkunnen groeien.
>
> Daarom brengen wij vanaf nu alles samen onder 1 dak: content, advertenties, funnels, opvolging en automatiseringen. Zodat elke euro die je uitgeeft ook echt richting omzet gaat.
>
> Voor TV Media Partners hebben we meer dan €350.000 aan advertentiebudget beheerd, 20.000+ leads over 3 landen gegenereerd, met meer dan €2 miljoen euro extra omzet als resultaat.
>
> Geen vingers wijzen, geen excuusjes, geen ruis. Gewoon één partij die verantwoordelijk is voor het eindresultaat.

---

### Video 2 — Content Machine

**Hooks:**
1. Als jij elke maand meer dan €3.000 investeert in advertenties, en je hebt geen systeem dat aan de lopende band nieuwe creatives lanceert, dan ben je budget aan het verbranden.
2. Wat als jij met 1 videoshoot winnende advertenties kunt maken voor de komende 3 maanden?
3. Stop met die dure videoproducties en losse videoshoots. Wat jouw bedrijf nodig heeft is een content systeem dat wekelijks automatisch nieuwe, winnende creatives kan lanceren.
4. Als jij in 2026 nog niet consistent nieuwe content hebt klaarstaan voor je advertenties, dan verbrand je advertentiebudget.
5. De top 1% adverteerders maken gebruik van een slim content systeem dat schaalbaarheid combineert met creativiteit. En precies daar zit het verschil.

**Body:**
> Je campagnes werken… tot ze niet meer werken. Het probleem? Je hebt simpelweg niet genoeg content.
>
> Wij bouwen een volautomatische contentmachine voor jouw advertentiecampagnes. 1x per kwartaal komen we bij je langs voor een videoshoot, en vervolgens maken we met AI onbeperkt iteraties zodat we eindeloos kunnen blijven testen en opschalen.
>
> Het resultaat: 5x meer advertentiecreatives per week, 85% lagere productiekosten, onbeperkte variaties — en betere resultaten dan ooit tevoren.
>
> Bij Dr. Ludidi genereerden we met €5.000 ad spend meer dan 500 aanvragen en 10 high-ticket deals. Voor TV Media Partners leidde €350.000+ budget tot meer dan €2M extra omzet.

---

### Video 3 — €3K Spend

**Hooks:**
1. Spendeer jij maandelijks minimaal €3.000 aan ad budget? Dan geef ik jou de garantie dat wij sneller, beter en goedkoper afspraken kunnen genereren voor jouw bedrijf op automatische piloot!
2. Spendeer jij duizenden euro's per maand aan ads, maar heb je nog geen content systeem dat dagelijks nieuwe creatives kan lanceren? Dan verbrand je waarschijnlijk je budget.
3. Je geeft €3.000 of meer per maand uit aan advertenties, maar onderaan de streep hou je amper iets over. Er moet toch een manier zijn waarop dit wel rendabel kan?
4. Ondernemers die meer dan €3.000 per maand spenderen aan advertenties lopen allemaal tegen hetzelfde aan: verzadiging door te weinig variatie.

**Body:**
> Bij Rocket Leads draaien we al 8 jaar mee, en we hebben een flinke verandering gezien in de strategie die werkt op Meta. Vroeger optimaliseerden we campagnes en doelgroepen — maar nu zijn winnende video creatives het enige dat telt.
>
> We hebben meer dan 2000 bedrijven geholpen en naar schatting meer dan €75 miljoen omzet gegenereerd via performance marketing.
>
> Neem Brian van Werk en Berg: met €13.000 adspend hebben we meer dan €1.000.000 omzet gerealiseerd.
>
> Als jij een advertentiebudget hebt van minimaal €100 per dag, plan dan een groeisessie in. We laten je direct zien waar je winst laat liggen, hoe je de aantallen consistenter krijgt en wat er nodig is om de kwaliteit van de afspraken te verbeteren.

---

### Video 4 — Branches met spend (selfie mode buiten)

**Hooks:**
1. Run jij een bedrijf in de renovatiebranche dat maandelijks duizenden euro's spendeert aan een marketingbureau en heb je het idee dat je te veel betaalt voor wat je daadwerkelijk krijgt? Bij ons is dit anders.
2. Verkoop jij high ticket producten van minimaal €5.000 aan de zakelijke markt en wil je consistent nieuwe klanten aantrekken?
3. Als jij elke maand duizenden euro's verbrandt om je unieke maatwerk producten te verkopen… is het product niet het probleem.
4. Draai jij maandelijks een ton aan omzet maar merk je dat advertenties je niet meer verder brengen? Dit heeft niet te maken met je dienst, maar de manier waarop je jezelf promoot.
5. Betaal jij nu €200 per afspraak en ben je tevreden? Geloof me… daar zit nog veel meer winst.

**Body:**
> Ik ben Roy, eigenaar van Rocket Leads. Als jij maandelijks duizenden euro's uitgeeft aan marketing maar je voelt dat het te weinig oplevert — dan ligt dat meestal niet aan je product of dienst.
>
> Het probleem is dat marketing bij de meeste bedrijven geen systeem is. Je hebt een ads-partij, een contentpartij, en ergens nog opvolging… maar niemand pakt de regie. En daardoor verdwijnt je budget in ruis, vertraging en te weinig output.
>
> Bij Rocket Leads brengen we alles samen onder 1 dak: advertenties, maandelijkse content, funnels, opvolging en automatiseringen. Zodat jij één aanspreekpunt hebt, één plan, en één team dat verantwoordelijk is voor resultaat, dag in dag uit.
>
> Dat doen we al 8+ jaar voor 2000+ bedrijven — niet via een copy-paste systeem, maar via een unieke funnel exclusief gebouwd voor jouw bedrijf.

---

### Video 5.1 — AI Avatar Winners (performance angle)

**Hooks:**
1. Voel jij je oncomfortabel voor de camera, maar wil je wel video advertenties die werken? Laat je AI-avatar het werk voor je doen!
2. Het aantal leads dat jij uit je campagnes haalt staat gelijk aan (1) de kwaliteit van je advertenties en (2) de hoeveelheid advertenties die jij test per week. Wat als ik je vertel dat wij deze 2 aspecten samenbrengen in een uniek AI content systeem?
3. Besteed jij maandelijks duizenden euro's om video advertenties te maken? Dit kan veel goedkoper en efficiënter!
4. Bedrijven die vandaag winnen met ads hebben geen betere targeting… maar een systeem dat nonstop nieuwe video creatives lanceert met AI.
5. Je concurrent test misschien 3 advertenties per maand. Met ons AI content systeem kun jij er 30 per week lanceren.
6. Wist je dat de reden van jouw tegenvallende Meta resultaten te maken heeft met het feit dat je te weinig nieuwe advertentie variaties publiceert?
7. Wat zou er met de resultaten van jouw campagnes gebeuren als jij aan de lopende band nieuwe video creatives kunt lanceren, zonder extra moeite of shootdagen?
8. De top 1% adverteerders op Meta hebben 1 ding gemeen: AI content in combinatie met echte beelden om aan de lopende band winnende advertenties te genereren.

**Body:**
> Veel bedrijven geven duizenden euro's uit aan advertenties, maar hun campagnes verzadigen omdat er te weinig nieuwe video creatives worden getest.
>
> Daarom gebruiken wij als een van de weinige in Nederland AI-avatars die advertenties draaien terwijl jij gewoon je bedrijf runt.
>
> Nooit meer voor de camera → meer variatie → betere advertenties → meer afspraken → meer winst. Zonder dat het jou extra tijd en energie kost.

---

### Video 7 — AI Bouw/Renovatie (AI avatar in setting)

**Setting:** Bouw/renovatie omgeving

**Hooks:**
1. Terwijl jij aan het renoveren bent lopen er gekwalificeerde klanten aan je voorbij. Ik ben AI en ik lever ze gewoon voor je aan.
2. Aannemers opgelet — stel je voor: je hoeft nooit meer zelf te zoeken naar klanten, nooit meer voor de camera, nooit meer hopen dat de telefoon gaat. Ik ben de AI die dat voor je regelt en ik stop nooit.
3. Bouwbedrijven lopen maandelijks duizenden euro's mis, simpelweg omdat ze het verkeerde systeem gebruiken. Ik ga je laten zien hoe dat anders kan.

**Body:**
> Ik ben een AI Avatar, en mijn enige taak is dit: jou aan de lopende band kwalitatieve afspraken bezorgen met mensen die al geïnteresseerd zijn in wat jij doet.
>
> Bedrijven die mij inzetten genereren gemiddeld €30.000 - €80.000 meer maandelijkse omzet, zonder dat jij daar iets voor hoeft te doen. De vraag is alleen: hoelang wacht jij nog?

---

## Presentatie / Pitch Deck Structuur

| Slide | Inhoud |
|---|---|
| 1 | Sterke zet — bevestiging kennismaking ingepland |
| 2 | Wie is Rocket Leads? |
| 3 | #1 leadgeneratie agency — focus op performance, niet targeting |
| 4 | 8+ jaar / €18M adspend / €75M+ omzet / 2000+ bedrijven |
| 5 | Wat kun je verwachten? |
| 6 | Online kennismaking via Google Meet — groeisessie, geen standaard salescall |
| 7 | RL 3.0 — 4 pijlers: content + funnel + dashboard + opvolging |
| 8 | Complete strategie-setup: doelgroeponderzoek, LP's, ads, tracking, automatiseringen |
| 9 | Focus op gekwalificeerde afspraken — niet op likes, bereik of "leads" |
| 10 | Waarom uitbesteden? (zelf doen = uitstelgedrag, weinig focus, ondoordachte strategie) |
| 11 | Zelf doen vs Rocket Leads — één schaalbaar systeem |
| 12 | Case Werk en Berg — €13K → €1M+ omzet, ROAS 76 |
| 13 | Case DiamondFlame — 100+ showroom afspraken in 3 mnd, €80K+ omzet |
| 14 | Case TV Media Partners — €350K+ spend, 20.000+ leads, €2M+ omzet |
| 15 | Case Dr. Ludidi — €5K spend, 500+ leads, 10 high-ticket deals in 2 mnd |
| 16 | Groeisessie — analyse + omzet laten liggen + roadmap 3-6 mnd |
| 17 | Gefeliciteerd met eerste stap |
| 18 | Team slide — tot snel |

---

## Review Video Bodies (per klant)

**Dr. Ludidi:** Geen koude leads of tijdverspilling — maar tientallen high-ticket deals in 3 maanden. Dr. Ludidi is een autoriteit binnen zijn vakgebied maar miste het systeem om hier consistent omzet uit te halen. Wij bouwden dat systeem. Van advertentie tot salescall, volledig ingericht en geoptimaliseerd.

**Werk en Berg:** Werk & Berg heeft een sterk product, maar zonder het juiste systeem bleef echte omzet liggen. Wij bouwden de volledige funnel: van de eerste advertenties tot een gevulde agenda. Geoptimaliseerd, consistent en schaalbaar.

**Zumex:** Geen startup meer, maar een gevestigd miljoenenbedrijf. Vandaag de dag komt meer dan 50% van al hun afspraken via Rocket Leads. Niet via beurzen, niet via mond-tot-mond — maar via één geoptimaliseerd systeem.

**Vlex Vending:** Zo overtuigd van wat wij deden dat ze iedere cent die ze hadden investeerden. Binnen één jaar schaalden zij hun vending business op naar meer dan €100.000 omzet in 1 maand. Rocket Leads was niet hun marketingbureau — wij waren hun groeimotor.

**TV Media Partners:** Meer dan 20.000 leads, verdeeld over 3 landen. De kracht van schaalbare advertenties die écht werken — in een branche waar leadgeneratie traditioneel via netwerken en koude acquisitie gaat.

**Adeqo:** Klaar met hopen op mond-tot-mond vanuit de bouw. Wilden structureel aan tafel zitten bij aannemers en bouwbedrijven. Rocket Leads bouwde het systeem om precies die doelgroep te bereiken. Resultaat: meer dan 100 B2B deals in de afgelopen 2 jaar.

**Verhuisvlot:** Moeite om structureel opdrachten binnen te halen, waardoor omzet iedere maand schommelde. Binnen 2 maanden na de start stonden er meer dan 30 opdrachten ingepland. Geen flyers of mond-tot-mond. Gewoon een systeem dat constant nieuwe klanten aanlevert.

---

## Landingspagina's

- Custom branded per klant, gebouwd via Loveable met vaste Claude-prompt
- Multi-step formulier met voorwaardelijke logica en pre-kwalificatie
- Social proof (reviews, testimonials, case studies) + trust indicators
- Pixel-perfect, snel, mobielvriendelijk

---

## Leadopvolging Flow (bij HTO met opvolging)

1. Lead binnenkomt → automatisch WhatsApp + email bevestiging
2. Binnen 4 uur telefonisch contact (tot 4x toe, binnen 48 uur)
3. Via 3 kanalen: WhatsApp sequence, telefonische follow-up, 5-daagse email sequence
4. Email sequence: bevestiging → case study → intro → CTA → laatste kans
5. Gekwalificeerde leads ingepland via Calendly → verschijnt in Monday CRM met reminders

**Pricing leadopvolging:** 0-100 leads/mnd: €750 · 100-200: €1.250 · 200-300: €1.750

---

## Optimalisatie

**Dagelijks:**
- Nieuwe doelgroepen testen (ad set dupliceren met interesses)
- Nieuwe ads / iteraties op winnende creatives lanceren
- Lead feedback uit Monday updates per UTM scannen → bad-quality ads pauzeren
- Budget verhogen (max 20%/dag) — ALLEEN bij klanten met flexibel budget; standaard klanten zitten op vast budget en hier is dit niet relevant

**Creative refresh:** elke maand nieuwe creatives en ad copy. Creatives > ad copy in impact. Bij winnende ads: itereren in dezelfde richting (zelfde hook/angle/format, frisse executies) om CPL laag te houden en fatigue te voorkomen.

**Wanneer nieuwe angle:** als meerdere creatives op dezelfde invalshoek niet werken én lead feedback geen kwaliteitsproblemen aantoont.

**Bij winnende ad:** nooit "laten lopen" — direct itereren. Een winnende ad is een signaal om te verdubbelen met nieuwe varianten, niet een rustpunt.

---

## Case Studies

| Klant | Ad Spend | Resultaat |
|---|---|---|
| Werk & Berg | €13.000 | 2000+ leads, €1M+ omzet, ROAS 76 |
| Vlex Vending | — | Bijna 200 leads in eerste maand → €100K/maand |
| TV Media Partners | €350.000+ | 20.000+ leads, 3 landen, €2M+ omzet |
| Dr. Ludidi | €5.000 | 500+ leads, 10 high-ticket deals in 2 mnd |
| DiamondFlame | — | 100+ showroom afspraken in 3 mnd, €80K+ omzet |
| Zumex | — | 50%+ van alle afspraken via Rocket Leads |
| Adeqo | — | 100+ B2B deals in 2 jaar |
| Verhuisvlot | — | 30+ opdrachten binnen 2 maanden |

**Social proof totaal:** 4.5★ Google (162+ reviews) · 2000+ bedrijven · 8+ jaar · €18M+ adspend · €75M+ omzet

---

## Key Messaging Framework

| Pijnpunt | Angle | CTA |
|---|---|---|
| Lege agenda | "Terwijl jij werkt lopen klanten aan je voorbij" | Groeiscan / kennismaking |
| Trage CRM opvolging | "70% van leads gaat verloren door trage opvolging" | Kennismaking |
| Te weinig content variatie | "Je campagnes verzadigen door te weinig creatives" | Content machine sessie |
| Meerdere agencies, geen regie | "3 bureaus, 0 resultaat" | Eén aanspreekpunt voorstel |
| Hoge kosten per afspraak | "€200 per afspraak? Daar zit nog veel meer winst" | Groeisessie |
| Seizoensgebonden daluren | "Rustig seizoen = voorsprong bouwen" | Kennismaking |
| Camera-angst / geen tijd | "Laat je AI-avatar het doen" | AI avatar info |
| Sceptisch over agencies | "Dan heb ik wellicht iets voor je" | Zachte CTA |

---

## Belangrijke nuances voor AI agents

- **Creatives zijn de belangrijkste hefboom** — niet targeting, niet ad copy
- Marketing angles worden gekozen op basis van **ervaring per branche** — niet willekeurig
- **Video ads presteren het beste op Meta** — static ads zijn tweede keuze
- Bij klanten zonder content: video scripts schrijven → klant neemt op met telefoon → wij editen. Stock content is laatste optie
- **Formulier-vragen zijn cruciaal voor leadkwaliteit** — meer vragen = minder maar betere leads
- **AI avatars zijn een kernonderscheider** van Rocket Leads 3.0
- Seizoensgebondenheid meenemen bij branche-specifieke angles
- Case studies worden actief gebruikt in sales framing — agents moeten deze kennen
- Scripts zijn gevalideerde referentie voor nieuwe campagne copy — gebruik de volledige teksten hierboven, niet samengevatte versies
