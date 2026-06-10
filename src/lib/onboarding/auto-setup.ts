import { createFolder, type CreatedDriveFolder } from "@/lib/integrations/google-drive"
import { fetchClientById, setItemColumnValue } from "@/lib/integrations/monday"
import { syncClientToSupabase } from "@/lib/clients/sync"

/**
 * Auto-setup runs the moment an AM first opens the onboarding wizard
 * for a client. By the time the AM has the client on a kick-off call,
 * three things have to be in place so they can share + reference them
 * live in the meeting:
 *
 *   1. Drive folder    — root + subfolder tree under the RL Clients
 *                         shared drive (parent ID via env), service
 *                         account is already Editor at the shared-drive
 *                         level. Drive folder ID also gets mirrored to
 *                         Monday so the existing Hub Drive picker stays
 *                         in sync.
 *   2. Meta BM URL     — Embedded Signup link. Placeholder until App
 *                         Review approval; today returns a Hub-hosted
 *                         guide page so the AM has *something* to share.
 *   3. Stripe link     — payment link for the first invoice. TODO:
 *                         hook into the existing Stripe invoice helpers;
 *                         placeholder until Sprint 2.
 *
 * Idempotent: re-running for a client that already has Drive folder ID
 * mirrored skips the create + reuses the existing folder. Safe to call
 * on every wizard page mount.
 */

/** Sub-folder structure inside each client's root Drive folder. Keys are
 *  stable identifiers used by later wizard steps to find the right place
 *  to drop their output (Brief.pdf → "brief", winning ads → "winningAds",
 *  etc.). The display name is what shows in Drive. */
export const CLIENT_DRIVE_SUBFOLDERS = {
  brief: "Brief",
  analyse: "Concurrentie-analyse",
  clientContent: "Content van klant",
  winningAds: "Winning Ads",
  creatives: "Creatives",
  landingPages: "Landing pages",
  reports: "Reports",
} as const

export type ClientDriveFolderKey = keyof typeof CLIENT_DRIVE_SUBFOLDERS

export type AutoSetupResult = {
  drive: {
    rootFolderId: string
    rootFolderUrl: string
    subfolders: Record<ClientDriveFolderKey, { id: string; url: string }>
    reused: boolean
  }
  metaBmConnectUrl: string
}

/**
 * Resolve the parent folder ID for the shared "RL Clients" drive. Reads
 * `RL_CLIENTS_DRIVE_PARENT_ID` from env so we don't hardcode it; the
 * setup throws a clear error message when it's missing rather than
 * silently creating folders at the service account's root.
 */
function getClientsParentFolderId(): string {
  const id = process.env.RL_CLIENTS_DRIVE_PARENT_ID
  if (!id) {
    throw new Error(
      "RL_CLIENTS_DRIVE_PARENT_ID env var is not set. Add it pointing to the shared 'RL Clients' folder ID before running onboarding auto-setup.",
    )
  }
  return id
}

/**
 * Run the auto-setup pipeline for a client. Returns the resolved
 * resources (folder URLs, Meta link, Stripe link) for the wizard to
 * cache on Stap 1's content.
 */
