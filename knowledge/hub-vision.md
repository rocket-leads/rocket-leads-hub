# Vision Document: Rocket Leads Hub v2.0

> **Let op:** Dit beschrijft de lange-termijn visie. Gebruik dit als context, niet als directe implementatie-instructies. Build features alleen wanneer expliciet gevraagd.

---

## Context: Drie Primaire Tijdvreters

1. **Trengo reactietijd** — AM's besteden 3–5 uur/dag aan klantcommunicatie
2. **Facturatie & debiteurenbeheer** — Handmatig facturen, herinneringen, achter betalingen aanbellen
3. **Campagne-analyse** — CM's scrollen door 50+ adaccounts om performance te beoordelen

## Strategische Visie

Hub evolueert van read-only dashboard naar intelligent actieplatform:
- Proactief problemen detecteren en oplossingen voorstellen
- Repetitieve communicatie automatiseren zonder menselijkheid te verliezen
- Teamleden van reactief naar strategisch werk verschuiven
- Marge verhogen van 25% naar 60%

---

## Toekomstige Capabilities (Gefaseerd)

### FASE 1: Foundation — Quick Wins

#### 1.1 — Automatische Facturatie Flow
```
Day -7: Automatische factuur (Stripe)
Day 0:  Betalingsdatum
Day +1: Auto-pause campagnes bij non-payment + notificaties
Day +3: Automatische tweede reminder
Day +7: Derde reminder + escalatie
```
Integraties: Stripe webhooks, Meta API (pause), Trengo (klant), Slack (team)
Impact: -5-10 uur/week Arno, -2-3 uur/week per AM

#### 1.2 — Trengo AI Agent (Eerste Respons)
```
Incoming message → AI classifier
  ↓
Standaard (70%): AI drafts antwoord in juiste tone → stuurt direct
Complex (30%):   Tagged "Requires human" → notificatie naar AM
```
AI leert tone of voice per AM. Training data: historische Trengo tickets.
Impact: -2-3 uur/dag per AM

#### 1.3 — Campaign Health Dashboard
```
🔴 Critical: CPL > target 3+ dagen | volume < 50% 14-dag gemiddelde | CTR < 1% 5+ dagen
🟡 Warning:  CPL +30% vs vorige week | CTR -20% vs vorige week | budget < €50/dag
🟢 Good:     Binnen targets, stabiel/groeiend
```
Quick actions: direct pauzeren of creative request triggeren vanuit alert.
Impact: -1-2 uur/dag per CM

---

### FASE 2: Force Multipliers

#### 2.1 — Proactive Client Reporting
Automatische rapporten zonder handmatig werk AM's:
- Maandag 08:00: weekrapport (branded email + WhatsApp samenvatting)
- 1e van maand: maandrapport
Impact: -3-5 uur/week per AM

#### 2.2 — AI Creative Generator
```
Performance dip → AI analyseert winnende ads + angles + client ICP
→ Output: 3 script variaties + 5 ad copy variaties + brief voor Shanna
→ CM reviewed → Shanna krijgt duidelijke opdracht
```
Impact: -2-3 uur/week per CM

#### 2.3 — Churn Risk Scoring
Score factoren: campaign performance + betaalgedrag (Stripe) + sentiment (Trengo) + contact frequency
Dashboard: sorteerbare churn risk kolom + proactive alerts.

---

### FASE 3: Advanced Features (Toekomst)
- Zapier Health Monitor
- Meeting Transcripts → Auto To-Do's in Monday.com
- Client Self-Service Portal (aparte branding/infra nodig)

---

## Wat We NIET Bouwen

| Feature | Reden |
|---------|-------|
| Automatisch campagnes pauzeren bij slechte performance | Te risicovol zonder menselijke validatie |
| New Client Wizard in hub | Beter via dedicated onboarding tool |
| Google Ads integratie | Niet prioriteit |
| Automation builder in hub | Overlapping met bestaande tools |

---

## Technische Bouwstenen

**AI Components (Claude API):**
- Ticket classificatie (standaard vs complex)
- Tone of voice matching per AM
- Creative generation (scripts, copy)
- Sentiment analysis
- Report summaries

**Cron Jobs:**
- Dagelijks: health scores berekenen
- Maandag 08:00: weekrapporten
- 1e vd maand: maandrapporten

---

## Verwachte Impact (Volledige Implementatie)

| Rol | Huidig | Besparing | Target |
|-----|--------|-----------|--------|
| Account Managers | 40u/week | -15u | 25u/week |
| Campaign Managers | 40u/week | -10u | 30u/week |
| Finance (Arno) | 20u/week | -8u | 12u/week |

Totaal: ~33 uur/week → €150K+/jaar besparing bij €75/uur gemiddeld
Marge: 25% → 45-50% via dit plan (rest via andere AI integraties)

---

## Ontwikkelprincipes

1. Human-in-the-loop: AI stelt voor, mens beslist bij kritieke acties
2. Progressive enhancement: simpel starten, intelligentie toevoegen waar ROI hoog
3. Data-driven: health scores op harde KPI's
4. Tone preservation: AI onzichtbaar voor klanten
5. Fail-safe: bij twijfel escaleren naar mens

---

## Indicatieve Build Volgorde

Sprint 1-2: Facturatie flow | Sprint 3-4: Trengo AI Agent
Sprint 5-6: Campaign Health Dashboard | Sprint 7-8: Proactive Reporting
Sprint 9-10: AI Creative Generator | Sprint 11-12: Churn Risk

**Build features alleen wanneer expliciet gevraagd. Dit document is context, geen takenlijst.**
