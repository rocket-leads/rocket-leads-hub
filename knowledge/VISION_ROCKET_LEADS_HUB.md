# Vision Document: Rocket Leads Hub v2.0

> **Let op:** Dit document beschrijft de lange-termijn visie en strategische richting voor de Rocket Leads Hub. Het dient als inspiratiebron en context voor toekomstige ontwikkeling, niet als directe implementatie-instructies. Gebruik dit om de grote lijnen te begrijpen en richting te bepalen, maar bouw features alleen wanneer expliciet gevraagd.

---

## Context: Huidige Situatie

De Rocket Leads organisatie heeft drie primaire tijdvreters geïdentificeerd:

1. **Trengo reactietijd & standaard antwoorden** — Account Managers besteden 3–5 uur per dag aan klantcommunicatie
2. **Facturatie & debiteurenbeheer** — Handmatig facturen versturen, herinneringen sturen, achter betalingen aanbellen
3. **Campagne-analyse & beslissingen** — Campaign Managers scrollen door 50+ adaccounts om performance te beoordelen

## Strategische Visie

De hub evolueert van een read-only dashboard naar een intelligent actieplatform dat:
- Proactief problemen detecteert en oplossingen voorstelt
- Repetitieve communicatie automatiseert zonder menselijkheid te verliezen
- Teamleden van reactief naar strategisch werk verschuift
- Marges verhoogt van 25% naar 60% door efficiëntiewinst

---

## Toekomstige Capabilities (Gefaseerd)

### FASE 1: Foundation — Quick Wins

#### 1.1 — Automatische Facturatie Flow
**Probleem:** Arno en AM's verliezen veel tijd aan handmatige facturatie en achterstallige betalingen.

**Visie:**
```
Day -7: Automatische factuur (Stripe)
Day 0:  Betalingsdatum
Day +1: Auto-pause campagnes bij non-payment
        → Multi-channel notificaties (team + klant)
        → Visual indicator in hub (rode "OVERDUE" status)
Day +3: Automatische tweede reminder
Day +7: Derde reminder + escalatie opties
```

**Integraties:**
- Stripe webhooks (`invoice.payment_failed`, `invoice.overdue`)
- Meta API voor campaign pause
- Trengo API voor klantcommunicatie
- Slack voor team alerts

**Impact:** -5-10 uur/week (Arno), -2-3 uur/week per AM

---

#### 1.2 — Trengo AI Agent (Eerste Respons)
**Probleem:** Klanten wachten uren op antwoord, AM's zitten vast in repetitieve communicatie.

**Visie:**
- 70% van tickets krijgt binnen 60 seconden intelligent antwoord
- AI leert tone of voice per AM (Roel WhatsApp style ≠ Danny email style)
- Alleen complexe tickets escaleren naar mensen
- Klanten ervaren snellere service, AM's focussen op échte problemen

**Flow:**
```
Incoming message → AI classifier
  ↓
Standaard (70%):
  → AI drafts antwoord in juiste tone
  → Stuurt direct + tagged AM voor follow-up
  
Complex (30%):
  → Tagged "Requires human"
  → Notificatie naar verantwoordelijke AM
```

**Training data:** Historische Trengo tickets per kanaal/persoon

**Impact:** -2-3 uur/dag per AM

---

#### 1.3 — Campaign Health Dashboard
**Probleem:** CM's besteden veel tijd aan het opsporen van probleemcampagnes in adaccounts.

**Visie:**
- Realtime health scoring (🟢 Good / 🟡 Warning / 🔴 Critical)
- Automatische detectie van afwijkingen (CPL spikes, volume drops, CTR dips)
- Actionable insights: "Campaign X needs refresh — hier zijn winning ads van afgelopen 14 dagen"
- Filters: "Show only critical" voor gefocuste aandacht

**Logica:**
```
🔴 Critical:
  - CPL > target voor 3+ dagen
  - Lead volume < 50% van 14-dag gemiddelde
  - CTR < 1% voor 5+ dagen
  - Ad disapproved/rejected

🟡 Warning:
  - CPL +30% vs vorige week
  - CTR -20% vs vorige week
  - Budget < €50/dag

🟢 Good:
  - Binnen targets, stabiel/groeiend
```

**Quick actions:** Direct vanuit alert campagne pauzeren of creative request triggeren

**Impact:** -1-2 uur/dag per CM

---

### FASE 2: Force Multipliers

#### 2.1 — Proactive Client Reporting
**Visie:** Klanten krijgen automatisch wekelijkse/maandelijkse rapporten zonder dat AM's deze handmatig samenstellen.

**Delivery:**
- Elke maandag 08:00: weekrapport
- Elke 1e van maand: maandrapport
- Multi-channel: branded email + WhatsApp samenvatting

**Content:**
- Leads gegenereerd
- CPL vs target
- Top performing ads
- AI-gegenereerde next steps in Rocket Leads tone

**Impact:** -3-5 uur/week per AM

---

