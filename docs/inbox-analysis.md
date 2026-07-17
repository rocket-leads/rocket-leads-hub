# Inbox — status & analyse

> Opgesteld 2026-07-16. Momentopname van de inbox (`/inbox`) na de herbouw + de
> mention-integratie. Beschrijft wat er staat, wat werkt (en hoe geverifieerd),
> en de bekende beperkingen. Bedoeld als naslag voor de volgende sessie.

---

## Verdict

De inbox draait op de nieuwe 3-paneel shell (`InboxShell`) als default op
`/inbox`. De kern werkt: kanaal-attributie is recht getrokken, e-mails renderen
netjes, mentions komen 1:1 uit Trengo binnen en zijn per-note afvinkbaar, en de
Mentioned-detail is identiek aan de kanaal-detail. `tsc` is clean en de
productie-build slaagt (zie onderaan). Wat resteert is randwerk + één
architecturale beperking (mention-sync is één-richting Trengo→Hub).

**Kort: het werkt. De open punten zijn verfijningen, geen blockers.**

---

## Architectuur

```
/inbox  → InboxShell (src/app/(dashboard)/inbox/_components/shell/)
  ├── Scope-tabs: Internal | External
  ├── Internal  → UpdateFeed (Monday-stijl tasks + updates, inline replies + reacties)
  └── External  → 3 kolommen:
        ├── Rail   : Mentioned · All channels · WhatsApp[…] · Email[…]
        ├── Feed   : UnifiedFeed (tickets, Open/Opgepakt/Gesloten of To-do/Done)
        └── Detail : DetailPane → ChatDetail → ThreadView (chat-pane.tsx)
```

- **Legacy** (`InboxView`) bestaat nog achter `/inbox?legacy` als vangnet.
- **Per-klant** inbox-tab gebruikt nog `InboxView` (niet gemigreerd naar de shell).

### Datastromen (ingest)

| Bron | Route | classify_method | Dekt |
|---|---|---|---|
| Trengo webhook | `POST /api/webhooks/trengo` | `ai` | gedeelde kanalen, realtime |
| Trengo poll-cron | `GET /api/cron/pull-trengo-private-channels` (elke 15 min) | `manual` | persoonlijke/stille kanalen, gap-fill |
| Hub outbound mirror | `src/lib/inbox/reply.ts` | `manual` | wat we zelf vanuit de Hub sturen |

Threads worden **per-kanaal** gegroepeerd: `trengo:contact:<id>|ch:<channelId>`.
Ticket-status (Open/Opgepakt/Gesloten) is afgeleid: `isArchived` (laatste row
gearchiveerd) → Gesloten, `isAssigned` (any row `assigned_at`) → Opgepakt.

---

## Wat er deze ronde is gefixt (met verificatie)

### 1. Kanaal-attributie — strikt per-kanaal
Trengo's `/tickets?channel_id=X` lekt tickets over kanalen heen; de poll viel
terug op het gepólde WhatsApp-kanaal. Daardoor stonden **1683 e-mails** onder
WhatsApp-kanalen (Danny/Roy/Roel WhatsApp).
- Cron gehardend: gebruikt altijd `ticket.channel.id`, nooit de fallback.
- Backfill: 1683 rows teruggezet naar hun echte e-mailkanaal.
- **Geverifieerd:** 0 e-mailrows resteren op WhatsApp-kanalen.

### 2. E-mail-rendering
Gecentreerde `max-w-3xl` leeskolom, `overflow-x-hidden`, lange tokens wrappen.
Loste "chat box ineens heel erg breed" + horizontale scroll op.

### 3. Mentions — inkomend (Trengo → Hub)
Trengo-notes coderen mentions als handles (`@roy430594`) + een gestructureerde
`mentions`-array; de auteur zit in `m.agent`/`m.user_id` (niet `m.author`).
- Nieuwe helper `src/lib/inbox/trengo-mentions.ts` mapt Trengo-user ↔ Hub-user
  (op naam, met eenduidige voornaam-fallback), herschrijft handles → `@Naam`,
  en fan-out één `kind=update` per getagde Hub-user naar diens Mentioned-inbox.
- **Zowel webhook als poll** doen nu de fan-out (poll deed dit voorheen niet →
  persoonlijke-kanaal-mentions gingen verloren).
- Backfill: 184 historische mentions in de inboxen gezet; 132 note-auteurs +
  192 mention-titels gecorrigeerd (Mike Sauer i.p.v. "TikTok Finance Team").

### 4. Mentions — uitgaand (Hub → Trengo)
Composer @-picker laadt de volledige Trengo-users-lijst; bij verzenden zet de
Hub `@Naam` om naar de Trengo-handle → **echte** Trengo-mention + notificatie.
- **Geverifieerd** via een test-note: posten met `@<voornaam><id>` vult Trengo's
  `mentions`-array.

### 5. Mentions — Mentioned-view
- Toont **alle** mentions (ook op closed/niet-geladen tickets) — gebouwd uit de
  mention-updates, niet uit de geladen thread-lijst.
- Klik → **volledige conversatie** (bypass van de kanaal-abonnement-filter na
  verificatie dat je een mention op die thread bezit).
- **Detail identiek aan kanaal-view**: dezelfde Open/Opgepakt/Gesloten knoppen,
  met de **echte** ticket-status (via `getChatThreadState`), ook voor stubs.