export async function runAutoSetup(args: {
  mondayItemId: string
}): Promise<AutoSetupResult> {
  const client = await fetchClientById(args.mondayItemId)
  if (!client) throw new Error(`Client ${args.mondayItemId} not found in Monday`)

  // ── 1. Drive folder + subtree ──
  let rootFolder: CreatedDriveFolder
  let subfolders: Record<ClientDriveFolderKey, { id: string; url: string }>
  let reused = false

  if (client.googleDriveId) {
    // Already wired — trust that the subfolder structure exists. Don't
    // re-create or we'd risk duplicating subfolders inside the existing
    // tree. The wizard can show a "Recreate subfolders" override later
    // if the AM truly needs that.
    reused = true
    rootFolder = {
      id: client.googleDriveId,
      name: client.companyName || client.name,
      webViewLink: `https://drive.google.com/drive/folders/${client.googleDriveId}`,
    }
    subfolders = await stubSubfoldersFor(client.googleDriveId)
  } else {
    const parentId = getClientsParentFolderId()
    const folderName = `${client.companyName || client.name} · ${args.mondayItemId.slice(0, 6)}`
    rootFolder = await createFolder({ parentId, name: folderName })

    // Create subfolders sequentially — Drive's API rate limit handles
    // this fine for 7 calls, and sequential makes the error path
    // simpler (if subfolder 4 fails we know the first 3 are real).
    const created: Partial<Record<ClientDriveFolderKey, { id: string; url: string }>> = {}
    for (const [key, displayName] of Object.entries(CLIENT_DRIVE_SUBFOLDERS) as Array<[
      ClientDriveFolderKey,
      string,
    ]>) {
      const sub = await createFolder({ parentId: rootFolder.id, name: displayName })
      created[key] = { id: sub.id, url: sub.webViewLink }
    }
    subfolders = created as Record<ClientDriveFolderKey, { id: string; url: string }>

    // Mirror the root folder ID back to Monday so the existing Hub Drive
    // picker on the client detail page picks it up. Best-effort — Monday
    // hiccup shouldn't fail the whole setup; the AM can paste manually if
    // it's a transient error.
    try {
      await setItemColumnValue(client.boardType, args.mondayItemId, "google_drive_id", rootFolder.id)
      // Resync so Supabase mirror picks up the new ID immediately —
      // otherwise the next page render still shows it empty until the
      // cron rolls around.
      await syncClientToSupabase({ ...client, googleDriveId: rootFolder.id })
    } catch (e) {
      console.error(
        `[auto-setup] Failed to write google_drive_id back to Monday for ${args.mondayItemId}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  // ── 2. Meta BM connect URL ──
  // Placeholder until App Review for Embedded Signup is approved. Today
  // returns a Hub-hosted guide page that walks the client through
  // creating/finding their BM + the partner-invite flow manually.
  // Sprint 6 swap-in: replace with the real Meta Embedded Signup URL.
  const metaBmConnectUrl = buildMetaBmPlaceholderUrl(args.mondayItemId)

  // No Stripe link — payment is a precondition for the kick-off itself
  // (per knowledge/process.md), not something we ask the client to
  // resolve during the call. The wizard surfaces payment-status (paid
  // yes/no) separately via /api/clients/[id]/onboarding/payment-status,
  // queried off the linked Stripe customer ID.

  return {
    drive: {
      rootFolderId: rootFolder.id,
      rootFolderUrl: rootFolder.webViewLink,
      subfolders,
      reused,
    },
    metaBmConnectUrl,
  }
}

/**
 * Returns a placeholder Meta BM URL pointing to a Hub-hosted guide page.
 * The page itself doesn't exist yet — Sprint 6 builds both the Embedded
 * Signup integration AND replaces this URL with the real one.
 */
function buildMetaBmPlaceholderUrl(mondayItemId: string): string {
  const base = process.env.HUB_BASE_URL ?? "https://hub.rocketleads.com"
  return `${base}/onboard/meta/${mondayItemId}`
}

/**
 * When auto-setup reuses an already-created root folder, we don't know
 * the subfolder IDs without listing the folder. Returning empty for now
 * is safe — the wizard's Stap 4 / Stap 1 share paths that need subfolder
 * IDs gracefully fall back to "no subfolder, write to root".
 *
 * TODO: list the children of the root folder + match by name against
 * `CLIENT_DRIVE_SUBFOLDERS` so the reuse path is fully equivalent to
 * the create path. Not blocking Sprint 1 because every new wizard run
 * goes through the create branch.
 */
async function stubSubfoldersFor(
  _rootId: string,
): Promise<Record<ClientDriveFolderKey, { id: string; url: string }>> {
  const empty: Partial<Record<ClientDriveFolderKey, { id: string; url: string }>> = {}
  for (const key of Object.keys(CLIENT_DRIVE_SUBFOLDERS) as ClientDriveFolderKey[]) {
    empty[key] = { id: "", url: "" }
  }
  return empty as Record<ClientDriveFolderKey, { id: string; url: string }>
}
