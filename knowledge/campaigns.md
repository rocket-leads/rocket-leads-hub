# Rocket Leads - Campaigns & Marketing Frameworks

> **Last updated:** 2026-04-15 CET
> Dit document beschrijft alle campagne frameworks, marketing angles, ad formats, scripts, landingspagina's en testing methodieken van Rocket Leads. Gebruik dit als referentie voor AI agents die campagne deliverables genereren en voor campagnemanagers.

---

## Samenvatting

Rocket Leads draait campagnes op Meta (primair), Google en TikTok. De standaard campagnestructuur is 1 ABO-campagne met 1 open-targeting ad set en 4-5 ads. Marketing angles worden gekozen op basis van een bewezen framework per branche. Creatives (video, static, AI avatar) zijn de belangrijkste hefboom - niet targeting of ad copy.

---

## Budget Reality (CRITICAL voor AI agents en campagnemanagers)

**Rocket Leads klanten hebben een VAST, GELIMITEERD advertentiebudget.**

- **Typisch budget:** €1.000–€3.000 per maand totaal. Dit is een **harde ceiling**, geen startbedrag.
- Klanten **schalen vrijwel nooit** hun budget op. Budget is geen flexibele knop.
- In zeldzame gevallen wil een klant na bewezen resultaten omhoog - maar dat is een uitzondering, geen norm.
- "Schalen" als optimalisatie-aanbeveling is **bijna altijd irrelevant** voor onze klantenbasis.

**De échte hefbomen voor optimalisatie zijn altijd:**
1. **Itereren op winnende creatives** - bij een ad die goed presteert maken we direct nieuwe variaties in dezelfde richting (zelfde hook, angle, format, AI avatar) om CPL laag te houden en ad fatigue te voorkomen
2. **Betere creatives** - nieuwe video's, betere hooks, andere AI avatars
3. **Nieuwe marketing angles** - andere invalshoek uit het framework testen wanneer huidige angle uitgewerkt is
4. **Verfijndere targeting** - al draaien we standaard open
5. **Betere landingspagina's** - conversie-optimalisatie
6. **Snellere/betere leadopvolging** - vooral bij HTO klanten met opvolging
7. **Reallocatie binnen vast budget** - verschuiven van underperformer naar winner, NIET netto erbij

**Wat AI agents NOOIT moeten aanbevelen:**
- ❌ "Scale budget by X%"
- ❌ "Increase spend on this ad set"
- ❌ "Scale up this winner"
- ❌ "Add more budget to capture more traffic"
- ❌ "Houd deze ad draaien" / "Keep running this winner" - passief, leidt tot ad fatigue. Een winnende ad moet juist actief worden uitgebouwd met nieuwe iteraties.

**Wat AI agents WEL moeten aanbevelen bij goed presterende campagnes:**
- ✅ "Itereer op [ad naam] - 3-5 nieuwe varianten in dezelfde richting (zelfde hook/angle/format) voor de volgende refresh"
- ✅ "Repliceer deze winnende angle in nieuwe creatives met andere openers, B-roll en CTA's"
- ✅ "Push meer creatives in deze richting om CPL laag te houden en fatigue te voorkomen"
- ✅ "Pause underperformer X, schuif budget naar winner Y binnen dezelfde ad set"

**Kernprincipe:** Een winnende ad is geen rustpunt maar een signaal. Zodra iets werkt, verdubbelen we erop met nieuwe iteraties - zelfde DNA, frisse executies. Stilstaan = ad fatigue = stijgende CPL.

**Maandelijkse creative refresh** is de standaard manier waarop we waarde toevoegen - niet door budget te verhogen.

---

## Huidige Hub data state - CPL als primary driver (2026-Q2)

> **Status note voor AI agents (Pedro + Watch List + alles wat aanbevelingen genereert):**
>
> Tot Q3 2026 draait de Hub primair op **cost per lead (CPL)** als hoofdsignaal voor wat winnaars en verliezers zijn. Niet omdat dat strategisch het juiste antwoord is - de tekst hieronder over Monday-update lead-feedback blijft de inhoudelijke standaard - maar omdat de **data daar nog niet is**:
>
> - Monday lead-board structuur is per klant ad-hoc; niet elke klant heeft consistent UTM-tagging op leads
> - Setter/AM-feedback in updates is niet gestandaardiseerd genoeg om betrouwbaar machine-leesbaar per UTM te aggregeren
> - Cost per appointment (CPA) en cost per deal (CPD) komen pas betrouwbaar binnen als (a) Monday lead-board mappings overal kloppen, (b) deal-data via `date3`-kolom op alle boards consistent is, (c) appointment-conversion gestructureerd doorvloeit
>
> Tot dat is opgelost, gelden voor Pedro / Watch List / alle agent-output **deze tijdelijke regels**:
>
> 1. Pedro mag CPL als primary winner/loser-signaal gebruiken, met het bekende voorbehoud: "winnaars zijn goedkoop, niet automatisch goed". Dit voorbehoud moet expliciet in elke proposal/refresh staan.
> 2. Cross-client examples (Pedro Phase 2) gebruiken óók CPL als basis - winners van same-vertical RL klanten worden geselecteerd op CPL-ratio t.o.v. hun account-avg, niet op leadkwaliteit.
> 3. Wanneer een AI agent een lead-quality observatie tóch wil maken (bv. een agent leest individuele Monday updates voor één klant in real-time), moet het expliciet als signaal naast CPL worden aangeboden - niet de plek vervangen van CPL als gating metric.
> 4. **De tekst hieronder ("Lead Feedback uit Monday Updates") beschrijft de strategische eindstaat, niet de huidige operatie.** Wanneer Monday + appointment-data klopt, schalen we Pedro op naar CPA/CPD-driven decisions. Tot dan: CPL is wat we hebben, dus CPL is wat we gebruiken.
>
> Roy + Pedro maintainer-team werkt parallel aan dataquality (Monday lead-board normalisatie + per-UTM update-structuur) zodat Pedro v.a. Q3 op leadkwaliteit kan draaien.

---

## Lead Feedback uit Monday Updates - primaire kwaliteitssignaal

> *(Strategische standaard - zie status note hierboven voor huidige operatie.)*

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
   - ✅ "Ad 'Photo 2 | Pricelist' heeft 8 leads waarvan 6× 'geen budget' - pauzeer en vervang met budget-kwalificatie in formulier"

**Zonder lead feedback is elke optimalisatie-aanbeveling halfblind.** CPL-cijfers zonder kwaliteitscontext leiden tot verkeerde conclusies.

---

## Lead Analysis Strategie (Quantity + Quality)

Voor elke klant maken we twee oordelen die samen het volledige beeld vormen: **hoeveel** leads er binnenkomen en **hoe goed** ze zijn. Beide oordelen moeten elkaar aanvullen - niet vervangen.

### 1. Quantity (kostefficiëntie - CPL & CPA vs baseline)

**Wat:** judgement op pure kostefficiëntie - krijgen we per geïnvesteerde euro voldoende leads en afspraken?

**KRITISCH - we kijken NOOIT naar absolute aantallen leads.**
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

Deze normaliseren voor budget en laten echte efficiency zien - onafhankelijk van hoeveel er is uitgegeven.

**Hoe te beoordelen:**
- Vergelijk huidige CPL en CPA (7d) met 14d en 30d baselines
- 14d/30d = baseline (wat is normaal voor deze klant), 7d = huidige status
- Gebruik branche-context (renovatie/verduurzaming/coaching/recruitment) om te bepalen of een CPL/CPA "goed" is in absolute zin - er is geen universele benchmark
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
- **neutral** = zowel CPL als CPA binnen ±25% van baseline (normale Meta ruis - geen actie nodig)

**Implicaties voor de Optimisation Proposal:**
- Geen insights genereren over "CPL stijgt" of "CPA verslechtert" tenzij ≥25%
- Geen insights genereren over lead-volume dalingen of stijgingen - ooit
- Wel insights genereren als CPL/CPA de 25% drempel kruist, en altijd als Monday update sentiment kwaliteitsproblemen onthult - ongeacht cost trends

**Wat NOOIT te doen:**
- ❌ "Volume gedaald van X naar Y leads" - irrelevant zonder spend-context
- ❌ Verdict baseren op lead-aantallen
- ❌ Alarm slaan op een volume-daling (kan puur door budget/pauze komen)
- ❌ Aanbevelen om budget te verhogen (zie budget reality)
- ❌ Reageren op CPL/CPA fluctuaties onder de 25% drempel - dat is normale Meta ruis

**Voorbeeldformuleringen:**
- ✅ "CPL stabiel op €11.42 (binnen ruis vs €11.30 baseline). CPA verbeterd met 28% - sterke conversie naar afspraak."
- ✅ "CPL gestegen van €9.20 naar €13.80 (+50% vs 14d, ruim boven 25% drempel). CPA volgt zelfde trend - efficiency degradeert."
- ⚠️ "CPL gestegen van €9.20 naar €10.40 (+13%)." → Binnen ruis, niet noemen, niet flaggen.
- ❌ "Volume gedaald van 36 naar 16 leads (-56%). CPL stabiel op €11.44." → De volume-zin is verboden.

### 2. Quality (Monday updates + conversie)

**Wat:** judgement op leadkwaliteit - komen er bruikbare leads binnen of vooral rotzooi?

**Hoe te beoordelen:**
- **Monday updates zijn de PRIMAIRE bron** - niet conversie-percentages
- Lees per UTM/ad de updates en zoek patronen:
  - Negatief: "geen budget", "niet geïnteresseerd", "verkeerde doelgroep", "geen beslisser", "te duur", no-shows
  - Positief: "afspraak ingepland", "goede lead", "interesse", "deal", "kwalitatief"
- Cross-check met conversie lead → afspraak, maar wees voorzichtig:
  - Hoge conversie + slechte updates = **concerning** (de afspraken worden gemaakt maar de leads zijn waardeloos)
  - Lage conversie + goede updates = **neutral** (kwaliteit is er maar opvolging hapert - process issue, niet ad issue)
  - Hoge conversie + goede updates = **good**
  - Lage conversie + slechte updates = **concerning** (dubbel rood)
- Citeer altijd specifieke ad/UTM namen + concrete patronen ("Photo 2 | Pricelist: 5 van 8 leads zeiden 'geen budget'")
- 2-4 patronen is genoeg - geen muur van bullets

**Waarom Monday updates belangrijker zijn dan conversie %:**
Conversie-statistieken meten of het opvolgproces werkt, niet of de leads kwalitatief zijn. Updates van setters/AM's geven ground truth over wat de leads écht zijn. Een ad kan 80% conversie naar afspraak hebben en alsnog waardeloos zijn als 100% van die afspraken "no budget" zegt.

### Verschil met AI Optimisation Proposal

- **Lead Analysis** = wat is er aan de hand? (state of the union) - geen acties, alleen oordelen
- **AI Optimisation Proposal** = wat moeten we doen? - concrete acties

De Lead Analysis informeert de Optimisation Proposal: een "concerning" quality verdict op een specifieke ad zou moeten leiden tot een actie-insight om die ad te pauzeren of te herwerken. Maar de Lead Analysis zelf bevat nooit acties - die horen in de Proposal.

---

## Klant Feedback Interpretatie - Niet Blind Vertrouwen

