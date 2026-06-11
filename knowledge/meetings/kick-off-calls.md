# Rocket Leads - Kick-off Calls

> Template voor AI-context bij kick-off meetings (Fathom `meeting_type='kick_off'`).
> Eerste call met een nieuwe klant na betaling - alle campagne-context wordt
> hier opgehaald en vastgelegd.
>
> Gerelateerde knowledge: `knowledge/process.md` (Fase 2 Kick-off Meeting),
> `knowledge/campaigns.md` (angles + scripts), `knowledge/crm-template.md`.

---

## Wat is een kick-off call bij Rocket Leads?

- **Setting:** Google Meet, ~60 min
- **Host:** Account Manager (AM) - campagne manager (CM) zit er **nooit** bij
- **Wanneer:** binnen 1-3 dagen na betaling van de eerste maand/kwartaal
- **Doel:** alle context ophalen om campagne te kunnen bouwen
- **Recording:** Fathom in team **Delivery Rocket Leads**

---

## Structuur van een kick-off

### Fase 1 - Relatie opbouwen
Klein, persoonlijk, vriendelijk. Gemeenschappelijke interesses zoeken (F1, voetbal, reizen). Belangrijk: de eerste indruk bepaalt de toon van de samenwerking.

### Fase 2 - Diepte in de campagne
AM stelt vragen over:
- **ICP** - wie is de ideale klant van de klant?
- **Pijnpunten** van de doelgroep
- **Objections** die de doelgroep heeft
- **USPs** van de klant
- **Propositie & aanbod**
- **Advertentiebudget**
- **Salesproces** van de klant
- **Koppelingen & technische setup**

### Fase 3 - Technische zaken & verwachtingen
- Toegang tot Meta Business Manager bespreken
- Google Drive aangemaakt voor content
- Tijdlijn (4-6 weken tot live, content is grootste vertraging)
- Verwachtingen uitspreken

---

## Wat AI moet extracten per kick-off

Cruciaal voor de Hub om de klant goed te kunnen ondersteunen:

### 1. ICP details
- Wie is doelgroep (B2B/B2C, branche, regio, leeftijd, bedrijfsgrootte)
- Pijnpunten van die doelgroep
- Objections / weerstand bij die doelgroep
- Onderscheidend vermogen klant t.o.v. concurrenten

### 2. Propositie & aanbod
- Wat verkoopt de klant (product/dienst)
- Prijs / marge per nieuwe klant
- High-ticket / low-ticket
- Garanties / leveringsvoorwaarden

### 3. Ad budget afspraken
- Maandelijks budget (typisch €1.000-€3.000)
- Wie betaalt: klant zelf in eigen Meta BM óf via Rocket Leads ad account
- Schaal-bereidheid (zelden, maar noteer als besproken)

### 4. Content commitments
- Wie levert video's: klant zelf, RL on-location, of derde partij
- Tijdlijn voor levering
- AI Avatar gebruik: ja/nee
- Stock content vermijden - flag als opgekomen

### 5. Technische setup
- Meta Business Manager toegang: klant heeft, of RL ad account?
- CRM koppeling: Monday board ID
- Stripe customer ID
- Trengo contact ID
- Google Drive folder
- Pixel + ad account verifications

### 6. Salesproces van de klant
- Hoe handelt klant leads af
- Wie volgt op (klant zelf / sales team / Rocket Leads opvolging)
- Reactietijd target
- Calendly / planningstool

### 7. Verwachtingen
- Wanneer wil klant live (target datum)
- Wat verwacht klant aan output (CPL/aantal leads/afspraken)
- Communicatievoorkeur (WhatsApp/email/call)
- Frequentie van check-ins

---

## Action items typisch uit kick-off calls

- "Klant levert video's aan voor [datum]" → assignee = klant (notify), volgen op via task
- "Stuur Loveable form aan klant ter goedkeuring" → assignee = AM
- "Maak Monday CRM bord aan" → assignee = AM/CM
- "Setup Zapier flow lead → Monday → WhatsApp" → assignee = CM
- "Plan eerste evaluatie call over 7 dagen" → assignee = AM
- "Vraag Meta BM toegang" → assignee = klant, follow-up door AM

---

## Onboarding roadblocks om op te alarmeren

Als deze patterns in de transcript voorkomen, flag voor AM:

| Signaal | Risico | Actie |
|---|---|---|
| "Ik heb nog geen Meta Business Manager" | Vertraging tot live | Optie aanbieden: RL ad account |
| "Ik wil eerst alle creatives goedkeuren" | Micromanagement risico | Frame: "wij baseren keuzes op ervaring" |
| "Stock foto's zijn ook OK" | Slechte resultaten verwacht | Push voor eigen content of telefoon-video's |
| "Ik kan niet voor [3+ weken] filmen" | Lange onboarding | Start met andere creatives parallel |
| "Wat als het niet werkt?" | Verwachtingsmanagement | Eerlijk over tijdlijn + garantie scope |
| Geen duidelijk budget besproken | Onduidelijkheid in delivery | AM moet voor einde call afspraken vastleggen |

---

## Anti-patterns

- AM laat klant **micromanaging** elke creative beslissing toe → frame als "wij leiden"
- **Garantie wordt nogmaals beloofd** zonder ICP fit check → risico
- Klant heeft **al Meta BM van vorige agency** zonder access transfer geregeld → flag
- **Geen Google Drive folder** opgeleverd binnen 24u → vertraging signal

---

## Output velden in `meetings.summary` (huidig)

Fathom AI summary in NL bevat typisch:
- **Doel van de vergadering** (vrijwel altijd "kick-off [klantnaam]")
- **Belangrijkste punten** - vaak ICP + propositie samenvatting
- **Onderwerpen** - per onderwerp wat besproken
- **Volgende stappen** - concrete to-do's, mappen naar `action_items`

Cross-reference met `client_agreements` (ad budget + service fee) voor consistency check.
