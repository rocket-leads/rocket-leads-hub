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