Klanten geven regelmatig feedback via Trengo (WhatsApp/email) en Monday updates. Deze feedback is waardevol maar moet altijd door onze eigen ervaring gefilterd worden. We nemen feedback serieus maar maken nooit blindelings aanpassingen.

### Veelvoorkomende klantklachten en de juiste interpretatie

| Klant zegt | Werkelijke oorzaak | Optimalisatie actie |
|---|---|---|
| "Leads nemen niet op" | Follow-up timing issue, NIET campagne-probleem | Andere beltijden proberen, WhatsApp reminder sequence toevoegen, ochtend vs avond testen |
| "Leads hebben geen budget" | Echt kwalificatie-issue | Budget-vraag toevoegen aan leadformulier, targeting aanpassen |
| "Leads zijn niet geïnteresseerd" | Te brede targeting OF te trage opvolging | Checken welke ads (per UTM) de slechte leads opleveren, angle-mismatch of follow-up snelheid |
| "Kwaliteit is slecht" | Vaag - altijd doorvragen | Welke UTM? Welke ads? Wat % is daadwerkelijk slecht? Niet actie nemen op vage klacht |
| "Er komen te weinig leads" | Budget-gerelateerd (vast budget) | Niet ons probleem als CPL goed is - volume = functie van budget. Wel kijken of CPL te hoog is |
| "Ik zie geen resultaten" | Verwachtingsmanagement | Wekelijkse rapportage tonen, concrete cijfers delen, eventueel evaluatie call plannen |

### Tijdsgevoeligheid van klant context

- **Klant requests (< 30 dagen):** Actueel en direct relevant. Meenemen in optimalisatie.
- **Klant insights over kwaliteit (< 90 dagen):** Bruikbaar als achtergrond. Nog relevant maar kan veranderd zijn.
- **Oude requests (> 90 dagen):** Alleen als achtergrondcontext, NOOIT als directe aanleiding voor actie. Klantprioriteiten veranderen.
- **Bij elke verwijzing naar klant context altijd de datum vermelden**, zodat de CM kan inschatten hoe actueel het is.

---

## Optimisation Proposal: Concrete Actie Categorieën

Elke optimalisatie-aanbeveling valt in een van deze 5 categorieën. Elke aanbeveling MOET specifiek zijn met ad-namen, cijfers en een concreet plan.

