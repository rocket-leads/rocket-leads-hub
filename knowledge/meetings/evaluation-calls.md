# Rocket Leads - Evaluation Calls

> Template voor AI-context bij evaluatie-/voortgangsgesprekken
> (Fathom `meeting_type='evaluation'`). Wekelijks of tweewekelijks contact
> tussen AM en klant - barometer voor klanttevredenheid en performance.
>
> Gerelateerde knowledge: `knowledge/process.md` (Fase 5 Klantcontact),
> `knowledge/campaigns.md` (4 pilaren CPD/ROAS framework).

---

## Wat is een evaluation call bij Rocket Leads?

- **Setting:** Google Meet (voorkeur), telefoon, of WhatsApp call (~30 min)
- **Host:** Account Manager - CM zit er **nooit** bij
- **Frequentie:** wekelijks of tweewekelijks per klant
- **Format:** "Wat gaat goed? Wat kan beter?" + concrete adjustments
- **Recording:** Fathom in team **Delivery Rocket Leads**

---

## Wat AI moet extracten per evaluation

### 1. Sentiment indicator
- 🟢 **Tevreden:** "blij met de leads", "loopt lekker", "we maken deals"
- 🟡 **Lukewarm:** "het mag wat sneller", "ik mis nog wat", neutraal
- 🔴 **Ontevreden:** "leads zijn slecht", "we zien geen resultaat", "hoeveel kost dit me eigenlijk"

### 2. Performance feedback
Match wat klant zegt tegen wat KPI's laten zien:
- Klant zegt "weinig leads" + KPI dashboard ook lage volumes → consistent → review met CM
- Klant zegt "weinig leads" + KPI dashboard normaal → verwachtingsmanagement issue
- Klant zegt "leads zijn slecht" + Monday updates bevestigen patroon → kwaliteit issue
- Klant zegt "leads zijn slecht" + Monday updates positief → opvolgingsproces klant issue

### 3. Strategische adjustments
- Nieuwe angle besproken
- Budget verhogen/verlagen (zeldzaam - vast budget is norm)
- Nieuwe creatives gevraagd
- Targeting aanpassen
- Lead form filtervragen toevoegen

### 4. Churn risk signalen
- "Ik twijfel of we doorgaan"
- "Andere agencies bellen me ook"
- "Ik ga even pauzeren"
- "Verwacht meer voor wat ik betaal"
- Frequentie van klachten neemt toe over meerdere calls

### 5. Expansion opportunities
- "Misschien wil ik ook Google Ads erbij"
- "Kunnen we een tweede campagne doen voor [andere dienst]"
- "Hebben jullie ook leadopvolging?"
- Klant noemt nieuwe diensten / locaties / business lines

---

## 4-Pilaren framework koppeling

Bij elke evaluation moet AM (en straks AI) de performance terugbrengen naar de 4 pijlers (CPD/ROAS outcome ≠ root cause):

| Pilaar | Klant signaal | Wat checken |
|---|---|---|
| **CBC** (cost per booked call) | "Geen leads" / "leads zijn duur" | Creatives presteren? Refresh nodig? |
| **Qualification rate** | "Verkeerde leads" / "geen ICP" | Targeting + ad messaging match? |
| **Show-up rate** | "Mensen komen niet opdagen" | Reminder flow check, scheduling timing |
| **Conversion rate** | "Wel afspraken maar geen deals" | Lead kwaliteit OF sales-issue klant |

AI moet bij negatieve sentiment proberen te triangleren op welke pijler off-track is.

---

## Action items typisch uit evaluations

- "Lever 5 nieuwe creatives aan voor [datum]" → assignee = CM
- "Test [nieuwe angle]" → assignee = CM
- "Voeg budget-vraag toe aan lead form" → assignee = CM
- "Plan vervolg-call over 2 weken" → assignee = AM
- "Stuur maandrapport naar klant" → assignee = AM
- "Sales coaching aanbieden" → assignee = AM (escalate)

---

## Anti-patterns / red flags

Dingen waar AI op moet alarmeren:

- **AM belooft schaling** ("we gaan budget verhogen") terwijl klant vast budget heeft → discrepantie met agreement
- **AM gaat alleen op klant-feedback af** zonder KPI cross-check → blind besluit
- **Geen concrete vervolgafspraak** aan einde van call → "follow-up zonder meeting" anti-pattern
- **Klant noemt 2+ keer "andere agencies"** in zelfde call → actief shoppen → escalate naar Roel
- **AM erkent probleem maar belooft geen actie** → klant voelt zich niet gehoord
- **Geen Monday updates over leads** in de afgelopen 7d besproken → sales team haakt niet aan

---

## Specifieke evaluation patterns per fase klant

### Eerste 30 dagen (vroege live fase)
Focus op verwachtingsmanagement. Klant heeft vaak hooggespannen verwachtingen. AM moet:
- Concrete data tonen (eerste leads / eerste afspraken)
- Frame: "we zijn aan het optimaliseren, geef het 2-4 weken"
- Roadblocks van klant kant adresseren (slechte content, langzame opvolging)

### Maand 2-3 (kwartaal-evaluatie nadert)
Hoogste churn-risico moment. Klant beslist over verlenging. AM moet:
- Resultaten benadrukken (wins highlight)
- Roadmap voor volgend kwartaal presenteren
- Eventuele frustraties vroeg op tafel

### Maand 6+ (trouwe klant)
Focus op groei en retentie:
- Expansion opportunities (Google Ads, leadopvolging)
- Case study / referral vragen
- Strategische sparring (groei-advies)

---

## Output velden in `meetings.summary` (huidig)

Fathom AI summary in NL bevat typisch:
- **Doel van de vergadering** ("evaluatie", "monthly review", "tussentijds overleg")
- **Belangrijkste punten** - performance + sentiment + adjustments
- **Onderwerpen** - per topic wat besproken
- **Volgende stappen** - concrete acties

Cross-reference met:
- KPI block voor performance check
- Trengo conversaties voor recente klantcommunicatie
- Monday updates voor lead kwaliteit signalen
- `client_agreements` voor budget / fee context
