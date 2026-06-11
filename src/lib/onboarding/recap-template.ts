/**
 * Fallback recap template for the post-kick-off message. Used when the
 * Fathom transcript hasn't landed yet — AM can still get a basic
 * skeleton with the greeting + drive + meta link and edit it manually.
 *
 * The transcript-driven AI version lives in `generate-recap.ts` and is
 * what the wizard prefers when available. This file stays minimal:
 * only the boilerplate the AI can't write better than us
 * (brand-aligned opening, resource links, sign-off).
 */

export type RecapInput = {
  firstName?: string
  companyName?: string
  amName?: string
  driveFolderUrl?: string | null
  metaBmConnectUrl?: string | null
}

export function buildRecapFallback(input: RecapInput): string {
  const greet = input.firstName?.trim() || "daar"
  const company = input.companyName?.trim() || "jouw bedrijf"
  const lines: string[] = []

  lines.push(`Hoi ${greet},`)
  lines.push("")
  lines.push(
    `Tof dat we van start gaan! We hebben enorm veel zin in deze campagne om ${company} te laten groeien.`,
  )

  // AM-filled summary placeholder — AI version replaces this with a
  // 2-3 sentence transcript-based recap.
  lines.push("")
  lines.push("[ vul hier de kick-off samenvatting in — wat hebben we besproken, wat is de pitch, wat is de volgende stap ]")

  if (input.driveFolderUrl) {
    lines.push("")
    lines.push(`📂 Drive folder: ${input.driveFolderUrl}`)
  }
  if (input.metaBmConnectUrl) {
    lines.push(`🔗 Meta BM uitleg: ${input.metaBmConnectUrl}`)
  }

  lines.push("")
  lines.push("Als je vragen hebt, laat het direct weten.")
  lines.push("")
  lines.push(input.amName ? `Groet,\n${input.amName}` : "Groet")

  return lines.join("\n")
}
