import { GENERATION_RULES, type BriefData, type BrandStyle } from "@/lib/pedro/helpers"

/**
 * Stage 4: Manus creative prompts.
 *
 * Two distinct outputs:
 *  1. `buildCreativesMasterPrompt` — the full Manus master template
 *     (client context + design system + variation guide + output format).
 *     This block is STATIC for the campaign and used as the prompt the
 *     CM pastes into Manus. No Claude call.
 *  2. `buildCreativesDescriptionsPrompt` — the Claude prompt that
 *     generates per-creative spec blocks (Headline / CTA / Background
 *     / etc.) which are appended below the master prompt.
 *
 * Both share the format/colour helpers below. Splitting them lets the
 * UI cache the master prompt while only the descriptions hit Claude
 * each refresh.
 */

const FORMAT_DIMS: Record<string, string> = {
  "Static 1:1 (1080×1080)": "1080 x 1080 px",
  "Static 4:5 (1080×1350)": "1080 x 1350 px",
  "Story 9:16 (1080×1920)": "1080 x 1920 px",
  "Carousel eerste slide": "1080 x 1080 px (carousel)",
}

function renderFormats(formats: string[]): string {
  const list = formats.length > 0 ? formats : ["Static 1:1 (1080x1080)"]
  return list.map((f) => `${f} (${FORMAT_DIMS[f] || "1080x1080"})`).join(", ")
}

export type CreativesMasterArgs = {
  brief: BriefData
  anglesStr: string
  qty: number
  formats: string[]
  driveLink: string
  brandStyle: BrandStyle | null | undefined
  /** Free-text huisstijl from the AM textarea (used when no extracted brand style). */
  huisstijl: string | null | undefined
  /** Tail-of-prompt block referencing the previous Manus prompt for visual consistency. */
  previousManusRef?: string
}

export function buildCreativesMasterPrompt(args: CreativesMasterArgs): string {
  const fmtStr = renderFormats(args.formats)
  const drive = args.driveLink || "geen"
  const bs = args.brandStyle
  const brandColors = bs
    ? `${bs.primaryColor}, ${bs.secondaryColor}`
    : args.huisstijl || "niet opgegeven"
  const toneValue = bs?.tone || "urgentie"
  const primaryHex = bs?.primaryColor || "#8967F3"
  const secondaryHex = bs?.secondaryColor || "#1A1A2E"
  const { brief } = args

  return `# MANUS MASTER PROMPT -- ROCKET LEADS AD CREATIVES

Je bent een senior Meta advertising creative director. Je maakt high-converting Nederlandstalige statische ad creatives voor B2C en B2B lead generation campagnes. Je creatives stoppen de scroll, communiceren één duidelijke boodschap en zorgen voor een klik.

---

## CLIENT CONTEXT
Klant: ${brief.bedrijf}
Sector: ${brief.sector}
Doelgroep: ${brief.doel}
Angle:
${args.anglesStr}
Hooks: ${brief.hooksExtra || brief.hooksAM || "niet opgegeven"}
USPs: ${brief.usps || "niet opgegeven"}
Brand kleuren: ${brandColors} (primary: ${primaryHex}, secondary: ${secondaryHex})
Content (Drive): ${drive}
Aantal creatives: ${args.qty}
Formaten: ${fmtStr}
Toon: ${toneValue}

---

## BEELDMATERIAAL

- Gebruik client-afbeeldingen als die beschikbaar zijn (max 1 per creative)
- Voor de rest: gebruik de Manus AI image generator
- Geen stockfoto's
- Achtergrondafbeeldingen mogen GEEN tekst, letters of cijfers bevatten -- dit clasht met de overlay-tekst
- Eindig elke AI image prompt met: "no text, no letters, no words, no numbers, no signs"

---

## BASISREGELS

- Alle tekst in het Nederlands
- Valuta altijd in € (euro)
- Geen datums of seizoensverwijzingen tenzij in de brief
- Geen overlappende tekstelementen
- Logo alleen als het bestand beschikbaar is

---

## DESIGN SYSTEEM

### Layout
- Formaat: ${fmtStr} (1:1=1080x1080 / 4:5=1080x1350 / 9:16=1080x1920)
- Full-bleed achtergrondafbeelding
- Donker gradient overlay onderste 40% voor leesbaarheid
- 48px veilige marge aan alle kanten
- Links uitgelijnd standaard, gecentreerd bij aspirational

### Headline
- Font: bold geometric sans-serif (Clash Display, Neue Haas Grotesk of vergelijkbaar)
- Groot en dominant -- vult 40-60% van de breedte
- Wit (#FFFFFF) met 1-2 kernwoorden in ${primaryHex}
- Max 8 woorden per regel, max 3 regels

### Subheadline
- Zelfde font, regular weight, 35-40% van headline grootte
- Wit of #E0E0E0

### USP checkmarks (optioneel, max 3)
- Checkmark in ${primaryHex} of wit
- Max 5 woorden per USP

### CTA button
- Pill shape (border-radius 50px), 60-75% breedte, gecentreerd
- Achtergrond: ${primaryHex}, wit bold tekst
- Positie: onderste 15-20%
- Max 5 woorden, nooit "Klik hier" of "Lees meer"

### Social proof (optioneel)
- Alleen met echte data -- nooit verzinnen
- Klein badge, rechtsboven

---

## CREATIVE VARIATIES

Genereer ${args.qty} creatives met VERSCHILLENDE aanpakken.

### A -- Statement (tekst-dominant)
Bold headline vult het meeste van het frame. Minimale of verdonkerde achtergrond.

### B -- Product Hero
Full-bleed product/dienst foto met gradient. Headline overlay. CTA prominent.

### C -- Social Proof
Echt resultaat of geloofwaardigheidselement als headline anker.

### D -- Problem/Solution
Directe confronterende vraag of pijnpunt. Checkmark USPs eronder.

### E -- Aspirational
Mooie lifestyle of eindresultaat beelden. Zachtere headline, droom-toon.

### F -- Pattern Interrupt (altijd min. 1 per batch)
Breekt bewust met sectornormen. Provocerend of verrassend.

---

## CREATIEVE RICHTING

Wees een echte creative director. Vraag bij elke batch: "Wat zou MIJN scroll stoppen?"

Varieer automatisch de toon per batch:
- 1x urgentie (FOMO-gevoel zonder datum)
- 1x aspiratie (droom, verlangen, status)
- 1x logica (cijfers, ROI, rationeel)
- 1x pattern interrupt (onverwacht, scroll-stoppend)

---

## OUTPUT FORMAT

Per creative:

### CREATIVE [N] -- Variatie [Letter] ([Naam])
**Headline:** "[Nederlandse tekst]"
**Subheadline:** "[tekst of GEEN]"
**USPs:** [max 3 of GEEN]
**CTA:** "[Nederlandse tekst]"
**Background:** [client afbeelding OF gedetailleerde AI image prompt eindigend met "no text, no letters, no words, no numbers, no signs"]
**Highlight kleur:** ${primaryHex} op [welke woorden]
**CTA achtergrond:** ${primaryHex}
**Logo:** [LINKSBOVEN / GEEN]
**Social proof:** [exacte tekst of GEEN]
**Sfeer:** [1 zin]
**Waarom dit werkt:** [1 zin strategische keuze]${args.previousManusRef ?? ""}`
}

