"use client"

import { Trash2, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  BrandColorRole,
  VisualStyleKey,
} from "@/lib/pedro/creative-settings"

/**
 * Shared brand-identity controls used by both:
 *  - the per-klant Pedro settings panel (pedro-settings-panel.tsx)
 *  - the creative briefing modal (brief-required-modal.tsx)
 *
 * Roy 2026-06-14: the CM expects brand-colour roles (primary / secondary /
 * accent) and the look & feel chips to be reachable from the briefing
 * modal too — not buried in a separate settings panel. Both surfaces
 * now talk to the SAME pedro_creative_settings blob via the same
 * components, so what you change in one is what runs through Pedro.
 */

export type BrandColorRow = {
  hex: string
  enabled?: boolean
  role?: BrandColorRole
}

export const VISUAL_STYLE_OPTIONS: Array<{
  value: Exclude<VisualStyleKey, "auto">
  label: string
}> = [
  { value: "professional", label: "Professioneel" },
  { value: "modern_clean", label: "Modern & clean" },
  { value: "luxurious", label: "Luxueus / premium" },
  { value: "tech_ai", label: "Tech / AI / SaaS" },
  { value: "feminine_soft", label: "Vrouwelijk & zacht" },
  { value: "mysterious_dark", label: "Geheimzinnig / donker" },
  { value: "playful_energetic", label: "Speels & energiek" },
  { value: "robust_industrial", label: "Robuust / industrieel" },
  { value: "vintage_editorial", label: "Vintage / editorial" },
]

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const ROLE_OPTIONS: Array<{ value: "" | BrandColorRole; label: string; hint: string }> = [
  { value: "", label: "Geen rol", hint: "Pedro plaatst 'm op een vrije positie" },
  {
    value: "primary",
    label: "Primary · achtergrond",
    hint: "Canvas / panel-vlak waar de headline op staat",
  },
  {
    value: "secondary",
    label: "Secondary · headline accent",
    hint: "Kleur voor 1-2 nadruk-woorden in je headline + ÉÉN typografisch accent op diezelfde woorden (cleane underline, gevuld marker-vlak met witte tekst, soft highlighter bar, of cirkel om één woord). Geen doorstreping. Base headline blijft wit.",
  },
  {
    value: "accent",
    label: "Accent · brand highlight",
    hint: "Brand-kleur voor scene elementen — graphic overlays, glow, particles, rim-light, highlighted props. Eventueel ook CTA-knop wanneer er één past, maar CTA is optioneel.",
  },
]

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-foreground/80 mb-1.5">{children}</div>
}

/**
 * Multi-select chip row for visual-style attributes ("look & feel"). The
 * full attribute list is opinionated and lives in VISUAL_STYLE_OPTIONS;
 * the chips drive a simple toggle into the `value` array. Empty array =
 * auto-mode (Pedro picks based on brief.sector).
 */
