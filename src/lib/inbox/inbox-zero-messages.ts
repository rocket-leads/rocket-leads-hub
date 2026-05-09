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
  "Inbox zero. Tijd voor een pilsie. 🍻",
  "Inbox zero — je bent een living legend.",
  "Jouw inbox verdwijnt als sneeuw voor de zon. ❄️",
  "Whoosh. Alles weg. ✨",
  "0 unread. Je moeder zou trots zijn.",
  "Inbox zero of bug? Beide kan.",
  "Klaar. Echt klaar. Beetje raar eigenlijk.",
  "Niks meer te doen — eerste rondje is voor jou. 🍺",
  "Inbox zero. Niet normaal goed.",
  "Inbox zero. Een 10 met een griffel.",
  "Wie heeft inbox zero? Jij. Pure boss energy.",
  "Heb je dit zelf gedaan? Petje af.",
  "Geen werk. Wel applaus. 👏",
  "Inbox zero. Champions League niveau. 🏆",
  "Inbox als een pannenkoek: plat. En leeg.",
  "Boss mode: aan.",
  "Inbox zero. Dat doe je ze niet na.",
  "0 in. 0 te doen. Beetje verdacht eigenlijk.",
  "Vrijdag voelt elke dag bij inbox zero. 🥳",
  "Inbox zero. Wat doen we hier eigenlijk?",
  "Iemand blokkeert vast je e-mail.",
  "Inbox: schoongespoeld. 🧼",
  "Verstappen-stijl: alles voorbij. 🏎️",
  "Niks gevonden. We zijn trots.",
  "Inbox zero. Het is bijna verdacht.",
  "Pak een koffie. Of iets sterkers. ☕",
  "Inbox zero. Magie bestaat dus. 🪄",
  "Een ster aan het firmament. Inbox-stijl. ⭐",
  "Stilte. Te stil. Of gewoon goed.",
  "Mic drop. 🎤",
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
