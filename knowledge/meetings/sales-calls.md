# Rocket Leads — Sales Calls

> Template voor AI-context bij sales meetings (Fathom `meeting_type='sales'`).
> Gebruikt door de matcher, summarizers, en task-extractors om patronen te
> herkennen en de juiste signalen op te pikken uit Fathom transcripts +
> summaries.
>
> Gerelateerde knowledge: `knowledge/sales.md` (volledig salesproces),
> `knowledge/company.md` (ICP), `knowledge/campaigns.md` (proposities).

---

## Wat is een sales call bij Rocket Leads?

- **Setting:** kennismakingsgesprek of groeisessie via Google Meet, ~45 min
- **Hosts:** sales consultants — closers (Anel, Jill) of bijspringende setters (Quintus)
- **Doel:** prospect → klant. Discovery (25-30 min vragen) + pitch + close
- **Frequentie:** ~30 per week
- **Recording:** Fathom in team **Sales Rocket Leads** (na ingest filter)

**Belangrijk:** sales calls worden bij ingest **geskipt** (niet opgeslagen) totdat de prospect klant wordt. Pas bij conversie pakt de matcher / backfill de oudere sales call(s) op via attendee-email match en koppelt ze alsnog aan de klant.

---

## Structuur van een sales call

### Fase 1 — Discovery (eerste 25-30 min)
Sales consultant stelt alleen vragen:
- Wie ben je / wat doe je?
- Wie is de doelgroep?
- Onderscheidend vermogen?
- Hoe nu aan leads gekomen?
- Doel?
- Wat al geprobeerd?
- Waarom nog niet behaald?

### Fase 2 — Pitch & close
- Vehicle (Meta Ads, leadgen) niet centraal — focus op resultaat (volle agenda, meer omzet)
- Start altijd met **HTO** (high-ticket offer) als eerste optie
- Urgency hooks: eerste maand gratis bij directe beslissing, schaarste ("nog X plekken")

### Fase 3 — Close, follow-up of disqualify

---

## Patronen om te herkennen (voor AI)

### Outcome detectie
| Signaal in transcript / summary | Outcome | Vervolgactie |
|---|---|---|
| "Stuur me de offerte" / "wanneer kunnen we starten" / "ik wil graag" | **Closed (intent)** | Wacht op betaling → kick-off in agenda |
| "Ik moet er even over nadenken" / "ik laat het je weten" | **Follow-up nodig** | Plan vervolgafspraak — geen open follow-up zonder gepland moment |
| "Te duur" / "geen budget" | **Lost — prijs** | Disqualify of HTO→LTO downgrade voorstellen |
| "Mijn doelgroep zit niet op Facebook" | **Bezwaar** | Frame met case study (B2B zoals Fortune Coffee) |
| "Slechte ervaring met agencies" | **Bezwaar — vertrouwen** | Frame met garantie + case study (Uptmz) |
| "Op commissie" / "gratis proeven" | **Disqualify hard** | Niet doen, doorvragen waar het vandaan komt |

### ICP fit signalen
- ✅ **Goed:** high-ticket product (€500+ marge), grote doelgroep (>100k bereikbaar op Meta), unieke propositie, B2B/B2C dienstverlening
- ❌ **Slecht:** e-commerce/webshop, hyper-lokaal, <€500 marge, wil €10k+/mnd ad spend, micro-doelgroep

### Bezwaren framework (de 6 standaard objections)
1. Slechte ervaring met agencies → garantie frame + case
2. Leads vorige keer slechte kwaliteit → filtervragen + case
3. Doelgroep niet op Facebook → targeting uitleg + B2B case
4. Andere partijen goedkoper → ROI frame + case
5. Moet er even over nadenken → doorvragen naar onderliggend bezwaar
6. Commissie / proefperiode → hard nee + doorvragen

---

## Action items typisch uit sales calls

Wat Fathom detecteert (en wij straks promoten naar Hub tasks):

- "Stuur PDF / offerte / pitch deck naar [prospect]" → assignee = closer
- "Plan vervolgafspraak op [datum]" → assignee = closer
- "Stuur case study [klant] door" → assignee = closer
- "Check of [prospect] in juiste markt zit" → assignee = senior sales

---

## Wat AI moet extracten per sales call

Voor de toekomstige `sales-call-summary` AI prompt:

1. **Outcome** — closed / follow-up / lost / disqualified
2. **Prospect bedrijfsnaam + branche** — voor matcher als ze later klant worden
3. **Aanbod gepitcht** — HTO / LTO / variant
4. **Bezwaren genoemd** — uit de 6 standaard set
5. **Follow-up commitments** — wat is afgesproken, wanneer, door wie
6. **ICP fit verdict** — past de prospect bij Rocket Leads (goed/twijfelachtig/slecht)
7. **Deal value indicator** — werd budget besproken, in welke range
8. **Decision maker check** — was de juiste persoon aanwezig?

---

## Anti-patterns / red flags

Dingen waar AI op moet alarmeren in de Watch List of summary:

- Closer geeft een **garantie zonder dat ICP fit duidelijk is** — risico op churn
- Prospect noemt **"andere offertes vergelijken"** zonder commitment → low-intent
- **Onrealistische verwachtingen** ("100 leads in eerste week") niet gecorrigeerd door closer
- Prospect heeft eerder **bij meerdere agencies stop gezet** — churn risk
- **Geen budget besproken** in een 45-min call → close zal moeilijk worden

---

## Output velden in `meetings.summary` (huidig)

Fathom levert in NL een gestructureerde markdown summary. Standaard secties:
- **Doel van de vergadering**
- **Belangrijkste punten** (bullets)
- **Onderwerpen** (per onderwerp een korte uitleg)
- **Volgende stappen** (vaak overlap met `action_items`)

Deze worden 1-op-1 opgeslagen — geen post-processing op ingest.
