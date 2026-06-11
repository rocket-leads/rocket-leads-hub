import { promises as fs } from "fs"
import path from "path"

// Pedro is a campaign management AI for Rocket Leads. The hub keeps all
// canonical RL knowledge (brand voice, marketing angles, video scripts, ad
// copy frameworks) in `knowledge/*.md` at the project root. Pedro pulls the
// most relevant files into its system prompt so every AI call (research,
// angle generation, scripts, ad copy) is grounded in RL's actual playbook
// instead of generic best practices.
//
// We hardcode the file list (not glob) because:
//  1. campaigns.md + brand.md are huge but directly relevant - Pedro's whole
//     job depends on them.
//  2. company.md / process.md / sales.md are operational context that adds
//     bloat without sharpening Pedro's output.
//  3. crm-template.md / vision-rocketleads-hub.md aren't relevant to ads.
//
// Files are read once and cached for the lifetime of the server process -
// updates require a redeploy or `touch` + restart, but that matches how the
// rest of the hub treats `knowledge/`.

const KNOWLEDGE_FILES = ["campaigns.md", "brand.md"] as const

let cachedSystemPrompt: string | null = null

async function readKnowledgeFile(name: string): Promise<string> {
  const fullPath = path.join(process.cwd(), "knowledge", name)
  try {
    return await fs.readFile(fullPath, "utf-8")
  } catch {
    return ""
  }
}

async function buildSystemPrompt(): Promise<string> {
  const sections = await Promise.all(
    KNOWLEDGE_FILES.map(async (name) => {
      const content = await readKnowledgeFile(name)
      if (!content) return ""
      return `<knowledge_file name="${name}">\n${content}\n</knowledge_file>`
    }),
  )

  const knowledge = sections.filter(Boolean).join("\n\n")

  return `Jij bent Pedro, senior campaign manager bij Rocket Leads - een Nederlandse performance marketing agency. Je helpt het team met campagne research, marketing angles, video scripts, creatives, landingspagina's en ad copy.

Hieronder vind je de canonical Rocket Leads playbook. Gebruik dit ALTIJD als basis voor je output: tone of voice, marketing angles per branche, scriptstructuur, hooks die werken, budget realiteit, alles. Wijk hier alleen vanaf als de brief van de campaign manager het expliciet vraagt.

${knowledge}

Belangrijke gedragsregels:
- Output altijd in dezelfde taal als de input van de gebruiker (meestal Nederlands).
- Geen datums, deadlines of tijdelijke aanbiedingen tenzij expliciet aangeleverd.
- Wees specifiek met cijfers, ad-namen, exacte hooks - geen generieke marketing-tips.
- Branche-specifieke angles uit knowledge/campaigns.md hebben voorrang op algemene best practices.
- RL's tone of voice (knowledge/brand.md) is direct, zelfverzekerd, resultaatgericht - geen corporate jargon.`
}

/**
 * Returns Pedro's system prompt, loading + caching the relevant
 * `knowledge/*.md` files on first call. Synchronous after warm-up.
 *
 * Kicks off the async load lazily - first call awaits, subsequent calls
 * return the cached value immediately.
 */
export async function loadPedroSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt !== null) return cachedSystemPrompt
  cachedSystemPrompt = await buildSystemPrompt()
  return cachedSystemPrompt
}
