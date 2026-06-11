import type { MondayClient } from "@/lib/integrations/monday"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

/**
 * Onboarding wizard registry.
 *
 * The wizard at /onboarding/[id] walks the AM through a fixed sequence of
 * actionable steps. Each step has:
 *   - a stable `key`        - primary key in `client_onboarding_tasks`
 *   - an `action` type      - which UI component renders the right pane
 *   - `prerequisites`       - steps that must be done before this one can
 *                              be entered (visualised as a "locked" pill
 *                              in the rail until cleared)
 *   - optional `derive`     - auto-mark done when underlying Hub data
 *                              already proves the work was done (e.g.
 *                              Drive ID set → Drive setup is implicitly
 *                              complete)
 *
 * The registry is intentionally code-defined (not DB-defined). Adding a
 * step = an entry here + an action component + i18n labels. No migration.
 */

export type WizardActionType =
  // AM section
  | "kickoff_live"
  | "transcript_brief"
  | "am_checklist"
  // CM section (formerly Pedro Onboard stages)
  | "cm_brief"
  | "cm_competitors"
  | "cm_angles"
  | "cm_scripts"
  | "cm_landing_page"
  | "cm_creatives"

/** Who owns the step — drives the section header in the rail + the
 *  default "active step" logic when an AM vs CM opens the wizard. */
export type WizardRole = "AM" | "CM"

/** Stored per-step state read from `client_onboarding_tasks`. Declared
 *  early so the `WizardStep.derive` signature can reference it. */
export type StoredStepRow = {
  done: boolean
  completedAt: string | null
  completedBy: string | null
  content: unknown
}

export type WizardStep = {
  key: string
  /** Short label rendered in the left rail. */
  labelKey: DictionaryKey
  /** One-line description rendered above the action pane. */
  descriptionKey: DictionaryKey
  /** Action type - drives which component renders in the right pane. */
  action: WizardActionType
  /** Account manager vs Campaign manager — drives the section header
   *  in the rail. Roy 2026-06-11: unify the wizard so AM + CM see one
   *  continuous flow instead of two separate sidebar entries. */
  role: WizardRole
  /** 1-based order. Determines rail position and "current step" resolution. */
  order: number
  /** Step keys that must be done before this one is reachable. */
  prerequisites: string[]
  /** When true, this step blocks Onboarding → Live status flip. */
  critical: boolean
  /** Optional auto-derive - returns true when underlying Hub data already
   *  proves the step is done (e.g. Drive folder ID present → Drive setup
   *  is implicitly complete) OR when other stored step rows can vouch
   *  for it (e.g. transcript_brief is done if its two underlying child
   *  rows are both done). The DB row stays unwritten in that case;
   *  the wizard shows it as done regardless. */
  derive?: (c: MondayClient, storedRows: Map<string, StoredStepRow>) => boolean
}

/**
 * v4 wizard sequence (2026-06-11 reframe): AM + CM in één wizard
 * i.p.v. twee aparte sidebar entries (Onboarding + Pedro Onboard).
 *
 * AM section (3 stappen):
 *   1. Kick-off meeting — live tool tijdens de call (brief, aanbod,
 *      klant-acties, brand fingerprint, send recap)
 *   2. Transcript koppelen + brief verrijken — Fathom recording
 *      koppelen EN AI brief enrichment in één stap (was twee)
 *   3. AM checklist — controleert alles staat klaar, flipt status
 *      Live + draagt over aan CM (was 'handoff' in v3)
 *
 * CM section (6 stappen — was Pedro Onboard):
 *   4. Creative briefing — CM verrijkt brief met invalshoeken
 *      bovenop AM's base brief
 *   5. Competitor research — Apify scrape per competitor
 *   6. Marketing angles — AI gegenereerd uit brief + concurrentie
 *   7. Video scripts — AI scripts per angle
 *   8. Landing page prompts — Loveable prompts
 *   9. Creatives & ads — Pedro image creatives + Meta ad copy
 *
 * Removed: wait_on_client (signalen zitten al in Stap 1 klant-
 * actie checkboxes + Stap 3 checklist).
 */
