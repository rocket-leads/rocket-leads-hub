import Anthropic from "@anthropic-ai/sdk"

const anthropic = new Anthropic()

/**
 * Smart-inbox layer: pre-draft a Dutch reply to an inbound Trengo message
 * so the AM can review-and-send instead of starting from a blank textarea.
 *
 * Called from the Trengo webhook the moment the AI classifier labels a
 * message as `task`. The result is stored in inbox_events.source_ref.
 * draft_message and the detail dialog prefills the existing reply textarea
 * with it.
 *
 * Tone goal: a draft that sounds like an Account Manager who knows this
 * client — vriendelijk, persoonlijk, niet defensief. The AM can edit before
 * sending; the AI's job is to absorb the typing cost, not to lock down the
 * exact wording.
 */
export async function draftTrengoReply(input: {
  clientName: string | null
  firstName: string | null
  inboundMessage: string
  channel: "email" | "whatsapp"
}): Promise<string> {
  const inbound = input.inboundMessage.trim().slice(0, 2000)
  const isEmail = input.channel === "email"
  const firstName = input.firstName?.trim() || null

  // Two prompt flavors per channel — same intent, different cadence. The
  // WhatsApp variant is shorter, more conversational, "kort appje"-stijl.
  const systemPrompt = isEmail
    ? `Je bent een Nederlandstalige Account Manager bij Rocket Leads die antwoord op een EMAIL van een klant. Schrijf een korte conceptreactie die de AM kan reviewen en versturen.

DOEL: De klant snel een vriendelijk, behulpzaam antwoord geven dat het balletje terugkaatst — niet alle definitieve toezeggingen doen, want de AM tweakt nog voor 't gaat.

STIJL (email):
- Nederlands, vriendelijk en persoonlijk — alsof je deze klant al even kent
- Aanhef met voornaam ("Hallo {voornaam}" of "Hi {voornaam}"; "Beste" alleen als de klantvraag heel formeel is)
- 2-5 zinnen, max ~80 woorden
- Bevestig kort dat je de vraag/opmerking gezien hebt
- Geef een eerste richting voor het antwoord ("we kijken er even naar", "ik laat het je morgen weten", "we passen het aan")
- Geen harde toezeggingen over termijnen tenzij ze in de oorspronkelijke vraag staan
- Sluit af met een vriendelijke afsluiting (geen handtekening, AM's eigen footer staat al in Trengo)

OUTPUT: Alleen de berichttekst, geen quotes, geen markdown.`
    : `Je bent een Nederlandstalige Account Manager bij Rocket Leads die antwoord op een WHATSAPP-bericht van een klant. Schrijf een korte appje-stijl conceptreactie die de AM kan reviewen en versturen.

DOEL: Snel, vriendelijk antwoord — alsof je een appje stuurt aan iemand die je kent.

STIJL (WhatsApp):
- Nederlands, conversationeel
- Opener: "Hé {voornaam}" of "Hi {voornaam}" — geen "Hallo" of "Beste"
- 1-3 zinnen, max ~40 woorden
- Bevestig kort dat je de vraag gezien hebt
- Geef richting (geen harde toezeggingen)
- Geen formele afsluiting, geen handtekening
- Geen emoji's (de AM voegt zelf toe als-ie wil)

OUTPUT: Alleen de berichttekst, geen quotes, geen markdown.`

  const greetingHint = firstName
    ? `Klant heet ${firstName}.`
    : `Voornaam onbekend — gebruik een neutrale opener (bv. "Hallo" of "Hi" zonder naam).`

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `${greetingHint}
${input.clientName ? `Bedrijf: ${input.clientName}.` : ""}

KLANTBERICHT:
${inbound}

Schrijf nu een Nederlandse conceptreactie die de AM kan reviewen.`,
      },
    ],
  })

  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim()
  return text
}

/**
 * Draft a follow-up message for the client based on action items they
 * agreed to in a Fathom-recorded meeting.
 *
 * Use case: AM had a kick-off / evaluation call, the client agreed to
 * deliver X, Y, Z. The Hub bundles those items into one task for the AM
 * with a "Taken voor de klant" section. This drafter generates a friendly
 * Dutch ping the AM can send to remind the client about those items.
 *
 * Tone: helpful, light-touch — frame it as "even doorgeven what we
 * besproken hebben" rather than chasing.
 *
 * Channel-aware. WhatsApp output uses the {firstName}, {body}. shape so
 * Roy's `rl_universal_<am>` template wraps it cleanly.
 */
export async function draftMeetingFollowupMessage(input: {
  firstName: string | null
  clientName: string | null
  meetingTypeLabel: string
  items: string[]
  channel: "email" | "whatsapp"
}): Promise<string> {
  const firstName = input.firstName?.trim() || "daar"
  const itemsList = input.items
    .slice(0, 8) // cap so the prompt + output stay short
    .map((it) => `- ${it.trim()}`)
    .join("\n")
  const isEmail = input.channel === "email"

  const systemPrompt = isEmail
    ? `Je schrijft als Account Manager bij Rocket Leads een korte EMAIL-follow-up naar een klant. In de meeting hebben we afgesproken dat de klant een paar dingen zou aanleveren — jij stuurt een vriendelijk seintje om dat in beweging te krijgen.

STIJL (email):
- Nederlands, vriendelijk en menselijk
- Aanhef: "Hallo {voornaam}" of "Hi {voornaam}"
- Refereer kort aan de meeting (bv. "naar aanleiding van onze kick-off call")
- Lijst de afgesproken acties op (max 5-8 bullets, kort gehouden)
- Sluit af met "laat het me weten als je vragen hebt" of vergelijkbaar — niet té formeel
- Geen "Met vriendelijke groet", geen handtekening (de AM tekent zelf via Trengo)
- 4-7 zinnen totaal

OUTPUT: Alleen de berichttekst, geen quotes, geen markdown. Bullets met "- " zijn ok.`
    : `Je schrijft als Account Manager bij Rocket Leads een korte WhatsApp-follow-up naar een klant. In de meeting hebben we afgesproken dat de klant een paar dingen zou aanleveren — een appje om het balletje rollend te krijgen.

CONTEXT: Het bericht gaat in een Trengo-template "Hey {{1}} Groetjes {AM}". Jouw output gaat in {{1}}. Begin daarom met de voornaam + komma, daarna de boodschap, eindig op een punt.

OUTPUT-FORMAT (verplicht): "{voornaam}, {body eindigend op een punt}"

VOORBEELD: "Dietrich, even een seintje naar aanleiding van onze kick-off — kun je nog de logo's en je Meta toegang regelen? Hoor 't graag."

STIJL (WhatsApp):
- Nederlands, conversationeel
- Begin met voornaam + komma — geen "Hé" of "Hi" als opener
- Refereer kort aan de meeting
- Noem de afgesproken acties — kort, eventueel als opsomming
- Geen formele afsluiting, geen handtekening, geen emoji's
- 2-4 korte zinnen, max ~60 woorden

OUTPUT: Alleen de body-tekst die in {{1}} komt, geen quotes, geen markdown.`

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 350,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Klant: ${firstName}${input.clientName ? ` (bedrijf: ${input.clientName})` : ""}
Meetingtype: ${input.meetingTypeLabel}

AFGESPROKEN ACTIES VOOR DE KLANT:
${itemsList}

Schrijf nu de follow-up.`,
      },
    ],
  })

  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim()
  return text
}
