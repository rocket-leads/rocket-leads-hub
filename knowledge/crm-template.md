# Rocket Leads — CRM Template (Monday.com)

> **Last updated:** 2026-04-04 05:30 CET
> Dit document beschrijft de structuur van het Monday.com CRM-bord dat Rocket Leads gebruikt per klant. Gebruik dit als referentie voor AI agents, account managers en bij het opzetten van nieuwe klantborden.

---

## Samenvatting

Elk klantbord heet "Template NL / BE 3.0" en bestaat uit vijf vaste secties. Leads stromen van boven naar beneden door de pipeline via statuswijzigingen. Het bord is gekoppeld aan Zapier voor automatische aanmaak van nieuwe leads en notificaties.

---

## Kolommen (van links naar rechts)

| Kolom | Type | Beschrijving |
|---|---|---|
| Name | Tekst | Bedrijfsnaam of naam contactpersoon |
| Status | Status (kleurgecodeerd) | Huidige fase in de pipeline — zie statuslijst per sectie |
| 🗓️ Afspraak | Datum + tijd | Datum en tijdstip van geplande afspraak |
| Telefoon | Telefoon | Telefoonnummer van de lead |
| E-mail | E-mail | E-mailadres van de lead |
| Date created | Datum | Aanmaakdatum (automatisch via Zapier) |
| First contact | Datum | Datum van eerste daadwerkelijke contactmoment (handmatig invullen) |
| Omzet | Nummer (€) | Gerealiseerde of verwachte omzetwaarde bij deal |
| Advertentie UTM | Tekst | UTM-tag van de advertentie waarmee de lead binnenkwam |
| Meeting link | URL | Google Meet of Calendly link voor de afspraak |
| Advertentiekosten | Nummer (€) | Wekelijkse ad spend (ingevuld in sectie Advertentiekosten) |
| Aantal leads | Nummer | Aantal leads in de periode |
| Kost per lead | Formule | Advertentiekosten ÷ Aantal leads (automatisch berekend) |
| Date deal | Datum | Datum waarop de deal gesloten werd (kolom ID: `date3`). **BELANGRIJK:** deals in het Targets dashboard worden geteld op basis van deze datum, niet op basis van afspraakdatum. Dit voorkomt dat deals aan de verkeerde maand worden toegewezen. |
| Country | Status | Land van de lead: NL, BE, DE. Kolom ID: `color`. Gebruikt in het Targets dashboard voor per-land filtering. |

---

## Secties & Statussen

### 1. Leads
Alle binnenkomende leads. Eerste opvang voor alle aanvragen vanuit Meta Lead Forms, Loveable of Typeform.

| Status | Betekenis |
|---|---|
| 🎯 Nieuwe leads | Vers binnengekomen, nog niet benaderd |
| 💬 In gesprek | Actief contact, opvolging loopt |
| ⏳ Wordt teruggebeld | Lead heeft gevraagd om terugbelmoment |
| 📞 Gebeld, geen gehoor | Gebeld maar niet opgenomen |
| 🔁 Herinnering gestuurd | Follow-up mail/WhatsApp verstuurd |
| 🔥 Afspraak kennismaking | Kennismakingsgesprek ingepland |

---

### 2. Kennismaking
Leads waarbij een kennismakingsgesprek is ingepland of heeft plaatsgevonden.

| Status | Betekenis |
|---|---|
| 🔥 Afspraak kennismaking | Afspraak staat gepland |
| ✅ Kennismaking gehad | Gesprek heeft plaatsgevonden, salestraject loopt |
| ❌ No-show | Niet komen opdagen |
| 🔁 Verzet | Afspraak verzet naar nieuw moment |

---

### 3. Salescalls
Leads in de salesfase — na kennismaking, voor deal.

| Status | Betekenis |
|---|---|
| 🔥 Afspraak salescall | Salescall ingepland |
| ✅ Salescall gehad | Gesprek heeft plaatsgevonden |
| ⏳ Offerte gestuurd | Offerte verstuurd, wacht op respons |
| 🤝 Onderhandeling | In onderhandeling over voorwaarden |
| ❌ No-show | Niet komen opdagen |

---

### 4. Deals
Gewonnen deals — klant heeft getekend of akkoord gegeven.

| Status | Betekenis |
|---|---|
| ✅ Deal | Deal gesloten |
| 🚀 Onboarding | Klant in onboardingfase |
| 🏃 Live | Campagne actief |