export const WIZARD_STEPS: WizardStep[] = [
  // ─── ACCOUNT MANAGER ──────────────────────────────────────────
  {
    key: "kickoff_live",
    labelKey: "onboarding.wizard.step.kickoff_live.label",
    descriptionKey: "onboarding.wizard.step.kickoff_live.desc",
    action: "kickoff_live",
    role: "AM",
    order: 1,
    prerequisites: [],
    critical: true,
  },
  {
    key: "transcript_brief",
    labelKey: "onboarding.wizard.step.transcript_brief.label",
    descriptionKey: "onboarding.wizard.step.transcript_brief.desc",
    action: "transcript_brief",
    role: "AM",
    order: 2,
    prerequisites: ["kickoff_live"],
    critical: false,
    // Done when BOTH underlying child rows are done — the combined
    // view delegates to TranscriptLinkStep + BriefEnrichmentStep,
    // which still save to their own original DB keys.
    derive: (_c, rows) =>
      Boolean(rows.get("transcript_link")?.done) &&
      Boolean(rows.get("brief_enrichment")?.done),
  },
  {
    key: "am_checklist",
    labelKey: "onboarding.wizard.step.am_checklist.label",
    descriptionKey: "onboarding.wizard.step.am_checklist.desc",
    action: "am_checklist",
    role: "AM",
    order: 3,
    prerequisites: ["kickoff_live"],
    critical: true,
    // Auto-done once every critical client-side AND Hub signal is
    // green. Read from the Stap 1 manual checkboxes (Drive content
    // uploaded, Meta connected) + the Hub IDs that the AM should have
    // wired during the kick-off.
    derive: (c) =>
      Boolean(c.metaAdAccountId) &&
      Boolean(c.stripeCustomerId) &&
      Boolean(c.googleDriveId),
  },
  // ─── CAMPAIGN MANAGER ──────────────────────────────────────────
  {
    key: "cm_brief",
    labelKey: "onboarding.wizard.step.cm_brief.label",
    descriptionKey: "onboarding.wizard.step.cm_brief.desc",
    action: "cm_brief",
    role: "CM",
    order: 4,
    prerequisites: ["am_checklist"],
    critical: false,
  },
  {
    key: "cm_competitors",
    labelKey: "onboarding.wizard.step.cm_competitors.label",
    descriptionKey: "onboarding.wizard.step.cm_competitors.desc",
    action: "cm_competitors",
    role: "CM",
    order: 5,
    prerequisites: ["cm_brief"],
    critical: false,
  },
  {
    key: "cm_angles",
    labelKey: "onboarding.wizard.step.cm_angles.label",
    descriptionKey: "onboarding.wizard.step.cm_angles.desc",
    action: "cm_angles",
    role: "CM",
    order: 6,
    prerequisites: ["cm_brief"],
    critical: false,
  },
  {
    key: "cm_scripts",
    labelKey: "onboarding.wizard.step.cm_scripts.label",
    descriptionKey: "onboarding.wizard.step.cm_scripts.desc",
    action: "cm_scripts",
    role: "CM",
    order: 7,
    prerequisites: ["cm_angles"],
    critical: false,
  },
  {
    key: "cm_landing_page",
    labelKey: "onboarding.wizard.step.cm_landing_page.label",
    descriptionKey: "onboarding.wizard.step.cm_landing_page.desc",
    action: "cm_landing_page",
    role: "CM",
    order: 8,
    prerequisites: ["cm_angles"],
    critical: false,
  },
  {
    key: "cm_creatives",
    labelKey: "onboarding.wizard.step.cm_creatives.label",
    descriptionKey: "onboarding.wizard.step.cm_creatives.desc",
    action: "cm_creatives",
    role: "CM",
    order: 9,
    prerequisites: ["cm_landing_page"],
    critical: false,
  },
]

const STEPS_BY_KEY: Map<string, WizardStep> = new Map(
  WIZARD_STEPS.map((s) => [s.key, s]),
)

export function getStep(key: string): WizardStep | undefined {
  return STEPS_BY_KEY.get(key)
}

/** Resolved per-step state - registry metadata + done state + persisted output. */
export type WizardStepState = WizardStep & {
  done: boolean
  /** True when prerequisites are not yet all done. The UI dims locked
   *  steps in the rail and short-circuits the action pane with a hint. */
  locked: boolean
  completedAt: string | null
  completedBy: string | null
  /** Step-specific output (brief JSON, email body, etc.) - see migration. */
  content: unknown
}


/**
 * Resolve the state of every step for a single client. Joins the static
 * registry with: (a) the Monday client snapshot for `derive`d steps and
 * (b) the manual-state map for explicitly persisted rows. Also computes
 * the `locked` flag per step from the prerequisite chain.
 */
export function resolveWizardState(
  client: MondayClient,
  storedRows: Map<string, StoredStepRow>,
): WizardStepState[] {
  // First pass: compute done state.
  const doneByKey: Map<string, boolean> = new Map()
  const states: WizardStepState[] = WIZARD_STEPS.map((step) => {
    const stored = storedRows.get(step.key)
    // Done = explicitly marked OR auto-derived from Monday snapshot +
    // the underlying child-step rows.
    const done =
      Boolean(stored?.done) ||
      (step.derive ? step.derive(client, storedRows) : false)
    doneByKey.set(step.key, done)
    return {
      ...step,
      done,
      locked: false, // filled in second pass
      completedAt: stored?.completedAt ?? null,
      completedBy: stored?.completedBy ?? null,
      content: stored?.content ?? null,
    }
  })

  // No locking (Roy 2026-06-11): the wizard never blocks a step on
  // unfinished predecessors. AM may want to write video scripts before
  // the transcript lands; the kick-off might start before the klant
  // uploads content. The `prerequisites` field stays in the registry
  // as documentation of the natural happy-path order — the UI uses it
  // only to compute the "current step" suggestion, not to gate
  // anything. Every step is always clickable + always saveable.
  return states
}

/**
 * Compute the wizard's "current step" - the lowest-order step that isn't
 * done AND isn't locked. Returns null when the wizard is complete (every
 * step done) so callers can render the "ready for handoff" finish screen.
 */
export function currentStepKey(states: WizardStepState[]): string | null {
  const sorted = [...states].sort((a, b) => a.order - b.order)
  const next = sorted.find((s) => !s.done && !s.locked)
  return next?.key ?? null
}

/**
 * Critical-step gate - returns critical steps that aren't done. Powers
 * the Onboarding → Live hard-gate in `updateClientField`, plus the
 * "X items still open" pill in the overview table.
 */
export function missingCriticalSteps(states: WizardStepState[]): WizardStepState[] {
  return states.filter((s) => s.critical && !s.done)
}

/** Progress percentage (0..100), rounded to nearest integer. */
export function progressPercent(states: WizardStepState[]): number {
  if (states.length === 0) return 0
  const done = states.filter((s) => s.done).length
  return Math.round((done / states.length) * 100)
}
