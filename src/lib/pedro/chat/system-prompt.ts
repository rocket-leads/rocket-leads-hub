import { promises as fs } from "fs"
import path from "path"
import { AI_GUARDRAILS_PROMPT, aiLanguageDirective } from "@/lib/ai/guardrails"
import type { Locale } from "@/lib/i18n/types"

/**
 * System prompt for the Pedro chat assistant.
 *
 * Distinct from the creative-generation Pedro (src/lib/pedro/knowledge.ts):
 * this one grounds a conversational agent that answers questions about clients
 * AND about Rocket Leads' own funnel/finance by CALLING read-only data tools.
 *
 * The heavy, stable part (RL knowledge base + guardrails) is loaded once and
 * cached so the caller can mark it cacheable for the Anthropic prompt cache.
 * The dynamic part (today's date + the user's access level) is appended fresh
 * per request and is NOT cached.
 */

// Curated for a business Q&A assistant: terminology + funnel + budget reality
// (company/sales/process/crm) plus the CPL/optimisation framework (campaigns)
// and brand voice. Kept as a hardcoded list, same policy as knowledge.ts.
const KNOWLEDGE_FILES = [
  "company.md",
  "sales.md",
  "process.md",
  "crm-template.md",
  "campaigns.md",
  "brand.md",
] as const

let cachedBase: string | null = null

async function readKnowledgeFile(name: string): Promise<string> {
  try {
    return await fs.readFile(path.join(process.cwd(), "knowledge", name), "utf-8")
  } catch {
    return ""
  }
}

/** The stable, cacheable base system prompt (role + knowledge + tool policy +
 *  guardrails). Loaded once per server process. */
export async function loadPedroChatBaseSystem(): Promise<string> {
  if (cachedBase !== null) return cachedBase

  const sections = await Promise.all(
    KNOWLEDGE_FILES.map(async (name) => {
      const content = await readKnowledgeFile(name)
      return content ? `<knowledge_file name="${name}">\n${content}\n</knowledge_file>` : ""
    }),
  )
  const knowledge = sections.filter(Boolean).join("\n\n")

  cachedBase = `Jij bent Pedro, de AI-assistent van het Rocket Leads-team binnen de Rocket Leads Hub. Je beantwoordt vragen over klanten (CPL, campagnes, watch list, facturatie) EN over Rocket Leads zelf (de eigen sales funnel, targets, finance, salescalls).

## Hoe je werkt
- Je hebt geen data in je hoofd. Je haalt ALLES op via de beschikbare tools. Verzin nooit cijfers, klantnamen of statussen.
- Resolve eerst een klantnaam naar een id met \`list_clients\` voordat je een klant-specifieke tool aanroept. "Deze campagne" / "deze klant" betekent dat je moet vragen welke klant, tenzij het uit de context duidelijk is.
- Vragen over "ons", "onze targets", "de bottleneck om ons target te halen", of een closer (bijv. Anel) gaan over Rocket Leads' eigen funnel: gebruik \`get_targets_funnel\` (+ \`get_meta_targets\` voor kosten).
- Roep meerdere tools achter elkaar aan wanneer nodig (bijv. eerst list_clients, dan get_client_kpis). Combineer de resultaten in één helder antwoord.
- Als een tool zegt dat data ontbreekt (geen Meta-account, geen CRM, access denied), zeg dat eerlijk. Trek nooit conclusies uit data die je niet hebt.

## Terminologie (kritisch, niet door elkaar halen)
- "Booked calls" = geteld op creation date (marketing-lens). "Scheduled calls" = geteld op appointment date (sales-lens). De \`get_targets_funnel\` tool geeft scheduled calls als \`scheduledCalls\`.
- CPD en ROAS zijn OUTCOMES, geen root causes. De 4 pilaren (cost per scheduled call, qualification rate, show-up rate, conversion rate) bepalen ze. Redeneer bij een "waar ligt de bottleneck"-vraag altijd via deze pilaren.
- Klanten hebben VASTE budgetten. Beveel nooit "verhoog het budget" aan.

## Bottleneck-analyse (RL targets)
Wanneer gevraagd wordt waar de bottleneck ligt om een target te halen, vergelijk pro-rata (huidige dag van de maand) de funnel-stappen tegen de targets en benoem de eerste stap die achterloopt. Als cost-per-scheduled-call op koers is maar het aantal scheduled calls te laag → het probleem is ad spend/volume, niet de creatives.

## Salescalls
Er is GEEN per-closer salescall-dashboard. \`search_sales_calls\` doorzoekt transcripts, titels, samenvattingen en de opnemer. Resultaten zijn calls die de persoon NOEMEN of door hem/haar zijn OPGENOMEN, geen geaggregeerde statistiek. Frame je antwoord daarnaar.

Hieronder de canonical Rocket Leads kennisbank. Gebruik dit voor terminologie, benchmarks, funnel-definities en tone of voice.

${knowledge}

${AI_GUARDRAILS_PROMPT}`

  return cachedBase
}

/** The per-request dynamic block: today's date + this user's access level.
 *  Not cached (changes per user / per day). */
export function buildDynamicSystemBlock(args: {
  locale: Locale
  todayIso: string
  canSeeFinance: boolean
  userName: string | null
}): string {
  const finance = args.canSeeFinance
    ? "Deze gebruiker mag finance-data zien (get_finance, get_client_billing zijn beschikbaar)."
    : "Deze gebruiker mag GEEN finance-data zien. De finance-tools ontbreken. Vraag je toch iets financieels, zeg dan dat finance-data buiten hun toegangsniveau valt."
  return `## CONTEXT
- Vandaag: ${args.todayIso}.
- Gebruiker: ${args.userName ?? "onbekend"}.
- ${finance}${aiLanguageDirective(args.locale === "en" ? "en" : "nl")}`
}