export function VisualStyleChips({
  value,
  onChange,
}: {
  value: VisualStyleKey[]
  onChange: (next: VisualStyleKey[]) => void
}) {
  const toggle = (v: Exclude<VisualStyleKey, "auto">) => {
    const present = value.includes(v)
    onChange(present ? value.filter((x) => x !== v) : [...value, v])
  }
  return (
    <div>
      <FieldLabel>
        Stijl{" "}
        <span className="font-normal text-muted-foreground">
          {value.length === 0 ? "(geen — auto-mode)" : `(${value.length} geselecteerd)`}
        </span>
      </FieldLabel>
      <div className="flex flex-wrap gap-1.5">
        {VISUAL_STYLE_OPTIONS.map((opt) => {
          const active = value.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium border transition-colors",
                active
                  ? "bg-primary/15 border-primary/40 text-primary"
                  : "bg-background border-border text-foreground/70 hover:bg-accent hover:text-foreground",
              )}
            >
              {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Editor for the brand-colour set that generate-image injects. Each row
 * = a hex + enable toggle + role dropdown. The CM tags each colour with
 * a role (primary panel / secondary headline accent / accent scene
 * element) so the auto-classifier's mistakes (donkerblauw-as-accent /
 * lichtblauw-as-panel) don't propagate to the final ad. White + black
 * are implicit and don't need to be in this list.
 */
export function BrandColorsEditor({
  colors,
  detectedSource,
  disabled,
  onChange,
}: {
  colors: BrandColorRow[]
  detectedSource: "pdf" | "website" | "none"
  disabled: boolean
  onChange: (next: BrandColorRow[]) => void
}) {
  const sourceLabel =
    detectedSource === "pdf"
      ? "uit brand book PDF"
      : detectedSource === "website"
        ? "uit website scrape"
        : "geen detectie — voeg ze handmatig toe"

  function patch(
    idx: number,
    p: Partial<{ hex: string; enabled: boolean; role: BrandColorRole | undefined }>,
  ) {
    const next = colors.map((c, i) => {
      if (i !== idx) return c
      const updated: BrandColorRow = { ...c, ...p }
      // "Geen rol" → strip the key so the persisted blob stays tight.
      if (p.role === undefined && "role" in p) delete updated.role
      return updated
    })
    onChange(next)
  }
  function remove(idx: number) {
    onChange(colors.filter((_, i) => i !== idx))
  }
  function add() {
    onChange([...colors, { hex: "#000000", enabled: true }])
  }

  const roleCounts = colors.reduce<Record<BrandColorRole, number>>(
    (acc, c) => {
      if (c.role) acc[c.role] = (acc[c.role] ?? 0) + 1
      return acc
    },
    { primary: 0, secondary: 0, accent: 0 },
  )

  return (
    <div className={cn(disabled && "opacity-50")}>
      <FieldLabel>
        Brand colors <span className="font-normal text-muted-foreground">({sourceLabel})</span>
      </FieldLabel>
      <div className="text-[11px] text-muted-foreground/80 -mt-1 mb-2 leading-snug space-y-0.5">
        <div>Tag elke kleur met een rol zodat Pedro weet waar &apos;ie hoort:</div>
        <ul className="ml-3 list-disc space-y-0.5">
          <li>
            <span className="font-medium text-foreground/80">Primary</span> = de achtergrond /
            panel-kleur waar je headline op staat
          </li>
          <li>
            <span className="font-medium text-foreground/80">Secondary</span> = de{" "}
            <em>nadruk-kleur</em> binnen de headline: 1-2 sleutel-woorden (idealiter 1) krijgen deze
            tint plus één positief typografisch accent — cleane underline, gevuld marker-vlak met
            witte tekst, soft highlighter bar, of dunne cirkel om één woord. Geen doorstreping of
            kruisstreepjes. Base headline blijft wit.
          </li>
          <li>
            <span className="font-medium text-foreground/80">Accent</span> = de brand-kleur voor{" "}
            <em>scene elementen</em>: graphic overlays, glow, particles, rim-light, gehighlighte
            props. Eventueel ook de CTA-knop wanneer er één past — maar CTA is optioneel, niet
            verplicht.
          </li>
        </ul>
        <div className="pt-0.5">
          Wit en zwart zijn altijd impliciet beschikbaar voor tekst &amp; elementen — die hoef je
          niet hier toe te voegen.
        </div>
      </div>
      <div className="space-y-2">
        {colors.length === 0 && (
          <div className="text-xs text-muted-foreground italic">
            Nog geen kleuren — voeg er één toe of hercheck de detectie via analyze-website.
          </div>
        )}
        {colors.map((c, idx) => {
          const enabled = c.enabled !== false
          const valid = HEX_RE.test(c.hex)
          const role = c.role
          const isDuplicateRole = role !== undefined && roleCounts[role] > 1
          return (
            <div
              key={idx}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/60 bg-background/40 flex-wrap",
                !enabled && "opacity-60",
              )}
            >
              <input
                type="checkbox"
                checked={enabled}
                disabled={disabled}
                onChange={(e) => patch(idx, { enabled: e.target.checked })}
                className="h-4 w-4 accent-primary shrink-0"
                title={enabled ? "Sluit deze kleur uit bij generatie" : "Gebruik deze kleur weer"}
              />
              <span
                className="h-6 w-6 rounded border border-border/60 shrink-0"
                style={{ backgroundColor: valid ? c.hex : "transparent" }}
              />
              <input
                type="text"
                value={c.hex}
                disabled={disabled}
                onChange={(e) => patch(idx, { hex: e.target.value })}
                className={cn(
                  "h-7 px-2 rounded border border-border/60 bg-background text-xs font-mono w-28",
                  !valid && "border-red-500/50 text-red-600 dark:text-red-400",
                )}
                placeholder="#000000"
                spellCheck={false}
              />
              <input
                type="color"
                value={valid ? c.hex : "#000000"}
                disabled={disabled}
                onChange={(e) => patch(idx, { hex: e.target.value })}
                className="h-7 w-9 rounded border border-border/60 cursor-pointer disabled:cursor-not-allowed"
                title="Color picker"
              />
              <select
                value={role ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  patch(idx, {
                    role: e.target.value === "" ? undefined : (e.target.value as BrandColorRole),
                  })
                }
                className={cn(
                  "h-7 px-2 rounded border border-border/60 bg-background text-xs",
                  isDuplicateRole && "border-amber-500/50 text-amber-700 dark:text-amber-400",
                )}
                title={
                  ROLE_OPTIONS.find((o) => o.value === (role ?? ""))?.hint ??
                  "Kies welke rol deze kleur speelt in de ad"
                }
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {!valid ? "ongeldig" : isDuplicateRole ? "dubbele rol — eerste wint" : ""}
              </span>
              <button
                type="button"
                onClick={() => remove(idx)}
                disabled={disabled}
                className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                title="Verwijder deze kleur"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={add}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          Voeg kleur toe
        </button>
      </div>
    </div>
  )
}