#### 2.2 — AI Creative Generator
**Visie:** Van reactive naar proactive creative testing. Wanneer performance daalt, genereert de hub automatisch nieuwe concepten.

**Flow:**
```
Performance dip gedetecteerd
  ↓
AI analyseert:
  - Welke ads werkten (afgelopen 30 dagen)
  - Welke angles al getest
  - Client industry + ICP (Monday.com)
  ↓
Output:
  - 3 video script variaties
  - 5 ad copy variaties
  - Gestructureerde brief voor creative team
  ↓
CM reviewed → Shanna krijgt duidelijke opdracht
```

**Impact:** -2-3 uur/week per CM, betere creative briefs

---

#### 2.3 — Churn Risk Scoring
**Visie:** Preventief handelen voordat klanten churnen.

**Score factoren:**
- Campaign performance trends
- Betaalgedrag (Stripe)
- Communicatie sentiment (Trengo AI analysis)
- Contact frequency (Monday.com)

**Dashboard features:**
- Sorteerbare "Churn Risk" kolom
- Filter: High risk clients
- Proactive alerts: "Client X needs check-in call"

**Impact:** Hogere retention → meer stabiele MRR

---

### FASE 3: Advanced Features (Toekomst)

#### 3.1 — Zapier Health Monitor
Realtime monitoring van Zaps om lead routing failures te voorkomen.

#### 3.2 — Meeting Transcripts → Auto To-Do's
FATM transcripts uploaden → AI extraheert actiepunten → automatisch in Monday.com

#### 3.3 — Client Self-Service Portal
Klanten loggen in voor eigen dashboard (campaigns, KPI's, facturen) → minder statusupdate calls

**Let op:** Dit vereist aparte branding, onboarding en support infrastructuur.

---

## Wat We NIET Bouwen (En Waarom)

| Feature | Reden |
|---------|-------|
| Automatisch campagnes pauzeren bij slechte performance | Te risicovol zonder menselijke validatie |
| New Client Wizard in hub | Beter via dedicated onboarding tool |
| Google Ads integratie | Niet prioriteit, mogelijk later |
| Automation builder in hub | Overlapping met bestaande tools |

---

## Technische Bouwstenen (Referentie)

### Integraties
- **Meta API**: Campaign data, ads performance, pause/resume
- **Stripe**: Facturatie, payment status, webhooks
- **Trengo**: Messaging, webhooks, sentiment data
- **Monday.com**: Client info, ICP data, contact history
- **Slack**: Team notificaties
- **Supabase**: Data opslag, cron jobs

### AI Components
- **Claude API**: 
  - Ticket classificatie (standaard vs complex)
  - Tone of voice matching per AM
  - Creative generation (scripts, copy)
  - Sentiment analysis
  - Report summaries

### Cron Jobs
- Dagelijks: Health scores berekenen
- Wekelijks: Rapporten genereren (maandag 08:00)
- Maandelijks: Maandrapporten (1e vd maand)

---

## Verwachte Impact (Na Volledige Implementatie)

### Tijdsbesparing
| Rol | Huidig | Besparing | Target |
|-----|--------|-----------|--------|
| Account Managers | 40u/week | -15u | 25u/week |
| Campaign Managers | 40u/week | -10u | 30u/week |
| Finance (Arno) | 20u/week | -8u | 12u/week |

**Totaal:** ~33 uur/week besparing → €150K+/jaar bij €75/uur gemiddeld

### Marge Impact
- Huidig: 25%
- Target: 60%
- Dit plan: 45-50% (rest via andere AI integraties)

---

## Ontwikkelprincipes

1. **Human-in-the-loop**: AI stelt voor, mens beslist bij kritieke acties
2. **Progressive enhancement**: Start simpel, voeg intelligentie toe waar ROI hoog is
3. **Data-driven**: Baseer health scores en alerts op harde KPI's, niet aannames
4. **Tone preservation**: AI moet onzichtbaar zijn voor klanten (tone matching cruciaal)
5. **Fail-safe**: Bij twijfel escaleren naar mens, niet automaten

---

## Referentie: Mogelijke Build Volgorde

*Disclaimer: Dit is indicatief, geen directe instructie*

**Sprint 1-2:** Facturatie flow (Stripe + Meta + notificaties)  
**Sprint 3-4:** Trengo AI Agent (webhooks + classifier + tone training)  
**Sprint 5-6:** Campaign Health Dashboard (scoring + alerts)  
**Sprint 7-8:** Proactive Reporting (generators + scheduling)  
**Sprint 9-10:** AI Creative Generator (analysis + generation)  
**Sprint 11-12:** Churn Risk (scoring + sentiment)

---

## Slotgedachte

Deze visie beschrijft een hub die niet alleen data toont, maar actief meedenkt en handelt. Van passief dashboard naar intelligent actieplatform. Van menselijke bottlenecks naar geautomatiseerde efficiency met behoud van persoonlijke touch.

**Build features alleen wanneer expliciet gevraagd. Dit document is context, geen takenlijst.**