### 1. Creative (🎨) - Nieuwe varianten of refresh
- **Wanneer:** Winnende ad gevonden (lage CPL + goede feedback), of bestaande creative vertoont fatigue (CTR daalt)
- **Wat:** 3-5 nieuwe varianten in dezelfde richting. Zelfde hook/angle/format, verse uitvoering (nieuwe openers, andere B-roll, nieuwe CTA's)
- **Altijd specifiek:** "Itereer op [ad naam] - €25 CPL, 14 leads (30d). Maak 3 varianten met zelfde hook, nieuwe visuals"

### 2. Pause (⏸) - Specifieke ads uitzetten
- **Wanneer:** Ad heeft hoge spend zonder resultaat, of goedkope leads maar slechte kwaliteit
- **Wat:** Pauzeer de specifieke ad, schuif budget naar winner
- **Altijd met data:** "Pauzeer [ad naam] - €154 spend, 2 leads = €77 CPL (30d), 3x boven account gemiddelde"

### 3. Angle (🧭) - Nieuwe marketing angle testen
- **Wanneer:** Huidige angle uitgewerkt (meerdere creatives getest, allemaal boven target CPL), of branche-specifieke seizoenseffecten
- **Wat:** Concreet nieuwe angle voorstellen op basis van branche-framework
- **Altijd specifiek:** "Test subsidie-angle - huidige 3 creatives allen boven €50 CPL, angle is uitgewerkt"

### 4. Funnel (🎚) - Formulier, landingspagina of opvolging aanpassen
- **Wanneer:** Lead quality issues die niet door creative changes opgelost worden (veel "geen budget", hoge no-show rate)
- **Wat:** Leadform vragen aanpassen, overstappen van leadform naar landingspagina (of vice versa), reminder-flow toevoegen
- **Altijd met reden:** "Voeg budgetvraag toe aan leadform - 5/8 leads via [UTM] hebben 'geen budget'"

### 5. Other (🔧) - Reallocatie, targeting, overig
- **Wanneer:** Budget verdeling suboptimaal, of targeting-issue geïdentificeerd
- **Wat:** Budget verschuiven tussen ads/adsets, targeting aanpassen
- **Altijd met vergelijking:** "Verschuif budget van [ad X] (€77 CPL) naar [ad Y] (€25 CPL)"

### Hard Numbers Regel

**Elke aanbeveling MOET harde cijfers bevatten:**
- ❌ "Ad presteert goed" → ✅ "Ad heeft €25 CPL, 14 leads, 4 afspraken (30d)"
- ❌ "Slechte efficiency" → ✅ "€154 spend, 2 leads = €77 CPL - 3x boven gemiddelde"
- ❌ "Creative fatigue" → ✅ "CTR gedaald van 2.1% naar 0.8% over 30d bij €280 spend"

### Time Window Labels - verplicht op élk getal in AI output

Elk getal dat een AI agent (Watch List AI Note, Optimisation Proposal, Lead Analysis, etc.) noemt MOET inline gelabeld zijn met de tijdvenster waar het uit komt. Geen blote getallen.

- ❌ "25 leads, 0 appts = audience mismatch" → ✅ "25 leads (all-time), 0 appts (all-time) = audience mismatch"
- ❌ "8 'no budget' replies" → ✅ "8 'no budget' replies (14d)"
- ❌ "CPL €38 vs €23 prev week" → ✅ "CPL €38 (7d) vs €23 (prev 7d)"

**Geldige labels:** `(7d)` · `(14d)` · `(30d)` · `(prev 7d)` · `(all-time)` - wat van toepassing is op de bron.

**Waarom:** De Watch List kolommen tonen 7d cijfers (spend, leads, CPL, appts). De AI Note ernaast trekt vaak getallen uit bredere bronnen (all-time Monday status counts, 14d updates, 30d ad-detail data). Zonder window-label leest "25 leads" als tegenstrijdig met de "5 leads" kolom - de campaign manager denkt dat het dashboard kapot is. Het label is het bewijs dat twee verschillende getallen allebei kloppen. Zonder label sneuvelt het vertrouwen in het hele product.

**Bron-windows die AI agents standaard ontvangen:**
| Datablok | Window |
|---|---|
| KPI columns / KPI block | 7d (en `prev 7d` voor week-over-week deltas) |
| Per-client KPI vergelijking | 7d / 14d / 30d (alle drie expliciet gelabeld) |
| Monday CRM - lead status counts | all-time (lifetime board totals) |
| Monday CRM - recent update texts | 14d |
| Trengo conversations | 14d |
| Per-ad performance details | meestal 30d, label per call mee |

Als een AI agent niet kan vaststellen uit welk venster een getal komt, gebruik dat getal niet - kies een andere invalshoek.

### Data Awareness - schrijf nooit conclusies over data die je niet hebt

Elke client heeft een andere combinatie van bronnen die verbonden zijn. Vóór een AI agent een note of proposal schrijft moet hij eerst checken WELKE data daadwerkelijk beschikbaar is. Een ontbrekende bron is **niet** hetzelfde als een nul-uitkomst.

**Bron-status combinaties die voorkomen:**
| Status | Wat de AI heeft | Wat de AI NIET heeft | Wat NIET claimen |
|---|---|---|---|
| Monday CRM connected | leads, appointments, lead status, Monday updates per UTM | - | (geen restricties) |
| Monday CRM **niet** connected (geen board OF fetch failed) | Meta spend/leads/CPL/CTR (Meta-fallback) | appointments, lead quality, conversie %, lead-status sentiment | "0 appointments", "no appts", "audience mismatch - geen afspraken", conversiepercentages, "leads converteren niet", lead-quality oordelen |
| Geen Meta ad account gekoppeld | Monday-data (als CRM linked) | spend, CPL, ad performance | Cost-per-X claims, ad-fatigue oordelen, creative-iteratie aanbevelingen |
| Geen Trengo contact | KPI + Monday updates | klant-sentiment via berichten | "Klant klaagt", "klant vraagt om X" - tenzij in Monday updates |

**Waarom:** als appointments=0 staat in een KPI block terwijl Monday niet gekoppeld is, is dat 0 GEEN feit - het is afwezigheid van data. Een AI die schrijft "25 leads, 0 afspraken = audience mismatch" voor een client zonder Monday CRM ondermijnt het vertrouwen in het hele dashboard. Roy heeft dit expliciet gemarkeerd voor Juice Concepts Benelux en ZoomX: er stond "0 appointments" terwijl Monday niet gekoppeld was, dus die conclusie was onmogelijk te trekken.

**Wat WEL doen als data ontbreekt:**
- Focus op de bronnen die je wél hebt. Bij alleen Meta: CPL trend (7d/30d), CTR-decay, ad fatigue, frequency, creative variation depth, hook-iteratie kansen.
- Stel ontbrekende-data zelf voor als actie: "Verify with client - no CRM linked, ask if appointments are being booked offline" - alleen als de afwezigheid zelf het meest nuttige inzicht is.
- **Nooit verzinnen wat je niet weet.** Liever een kortere, smallere note die klopt dan een complete maar deels-fictieve.

**Implementatie-hint voor prompts:** stuur per client een expliciete `DATA AVAILABILITY` regel mee (welke bronnen connected, welke metrics trackable) en label velden die niet beschikbaar zijn als `UNKNOWN` in plaats van `0`.

### Signal Bar - geen filler in AI-genereerde lijsten

Voor elke AI-output die naast bestaande KPI-kolommen of een Insight-tekst getoond wordt (Watch List Activity Summary, Optimisation Proposals, AI Note), geldt een hoge bar: minder bullets die kloppen verslaat meer bullets die zacht of overlappend zijn.

**De drie failure modes die altijd geskipt moeten worden:**

| Failure mode | Voorbeeld (BAD) | Waarom skippen |
|---|---|---|
| **Dubbele info met Insight kolom** | "CPL elevated this week" terwijl Insight zegt "CPL up 80%" | De CM ziet het al, herhaling kost leestijd zonder waarde |
| **Bare counts zonder noemer** | "11 leads marked 'niet bereikbaar'" | Zonder totaal-pool of percentage zegt het niets - 11 op 1000 is geen probleem, 11 op 15 is een crisis. Verbieden tenzij als ratio: `X/Y (Z%, 14d)` |
| **Vage referenties zonder uitkomst** | "Pending invoicing clarification", "video timeline discussion", "ongoing content alignment" | Geen concrete actie of beslissing. Of expand naar het specifieke besluit/blocker, of skip |

**Wat WEL als signal telt:**
1. **Campaign status changes** - on hold, paused, going live, killed, resuming after content delivery
2. **Directe klant requests/decisions** - budget increase, scope change, complaint, content commitment (cite kanaal + datum)
3. **Concrete blockers** - "wacht op nieuwe creatives voor restart", "klant moet Meta business manager verifiëren"
4. **Lead-quality patterns als RATIO** - "11/15 'niet bereikbaar' (73%, 14d)", "5/8 leads via [UTM] 'geen budget' (14d)"
5. **Pattern over meerdere Trengo berichten** - herhaalde klacht, escalatie, expliciete tevredenheid

**Aantal bullets:** maximaal 3. Nul bullets is een geldig antwoord wanneer er geen concrete signalen zijn - output dan exact één regel `- No notable activity in the last 14d.` Geen padding.

**Implementatie-hint voor prompts:** stuur de huidige Insight-tekst expliciet mee in de prompt zodat de AI kan vergelijken en niet dubbel-werk produceert. Cache-key bumpen wanneer het prompt verandert zodat oude soft summaries weggaan.

### Top Ads - geen winners/losers split bij kleine ad-sets

Voor de Watch List inline-expand (en vergelijkbare per-client overzichten) toon je **één** ranglijst van top ads, gesorteerd op spend, met per-ad een verdict relatief tot de account-gemiddelde CPL. Géén aparte "Top winners" en "Top losers" panelen.

**Waarom:** klanten draaien meestal 5-10 advertenties. Met 5 ads zijn "laagste CPL met ≥3 leads" en "hoogste CPL met ≥€50 spend" niet wederzijds uitsluitend - dezelfde ad valt in beide buckets. Roy heeft dit gemarkeerd voor SiteJob: "Before/After Dynamics" stond én bij winners (€22.71 CPL, laagste) én bij losers (€22.71 CPL, hoogste). Dat sloopt het concept.

**Verdict-regels (relatief tot account-avg CPL):**
| Conditie | Verdict | UI kleur |
|---|---|---|
| `leads === 0 && spend ≥ €50` | loser | rood (CPL "-") |
| `cpl ≤ 0.7 × accountAvgCpl` | winner | groen |
| `cpl ≥ 1.4 × accountAvgCpl` | loser | rood |
| anders (incl. te weinig data om te oordelen) | neutral | muted |

Brede neutrale band (0.7 / 1.4) voorkomt dat met kleine ad-sets álles gekleurd wordt - alleen de duidelijke uitschieters krijgen een signaal.

**Filter:** ad-sets met spend < €10 (30d) negeren - micro-tests vertekenen het account-gemiddelde anders.

**Output cap:** max 5 ads, gesorteerd op spend desc. De ad waar je de meeste euro's in stopt wil je sowieso zien.

---

## Campagnestructuur (Meta)

### Standaard setup
- **1 campagne** - ABO (Ad Set Budget Optimization)
- **1 ad set** - volledig open targeting:
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

1. **Gegarandeerd resultaat** - "Ontvang een garantie op X leads/afspraken/resultaat"
2. **Gratis iets van waarde** - "Gratis X t.w.v. €X" (hogere perceived value door bedrag te noemen)
3. **Prijslijst/offerte** - "Bekijk onze tarieven" (laagdrempelig, iedereen wil dit weten)
4. **Financieel/ROI** - "Al rendabel vanaf X per dag", "Bespaar X% per maand", "Zonder directe investering"
5. **Uniek/Enige in NL/Revolutionair** - Exclusiviteit en nieuwheid
6. **Schaarste** - "We zoeken 10 bedrijven die..." (exclusief aanbod. Let op: leads kunnen denken dat het gratis is)
7. **Pijnpunten adresseren** - Specifieke problemen van de doelgroep benoemen
8. **Branche-specifiek** - Spreek de taal van de doelgroep, ad sluit aan bij de branche

### Angles per branche

#### B2B - Agencies & Consultants
- Garantie op resultaat (30 leads in eerste maand)
- Pijnpunten: "Al maanden geld verspild aan een agency?"
- Multiple choice vragen: "Gebruik je al X? Ja/Nee", "Hoeveel spend je per maand?"
- Wanneer bereikbaar, doel, huidige website

#### B2B - Product/Service
- Garantie: "Gegarandeerd 5% meer omzet met X"
- ROI: "Al rendabel bij verkoop van X per dag"
- Gratis proberen: "Probeer gratis voor 30 dagen"
- Besparen: "Bespaar tot X uur per week"
- Problemen adresseren met concrete oplossing
- "We zoeken 10 bedrijven die..."

#### B2C - Verduurzaming
- **Besparen** werkt het beste: "Bespaar €750 per maand met een warmtepomp"
- Gratis giveaway: "Ontvang 2 GRATIS zonnepanelen"
- Veel concurrentie → ad moet uniek aanbod hebben
- Vragen: adres, binnen welke termijn realiseren

#### B2C - Renovatie / Home Improvement
- **Pijnpunten**: "Is je huidige badkamer toe aan vervanging?"
- **Before/after foto's** als creative
- **(Seizoens)kortingen**: "Zomeractie: bespaar tot €400"
- Let op: weer-afhankelijk (bijv. dakdekker niet in de zomer adverteren met lekkages)
- Vragen: hoe kunnen we helpen, wanneer bereikbaar

#### B2C - Product/Service
- **Prijslijst bekijken** - lagere kwaliteit maar werkt voor volume
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
1. **Hook** (eerste 3 seconden) - stopper, moet scrollen doorbreken
2. **Body** - probleem benoemen, oplossing positioneren, social proof
3. **CTA** - duidelijke call to action

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
1. **Professionele video op locatie** (1x per kwartaal bij HTO) - b-roll, testimonials, hooks, productvisuals
2. **AI Avatar video's** - schaalbaar, snel, goedkoop. 5x meer output, 85% lagere kosten
3. **Static ads** (Canva) - foto's, afbeeldingen
4. **Manus** (Meta AI tool) - automatisch advertenties genereren
5. **Stock content** (laatste optie als klant geen eigen content heeft)

---

## Image Creative Principles (Pedro + handmatig)

> Roy 2026-06-10. Deze principes gelden voor élke AI-gegenereerde of handmatige static ad. Pedro's image-gen prompt en CM-review beide.

### 1. Logo's klein, of helemaal niet

- **Verbod op grote logo's** die de helft van de afbeelding vullen. Het logo van de klant verkoopt geen ad - de hook doet dat.
- Subtiele logo-integratie is prima: klein in een hoek, op een product zelf (kassa-display, schort, gevel), of op een receipt/menukaart in beeld. Maakt 'm "echt" zonder de aandacht te kapen.
- Helemaal géén logo is ook acceptabel - een product zonder branding is vaak sterker dan een product met een 60%-screen logo.

### 2. Géén brand-slogans als visuele tekst

- **Brand-slogans verkopen niet.** "Working on a fresh future", "Better. Faster. Stronger." - dat zijn interne tagline-flexies, geen ad copy.
- De enige tekst die op de afbeelding mag staan is de **werkelijke hook of headline** van de variant.
- Pedro mag een brand-slogan opnemen in de IMAGE_PROMPT als referentie naar de visuele stijl, maar moet expliciet verbieden dat hij als overlay-text op de output komt. ("Do not render any brand slogan or tagline as on-image text.")

### 3. Headlines zijn pijnpunt-vragen, geen product-statements

De headline-tekst op een static ad moet de doelgroep **direct in hun pijn raken**, niet een productvoordeel opsommen.

| ❌ Niet | ✅ Wel |
|---|---|
| "Verse sappen = hogere marges" | "Krijg je elke dag dezelfde vraag van je gasten: 'Hebben jullie ook verse sappen?'" |
| "Bespaar tot 40% energie" | "Te hoge energierekening ondanks je beste isolatie?" |
| "Snelle service, beste prijs" | "Wachten je klanten al weken op die offerte?" |

De vraag/pijn moet **uit de doelgroep zelf komen** - wat ze dénken of zéggen, niet wat wij over hen claimen. Pedro genereert image-prompts mét deze framing: de overlay-tekst op de afbeelding is altijd een pijnpunt-vraag of een herkenbare situatie, nooit een verkoopclaim.

### 4. Brand-kleuren + fonts gestructureerd capturen (per klant verplicht)

- Voor élke klant moeten **brand colors (hex codes)** en **font families** worden vastgelegd voordat Pedro mag genereren. Geslagen op `pedro_client_state.brand_style`.
- Auto-extractie via `analyze-website`: pakt primary/secondary/accent kleuren + dominant font uit de klant-website. CM verifieert/overrided.
- Brand kit (PDF/Drive) overschrijft auto-extractie als die er is - verplichte input bij onboarding voor klanten met een brand kit.
- Pedro's image-prompt verwijst expliciet naar de hex codes ("use #FF6B00 as accent color for the headline overlay") en font ("Sans-serif body in style of Inter / Clash Grotesk").
- **Geen brand identity vastgelegd = Pedro waarschuwt + valt terug op kleur-extractie uit reference photos**, maar markeert de output als "brand-identity missing".

### 4b. Brand-colour roles (primary / secondary / accent) — wat betekent welke kleur

> Roy 2026-06-13. De auto-classifier voor kleur-rollen (luminantie + hue afstand) raakte te vaak mis: donkerblauw werd accent, lichtblauw werd panel, etc. CM tagt nu expliciet per kleur welke rol 'ie speelt. De drie rollen mappen op hoe een ad daadwerkelijk in elkaar zit:

| Rol | Wat het is in de ad |
|---|---|
| **Primary** | De canvas / panel-achtergrond waar headline + subject op zitten. Dominante vlak. ("Donkerblauw" in de Sneller-software LP). |
| **Secondary** | De **nadruk-kleur binnen de headline** — niet de hele tekstkleur. **1-2 sleutel-woorden** (ideaal 1) krijgen deze tint: de benefit of pain point, niet artikels/filler. De rest van de headline blijft wit. Drijft ook één positief typografisch accent op diezelfde woorden (cleane underline / gevuld marker-vlak met witte tekst / soft highlighter bar / dunne cirkel om één woord). ("Lichtblauw" in de LP: "software laten ontwikkelen" + "minder budget" lit up, "Sneller" + "voor" wit). |
| **Accent** | De brand-highlight kleur voor **scene elementen**: graphic overlays, glow, particles, rim-light, gehighlighte props/icons. Eventueel óók de CTA-knop achtergrond — maar CTAs zijn **optioneel**, niet verplicht. Een schone ad zonder knop is beter dan een geforceerde knop. ("Groene" tint op de CTA én de hover-glow in de LP). |

Wit + zwart zijn altijd impliciet beschikbaar voor base tekst en elementen — die hoeven niet in de brand-color set te staan.

**Headline emphasis treatment — POSITIEVE emphasis, twee lagen tegelijk, op dezelfde 1-2 woorden:**

> Roy 2026-06-13. Eerste versie liet "DIAGONAL STRIKE-OUT" als optie staan; Gemini interpreteerde dat als letterlijke kruisstreepjes door élk woord (ziet eruit alsof de tekst doorgestreept is). Die optie is verwijderd — alle treatments moeten **positief** lezen, nooit als ontkenning of correctie.

1. **Kleur-emphasis** — de geselecteerde 1-2 nadruk-woorden krijgen de emphasis-kleur (secondary, of accent als fallback). Idealiter slechts ÉÉN woord/frase per headline; twee is het absolute max. Less is more.
2. **Typografisch accent** op DIEZELFDE woorden — kies precies één van:
   - **Cleane underline** — een enkele rechte of zacht-gebogen lijn onder het woord. Vector-clean, niet sloppy.
   - **Gevuld marker-vlak (highlighter)** — een gevulde rechthoek (of afgerond) in de emphasis-kleur achter het woord, met het woord **opnieuw gerenderd in WIT** zodat het leesbaar blijft op de fill. Sterke high-confidence treatment voor het hero-woord.
   - **Soft highlighter bar** — low-opacity (~30%) afgeronde rechthoek achter het woord; oorspronkelijke woord-kleur (emphasis colour van laag 1) schijnt erdoor.
   - **Dunne cirkel / ovaal** — een ring AROM één key word. De ring loopt ALLEEN langs de perimeter, NOOIT door de letters.

**Verboden treatments** (lezen als negatie/correctie):
- ❌ Diagonale strepen door een woord
- ❌ Horizontale strikethrough door een woord
- ❌ X-marks, slashes, scribbles op letters
- ❌ Sloppy / multi-stroke marks zoals een correctie
- ❌ Meerdere lijnen op hetzelfde woord

Nooit meer dan één typografisch accent per ad. Beide lagen versterken altijd DEZELFDE woorden — niet kleur op woord X en cirkel op woord Y.

**Implementatie:** `creative-settings.ts` slaat per kleur een `role` op (`primary` / `secondary` / `accent` / unset). `generate-image/route.ts` resolvert die naar een `BrandPalette` met positionele fallback (1e enabled = primary, 2e = accent, 3e = secondary) wanneer de CM niet expliciet getagd heeft. De `styleDirective` injecteert per slot-style de juiste rol-uitleg + het `headlineAccentBlock`.

### 4c. Reference photos = inspiratie, geen blueprint — gegarandeerde scene-variatie tussen iteraties

> Roy 2026-06-13. Een TMM creative kwam terug die letterlijk de Drive-foto (2 mannen aan een laptop met groen-blauwe circuit-board achtergrond) overnam: zelfde mensen, zelfde houding, zelfde environment, zelfde lighting. Alleen het text-panel was nieuw. Dat is geen iteratie maar een re-skin — Meta krijgt onvoldoende variantie om te leren wat werkt.

**Regel:** alle aangehechte real-photo references (Drive klant-foto's, website-images, stock) zijn er voor de **WAT** (wie is de klant, wat verkoopt 'ie, welke brand-look familie) — niet voor de **HOE** (de scene, het camera-angle, de pose, de lighting).

| Wel overnemen (WAT) | Niet overnemen (HOE) |
|---|---|
| Subject identity / appearance (als het de klant is) | De exacte scene / setting / environment |
| Product- of dienst-context | Het exacte camera-angle, framing, pose |
| Brand-look familie (kleur-temperatuur, polish-niveau) | De compositie-layout |
| Brand colour cues (via de RL roles) | Lighting setup, atmosfeer, time-of-day |

**De bar:** als de CM de output naast het reference photo legt, moet het oordeel zijn "zelfde klant, zelfde product, **compleet andere shot**" — niet "zelfde shot met een tekstpaneel".

**Per-slot variatie (gegarandeerde 3-up differentiatie):** zelfs binnen dezelfde slot-style krijgt elke slot een andere variation direction:
- Slot A → **ENVIRONMENT** swap (andere setting / background / time-of-day dan de references)
- Slot B → **FRAMING + POSE** swap (andere camera-distance + subject-actie)
- Slot C → **ATMOSPHERE + MOOD** swap (andere lighting + colour temperature + ambient feel)

Dit is hardcoded in `slotVariationHint()` zodat ook wanneer de CM 3x dezelfde slot-style kiest, de 3-up echt 3 verschillende uitvoeringen oplevert.

**Implementatie:** `referencePhotoUsageBlockFor(style)` in `generate-image/route.ts` fires zodra `drive + website + stock` count > 0 EN past zich aan per slot-style (zie §4c-bis). De `slotVariationHint(slotIndex, style)` cycle wordt per slot ge-appended aan de prompt.

### 4e. Scene reinforces the headline's argument (geen default tech-chrome)

> Roy 2026-06-14. Een TMM creative had de headline "Geen zin in honderdduizenden euro's aan softwareontwikkeling..?" — duidelijk een budget / geld-verspilling angle, gericht op kostenbewuste klanten. Pedro's AI Animation renderde generic circuit-board chrome + code particles. De headline argumenteert "stop met te veel geld uitgeven" en de visuele context zegt "dit gaat over tech". Mismatch — de scene ondersteunt de hook niet.

**Regel:** elke variant heeft een argument (de headline) en een scene. Pedro leest de headline EERST en ontwerpt de scene daaromheen zodat het argument visueel ondersteund wordt.

**Headline → scene-element mapping (richtinggevend):**

| Headline-thema | Scene cues |
|---|---|
| Geld / budget / verspilling / besparen | Munten, biljetten die wegvliegen, calculator, portemonnee, prijslabel met pijl omlaag (geen letterlijke €-bedragen), weegschaal die kantelt |
| Snelheid / fast delivery | Speedlines, motion trails, sprintende subject, klok met snelle wijzers, fast-forward pijlen |
| Kwaliteit / vakmanschap | Premium materialen, gepolijste oppervlakken, close-up texture, hand op product, precision tools |
| Schaal / groei | Pijlen omhoog, ascending bar chart, expanding compositie, multiplying subjects |
| Pijn / probleem | Tension cues: gebroken oppervlak, vallend object, bezorgde blik, verbroken keten |
| Oplossing / verlichting | Resolution cues: glad pad, lit forward path, confident subject, zon die doorbreekt |
| Tijd / deadline | Kalender, klok, hourglass, countdown |

**Wat NOOIT te doen:** circuit-board / data-stream / code-particles default chrome voor ELKE tech-adjacent klant ongeacht headline. Dat is de luiste keus en negeert de hook. Als de headline over geld gaat, zijn circuit boards de verkeerde scene zelfs voor een SaaS klant.

**Per slot style:**
- **`ai_content`** / **`ai_animation`** / **`stock_content`**: scene wordt volledig naar het headline-thema gestuurd.
- **`client_content`** / **`client_content_ai`**: locked subject blijft. Maar accent overlays / brand-coloured highlights / atmosphere cues / props in negative space tilten naar het headline-thema, niet default tech-chrome.

**Concrete test:** als je de headline weghaalt en alleen de scene laat staan, moet een buitenstaander nog steeds het thema kunnen raden binnen 2 seconden. Lukt dat niet — geen geld-cue te bekennen op een budget-headline — dan klopt de match niet.

**Implementatie:** `HEADLINE_SEMANTIC_CONTEXT_RULE` constante in `generate-image/route.ts`, wordt per slot tussen `referencePhotoUsageBlockFor(style)` en `directive` ge-injecteerd zodat Gemini de headline-mapping leest VÓÓR de stylistische directives.

### 4c-bis. Slot-style → reference-photo gedrag (slot-style is een CONTRACT)

> Roy 2026-06-14. Eerste versie van §4c paste het anti-copy framing uniform toe op álle slot styles. Resultaat: bij "Client content + AI" genereerde Pedro een totaal nieuwe persoon die niet in de Drive zat — terwijl de hele bedoeling van die slot is om de echte klant-foto te gebruiken en alleen de scene met AI te enhancen. Slot-style is geen suggestie maar een contract; reference-photo behaviour moet daar 1:1 op aansluiten.

| Slot style | Subject identity (mens / product) | Scene / environment / atmosfeer | Variation hint richtingen |
|---|---|---|---|
| **`client_content`** | LOCKED — exact same person + product uit refs | LOCKED — same scene, alleen colour grade / crop / light treatment | Colour grade / crop / light treatment (binnen dezelfde shot) |
| **`client_content_ai`** | LOCKED — exact same person + product uit refs | FREE — invent new background / environment / atmosphere | Environment / framing / atmosphere AROUND de locked subject |
| **`ai_content`** | LOOSE — refs zijn brand-DNA inspiratie (mag wel lijken op het team, mag ook anders) | FREE — fully composed AI scene | Environment / framing+pose / atmosphere+mood (full freedom) |
| **`ai_animation`** | LOOSE — subject is één van vele kinetic elementen | FREE — fully composed kinetic scene | idem `ai_content` |
| **`stock_content`** | n/a — geen subject lock | FREE — editorial stock aesthetic | idem `ai_content` |

**Waarom dit een hard contract is:** de CM kiest de slot style bewust. "Client content + AI" betekent expliciet "ik wil ECHT mijn klant in beeld, met AI als atmosfeer-laag eromheen". Als Pedro daar een vreemde stockey-looking man van maakt, is het contract gebroken — ongeacht hoe goed de output er verder uitziet.

**Wat als er geen real-photo refs zijn?** Voor `client_content` / `client_content_ai`: Pedro moet escaleren — brand-cohesive composite produceren maar de output flagaen als identity-uncertain. Niet stilletjes een willekeurig persoon verzinnen.

**Implementatie:** `referencePhotoUsageBlockFor(style: SlotStyleKey)` returnt drie verschillende blocks (HARD FIDELITY voor `client_content`, SUBJECT IDENTITY LOCK voor `client_content_ai`, loose anti-copy voor de AI-styles). `slotVariationHint(slotIndex, style)` kiest uit drie verschillende direction-sets per style zodat een "Client content + AI" slot nooit een "swap the subject" instructie krijgt.

### 4d. Subject scale & canvas density — vul de ruimte op

> Roy 2026-06-13. Een TMM creative kwam terug met 2 personen relatief klein in beeld + grote lege donkere lucht eromheen. Probleem: Meta-feed scroll geeft een **split-second** om aandacht te wekken. Lege achtergrondruimte vult dat moment niet — die ruimte schreeuwt "niet kijken". De hero subject moet de canvas vullen, niet erin zwemmen.

**Regel:** het hero subject (persoon / product / hero-element / animatie) bezet ongeveer **60-80% van het zichtbare canvas**.

| Aspect | Wel | Niet |
|---|---|---|
| Mensen | Tight chest-up of three-quarters crop, schouders raken bijna de canvas-randen | Klein figuur in groot vertrek met meters lege achtergrond |
| Producten | Confidently filling the frame; productdelen mogen off-canvas croppen voor presence | Product centred met dikke padding alle kanten op |
| Animaties / elementen | Vullen ook de ruimte op met motion / particles / accent overlays | Alleen de tekst-panel + één klein object in een grote leegte |
| Negatieve ruimte | Alleen voor het headline-panel | Niet voor "atmosfeer padding" rond de subject |

**Belangrijke override op de reference-foto's:** als de Drive klant-foto een klein subject in een grote ruimte toont, **crop in tighter** in de output. Het reference photo is een hint over WIE het subject is, niet over hoeveel ruimte 'ie inneemt.

**Headline-panel + subject zijn de twee zwaargewichten** van de compositie. Samen claimen ze vrijwel de hele canvas. Onclaimed canvas-vlak = ruimte die niet werkt voor je.

**Implementatie:** `subjectScaleRule` in `generate-image/route.ts` wordt in elke `styleDirective` ge-appended (alle 5 styles) + apart genoemd in `RL_QUALITY_RULES_COMPOSITE` als defense-in-depth.

### 5. Dual feedback-loop: per-klant STRIKT + globaal ADVISORY

> Roy 2026-06-13. Eerst was alle feedback strict per-klant. Maar sommige feedback ("geen doorstreping op tekst", "subjects groter in beeld") is geen brand-voorkeur — het is een craft-les die voor ALLE klanten geldt. Tegelijk: een Zumex-voorkeur ("logo's altijd klein") mag niet leaken naar Blendtec. Dus splitsen we de feedback in twee loops met aparte strengheid.

Elke keer dat een CM een gegenereerde image afkeurt, een prompt aanpast, of opmerkingen toevoegt na een regen-actie wordt dat opgeslagen als `pedro_creative_feedback`. Een **Haiku 4.5 classifier** loopt bij elke insert en plaatst de feedback in één van drie scopes:

| Scope | Wat | Strengheid |
|---|---|---|
| **`client`** | Brand / taste / audience / industrie-specifiek. Geldt alleen voor DEZE klant. | STRICT — Pedro mag deze fout nooit meer maken op deze klant. |
| **`global`** | Generieke craft / design / quality lessen die voor ALLE RL klanten gelden. | ADVISORY — Pedro beoordeelt per generatie of het past in de context. |
| **`both`** | Begon klant-specifiek, maar het onderliggende principe is breder. | STRIKT op de bron-klant ÉN beschikbaar in de globale pool voor andere klanten. |

**Voorbeelden classificatie:**

| Feedback | Scope | Reden |
|---|---|---|
| "Logo's altijd klein voor Zumex" | `client` | Brand-specifiek voor Zumex |
| "Klant haat stock-foto's met te witte tanden" | `client` | Per-klant taste |
| "Altijd minimaal 1 persoon in beeld" | `client` | Klant-instructie, niet universeel |
| "Geen doorstreping op tekst — leest als ontkenning" | `global` | Universele design-les |
| "Subjects groter in beeld — Meta-feed scan moment" | `global` | Universele craft-les |
| "Geen glow op letters — slechte leesbaarheid" | `global` | Universele typografie-regel |
| "Deze klant haat dat tekst glowed" | `both` | Klant-klacht waarvan het principe (geen glow op letters) globaal geldt |

**Hoe Pedro de twee loops leest bij generatie:**

1. **Per-klant strict block** (KLANT-FEEDBACK PATRONEN — STRIKT):
   - Pulled: rows met `scope IN ('client','both')` voor `client_id = current`, laatste 90d
   - Framing in de prompt: "Pedro moet ELKE volgende imagePrompt voor deze klant hierop afstemmen; deze regels zijn brand/taste/audience-specifiek en niet onderhandelbaar"

2. **Globale advisory block** (GLOBALE CRAFT-NOTES):
   - Pulled: rows met `scope IN ('global','both')` van ALLE klanten behalve de huidige, laatste 180d (langere window want craft-lessen verouderen langzamer), gededupliceerd op text-similarity
   - Framing in de prompt: "Pedro beoordeelt PER GENERATIE of een note relevant is voor deze specifieke variant — pas alleen toe wanneer het past in de context, negeer wanneer het botst met klant-specifieke voorkeuren of brief-richting"

Bij botsing wint de per-klant block altijd (framing zegt het expliciet). Pedro krijgt zo de "double feedback loop": fouten van klant X worden nooit herhaald op klant X, EN als die fout van klant X eigenlijk een algemene les was, leert klant Y daar ook van.

**Implementatie:**
- Migratie `20240075000000_pedro_creative_feedback_scope.sql` voegt `scope` + `scope_rationale` toe aan de bestaande tabel (default `'client'` voor backwards-compat)
- `src/lib/pedro/feedback-scope-classifier.ts` — Haiku 4.5 classifier (~$0.0003/call, ~1s); failt open naar `'client'`
- `src/lib/pedro/feedback-insert.ts` — shared insert helper; alle 4 inserts gaan hier doorheen (explicit feedback button / regen feedback / prompt edit / handmatige upload)
- `src/lib/pedro/creative-refresh-context.ts` — `fetchCreativeFeedback` (strict, per-klant) + `fetchGlobalCreativeFeedback` (advisory, cross-klant) + twee aparte format-blocks

**Doel:** hoe meer iteraties over de hele klantbasis, hoe sneller Pedro het algemene craft-niveau optilt — terwijl per-klant fouten geïsoleerd blijven. **Iteratie is leerdata, geen kosten-post.**

### 6. Typografie + alignment quality bar - marketing-agency deliverable

> Roy 2026-06-10. Een Zumex generatie kwam terug met 3 concurrerende badges ("LAGE MARGE" / "3x MARGE" twee keer / "€2.50" / "€3.000" / "€5.50" / "€6.00") plus een QualityFry watermerk op een Zumex shot. Dit kunnen wij als bureau niet leveren. Generatieve modellen "vullen" automatisch met badges/labels als de prompt niet expliciet verbiedt. Pedro's image-prompt moet strakke regels meegeven, EN de Hub stamps deze regels hardcoded op elke Gemini-call (defense-in-depth).

**Hard rules - niet onderhandelbaar:**

| # | Regel | Reden |
|---|---|---|
| 1 | **EXACTLY ONE on-image text element** - de Dutch headline. Niets anders. | Modellen dupliceren badges; één element verzekert leesbaarheid |
| 2 | **NO badges, prijslabels (€..), multiplier-stickers (3x/2x), comparison-labels (LAGE/HOGE), watermarks, sub-captions, sticker overlays** | Maakt collage-look, niet professioneel |
| 3 | **Render headline ONCE, één positie** - never twice, never split across boxes | Modellen herhalen graag dezelfde tekst in 2-3 plekken |
| 4 | **ONE sans-serif typeface** voor de hele headline. Even letter-spacing. Consistente weight. | Mixed fonts schreeuwen "AI" |
| 5 | **≥8% canvas padding** rond de headline op alle kanten. Headline in negative space, nooit op visueel drukke detail | Voorkomt overlap met onderwerp |
| 6 | **Eén kleur** voor de headline (brand accent OR pure zwart/wit). GEEN mixed fill+outline | Mixed treatments lezen amateuristisch |
| 7 | **Eén foto-subject in focus** - geen split-screen of collage, tenzij expliciet gevraagd | Drukte = onleesbaar in feed |
| 8 | **Geen concurrerende brand-namen** zichtbaar (geen QualityFry/Blendtec in een Zumex shot) | Confuses brand-attribution |
| 9 | **Brand-aanwezigheid alleen subtiel + natuurlijk** op productoppervlak (klein, in-context) | Grote logo's verkopen niet |
| 10 | **Headline TEXT rendert schoon** — geen glow halo om de letters, geen kleur-gradient binnen de letters, geen blur op de tekst. Glow/atmosfeer hoort op SCENE-elementen (overlays, particles, omgeving), niet op de letterforms. Tight 1-2px harde drop-shadow is OK; diffuse glow rond text is NIET OK | Roy 2026-06-13: TMM creative had glow-gradient onder de tekst die de leesbaarheid pakte. Tekst is een graphic-design element, geen verlicht object |
| 11 | **CTA buttons zijn OPTIONEEL** — alleen renderen wanneer de headline er om vraagt (Bekijk / Vraag aan / Plan / Ontdek / Start) EN de compositie ruimte heeft. Een schone ad zonder CTA is beter dan een geforceerde knop | Roy 2026-06-13: CTA is geen hero-element, accent-kleur landt liever op scene elementen dan op een verplichte knop |
| 12 | **Subject domineert canvas (~60-80%)**. Tight crop op mensen/producten/hero element. Geen "klein figuur in groot vertrek"-composities. Lege achtergrond = verspilde stopping-power op Meta-feed | Roy 2026-06-13: TMM creative had 2 mannen klein in beeld met veel donkere lucht eromheen — split-second scroll-attentie wordt verloren. Zie §4d voor de volle regel |
| 13 | **Geen mid-woord afbrekingen**. Een woord wordt NOOIT mid-woord gesplitst met een streepje (geen "softwareont-" op regel N + "wikkeling" op regel N+1) — dat leest als een typo. **Nederlandse samengestelde woorden** (compounds: "softwareontwikkeling" = software + ontwikkeling, "klantenservice" = klanten + service, "verduurzaming" = ver + duurzaming) MOGEN op de **morpheem-grens** breken zonder streepje wanneer de compound te lang is voor één regel — "software" op regel N, "ontwikkeling" op regel N+1 (zonder hyphen). Solitaire (niet-samengestelde) woorden blijven ALTIJD intact; past 'm niet: (1) kleiner font, (2) re-flow line breaks, (3) panel iets breder — kies één. Line breaks landen alleen op whole-word of morpheem-boundaries; lijnspacing + linker-edge alignment consistent; panel sized to headline, niet andersom (geen 40% lege onderkant) | Roy 2026-06-14: TMM creative renderde "softwareont-/wikkeling" — leest als typo. Roy 2026-06-14 update: alternatief voor te lange compounds is morpheem-break ("software"/"ontwikkeling"), niet halverwege "ont-". Bij solitaire woorden gewoon shrinken |
| 14 | **Scene reinforces the headline's argument**. Read the headline FIRST, design scene to back it up VISUALLY. Money/budget/waste → financiële illustraties, geld dat wegvliegt, calculator. Speed → speedlines / motion trails. Quality → premium materials, polished texture. Pain → tension cues. Geen default circuit-board chrome voor ELKE tech-klant ongeacht headline | Roy 2026-06-14: TMM headline ging over "honderdduizenden euro's verspillen aan softwareontwikkeling" — Pedro renderde generic circuit-board animatie. Headline argument (geld / budget) en visuele context (tech generic) sloten niet op elkaar aan |
| 15 | **Headline rendert LETTERLIJK**. De op-image tekst is een woord-voor-woord, karakter-voor-karakter weergave van de supplied headline string. Geen verdubbelde tokens binnen de headline ("software software ontwikkeling" terwijl de string "softwareontwikkeling" was), geen ingevoegde woorden, geen weggelaten woorden, geen volgorde-wijzigingen. Image-gen modellen "stotteren" graag op compound-achtige tekst — expliciet verbieden | Roy 2026-06-14: TMM Variant B renderde "software" twee keer in de op-image headline terwijl de supplied string het woord één keer bevatte. Rule #1 verbiedt dubbele tekst-elementen maar niet token-verdubbeling binnen één element |

**Implementatie (Hub side):**
- Pedro's `imagePrompt` JSON-veld bevat A-F regels per variant.
- `/api/pedro/variants/[id]/generate-image` plakt een **hardcoded `RL_QUALITY_RULES` suffix** op elke Gemini-call met expliciete `NEGATIVE: …` lijst. Pedro's eigen prompt-output kan dit niet ondermijnen.
- Bij regen-feedback ("design / styling") krijgt Gemini de specifieke pain-point boven op deze base rules.

**Wat NIET in deze sectie zit:** preferenties die per klant verschillen (logo-grootte, fontkeuze, stock-fotos ja/nee). Die horen in `brand_style` + `pedro_creative_feedback` per klant. Bovenstaande regels gelden voor ALLE klanten zonder uitzondering.

### 7. Visual Reference Library (per 2026-06-11)

> Roy 2026-06-11. Tekstuele kwaliteitsregels alleen leveren generieke output - Gemini ankert veel sterker op visuele referenties dan op prescriptief proza. Pedro injecteert daarom per image-generatie 2-3 referenties uit een Drive map met winning ad creatives. Dit tilt de visuele kwaliteit substantieel: composition, lighting, mood, typografie krijgen een echte anker in plaats van te leunen op "use bold typography, high contrast" type instructies die per definitie ambigu zijn.

**Folder structuur — `AD CREATIVES INSPIRATION/`** (in `RL Clients` Drive):

| Subfolder | Wat | Wanneer aan |
|---|---|---|
| `Client content/` | Pure klant-foto's. Top tier - meest authentiek, hoogste perceived quality. | Default aan |
| `Client content + AI/` | Klant-foto's met AI-polish (composition, lighting, retouching). Default landing voor CM-uploads. Top tier. | Default aan |
| `AI Content/` | Volledig AI-gegenereerd. Goede toevoeging bovenop client content - lichte AI-touch tilt vaak de eindcompositie. | Default aan |
| `AI Animation/` | AI video/motion. Voor video refresh - nu beperkt gebruikt, klaarliggend voor wanneer Pedro video gaat genereren. | Default aan |
| `Stock content/` | Stock fallback. Alleen wanneer expliciet gekozen door CM - in lijn met process.md roadblock #2: stock is altijd de laatste optie. | Default UIT |

**Selectie per klant** (CM-controlled):
- Per klant kan een Campaign Manager via een chip-rij op de Pedro Creative Refresh tab aanvinken welke subfolders meedoen.
- Default: alle 4 aan behalve Stock. Sommige klanten willen alleen pure client content (geen AI variatie), andere willen juist meer AI lift - dat is per-klant overrideable.
- Wijziging slaat instant op (per-client persistence in `pedro_inspiration_prefs`).

**Selectie algoritme tijdens generatie**:
- Pedro pakt 2-3 referenties random uit de aangevinkte mappen.
- Lichte bias: Client content / Client + AI krijgen ~2× zoveel selectie-gewicht als AI Content / AI Animation - authentieker = vaker doorgegeven aan Gemini.
- Tenminste 1 referentie uit AI Content of AI Animation komt mee wanneer aangevinkt - die geven stylistische lift.
- Wanneer geen enkele subfolder is aangevinkt: skip de visual library (geen blokker, refresh werkt zonder).

**Gemini prompt-instructie** (hardcoded suffix bij elke generation met refs):
```
You will see N reference images attached. Use these ONLY as a
composition + lighting + mood + typography reference - DO NOT copy
specific text, layouts, subjects, or product elements. The goal is
to match the visual quality bar, not the content.
```

**Auto-promote feedback loop**:
- Wanneer een variant succesvol naar Meta gepushed wordt (push-to-Meta success), wordt het beeld automatisch gekopieerd naar `Client content + AI/` als default landing zone. Naam: `{client}-{angle}-{YYYY-MM-DD}.jpg`.
- CM kan optioneel een andere bestemmingsmap kiezen op upload-moment via een dropdown naast de upload-knop ("Add to inspiration: [folder ▼]"). Default = Client content + AI.
- Optie "Don't add" voor edge cases (placeholder, test, fix-upload).
- Later (Phase 2): cron checkt na 14d of de Meta-ad onder account-avg CPL is gebleven - zo niet, archiveer de ref uit de library (verplaatst naar een `archive/` map) om vergiftiging te voorkomen.

**Implementatie locatie**:
- Drive folder ID configureerbaar in Settings → Pedro tab.
- Library reader cached subfolder listings (1u TTL) in `src/lib/pedro/visual-reference-library.ts`.
- Per-client selectie-prefs in `pedro_inspiration_prefs` Supabase tabel.
- Hook in `/api/pedro/variants/[id]/generate-image` voegt refs toe aan Gemini-call als inline images.
- Hook in `/api/pedro/proposals/[refreshId]/[proposalIndex]/push-to-meta` doet auto-promote bij success.

---

## Volledige Video Scripts - RL 3.0 Campagnes

> Gebruik als referentie bij het schrijven van nieuwe ad copy of het briefen van video-opnames.

### PVA / Standaard Body (generiek inzetbaar na elke hook)

> De meesten zullen deze video negeren, maar als jij deze video tot het einde kijkt, hoor je waarschijnlijk bij de 10% die WEL meegaat. Jij zal niet alleen je concurrenten voorbijsteken, maar de online markt domineren door de marketing in je bedrijf naar een volledig automatische piloot te brengen.
>
> Met deze onontdekte methode kun jij op automatische piloot nieuwe offerte-aanvragen & betalende klanten aantrekken zonder dat je sales team elke dag achter leads aan hoeft te jagen. AI en automatiseringen zorgen ervoor dat jouw bedrijfsprocessen op volledige snelheid draaien, zodat je meer klanten krijgt, terwijl jij meer tijd overhoudt om je focus op groei te houden.
>
> We rollen momenteel een exclusieve methode uit voor een selecte groep bedrijven om te testen. Dit is jouw kans om als een van de eersten gebruik te maken van RL 3.0 die jouw agenda automatisch vult. We zitten nog in de startfase, dus de mogelijkheid is nu groter dan ooit dat jouw bedrijf hiervan kan profiteren voordat we de methode breder lanceren. Zodra we live gaan, is de kans om mee te doen veel kleiner, dus grijp deze kans nu en ontdek of jouw bedrijf geschikt is.

---

### Video 1 - AI/Automatisering angle

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

### Video 1 - Meta twijfel angle

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

### Video 1 - RL 3.0 angle

**Hooks:**
1. Wil je 24/7 grip op jouw marketing en sales?
2. Stel je voor dat je leads als hyena's opgevolgd worden, met 11 contactmomenten binnen 48 uur.
3. Als marketing voor jou altijd een gevecht is, waarom laat je jezelf dan niet eindelijk winnen?
4. Je zit vast in marketing die werkt als een onbetrouwbare vriendin. Het lijkt wel goed, maar faalt op het moment dat je het het meeste nodig hebt.
5. Je hebt net weer 5 potentiële klanten gemist. En je weet niet eens aan wie.

---

### Video 2 - Fake Nieuwsbericht

| # | Hook | Visuele richting |
|---|---|---|
| 1 | Jan ging met zijn bedrijf van nul naar 10.000 afspraken per maand zonder ook maar één telefoontje te plegen! | Roy op reuze-eenhoorn zwemband met laptop |
| 2 | Wist je dat Mark €500.000 omzet behaalde in 3 maanden tijd zonder ooit zijn agenda open te trekken? | Op de bank in pyjama in een freehouse |
| 3 | Deze B.V is van €10.000 naar €2.500.000 maandomzet gegaan met één simpele automatisering. Geen cold calling, geen urenlange meetings. | - |
| 4 | Ondernemers versterken elkaar en profiteren van een ROI van zo'n 80%! | - |
| 5 | Elke week 10 nieuwe klanten voor de rest van je leven met slechts 1 simpele software! | Maaltijd, chill met beentjes omhoog |

**Body:**
> Je hebt vast al vaker zulke ongelooflijke verhalen gehoord, maar helaas is het niet zo eenvoudig. Wat wel mogelijk is, is Rocket Leads 3.0. Dit is geen magische oplossing, maar wel een compleet systeem waarmee jij geautomatiseerd gekwalificeerde afspraken ontvangt, zonder dat je daar zelf veel voor hoeft te doen.
>
> We leveren meer dan alleen afspraken - wat we bieden is een module die bestaat uit automatiseringen, triggers, loops, e-mails en meer, waarmee warme leads continu aan je digitale dashboard komen. Je hoeft alleen maar te profiteren van een stijgende omzet.
>
> Benieuwd naar dit framework en of jouw bedrijf geschikt is? Klik op de knop en plan vrijblijvend een kennismaking in!

---

### Video 3 - Pijnpunt CRM

**Hooks:**
1. Wist je dat maar liefst 70% van je leads verloren gaat door trage opvolging in je CRM? Als je denkt dat je geen tijd hebt om het bij te houden, dan heb je waarschijnlijk gelijk - maar dat hoeft niet zo te blijven.
2. Waarom krijg jij je leads niet op tijd in gesprek? 67% van de ondernemers geeft aan dat het CRM-systeem hen juist tegenhoudt in plaats van helpt.
3. Heb jij ook last van leads die vast blijven hangen in je CRM en uiteindelijk nooit kopen?
4. Heb jij een bak aan leads die niet gekwalificeerd zijn of hun telefoon niet opnemen?
5. 90% van de ondernemers gebruiken hun CRM systeem niet goed waardoor het ze uiteindelijk meer tijd kost dan oplevert!

**Body:**
> Rocket Leads 3.0 verandert dit! Aanvragen komen direct in jouw marketing- en salesmachine. Wij zorgen voor meerdere contactmomenten voor de ultieme opvolging en automatiseren je sales zodra een afspraak is ingepland. Profiteer van een unieke afspraakloop op autopilot, terwijl jij je omzet ziet stijgen.
>
> Wij zijn een van de eersten die deze technieken toepassen in Nederland en gaan graag samen met jou in gesprek om te zien of deze gamechanger ook voor jou toepasbaar is. Plan een korte kennismaking in via onderstaande knop.

---

### Video 4 - Pijnpunt Oude Leads

| # | Hook | Visuele richting |
|---|---|---|
| 1 | Heb jij enorm veel (oude) leads in je CRM waar je niets mee doet? Dan laat je duizenden euro's liggen. | Geld in de lucht gooien |
| 2 | Waarom blijf je geld verbranden aan nieuwe leads als er nog goud in je CRM ligt? | Shot van geld dat verbrand wordt |
| 3 | Hoeveel leads in jouw CRM zijn na één belletje of mailtje nooit meer opgevolgd? | Telefoon neergelegd, CRM vol ongeopende leads |
| 4 | 80% van bedrijven benaderen hun oude leads niet en laten daar duizenden euro's mee liggen. | Geld in prullenbak gooien |
| 5 | Gratis afspraken of dure betaalde afspraken - de keuze lijkt simpel. Maar gek genoeg kiezen veel bedrijven voor het laatste. | - |
| 6 | Waarom zou je betalen voor afspraken als je ze ook gratis kunt krijgen? | - |
| 7 | Meer dan 33 gekwalificeerde afspraken in een maand zonder te adverteren! | - |

**Body:**
> Oude leads die ooit interesse hebben getoond, verdwijnen vaak na één belletje of mailtje in de vergetelheid. En juist dáár laat je omzet liggen.
>
> Het probleem is niet dat je te weinig leads hebt - het probleem is dat je niet alles uit de leads haalt die je al bezit. Met een gestructureerde opvolging kun je die slapende kansen wakker maken en direct omzetten in nieuwe afspraken en omzet.
>
> Dit levert je duizenden euro's extra op, zonder ook maar één euro extra aan advertenties uit te geven.
>
> Benieuwd hoe jouw bedrijf meer afspraken krijgt zonder te adverteren? Klik op onderstaande knop.

---

### Video 5 - Pijnpunt Bedrijf Staat Stil

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

### Video 5 - Leo angle (branchespecifiek, professioneel)

**Hooks:**
1. Ben jij {functie} van een {branche} bedrijf? Dit is jouw unieke kans om marktleider binnen jouw regio te worden!
2. CEO's gezocht in de {branche}!
3. Wij zoeken 5 bijzondere bedrijven in de {branche}.

**Body:**
> Zet je bedrijf op een nationaal podium en krijg de aandacht die het verdient. Je zit stil terwijl jouw concurrenten de leads op automatische piloot binnenhalen. Waarom? Omdat jij nog niet gebruik maakt van een eigen marketing- en salesmachine.
>
> Stop met het verliezen van tijd en geld. Dit is de kans om je bedrijf echt te laten groeien. Wij selecteren slechts 5 bedrijven deze maand om onze methode te ontdekken. Klik op de knop voor meer informatie.

---

### Video 6 - Lege Agenda

**Hooks:**
1. Nog zo'n lead die zegt 'ik laat iets weten'… en daarna nooit meer reageert?
2. Je investeert in marketing, maar je agenda blijft leeg. Herkenbaar?
3. Lege agenda's, trage opvolging… en wéér een maand zonder resultaat?
4. Leads die niet opnemen, niet terugbellen en niet komen opdagen - het is om gek van te worden.
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

### Video 6 - AI UGC vorm

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

### Video 6.1 - AI UGC Iteratie

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

### Video 6 V2 - Branchespecifiek

**Hooks:**
1. Ben jij eigenaar van een interieurbedrijf en wil jij je positioneren als dé partner in jouw regio? Dan is dit jouw kans om je omzet structureel te laten groeien!
2. Ben jij eigenaar van een bedrijf dat gespecialiseerd is in het verwarmen van woningen? Dan is dit jouw kans om je omzet structureel te laten groeien!
3. Wij zijn op zoek naar 5 renovatiebedrijven die nieuwe partners willen aantrekken! Ontdek de enige marketing- en salesmachine in Nederland die met behulp van AI jouw ideale klanten aantrekt.

**CTA:** Benieuwd naar de mogelijkheden? Klik hieronder en ontdek of jouw bedrijf geschikt is.

---

### Video 7 - Stabiele Stroom

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

### Video 8 - Druk maar Lege Agenda

**Hooks:**
1. Je dagen zitten vol, maar nieuwe klanten krijgen voelt nog steeds als losse flodders.
2. Hoe hard je ook werkt, het blijft lastig om een constante stroom klanten op te bouwen.
3. Je team draait wéér een drukke week, maar de agenda blijft leeg.

**Body:**
> Altijd bezig met klanten, personeel en offertes - en voor marketing is geen tijd. En die keren dat je het uitbesteedde? Mooie beloftes, weinig resultaat. Je wilt gewoon nieuwe klanten. Zonder gezeik.
>
> Maar zo doorgaan? De ene maand druk, de volgende stil. Geen rust. Geen voorspelbaarheid.
>
> Stel je voor dat dat verandert. Elke week kwalitatieve leads en afspraken in je inbox. Een volle agenda en een team dat continu aan het werk is.
>
> Bij Rocket Leads bouwen we dat systeem voor je. Geen marketingtaal, maar gewoon: meer klanten. Meer omzet. Minder gedoe.

---

### Video 9 - Agency vs In-house

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

### Video 10 - AI Avatar (generiek)

**Hooks:**
1. Stel je voor dat je nooit meer zelf voor de camera hoeft te staan, maar tóch elke week nieuwe video's hebt die jouw bedrijf laten groeien.
2. Geen zin en tijd om elke week video's op te nemen? Laat je AI-avatar het doen!
3. Hi, ik ben Twan - de AI-avatar die jouw content draait terwijl jij andere dingen doet.
4. Hoeveel tijd verlies je nog aan opnames en edits… terwijl je AI avatar in minuten nieuwe varianten maakt en tot 85% goedkoper is.

**Body:**
> Iedere ondernemer weet hoe belangrijk video is voor marketing, maar niemand heeft zin in de camera-stress, tijdsdruk en eindeloze retakes. Wat als dat hele proces voor altijd van je bord verdwijnt?
>
> Wij maken jouw AI-avatar en produceren alle video-ads ermee, zodat je content 24/7 blijft lopen zonder dat je zelf hoeft te filmen.
>
> De voordelen: onbeperkte variaties zonder extra kosten, 5x hogere output per week, 85% lagere productiekosten - en het belangrijkste: betere resultaten dan ooit tevoren.

---

### Video 10.1 - AI Avatar + Leadgeneratie combo

**Hooks:**
1. Geen zin en tijd om elke week video's op te nemen? Laat je AI-avatar het doen!
2. Hi, ik ben Linda - de AI-avatar die jouw leads binnenhaalt terwijl jij andere dingen doet.
3. Hoeveel tijd verlies je nog aan opnames én leadgeneratie… terwijl je AI-avatar beide automatiseert, 24/7 leads binnenhaalt en tot 85% goedkoper is.
4. Leads genereren kost tijd en video ads maken ook. Wat als één systeem beide regelt?

**Body:**
> Iedere ondernemer weet hoe belangrijk video ads zijn om leads te genereren, maar niemand heeft zin in de camera-stress, tijdsdruk en eindeloze retakes. En zodra je stopt met opnemen? Stoppen je leads ook.
>
> Wij maken jouw AI-avatar en zetten een systeem op dat continu kwalitatieve leads genereert, zodat je content én afspraken 24/7 blijft doorlopen zonder dat je zelf hoeft te filmen.
>
> De voordelen: onbeperkte video variaties, 5x hogere output per week, 85% lagere productiekosten - en kwalitatieve afspraken op de automatische piloot.

---

### Video 10 - AI Avatar Roy (studio versie)

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

### Video 11 - Roy Studio (FTC angle)

**Hooks - B-roll:**
1. {{Branche}} opgelet!
2. Ben jij op zoek naar leads voor {{branche}}?
3. Wij zoeken X {{branche}}-bedrijven die willen groeien.
4. Ben jij eigenaar van een interieurbedrijf met een salesteam? Dat kost je waarschijnlijk bakken met geld.

**Hooks - FTC (confronterend):**
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

### Video 12 - Algemeen

**Hooks:**
1. Ben je het zat om tijd te verspillen aan leads die nergens naartoe leiden?
2. Ben jij eigenaar van een BV met een salesteam? Dat kost je waarschijnlijk bakken met geld.
3. Vraag je je af hoe je je agenda dit jaar vol krijgt?
4. Geen constante stroom aan afspraken?

---

### Video 13 - Groeicalculator

**Hooks:**
1. Benieuwd hoeveel extra leads en omzet er voor jouw bedrijf mogelijk zijn?
2. Wat als je kon berekenen hoeveel afspraken en omzet je structureel laat liggen?
3. Volgende week miljonair? Nee, dat beloven we niet. Wij laten liever zien wat er nú al mogelijk is in jouw markt - en dat is vaak meer dan gedacht.
4. 300% tot 900% rendement is wat wij gemiddeld realiseren voor onze klanten! Ontdek binnen 1 minuut of dit ook voor jou haalbaar is via onze gratis calculator.
5. Gemiddeld 25-80 extra afspraken en aanvragen per maand voor onze klanten. Check binnen 1 minuut wat voor jouw bedrijf mogelijk is.

**Body:**
> Veel ondernemers voelen dat er meer in zit. Meer aanvragen. Meer afspraken. Meer omzet. Maar het blijft vaag. En zonder duidelijke cijfers blijft groei een gok.
>
> Bij Rocket Leads beginnen we niet met campagnes. We beginnen met rekenen. Op basis van 8+ jaar ervaring, duizenden campagnes en 2000+ bedrijven geholpen te hebben, berekenen we hoeveel leads haalbaar zijn, hoeveel afspraken daaruit volgen, en wat dat betekent voor jouw omzet. Pas daarna bouwen we het systeem dat dit ook daadwerkelijk realiseert, elke week opnieuw.

---

### Video 14 - Seizoensgebonden

**Hooks:**
1. Heb jij een bedrijf dat in de winter amper groeit? Dan geef ik je de garantie: dit wordt een zwaar voorjaar.
2. Als je eerlijk bent levert dit seizoen je nauwelijks nieuwe klanten op. Maar dat tekort moet je de rest van het jaar inhalen.
3. Heb jij een bedrijf dat op koude dagen bijna geen nieuwe klanten ziet binnenkomen? Die stilte voel je straks gegarandeerd in je omzet.

**Body:**
> Maar wat als dit rustige seizoen juist het moment is om een voorsprong te bouwen - zonder meer uren, zonder extra personeel en zonder torenhoge advertentiekosten?
>
> Met dit systeem hebben we al meer dan 2000 ondernemers geholpen om het hele jaar door hun pipeline gevuld te houden. Zodat zij het voorjaar ingaan met aanvragen in plaats van stress.

---

## New Offer Scripts

### Video 1 - Eén aanspreekpunt / Totaalplaatje

**Hooks:**
1. 3 bureaus. Drie verschillende meningen. En uiteindelijk 0 resultaat.
2. Het feit dat je marketing niet werkt ligt niet aan jou of de partners… maar aan het feit dat je met meerdere partners werkt en niemand het totaalplaatje bewaakt.
3. Als jouw ads niet werken, je content niet converteert en je opvolging hapert… wie is er dan verantwoordelijk?
4. Je investeert steeds meer budget in marketing, je omzet stijgt niet, marges krimpen - en iedere partij geeft een andere oorzaak.

**Body:**
> Je hebt iemand voor je content, iemand anders voor je advertenties, de opvolging doe je in-house, en je hebt ergens nog iemand voor emailmarketing. Niemand pakt de regie. Iedere partij focust op zijn eigen stukje. Hierdoor zal je nooit echt doorkunnen groeien.
>
> Daarom brengen wij vanaf nu alles samen onder 1 dak: content, advertenties, funnels, opvolging en automatiseringen. Zodat elke euro die je uitgeeft ook echt richting omzet gaat.
>
> Voor TV Media Partners hebben we meer dan €350.000 aan advertentiebudget beheerd, 20.000+ leads over 3 landen gegenereerd, met meer dan €2 miljoen euro extra omzet als resultaat.
>
> Geen vingers wijzen, geen excuusjes, geen ruis. Gewoon één partij die verantwoordelijk is voor het eindresultaat.

---

### Video 2 - Content Machine

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
> Het resultaat: 5x meer advertentiecreatives per week, 85% lagere productiekosten, onbeperkte variaties - en betere resultaten dan ooit tevoren.
>
> Bij Dr. Ludidi genereerden we met €5.000 ad spend meer dan 500 aanvragen en 10 high-ticket deals. Voor TV Media Partners leidde €350.000+ budget tot meer dan €2M extra omzet.

---

### Video 3 - €3K Spend

**Hooks:**
1. Spendeer jij maandelijks minimaal €3.000 aan ad budget? Dan geef ik jou de garantie dat wij sneller, beter en goedkoper afspraken kunnen genereren voor jouw bedrijf op automatische piloot!
2. Spendeer jij duizenden euro's per maand aan ads, maar heb je nog geen content systeem dat dagelijks nieuwe creatives kan lanceren? Dan verbrand je waarschijnlijk je budget.
3. Je geeft €3.000 of meer per maand uit aan advertenties, maar onderaan de streep hou je amper iets over. Er moet toch een manier zijn waarop dit wel rendabel kan?
4. Ondernemers die meer dan €3.000 per maand spenderen aan advertenties lopen allemaal tegen hetzelfde aan: verzadiging door te weinig variatie.

**Body:**
> Bij Rocket Leads draaien we al 8 jaar mee, en we hebben een flinke verandering gezien in de strategie die werkt op Meta. Vroeger optimaliseerden we campagnes en doelgroepen - maar nu zijn winnende video creatives het enige dat telt.
>
> We hebben meer dan 2000 bedrijven geholpen en naar schatting meer dan €75 miljoen omzet gegenereerd via performance marketing.
>
> Neem Brian van Werk en Berg: met €13.000 adspend hebben we meer dan €1.000.000 omzet gerealiseerd.
>
> Als jij een advertentiebudget hebt van minimaal €100 per dag, plan dan een groeisessie in. We laten je direct zien waar je winst laat liggen, hoe je de aantallen consistenter krijgt en wat er nodig is om de kwaliteit van de afspraken te verbeteren.

---

### Video 4 - Branches met spend (selfie mode buiten)

**Hooks:**
1. Run jij een bedrijf in de renovatiebranche dat maandelijks duizenden euro's spendeert aan een marketingbureau en heb je het idee dat je te veel betaalt voor wat je daadwerkelijk krijgt? Bij ons is dit anders.
2. Verkoop jij high ticket producten van minimaal €5.000 aan de zakelijke markt en wil je consistent nieuwe klanten aantrekken?
3. Als jij elke maand duizenden euro's verbrandt om je unieke maatwerk producten te verkopen… is het product niet het probleem.
4. Draai jij maandelijks een ton aan omzet maar merk je dat advertenties je niet meer verder brengen? Dit heeft niet te maken met je dienst, maar de manier waarop je jezelf promoot.
5. Betaal jij nu €200 per afspraak en ben je tevreden? Geloof me… daar zit nog veel meer winst.

**Body:**
> Ik ben Roy, eigenaar van Rocket Leads. Als jij maandelijks duizenden euro's uitgeeft aan marketing maar je voelt dat het te weinig oplevert - dan ligt dat meestal niet aan je product of dienst.
>
> Het probleem is dat marketing bij de meeste bedrijven geen systeem is. Je hebt een ads-partij, een contentpartij, en ergens nog opvolging… maar niemand pakt de regie. En daardoor verdwijnt je budget in ruis, vertraging en te weinig output.
>
> Bij Rocket Leads brengen we alles samen onder 1 dak: advertenties, maandelijkse content, funnels, opvolging en automatiseringen. Zodat jij één aanspreekpunt hebt, één plan, en één team dat verantwoordelijk is voor resultaat, dag in dag uit.
>
> Dat doen we al 8+ jaar voor 2000+ bedrijven - niet via een copy-paste systeem, maar via een unieke funnel exclusief gebouwd voor jouw bedrijf.

---

### Video 5.1 - AI Avatar Winners (performance angle)

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

### Video 7 - AI Bouw/Renovatie (AI avatar in setting)

**Setting:** Bouw/renovatie omgeving

**Hooks:**
1. Terwijl jij aan het renoveren bent lopen er gekwalificeerde klanten aan je voorbij. Ik ben AI en ik lever ze gewoon voor je aan.
2. Aannemers opgelet - stel je voor: je hoeft nooit meer zelf te zoeken naar klanten, nooit meer voor de camera, nooit meer hopen dat de telefoon gaat. Ik ben de AI die dat voor je regelt en ik stop nooit.
3. Bouwbedrijven lopen maandelijks duizenden euro's mis, simpelweg omdat ze het verkeerde systeem gebruiken. Ik ga je laten zien hoe dat anders kan.

**Body:**
> Ik ben een AI Avatar, en mijn enige taak is dit: jou aan de lopende band kwalitatieve afspraken bezorgen met mensen die al geïnteresseerd zijn in wat jij doet.
>
> Bedrijven die mij inzetten genereren gemiddeld €30.000 - €80.000 meer maandelijkse omzet, zonder dat jij daar iets voor hoeft te doen. De vraag is alleen: hoelang wacht jij nog?

---

## Presentatie / Pitch Deck Structuur

| Slide | Inhoud |
|---|---|
| 1 | Sterke zet - bevestiging kennismaking ingepland |
| 2 | Wie is Rocket Leads? |
| 3 | #1 leadgeneratie agency - focus op performance, niet targeting |
| 4 | 8+ jaar / €18M adspend / €75M+ omzet / 2000+ bedrijven |
| 5 | Wat kun je verwachten? |
| 6 | Online kennismaking via Google Meet - groeisessie, geen standaard salescall |
| 7 | RL 3.0 - 4 pijlers: content + funnel + dashboard + opvolging |
| 8 | Complete strategie-setup: doelgroeponderzoek, LP's, ads, tracking, automatiseringen |
| 9 | Focus op gekwalificeerde afspraken - niet op likes, bereik of "leads" |
| 10 | Waarom uitbesteden? (zelf doen = uitstelgedrag, weinig focus, ondoordachte strategie) |
| 11 | Zelf doen vs Rocket Leads - één schaalbaar systeem |
| 12 | Case Werk en Berg - €13K → €1M+ omzet, ROAS 76 |
| 13 | Case DiamondFlame - 100+ showroom afspraken in 3 mnd, €80K+ omzet |
| 14 | Case TV Media Partners - €350K+ spend, 20.000+ leads, €2M+ omzet |
| 15 | Case Dr. Ludidi - €5K spend, 500+ leads, 10 high-ticket deals in 2 mnd |
| 16 | Groeisessie - analyse + omzet laten liggen + roadmap 3-6 mnd |
| 17 | Gefeliciteerd met eerste stap |
| 18 | Team slide - tot snel |

---

## Review Video Bodies (per klant)

**Dr. Ludidi:** Geen koude leads of tijdverspilling - maar tientallen high-ticket deals in 3 maanden. Dr. Ludidi is een autoriteit binnen zijn vakgebied maar miste het systeem om hier consistent omzet uit te halen. Wij bouwden dat systeem. Van advertentie tot salescall, volledig ingericht en geoptimaliseerd.

**Werk en Berg:** Werk & Berg heeft een sterk product, maar zonder het juiste systeem bleef echte omzet liggen. Wij bouwden de volledige funnel: van de eerste advertenties tot een gevulde agenda. Geoptimaliseerd, consistent en schaalbaar.

**Zumex:** Geen startup meer, maar een gevestigd miljoenenbedrijf. Vandaag de dag komt meer dan 50% van al hun afspraken via Rocket Leads. Niet via beurzen, niet via mond-tot-mond - maar via één geoptimaliseerd systeem.

**Vlex Vending:** Zo overtuigd van wat wij deden dat ze iedere cent die ze hadden investeerden. Binnen één jaar schaalden zij hun vending business op naar meer dan €100.000 omzet in 1 maand. Rocket Leads was niet hun marketingbureau - wij waren hun groeimotor.

**TV Media Partners:** Meer dan 20.000 leads, verdeeld over 3 landen. De kracht van schaalbare advertenties die écht werken - in een branche waar leadgeneratie traditioneel via netwerken en koude acquisitie gaat.

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
- Budget verhogen (max 20%/dag) - ALLEEN bij klanten met flexibel budget; standaard klanten zitten op vast budget en hier is dit niet relevant

**Creative refresh:** elke maand nieuwe creatives en ad copy. Creatives > ad copy in impact. Bij winnende ads: itereren in dezelfde richting (zelfde hook/angle/format, frisse executies) om CPL laag te houden en fatigue te voorkomen.

**Wanneer nieuwe angle:** als meerdere creatives op dezelfde invalshoek niet werken én lead feedback geen kwaliteitsproblemen aantoont.

**Bij winnende ad:** nooit "laten lopen" - direct itereren. Een winnende ad is een signaal om te verdubbelen met nieuwe varianten, niet een rustpunt.

---

## 4-Pilaren Optimalisatie Framework (Intern - Targets Dashboard)

CPD (Cost per Deal) en ROAS zijn **outcomes**, nooit root causes. Bij diagnose altijd terugtraceren naar de 4 pilaren:

### Pilaar 1: CBC (Cost per Booked Call)
- **Benchmark:** instelbaar per maand in Settings
- **Off track = oorzaak:** creatives presteren niet, targeting is te breed/smal
- **Optimalisatie:** nieuwe hooks, angles, formats testen. Itereren op winnende richting. 3-5 nieuwe variaties per week.
- **Let op:** als CBC on track is maar booked calls off track → het probleem is **ad spend** (te laag), niet creative performance

### Pilaar 2: Qualification Rate (Qualified / Booked Calls)
- **Benchmark:** ≥75%
- **Off track = oorzaak:** we bereiken de verkeerde mensen (ICP mismatch), ad messaging sluit niet aan
- **Optimalisatie:** branche-specifieke ads, betere invalshoeken die de ICP direct aanspreken, kwalificatievragen in lead form toevoegen (budget, tijdlijn, beslisser)
- **Key insight:** lage qualification rate + lage CBC = goedkope maar verkeerde leads

### Pilaar 3: Show-up Rate (Taken / Qualified Calls)
- **Benchmark:** ≥80%
- **Off track = oorzaak:** no-shows door gebrek aan urgentie, koude leads, scheduling issues
- **Optimalisatie:** WhatsApp reminder delivery en timing auditen (zijn al actief - check of ze aankomen), persoonlijke bevestigingsbelletje 2u voor afspraak, booking window verkorten (niet te ver vooruit kunnen boeken)
- **Let op:** als CBC/CQC off track zijn maar show-up rate ≥80% → CTC kan alsnog on track zijn. Geen actie nodig op creatives.

### Pilaar 4: Conversion Rate (Deals / Taken Calls)
- **Benchmark:** ≥30%
- **Off track = oorzaak:** lead kwaliteit (ICP fit), sales propositie, close technique
- **Optimalisatie:** lead kwaliteit reviewen (zijn ze closeable?), sales coaching, pricing/packaging aanpassen, HTO vs LTO mix evalueren
- **Key insight:** lage conversion rate + goede qualification rate = sales issue, niet marketing issue

### Misalignment Detection
- **Deal value gap:** als gemiddelde deal value structureel lager is dan verwacht (revenue target / deals target), kan het revenue target niet gehaald worden zelfs met genoeg deals. Oplossing: sales sturen naar HTO, kortingspraktijken reviewen.
- **Funnel compensatie:** pilaren compenseren elkaar. Hoge show-up rate compenseert hoge CBC. Lage CBC compenseert lage conversion rate. Altijd het eindresultaat (ROAS) als toets gebruiken.
- **Spend vs efficiency:** als CBC on track is en booked calls off track → niet de creatives aanpassen maar ad spend verhogen. De efficiency is bewezen, het volume is de bottleneck.

---

## Case Studies

| Klant | Ad Spend | Resultaat |
|---|---|---|
| Werk & Berg | €13.000 | 2000+ leads, €1M+ omzet, ROAS 76 |
| Vlex Vending | - | Bijna 200 leads in eerste maand → €100K/maand |
| TV Media Partners | €350.000+ | 20.000+ leads, 3 landen, €2M+ omzet |
| Dr. Ludidi | €5.000 | 500+ leads, 10 high-ticket deals in 2 mnd |
| DiamondFlame | - | 100+ showroom afspraken in 3 mnd, €80K+ omzet |
| Zumex | - | 50%+ van alle afspraken via Rocket Leads |
| Adeqo | - | 100+ B2B deals in 2 jaar |
| Verhuisvlot | - | 30+ opdrachten binnen 2 maanden |

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

- **Creatives zijn de belangrijkste hefboom** - niet targeting, niet ad copy
- Marketing angles worden gekozen op basis van **ervaring per branche** - niet willekeurig
- **Video ads presteren het beste op Meta** - static ads zijn tweede keuze
- Bij klanten zonder content: video scripts schrijven → klant neemt op met telefoon → wij editen. Stock content is laatste optie
- **Formulier-vragen zijn cruciaal voor leadkwaliteit** - meer vragen = minder maar betere leads
- **AI avatars zijn een kernonderscheider** van Rocket Leads 3.0
- Seizoensgebondenheid meenemen bij branche-specifieke angles
- Case studies worden actief gebruikt in sales framing - agents moeten deze kennen
- Scripts zijn gevalideerde referentie voor nieuwe campagne copy - gebruik de volledige teksten hierboven, niet samengevatte versies