export type CreativesDescriptionsArgs = {
  brief: BriefData
  anglesStr: string
  qty: number
  formats: string[]
  driveLink: string
  brandStyle: BrandStyle | null | undefined
  /** Already-rendered video-script context block (empty when script skipped). */
  scriptContext?: string
  /** First ~600 chars of the LP prompt — added 2026-05-22 after LP
   *  moved BEFORE creatives in the pipeline. Lets the creative
   *  descriptions align headlines/CTA to the LP hero so the visual
   *  promise and the LP delivery match. */
  lpContext?: string
  previousManusRef?: string
  /** Free-text steering from the CM — e.g. "minder generieke headlines,
   *  meer concrete cijfers" or "alle creatives in pattern-interrupt
   *  variant F". Layered on top of the standard prompt without
   *  replacing it. */
  steering?: string
}

export function buildCreativesDescriptionsPrompt(args: CreativesDescriptionsArgs): string {
  const bs = args.brandStyle
  const pHex = bs?.primaryColor || "#8967F3"
  const sHex = bs?.secondaryColor || "#1A1A2E"
  const { brief } = args
  const fmtList = args.formats.length > 0 ? args.formats : ["Static 1:1 (1080x1080)"]
  const steeringBlock = args.steering
    ? `\n\nExtra steering van de campaign manager (laat dit zwaar wegen bij ELKE creative): ${args.steering}`
    : ""

  return `Genereer ${args.qty} creative specs voor Manus. ALLE tekst in het Nederlands. Valuta in €.${steeringBlock}

Klant: ${brief.bedrijf} (${brief.sector})
Doelgroep: ${brief.doel}
Angles:
${args.anglesStr}
Hooks: ${brief.hooksExtra || brief.hooksAM || "niet opgegeven"}
USPs: ${brief.usps || "niet opgegeven"}
Primary kleur: ${pHex} / Secondary: ${sHex}
Drive: ${args.driveLink || "geen"}
Formaten: ${fmtList.join(", ")}
${args.scriptContext ? `Script context:\n${args.scriptContext}` : ""}
${args.lpContext ? `Landingspagina context (headlines + CTA's MOETEN hierop aansluiten — visuele belofte = LP belofte):\n${args.lpContext.substring(0, 600)}` : ""}

Kies ${args.qty} variaties (A-F), min. 1x F "Pattern Interrupt". Varieer toon: urgentie, aspiratie, logica, pattern interrupt.

Per creative EXACT dit format:

### CREATIVE [N] -- Variatie [Letter] ([Naam])
**Headline:** "[Nederlands, max 3 regels x 8 woorden]"
**Subheadline:** "[tekst of GEEN]"
**USPs:** [max 3 of GEEN]
**CTA:** "[Nederlands, max 5 woorden]"
**Background:** [gedetailleerde AI image prompt: onderwerp, compositie, belichting, perspectief, kleurenpalet, sfeer. Eindig met "no text, no letters, no words, no numbers, no signs". OF "gebruik [bestandsnaam]" bij client content]
**Highlight kleur:** ${pHex} op [welke woorden]
**CTA achtergrond:** ${pHex}
**Logo:** [LINKSBOVEN / GEEN]
**Social proof:** [tekst of GEEN -- nooit verzinnen]
**Sfeer:** [1 zin]

Start direct met ### CREATIVE 1. Geen intro, geen samenvatting.${args.previousManusRef ?? ""}${GENERATION_RULES}`
}