- **Per-note checkbox** op de internal note zelf (Trengo-stijl) om de mention af
  te vinken — los van de ticket-status.
- Internal notes zijn nu full-width amber-kaarten met accent-balk (vallen op).

### 6. Mention To-do/Done ↔ Trengo seen (1:1)
Nieuwe cron `sync-trengo-mention-seen` (elke 15 min) leest de `seen`-status uit
Trengo en zet de Hub-mention op Done zodra Trengo 'm gezien heeft.
- **Geverifieerd:** Roy's Mentioned ging van 8 To-do → 1 To-do / 8 Done, gelijk
  aan Trengo.

### 7. AI Summary / AI Note attributie
Automatische Trengo-notes (geen agent/user_id) krijgen een systeem-auteur
("AI Summary") + Sparkles-avatar i.p.v. de contactnaam/-avatar. 1390 backfilled.

### 8. Hub-identiteit op eigen internal notes
Poll clobbert Hub-geschreven outbound rows niet meer → je eigen internal note
behoudt je Hub-naam + profielfoto.

---

## Bekende beperkingen / open punten

1. **Mention-sync is één-richting (Trengo → Hub) — bewust zo (Roy 2026-07-17).**
   Afvinken in Trengo → weg uit Hub To-do (sync-cron, 15 min). Afvinken in de Hub
   → lokaal Done; Trengo blijft ongemoeid. **Reverse sync is niet mogelijk:** de
   Trengo v2 API is read-only voor mentions — `POST/PUT/PATCH/DELETE /mentions/{id}`
   geeft `405 | Allow: GET, HEAD` (uitgebreid getest). Er is geen mark-seen
   endpoint; Trengo zet `seen` alleen via de web-UI. Besluit: zo laten.

2. **Backfill-restjes.** ~43 historische mentions konden niet geresolved worden
   (note-bericht stond niet op pagina 1 van het ticket) → mogelijk verkeerde
   To-do-status of auteur "Someone". Nieuwe mentions zijn correct; de sync-cron
   ruimt de meeste alsnog op. Paginatie in de backfill zou de rest pakken.

3. **Per-klant inbox-tab** (`clients/[id]/_components/inbox-tab.tsx`) draait nog
   op de oude `InboxView`, niet op de shell.

4. **Poll-cron dekking.** Alleen "verse" tickets (activiteit < 2u) worden gepold;
   heel oude threads worden niet opnieuw geraakt. Prima voor de inbox, maar
   seen-state op oude tickets leunt volledig op de sync-cron.

5. **Webhook mention-fan-out** vertrouwt op het custom webhook-payload-formaat;
   de meeste mentions komen via de poll binnen (persoonlijke kanalen), die is
   het grondig getest.

6. **Niet automatisch geverifieerd:** de daadwerkelijke UI-flows (klikken,
   afvinken, status wijzigen) zijn code-compleet + type-safe maar vragen nog een
   handmatige rook-test in de browser — zie checklist.

---

## Testchecklist (browser, na hard-refresh)

- [ ] `/inbox` opent de nieuwe shell (Internal/External), niet de legacy.
- [ ] External → een e-mailthread: netjes gecentreerd, geen horizontale scroll.
- [ ] Monday-e-mails staan onder het juiste e-mailkanaal (Danny/Roel Persoonlijk).
- [ ] Mentioned toont al je mentions; To-do-aantal ≈ Trengo.
- [ ] Klik een mention → **volledige** conversatie (e-mails + notes), niet enkel notes.
- [ ] Internal note toont de echte auteur (Mike Sauer) + foto; valt op; @naam blauw.
- [ ] Vinkje op de note → mention To-do⇄Done; raakt ticket-status niet.
- [ ] Header-knoppen in Mentioned-detail wijzigen Open/Opgepakt/Gesloten correct.
- [ ] Internal note maken vanuit de Hub met `@` → Trengo-users; ontvanger krijgt
      Trengo-notificatie + Hub Mentioned-item.

---

## Belangrijkste bestanden

```
src/app/(dashboard)/inbox/page.tsx                         default = InboxShell
src/app/(dashboard)/inbox/_components/shell/inbox-shell.tsx  orchestrator + mention-logica
src/app/(dashboard)/inbox/_components/shell/detail-pane.tsx  ChatDetail + 3-state knoppen
src/app/(dashboard)/inbox/_components/chat-pane.tsx          ThreadView + note-render + composer @-picker
src/lib/inbox/fetchers.ts                                    listChatThreads, getChatThreadMessages/State
src/lib/inbox/trengo-mentions.ts                            Trengo↔Hub mention mapping
src/lib/inbox/reply.ts                                      outbound + naam→handle + fan-out
src/app/api/webhooks/trengo/route.ts                        webhook ingest + mention fan-out
src/app/api/cron/pull-trengo-private-channels/route.ts      poll ingest + mention fan-out
src/app/api/cron/sync-trengo-mention-seen/route.ts          mention seen-state sync (Trengo→Hub)
src/app/api/inbox/threads/[threadKey]/route.ts              thread messages + state + ?mentioned=1
```

_Build-status: zie commit-message / CI. `tsc --noEmit` clean op moment van schrijven._
