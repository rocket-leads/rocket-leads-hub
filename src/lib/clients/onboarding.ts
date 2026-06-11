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
  | "kickoff_live"
  | "transcript_link"
  | "brief_enrichment"
  | "wait_on_client"
  | "handoff"

export type WizardStep = {
  key: string
  /** Short label rendered in the left rail. */
  labelKey: DictionaryKey
  /** One-line description rendered above the action pane. */
  descriptionKey: DictionaryKey
  /** Action type - drives which component renders in the right pane. */
  action: WizardActionType
  /** 1-based order. Determines rail position and "current step" resolution. */
  order: number
  /** Step keys that must be done before this one is reachable. */
  prerequisites: string[]
  /** When true, this step blocks Onboarding → Live status flip. */
  critical: boolean
  /** Optional auto-derive - returns true when underlying Hub data already
   *  proves the step is done (e.g. Drive folder ID present → Drive setup
   *  is implicitly complete). The DB row stays unwritten in that case;
   *  the wizard shows it as done regardless. */
  derive?: (c: MondayClient) => boolean
}

/**
 * v3 wizard sequence (2026-06-10 reframe, scope-split 2026-06-10):
 * The wizard is a LIVE tool the AM uses during the kick-off itself,
 * not a post-kick-off checklist. Stap 1 is the do-everything live
 * screen: auto-setup (Drive + Meta BM URL + Stripe link) already ran
 * before the AM opens it, so they have all the resources to share with
 * the client + Hub-connection pickers to wire Trengo/Stripe/Monday +
 * a brief template to fill live + a website brand-fingerprint snapshot
 * (colors + fonts editable). After the call, Stap 2-3 enrich the brief
 * from the Fathom transcript. Stap 4 polls client-side completion.
 * Stap 5 hands off to CM.
 *
 * Competitor research moved to Pedro / CM (2026-06-10) - it's CM craft
 * work and AM was duplicating brief context, see process.md split.
 */
export const WIZARD_STEPS: WizardStep[] = [
  {
    key: "kickoff_live",
    labelKey: "onboarding.wizard.step.kickoff_live.label",
    descriptionKey: "onboarding.wizard.step.kickoff_live.desc",
    action: "kickoff_live",
    order: 1,
    prerequisites: [],
    critical: true,
  },
  {
    key: "transcript_link",
    labelKey: "onboarding.wizard.step.transcript_link.label",
    descriptionKey: "onboarding.wizard.step.transcript_link.desc",
    action: "transcript_link",
    order: 2,
    prerequisites: ["kickoff_live"],
    // Not critical - wizard doesn't block Live-flip if the transcript
    // never lands (Fathom hiccup, AM didn't record, etc.). Brief
    // enrichment becomes a no-op in that case.
    critical: false,
  },
  {
    key: "brief_enrichment",
    labelKey: "onboarding.wizard.step.brief_enrichment.label",
    descriptionKey: "onboarding.wizard.step.brief_enrichment.desc",
    action: "brief_enrichment",
    order: 3,
    prerequisites: ["transcript_link"],
    critical: false,
  },
  {
    key: "wait_on_client",
    labelKey: "onboarding.wizard.step.wait_on_client.label",
    descriptionKey: "onboarding.wizard.step.wait_on_client.desc",
    action: "wait_on_client",
    order: 4,
    prerequisites: ["kickoff_live"],
    critical: true,
    // Auto-done once every critical client-side action is detected.
    // Meta IDs auto-wire through the Embedded Signup callback the
    // moment the client connects (Sprint 6 swap-in); until then the
    // metaAdAccountId stays empty and this stays open.
    derive: (c) =>
      Boolean(c.metaAdAccountId) &&
      Boolean(c.stripeCustomerId) &&
      Boolean(c.googleDriveId),
  },
  {
    key: "handoff",
    labelKey: "onboarding.wizard.step.handoff.label",
    descriptionKey: "onboarding.wizard.step.handoff.desc",
    action: "handoff",
    order: 5,
    prerequisites: ["wait_on_client"],
    // Handoff is the consequence of finishing the upstream gates, not
    // itself a gate. Flipping the client to Live is what this step does.
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

/** Stored per-step state read from `client_onboarding_tasks`. */
export type StoredStepRow = {
  done: boolean
  completedAt: string | null
  completedBy: string | null
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
    // Done = explicitly marked OR auto-derived from Monday snapshot.
    const done = Boolean(stored?.done) || (step.derive ? step.derive(client) : false)
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

  // Second pass: lock steps whose prereqs aren't all done.
  for (const s of states) {
    s.locked = s.prerequisites.some((p) => !doneByKey.get(p))
  }

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
