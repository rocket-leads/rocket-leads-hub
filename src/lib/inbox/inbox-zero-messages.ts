/**
 * Rotating motivational lines shown on the Home dashboard's Inbox block when
 * the user has hit Inbox Zero. Same line for everyone for the whole UTC day —
 * picks a new one tomorrow. The point is to make Inbox Zero feel like a tiny
 * win you want to keep, not a dead empty state.
 *
 * Tone: Roy / Rocket Leads — direct, slightly cheeky, jij-vorm, no fluff.
 * Light pop-culture / marketing references are fine. Avoid anything mean.
 *
 * Pre-baked rather than LLM-on-load so the home page stays cheap to render
 * and never depends on an outbound API call to feel snappy. Refresh the list
 * any time — pure data, no schema.
 */
export const INBOX_ZERO_MESSAGES: readonly string[] = [
  "Inbox zero. Een legende loopt op aarde. 🚀",
  "Lekker leeg. Pak een koffie en de Watch List.",
  "Niks toegewezen. Gebruik de tijd. Bel een klant.",
  "0 unread. Nu écht aan het werk.",
  "Inbox zero is geen rust, het is voorsprong.",
  "Schoon. Net zoals een verse ad set.",
  "Stilte. Te stil. Tijd voor een check-in call.",
  "Inbox leeg, agenda vol? Zo houden we het.",
  "Geen tickets = geen excuses.",
  "Pure status. Hou het zo.",
  "Zo zien we het graag. Door naar de volgende deal.",
  "Niks meer te doen? Drie woorden: Watch. List. Open.",
  "Empty inbox, full pipeline. Toch?",
  "Lekker bezig. Pedro heeft vast nog werk voor je.",
  "0 in. 0 te doen. Klanten bellen dan maar.",
  "Inbox zero is een lifestyle.",
  "Geen werk = geen excuus om vroeg naar huis te gaan.",
  "Schoon als nieuw. Volgende ronde komt eraan.",
  "Allemaal afgehandeld. Ga creatives reviewen.",
  "Inbox: empty. Energy: full. ⚡",
  "Niks gevonden. Voor nu.",
  "Het universum is op één lijn. Inbox zero.",
  "Lege inbox, frisse mind. Push door.",
  "Eindelijk rust. Nu een klant verrassen.",
  "Geen ticket is geen prestatie. Hou de campagnes scherp.",
  "Inbox zero. Onderdeel van een complete Rocket Leads ervaring.",
  "Niks te zien hier. Verder naar de Watch List.",
  "Schoon. Net als de pijplijn van wie z'n inbox vol staat.",
  "Geen taken. Wel doelen. Open Targets.",
  "Inbox zero. Een verhaal voor je kinderen.",
] as const

/**
 * Picks one message deterministically per UTC day. Same string for the whole
 * day so the home page doesn't flicker on refresh, and rotates at midnight UTC
 * to keep it fresh when someone opens the dashboard daily.
 *
 * `now` is overridable for tests / Storybook. Default = real time.
 */
export function pickInboxZeroMessage(now: Date = new Date()): string {
  const dayIndex = Math.floor(now.getTime() / (24 * 60 * 60 * 1000))
  return INBOX_ZERO_MESSAGES[dayIndex % INBOX_ZERO_MESSAGES.length]
}
