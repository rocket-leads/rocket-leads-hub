# TODO — Rocket Leads Hub

> Snapshot van openstaand werk per **2026-05-03** EOD. Bijgewerkt na de agreement section release.

---

## 🔥 Vandaag/morgen — manueel werk (geen code)

### Multi-campagne klanten invullen
- ~20% van de klanten in Current Clients heeft meerdere campagnes (ex-sub-items in Monday)
- Default seed heeft voor iedereen 1 Meta-campagne aangemaakt met de service fee uit Monday
- Per multi-campagne klant: open Billing tab → Add campaign → splitsing van budget en fee invullen
- Sanity check op een paar klanten met `status__1 = "Rocket Leads"` — Varel = €1950 MRR is de blauwdruk

### Monday opschoning
- Sub-items op alle 762 klanten kunnen weg (de Hub leest ze niet meer)
- Plus: de 38 klanten met empty `status__1` even nalopen — bedoeling is dat het "Client" of "Rocket Leads" is

---

## 🟡 Klein, ad-hoc

### MRR-kolom in Clients overview (optioneel)
- Toevoegen aan de tabel op `/clients`
- Data komt uit `client_agreements` (per-client som van platform fees + follow-up fee)
- Pre-aggregeren in een nieuwe `/api/agreement-summaries` endpoint, React Query op de overview
- Naast de bestaande Budget kolom — finance-relevant signaal

### Settings — board config voor follow_up_status / follow_up_fee
- Nu hardgecodeerd op `status__1` en `numbers0__1` met literal-fallback in `monday.ts`
- Nice-to-have: configureerbaar maken via Settings → Board Config (zelfde pattern als andere kolommen)
- Niet urgent — ID's zijn stabiel genoeg

---

## 🟢 Phase C — Unified Inbox (volgende stap)

Status: C.1 t/m C.6 + Fathom integraties geland. C.7-C.8 nog te doen.

### C.7 — Chat substrate UI tabs
- Twee nieuwe tabs in de inbox: **Team Inbox** (Slack DMs/channels) + **Client Inbox** (Trengo per-contact merged)
- Pull events met `thread_key IS NOT NULL` uit `inbox_events`, render per thread
- Per-platform thread keys al gedefinieerd in `project_phase_c_unified_inbox_design.md`
- Trengo's biggest pain: tickets-per-contact merge — al gemodelleerd in schema

### C.8 — Per-client timeline op slide-over
- Op de client slide-over (`/clients/[id]` of het overlay paneel): chronologische timeline van alle inbox events met die `client_id`
- Inclusief Monday updates (chat-substrate uitgesloten maar timeline wel)
- Eventueel filterbaar per source

---

## 🟢 Project basis (uit CLAUDE.md "Pending")

- **Step 9** — Per-user per-client per-tab access control verfijnen (basis bestaat in `client_access` tabel, UI deels in users-tab)
- **Step 10** — Polish: error boundaries, responsive, loading states. Niet sexy maar nodig voor productiekwaliteit

---

## 🔵 Lange termijn — Phase D-G (uit vision doc)

Bouw alleen wanneer je expliciet besluit eraan te beginnen — visie-doc, geen takenlijst.

- **Phase D** — Unified to-do system (Hub-native `tasks` tabel; convert-from-inbox in 1 klik)
- **Phase E** — Native internal communication (Hub-chat per klant + team channels, vervangt operationele Slack)
- **Phase F** — Notificaties (browser push + email digest + mobile)
- **Phase G** — Decommissioning Trengo/Monday/Slack als daily tools

---

## 🧹 Tech debt / cleanup

- Fathom WIP code is nu gemerged — even nakijken of er nog dead-code branches zijn
- `seed-agreements` endpoint blijft staan voor toekomstige re-seeds (na schema-wijzigingen of matcher updates)
- Migration nummering: skip van `20240016` naar `20240018` — `20240017` ontbreekt; check of dat klopt of dat er een file gemist is

---

## 📌 Open vragen

- Wil Roy de quick-link logos in de header eventueel dezelfde layout op de Clients overview tabel? Nu alleen op detail pagina.
- Multi-campaign rapportage: zinvol om in toekomst per-campagne KPIs te splitsen? Nu rolt alles op per Meta ad-account, niet per campagne-binnen-account.