---

### 5. Lost
Verloren leads en gediskwalificeerde contacten. Nooit verwijderen — worden gebruikt voor retargetingcampagnes.

| Status | Betekenis |
|---|---|
| 🥴 Spam of foutief nr | Onbruikbaar contact |
| ❌ Niet geïnteresseerd | Lead heeft expliciet afgehaakt |
| 💸 Te duur | Lead haakte af op prijs |
| 🚫 Niet gekwalificeerd | Voldoet niet aan criteria (budget, branche, fit) |
| ⏸️ Nu niet, later misschien | Goede lead maar verkeerd moment |

---

### 6. Advertentiekosten
Aparte sectie voor wekelijkse ad spend-tracking en KPI-berekeningen. Elke rij = één week.

| Veld | Invullen |
|---|---|
| Name | Startdatum van de week (bijv. 01-09-2025) |
| Status | 🎯 Nieuwe leads (standaard) |
| Date created | Startdatum periode |
| Advertentiekosten | Totale spend die week |
| Aantal leads | Binnenkomende leads die week |
| Kost per lead | Automatisch berekend |

De samenvatting-rij onderaan toont automatisch de totalen over de geselecteerde periode.

---

## Pipeline Flow

```
Lead binnenkomt (Zapier trigger)
        ↓
[Leads] — Status: 🎯 Nieuwe leads
        ↓
Opvolging: bellen, WhatsApp, mail
        ↓
Afspraak ingepland → 🔥 Afspraak kennismaking
        ↓
[Kennismaking] — Gesprek gehad → ✅ Kennismaking gehad
        ↓
[Salescalls] — Offerte → Onderhandeling → ✅ Deal
        ↓
[Deals] — Onboarding → Live

→ Op elk moment kan een lead naar [Lost]
```

---

## Automatiseringen (via Zapier)

| Trigger | Actie |
|---|---|
| Nieuwe lead aangemaakt | WhatsApp naar klant: "Nieuwe lead binnen" + email notificatie + WhatsApp naar de lead: "Bedankt voor je aanvraag" |
| Status → 🔥 Afspraak kennismaking | Bevestigingsmail + calendar invite naar lead |
| Calendly afspraak ingepland | Monday item bijgewerkt + reminders naar lead en klant |
| Status → ❌ No-show | Automatische follow-up sequentie (3 contactmomenten) |
| Status → ⏳ Offerte gestuurd | Herinnering na 48u als geen reactie |
| Status → ✅ Deal | Onboarding checklist aangemaakt, notificatie naar team |

**Opvolgingsloop (11 contactmomenten binnen 48u bij HTO):**
1. WhatsApp binnen 5 min na aanvraag
2. Automatische e-mail binnen 1u
3. Tweede WhatsApp na 3u
4. Voicemail dag 1
5. E-mail dag 1 (avond)
6. WhatsApp dag 2 (ochtend)
7. Bel poging dag 2
8. SMS dag 2
9. E-mail dag 2 (middag)
10. WhatsApp dag 2 (avond)
11. Finale e-mail dag 3

---

## Veldnotities voor Account Managers

- **UTM altijd invullen** bij aanmaken van een lead — essentieel voor campagnerapportage en het koppelen van resultaten aan specifieke advertenties
- **First contact handmatig invullen** zodra je de lead voor het eerst daadwerkelijk hebt bereikt (niet bij de eerste belpoging)
- **Omzet invullen** bij een gewonnen deal — wordt gebruikt voor ROAS-berekeningen per campagne
- **Lost leads nooit verwijderen** — worden ingezet voor retargetingcampagnes en reactiveringscampagnes via oude leads
- **Advertentiekosten-sectie wekelijks bijwerken** — elke maandag, voor de rapportage naar de klant
- **Notities-veld** van een item gebruiken voor gespreksaantekeningen, relevante context en afspraken

---

## Belangrijke nuances voor AI agents

- Monday-bord structuur is per klant gelijk — zelfde secties, zelfde kolommen, zelfde statussen
- Sommige klanten hebben hun eigen CRM — Rocket Leads koppelt Monday erbovenop, maar **werkt altijd in het eigen Monday-bord**, nooit in het systeem van de klant
- Klanten kunnen hun eigen resultaten inzien in hun bord
- De Hub combineert KPI's van Monday én Meta Ads in één dashboard
- Zapier is de enige automatiseringstool — alle triggers en flows lopen hiervia
