/**
 * Client-side helper: save a Pedro stage as a new version, but only
 * when the data differs from the latest existing version.
 *
 * Roy's directive 2026-05-09: "als er geen aanpassingen zijn geweest,
 * ook niet dat er elke keer een nieuwe versie wordt gemaakt".
 *
 * Behaviour:
 *  - No latest version yet → POST (this becomes v1).
 *  - Latest version exists, data identical → skip POST, return the
 *    existing version_number.
 *  - Latest version exists, data different → POST (auto-increments).
 *  - Network or server error on the GET → fall through to POST anyway
 *    (better to over-save than to lose work; skip is an optimisation).
 *
 * Equality is JSON-based — every field Pedro persists is JSON-
 * serialisable (objects, arrays, strings, numbers). Key-order changes
 * could in theory cause false-negatives but in practice Pedro builds
 * its payloads from stable shapes so this isn't a real concern.
 */

export type SaveStage =
  | "brief"
  | "angles"
  | "script"
  | "creatives"
  | "lp"
  | "ad-copy"
  | "research"

export type SaveResult =
  | { saved: true; versionNumber: number }
  | { saved: false; reason: "unchanged"; versionNumber: number }
  | { saved: false; reason: "no_client" | "post_failed" | "error"; versionNumber?: number; message?: string }

/**
 * Stable JSON serialisation — sorts object keys recursively so that
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same string.
 * Prevents false "changed" verdicts when the only difference is key
 * order (e.g. when the server hands back fields in a different order
 * than the form built them).
 */
function stableStringify(input: unknown): string {
  if (input === null || typeof input !== "object") return JSON.stringify(input)
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(",")}]`
  const obj = input as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
}

export async function saveIfChanged(args: {
  clientId: string | null
  stage: SaveStage
  data: unknown
  /** Pedro campaign scope. Defaults to 1 for backwards compatibility
   *  with call sites that haven't been campaign-aware yet (Roy
   *  2026-05-23 added named campaigns; old single-campaign clients
   *  remain on campaign_number=1 indefinitely). */
  campaignNumber?: number
}): Promise<SaveResult> {
  if (!args.clientId) return { saved: false, reason: "no_client" }

  const campaignNumber = args.campaignNumber ?? 1

  // 1. Fetch latest version for this stage+campaign. If anything goes
  // wrong here we don't block the save — fall through to POST.
  let latest: { version_number: number; data: unknown } | null = null
  try {
    const res = await fetch(
      `/api/pedro/saved-versions?clientId=${encodeURIComponent(args.clientId)}&stage=${encodeURIComponent(args.stage)}&campaignNumber=${campaignNumber}`,
    )
    if (res.ok) {
      const json = await res.json()
      const versions = (json.versions ?? []) as Array<{ version_number: number; data: unknown }>
      latest = versions[0] ?? null
    }
  } catch {
    /* fall through to POST */
  }

  // 2. Compare. If identical, skip the POST.
  if (latest && stableStringify(latest.data) === stableStringify(args.data)) {
    return { saved: false, reason: "unchanged", versionNumber: latest.version_number }
  }

  // 3. POST as a new version.
  try {
    const res = await fetch("/api/pedro/saved-versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: args.clientId,
        stage: args.stage,
        data: args.data,
        campaignNumber,
      }),
    })
    if (!res.ok) {
      return { saved: false, reason: "post_failed", message: `HTTP ${res.status}` }
    }
    const json = await res.json()
    return { saved: true, versionNumber: json.version?.version_number ?? 0 }
  } catch (e) {
    return {
      saved: false,
      reason: "error",
      message: e instanceof Error ? e.message : "unknown",
    }
  }
}
