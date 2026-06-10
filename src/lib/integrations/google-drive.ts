import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { ResolvedEntity } from "./resolved-entity"

let cachedAuth: { value: InstanceType<typeof google.auth.GoogleAuth>; expiresAt: number } | null = null

async function getAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "google_drive")
    .single()

  if (!data) throw new Error("Google Drive service account not configured. Go to Settings → API Tokens.")

  const keyJson = JSON.parse(decrypt(data.token_encrypted))

  // Scopes: `drive.readonly` for the existing knowledge-base ingest, plus
  // `drive.file` so we can write Pedro refresh deliverables INTO folders
  // the service account was already given Editor access to. `drive.file`
  // is the narrower of the two write scopes — it only authorises files
  // the service account itself creates, which is exactly what we want
  // (no risk of clobbering an existing client file by accident).
  //
  // Folder share precondition: the client's Drive folder must be shared
  // with the service account email as Editor for write to succeed.
  // Without it, createMarkdownFile() returns a 403 which the calling
  // endpoint surfaces to the AM ("Drive folder must be shared as Editor").
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  })

  cachedAuth = { value: auth, expiresAt: Date.now() + 30 * 60 * 1000 }
  return auth
}

export type CreatedDriveFile = {
  id: string
  webViewLink: string
  name: string
}

export type CreatedDriveFolder = {
  id: string
  webViewLink: string
  name: string
}

/**
 * Create a single Drive folder underneath a parent folder. The parent
 * MUST be shared as Editor with the service account, otherwise Drive
 * returns a 403 (same precondition as `createMarkdownFile` above).
 *
 * `webViewLink` is the URL the AM shares with the client — it's the
 * folder's normal Drive URL, opens in browser when clicked.
 */
export async function createFolder(args: {
  parentId: string
  name: string
}): Promise<CreatedDriveFolder> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  try {
    const res = await drive.files.create({
      requestBody: {
        name: args.name,
        parents: [args.parentId],
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id, name, webViewLink",
      supportsAllDrives: true,
    })
    const data = res.data
    if (!data.id) throw new Error("Drive folder create returned no id")
    return {
      id: data.id,
      name: data.name ?? args.name,
      webViewLink: data.webViewLink ?? `https://drive.google.com/drive/folders/${data.id}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/permission|forbidden|insufficient|insufficientFilePermissions/i.test(msg)) {
      throw new Error(
        "Drive parent folder is niet als Editor gedeeld met het service-account. Open de parent folder, kies Share, en geef het service-account-emailadres Editor-rechten.",
      )
    }
    throw e
  }
}

/**
 * Share a Drive folder with a user email at the requested role. Used by
 * the onboarding wizard's Stap 1 share-flow: when the AM marks "Share
 * via Trengo", we grant the client Editor access on the root folder so
 * they can drop their content in.
 *
 * `sendNotificationEmail: false` — we send our own onboarding email
 * via Trengo with the link, so Drive's auto-email would just be noise.
 */
export async function shareFolderWithUser(args: {
  folderId: string
  email: string
  role?: "reader" | "writer" | "commenter"
}): Promise<void> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  await drive.permissions.create({
    fileId: args.folderId,
    sendNotificationEmail: false,
    supportsAllDrives: true,
    requestBody: {
      type: "user",
      role: args.role ?? "writer",
      emailAddress: args.email,
    },
  })
}

/**
 * Create a plain Markdown file inside the given Drive folder.
 *
 * Roy 2026-06-09: Pedro refresh deliverables push here so the CM can find
 * them in the client's existing Drive folder without manually exporting.
 *
 * Permission failures surface as a thrown error with a hint about the
 * Editor share — the caller wraps this so the AM sees an actionable
 * message instead of a stack trace.
 */
export async function createMarkdownFile(args: {
  folderId: string
  name: string
  contentMarkdown: string
}): Promise<CreatedDriveFile> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  try {
    const res = await drive.files.create({
      requestBody: {
        name: args.name.endsWith(".md") ? args.name : `${args.name}.md`,
        parents: [args.folderId],
        mimeType: "text/markdown",
      },
      media: {
        mimeType: "text/markdown",
        body: args.contentMarkdown,
      },
      fields: "id, name, webViewLink",
      supportsAllDrives: true,
    })
    const data = res.data
    if (!data.id) throw new Error("Drive create returned no file id")
    return {
      id: data.id,
      name: data.name ?? args.name,
      webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/permission|forbidden|insufficient|insufficientFilePermissions/i.test(msg)) {
      throw new Error(
        "Drive folder is niet als Editor gedeeld met het service-account. Open de folder, kies Share, en geef het service-account-emailadres Editor-rechten.",
      )
    }
    throw e
  }
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
}

/** Lightweight folder tree node returned by `listFolderTree`. Used by
 *  the per-client image-source picker so the CM can toggle whole
 *  subtrees on/off vóór de Genereer-image klik. Roy 2026-06-10. */
export type DriveFolderNode = {
  id: string
  name: string
  /** Pad relatief vanaf de root, alleen folder-namen (geen ids).
   *  Voorbeeld: "Photos / Showroom" — disambiguatie wanneer twee
   *  subfolders dezelfde naam hebben. Root zelf heeft path="". */
  path: string
  /** Depth vanaf de root (0 = root, 1 = direct child, ...). */
  depth: number
  /** Indicatief: laatste-gewijzigde timestamp (kan ontbreken voor
   *  Drives waar het service-account beperkte rechten heeft). */
  modifiedTime: string | null
  /** True als deze folder zelf nog subfolders heeft (zodat de UI een
   *  "expand" affordance kan tonen wanneer we lazy-loaden). */
  hasSubfolders: boolean
  /** True als deze folder direct image files bevat (jpg/png). Pure
   *  container-folders zonder eigen foto's worden nog steeds getoond
   *  zodat de CM hun subtree kan toggelen. */
  hasImages: boolean
}

/** Lightweight in-memory cache for listFolderTree results, keyed by
 *  (rootFolderId, maxDepth, maxFolders). TTL 10 min. Survives across
 *  requests (Next.js keeps the module in memory) — so subsequent
 *  ImageSourcesPicker opens for the same client return instant. Roy
 *  2026-06-10: was 15-25s sequential per open; nu meestal <100ms na de
 *  eerste call.
 *
 *  Map cap = 200 entries so memory usage stays bounded if many clients
 *  cycle through. LRU eviction kicks in via `lastUsed`. */
type TreeCacheEntry = {
  result: DriveFolderNode[]
  expiresAt: number
  lastUsed: number
}
const TREE_CACHE = new Map<string, TreeCacheEntry>()
const TREE_CACHE_TTL_MS = 10 * 60 * 1000
const TREE_CACHE_MAX = 200

function cacheKey(rootFolderId: string, maxDepth: number, maxFolders: number): string {
  return `${rootFolderId}|d${maxDepth}|m${maxFolders}`
}

function evictTreeCacheIfNeeded(): void {
  if (TREE_CACHE.size <= TREE_CACHE_MAX) return
  const sorted = Array.from(TREE_CACHE.entries()).sort(
    ([, a], [, b]) => a.lastUsed - b.lastUsed,
  )
  const drop = sorted.length - TREE_CACHE_MAX
  for (let i = 0; i < drop; i++) {
    TREE_CACHE.delete(sorted[i][0])
  }
}

/** Force-invalidate the cache entry for a given root. Use after the CM
 *  toggles a folder pref so the next picker load reflects fresh state.
 *  (Pref state itself lives in the DB, so the tree-content cache stays
 *  valid — but a CM that just toggled wants confidence the UI reflects
 *  reality, so we invalidate.) */
export function invalidateFolderTreeCache(rootFolderId: string): void {
  if (!rootFolderId) return
  for (const k of TREE_CACHE.keys()) {
    if (k.startsWith(`${rootFolderId}|`)) TREE_CACHE.delete(k)
  }
}

/**
 * Enumerate folders onder een root, tot `maxDepth` niveaus diep. Geeft
 * een platte lijst — caller bouwt zelf een tree-view uit de `path` en
 * `depth` velden. Bedoeld voor de per-klant Drive folder picker waarin
 * de CM vóór de Genereer-klik aanvinkt welke folders Pedro mag
 * gebruiken.
 *
 * Roy 2026-06-10 speedup: per-level parallel BFS in plaats van
 * sequential. Voor een typische klant (15-30 folders, depth 2) zakte
 * de wall-time van ~18s naar ~2-3s op cold call. Subsequent picker
 * opens binnen de 10-min TTL hitten de in-memory cache instant.
 *
 * Best-effort: failures per folder loggen + door. Cap totaal folder
 * count op `maxFolders` zodat we niet door 500+ folder trees gaan
 * voor 1 picker-call.
 */
export async function listFolderTree(
  rootFolderId: string,
  options: { maxDepth?: number; maxFolders?: number; bypassCache?: boolean } = {},
): Promise<DriveFolderNode[]> {
  const maxDepth = options.maxDepth ?? 2
  const maxFolders = options.maxFolders ?? 60
  const id = rootFolderId?.trim()
  if (!id) return []

  // ── Cache hit? ──────────────────────────────────────────────────
  const key = cacheKey(id, maxDepth, maxFolders)
  const now = Date.now()
  if (!options.bypassCache) {
    const cached = TREE_CACHE.get(key)
    if (cached && cached.expiresAt > now) {
      cached.lastUsed = now
      return cached.result
    }
  }

  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  type Entry = { id: string; name: string; path: string; depth: number }
  type FolderProbe = {
    entry: Entry
    subfolders: Array<{ id: string; name: string }>
    hasImages: boolean
  }

  // List the children of one folder. Returns subfolders + a hasImages
  // flag (true when at least one jpg/png is direct child). Failures
  // log + return an empty probe so we don't block the whole tree.
  async function probe(entry: Entry): Promise<FolderProbe> {
    try {
      const res = await drive.files.list({
        q: `'${entry.id}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'image/jpeg' or mimeType = 'image/png')`,
        fields: "files(id, name, mimeType)",
        pageSize: 200,
        orderBy: "name",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      const subfolders: Array<{ id: string; name: string }> = []
      let hasImages = false
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue
        if (f.mimeType === "application/vnd.google-apps.folder") {
          subfolders.push({ id: f.id, name: f.name })
        } else {
          hasImages = true
        }
      }
      return { entry, subfolders, hasImages }
    } catch (e) {
      console.error(
        `[google-drive] listFolderTree probe fail (${entry.name}):`,
        e instanceof Error ? e.message : e,
      )
      return { entry, subfolders: [], hasImages: false }
    }
  }

  // Per-level parallel BFS. All folders at depth N are probed in
  // parallel (cap = 12 concurrent so we don't hit Drive rate limits),
  // then their children become the next level.
  const visited = new Set<string>([id])
  const results: DriveFolderNode[] = []
  let level: Entry[] = [{ id, name: "(root)", path: "", depth: 0 }]
  const CONCURRENCY = 12

  while (level.length > 0 && results.length < maxFolders) {
    // Probe this level in parallel batches.
    const probes: FolderProbe[] = []
    for (let i = 0; i < level.length; i += CONCURRENCY) {
      const batch = level.slice(i, i + CONCURRENCY)
      const settled = await Promise.allSettled(batch.map((e) => probe(e)))
      for (let j = 0; j < batch.length; j++) {
        const r = settled[j]
        if (r.status === "fulfilled") {
          probes.push(r.value)
        } else {
          probes.push({ entry: batch[j], subfolders: [], hasImages: false })
        }
      }
    }

    // Emit results + collect next level. Skip root from results.
    const nextLevel: Entry[] = []
    for (const p of probes) {
      if (results.length >= maxFolders) break
      if (p.entry.depth > 0) {
        results.push({
          id: p.entry.id,
          name: p.entry.name,
          path: p.entry.path,
          depth: p.entry.depth,
          modifiedTime: null,
          hasSubfolders: p.subfolders.length > 0,
          hasImages: p.hasImages,
        })
      }
      if (p.entry.depth + 1 > maxDepth) continue
      for (const sub of p.subfolders) {
        if (visited.has(sub.id)) continue
        visited.add(sub.id)
        nextLevel.push({
          id: sub.id,
          name: sub.name,
          path: p.entry.depth === 0 ? sub.name : `${p.entry.path} / ${sub.name}`,
          depth: p.entry.depth + 1,
        })
      }
    }
    level = nextLevel
  }

  // Sort: by path so the tree renders parent-then-children naturally.
  results.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }))

  // ── Cache write ─────────────────────────────────────────────────
  TREE_CACHE.set(key, {
    result: results,
    expiresAt: now + TREE_CACHE_TTL_MS,
    lastUsed: now,
  })
  evictTreeCacheIfNeeded()

  return results
}

export type DriveImageRef = {
  id: string
  name: string
  mimeType: "image/jpeg" | "image/png"
  modifiedTime: string
  bytes: Buffer
}

export type GetFolderImagesOptions = {
  /** Max recursion depth (5 = root → 5 levels deep). Default 5. */
  maxDepth?: number
  /** Soft cap on the number of folders we'll traverse, to prevent
   *  pathological cases on huge Drive trees. Default 80. */
  maxFolders?: number
  /** Primary campaign / product name (e.g., "Zumex"). Folders matching
   *  this name get a massive bonus; folders matching SIBLING campaigns
   *  (the other top-level folders at the root) get a heavy penalty so
   *  we don't pull a Blendtec photo for a Zumex campaign. */
  campaignHint?: string
  /** Secondary hints (variant topic label, ad name). Match in filenames
   *  for a smaller bonus. */
  topicHints?: string[]
  /** Optional async reranker run AFTER bytes are downloaded but BEFORE
   *  the final slice-to-limit. Receives all candidates (up to 4× limit),
   *  must return refs sorted by preference (best first). The caller's
   *  `limit` is then applied to the reranked list. Used by Pedro to do
   *  Claude vision relevance scoring on the candidates so "Pedro zelf
   *  nadenkt" over fotokeuze (Roy 2026-06-10). On failure (throw or
   *  empty return), original order is preserved. */
  rerank?: (candidates: DriveImageRef[]) => Promise<DriveImageRef[]>
  /** Folder ids the CM has explicitly toggled OFF for this client (per
   *  `pedro_drive_folder_prefs`). When the BFS encounters one of these
   *  the entire subtree is hard-skipped — no enumeration, no download,
   *  no vision-call. Roy 2026-06-10: dit voorkomt dat we API kosten
   *  maken aan irrelevante folders zoals 'QualityFree' onder een Zumex
   *  refresh. */
  deniedFolderIds?: Set<string>
}

/**
 * Pull up to `limit` real client photos from the Drive folder for use
 * as reference images in image generation. Deep BFS up to maxDepth
 * (default 5), scoring folders by campaign relevance + skipping
 * sibling-campaign branches.
 *
 * Roy 2026-06-10: oude versie ging maar 1 niveau diep en behandelde
 * alle siblings als gelijkwaardig. Voor "Juice Concepts Benelux"
 * (umbrella met Blendtec / XpressChef / Zumex / QualityFry siblings)
 * leverde dat random foto's uit Blendtec voor een Zumex campagne.
 *
 * Algoritme:
 *   1. Inspecteer root → identificeer welke siblings de campagne zijn
 *      (campaignHint match) en welke andere campagnes (= avoid)
 *   2. BFS door folders. Per folder: score op
 *      - campagne match (+200, hardest signal)
 *      - sibling campaign match (-500, skip subtree)
 *      - generic "brand/style/product/foto" keyword (+50)
 *      - "invoice/contract/legal" keyword (-80)
 *   3. Verzamel image files uit folders met positieve score
 *   4. Sort by file score (folder + filename + size + recency)
 *   5. Download top `limit` bytes
 *
 * Skips:
 *  - Files under 10 KB (icons/logos)
 *  - Files over 8 MB (Gemini payload too big)
 *  - Trashed folders, video files (already implicit via mime filter)
 */
export async function getFolderImages(
  folderId: string,
  limit = 2,
  topicHintsOrOptions: string[] | GetFolderImagesOptions = [],
): Promise<DriveImageRef[]> {
  if (!folderId?.trim()) return []
  // Back-compat: positional string[] is the legacy topicHints arg.
  const opts: GetFolderImagesOptions = Array.isArray(topicHintsOrOptions)
    ? { topicHints: topicHintsOrOptions }
    : topicHintsOrOptions

  const maxDepth = opts.maxDepth ?? 5
  const maxFolders = opts.maxFolders ?? 80
  const campaignHint = opts.campaignHint?.trim() ?? ""
  const topicHints = opts.topicHints ?? []
  const deniedFolderIds = opts.deniedFolderIds ?? new Set<string>()

  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  type FolderRef = {
    id: string
    name: string
    depth: number
    folderScore: number
  }

  type FileMeta = {
    id: string
    name: string
    folderName: string
    folderScore: number
    mimeType: string
    modifiedTime: string
    size: number
  }

  // Token derivation. Campaign hint is the PRIMARY signal — drives both
  // positive scoring (campaign match) and which OTHER siblings to avoid.
  function tokensOf(s: string): string[] {
    return s
      .toLowerCase()
      .split(/[\s/_\-|,.()]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  }
  const STOPWORDS = new Set([
    "rl",
    "the",
    "and",
    "for",
    "ads",
    "campaign",
    "campagne",
    "general",
    "algemeen",
    "folder",
    "main",
    "old",
    "new",
    "temp",
    "test",
  ])
  const campaignTokens = tokensOf(campaignHint)
  const topicTokens = topicHints.flatMap((h) => tokensOf(h))

  const FOLDER_BONUS_RE = /(brand|style|product|foto|photo|asset|creative|shoot|content|imagery|merk|huisstijl|logo)/i
  const FOLDER_PENALTY_RE = /(invoice|factuur|contract|nda|legal|signed|admin|verklaring|wedstrijd|rapport|finance|tax|hr)/i

  // siblingsBlacklist gets populated from the root's other top-level
  // children — those are presumed to be OTHER campaigns in the umbrella.
  const siblingBlacklistTokens = new Set<string>()

  function scoreFolder(name: string, depth: number): number {
    let score = 0
    const lcName = name.toLowerCase()
    // 1. Campaign hit — biggest signal.
    if (campaignTokens.length > 0) {
      const hits = campaignTokens.filter((t) => lcName.includes(t)).length
      if (hits > 0) score += 200 * hits
    }
    // 2. Sibling campaign hit — strong negative, will exclude subtree.
    for (const t of siblingBlacklistTokens) {
      if (lcName.includes(t)) score -= 500
    }
    // 3. Generic asset-folder keywords (brand/photo/product).
    if (FOLDER_BONUS_RE.test(name)) score += 50
    // 4. Negative asset folders (legal/invoice/contract).
    if (FOLDER_PENALTY_RE.test(name)) score -= 80
    // 5. Light depth penalty so shallower folders win ties.
    score -= depth * 2
    return score
  }

  function scoreFile(f: FileMeta): number {
    let score = f.folderScore
    const lcName = f.name.toLowerCase()
    for (const t of topicTokens) if (lcName.includes(t)) score += 25
    if (FOLDER_BONUS_RE.test(f.name)) score += 10
    if (f.size >= 200 * 1024 && f.size <= 4 * 1024 * 1024) score += 5
    const ageDays = (Date.now() - Date.parse(f.modifiedTime)) / 86_400_000
    if (Number.isFinite(ageDays) && ageDays >= 0) {
      score += Math.max(0, 20 - ageDays / 12)
    }
    return score
  }

  // ── 1. Identify sibling campaigns at the root ─────────────────────
  // Look at the immediate children of the root folder. The ones whose
  // names DON'T match the campaignHint are presumed to be OTHER
  // campaigns under the same client umbrella (e.g., Blendtec / XpressChef
  // when Zumex is the active campaign). We blacklist their tokens
  // (excluding generic asset-folder keywords) so descent into those
  // subtrees is heavily penalized.
  let rootChildren: Array<{ id: string; name: string }> = []
  try {
    const res = await drive.files.list({
      q: `'${folderId.trim()}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "files(id, name)",
      pageSize: 50,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    rootChildren = (res.data.files ?? [])
      .filter((f): f is { id: string; name: string } => !!f.id && !!f.name)
      .map((f) => ({ id: f.id, name: f.name }))
  } catch {
    /* best-effort */
  }

  if (campaignTokens.length > 0) {
    for (const child of rootChildren) {
      const childTokens = tokensOf(child.name)
      // Skip generic asset-folder names — those are NOT sibling campaigns.
      if (FOLDER_BONUS_RE.test(child.name)) continue
      // Tokens that DON'T overlap with campaign tokens → sibling.
      const overlaps = childTokens.some((t) => campaignTokens.includes(t))
      if (!overlaps) {
        for (const t of childTokens) siblingBlacklistTokens.add(t)
      }
    }
  }

  // ── 2. BFS over folders ──────────────────────────────────────────
  const visited = new Set<string>([folderId.trim()])
  const queue: FolderRef[] = [
    {
      id: folderId.trim(),
      name: "(root)",
      depth: 0,
      folderScore: campaignTokens.length === 0 ? 0 : -10, // mild penalty if root has unrelated stuff
    },
  ]
  const allImages: FileMeta[] = []
  let folderCount = 0

  while (queue.length > 0 && folderCount < maxFolders) {
    const current = queue.shift()!
    folderCount++

    // List BOTH subfolders and image files in this folder in one call.
    try {
      const res = await drive.files.list({
        q: `'${current.id}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'image/jpeg' or mimeType = 'image/png')`,
        fields: "files(id, name, mimeType, modifiedTime, size)",
        pageSize: 200,
        orderBy: "name",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue
        if (f.mimeType === "application/vnd.google-apps.folder") {
          // Subfolder — score and enqueue if still within depth + not visited.
          if (current.depth + 1 > maxDepth) continue
          if (visited.has(f.id)) continue
          visited.add(f.id)
          // Hard CM-denylist skip — pedro_drive_folder_prefs.enabled=false.
          // No enumeration, no download, no vision-call for this subtree.
          // Roy 2026-06-10.
          if (deniedFolderIds.has(f.id)) continue
          const childScore = scoreFolder(f.name, current.depth + 1)
          // Hard skip subtree if very negative (sibling campaign).
          if (childScore <= -300) continue
          queue.push({
            id: f.id,
            name: f.name,
            depth: current.depth + 1,
            folderScore: current.folderScore + childScore,
          })
        } else if (f.modifiedTime) {
          const size = typeof f.size === "string" ? parseInt(f.size, 10) : 0
          allImages.push({
            id: f.id,
            name: f.name,
            folderName: current.name,
            folderScore: current.folderScore,
            mimeType: f.mimeType,
            modifiedTime: f.modifiedTime,
            size: Number.isFinite(size) ? size : 0,
          })
        }
      }
    } catch {
      // Per-folder failures don't kill the BFS.
    }
  }

  if (allImages.length === 0) return []

  // ── 3. Filter + score-sort ──────────────────────────────────────
  const MIN_BYTES = 10 * 1024
  const MAX_BYTES = 8 * 1024 * 1024
  const usable = allImages
    .filter((f) => f.size === 0 || (f.size >= MIN_BYTES && f.size <= MAX_BYTES))
    .map((f) => ({ file: f, score: scoreFile(f) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 4, 8)) // keep extras as candidates for vision reranking
    .map((s) => s.file)

  // 4. Download each image's bytes. Sequential so a fat file doesn't
  //    OOM the function; with limit=2 the latency is fine.
  const downloaded: DriveImageRef[] = []
  for (const meta of usable) {
    try {
      const dl = await drive.files.get(
        { fileId: meta.id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" },
      )
      const bytes = Buffer.from(dl.data as ArrayBuffer)
      // Defensive size cap — sometimes Drive returns size=0 in metadata
      // but the actual download is huge. Skip rather than blow up Gemini.
      if (bytes.length > MAX_BYTES) continue
      const mimeType: "image/jpeg" | "image/png" =
        meta.mimeType === "image/png" ? "image/png" : "image/jpeg"
      downloaded.push({
        id: meta.id,
        name: meta.name,
        mimeType,
        modifiedTime: meta.modifiedTime,
        bytes,
      })
    } catch (e) {
      console.error(
        `[google-drive] image download failed for ${meta.name}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }

  // 5. Optional vision rerank — caller passes a callback that scores
  //    candidates against campaign + variant context. On failure we
  //    keep the original (folder-score) order.
  let ordered = downloaded
  if (opts.rerank && downloaded.length > 1) {
    try {
      const reranked = await opts.rerank(downloaded)
      if (Array.isArray(reranked) && reranked.length > 0) {
        ordered = reranked
      }
    } catch (e) {
      console.error(
        "[google-drive] rerank callback failed (continuing with folder-score order):",
        e instanceof Error ? e.message : e,
      )
    }
  }

  return ordered.slice(0, limit)
}

export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    for (const f of res.data.files ?? []) {
      files.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime!,
      })
    }

    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

/**
 * Format `modifiedTime` (ISO8601) as a short relative label for the picker
 * subline ("modified 3d ago"). Keeps things tight in the row — anything
 * past a year is rendered as the year only.
 */
function relativeModifiedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 60) return "modified just now"
  if (diffSec < 3600) return `modified ${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `modified ${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 30 * 86400) return `modified ${Math.floor(diffSec / 86400)}d ago`
  if (diffSec < 365 * 86400) return `modified ${Math.floor(diffSec / (30 * 86400))}mo ago`
  return `modified in ${new Date(ms).getFullYear()}`
}

type DriveFolderSummary = {
  id: string
  name: string
  modifiedTime: string | null
  trashed: boolean
}

function toResolvedDriveFolder(f: DriveFolderSummary): ResolvedEntity {
  const subParts: string[] = []
  const modLabel = relativeModifiedLabel(f.modifiedTime)
  if (modLabel) subParts.push(modLabel)
  return {
    id: f.id,
    name: f.name,
    subline: subParts.length > 0 ? subParts.join(" · ") : undefined,
    // Trashed folders are resolvable but unusable as a link target; flag
    // loudly so the AM can fix before it silently breaks file creation.
    status: f.trashed ? "error" : "ok",
    statusLabel: f.trashed ? "In trash" : undefined,
  }
}

/**
 * Search Drive folders by name for the ConnectedEntity picker.
 *
 * Uses `files.list` with a server-side `name contains` filter — Drive
 * supports this natively so we don't have to do client-side substring
 * matching. Scopes to folders the service account can see (it's been
 * shared in as Editor or Viewer); workspace folders the service account
 * has no access to won't appear, which is the correct behavior — those
 * aren't link candidates anyway.
 *
 * Empty query returns the most-recently-modified folders so cold-open
 * shows "folders I actually use", not the alphabetical A-list.
 */
export async function searchDriveFolders(
  query: string,
  limit = 10,
): Promise<ResolvedEntity[]> {
  const trimmed = query.trim()
  const cap = Math.min(Math.max(limit, 1), 25)
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  // Drive's `q` filter accepts a mix of clauses joined with `and`. Escape
  // single quotes in the name fragment so a folder called "Roy's Tests"
  // doesn't break the query string.
  const escaped = trimmed.replace(/'/g, "\\'")
  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ]
  if (escaped.length > 0) clauses.push(`name contains '${escaped}'`)
  const q = clauses.join(" and ")

  const res = await drive.files.list({
    q,
    fields: "files(id, name, modifiedTime, trashed)",
    pageSize: cap,
    orderBy: "modifiedTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  const folders: DriveFolderSummary[] = (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? f.id ?? "",
    modifiedTime: f.modifiedTime ?? null,
    trashed: f.trashed === true,
  }))
  return folders.map(toResolvedDriveFolder)
}

/**
 * Resolve a single Drive folder ID to its ResolvedEntity. Returns null
 * when the folder doesn't exist or the service account has no access —
 * both are "broken link" from the Hub's perspective; the AM needs to
 * either fix the ID or share the folder. Throws on transport/auth
 * failures so the picker shows "couldn't verify" instead of "broken".
 */
export async function resolveDriveFolder(id: string): Promise<ResolvedEntity | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })
  try {
    const res = await drive.files.get({
      fileId: trimmed,
      fields: "id, name, mimeType, modifiedTime, trashed",
      supportsAllDrives: true,
    })
    const f = res.data
    if (!f.id) return null
    if (f.mimeType !== "application/vnd.google-apps.folder") {
      // It's a real file ID but not a folder — wrong link, treat as broken
      // so the picker prompts a correction rather than silently accepting
      // a file ID where the rest of the Hub expects a folder.
      return null
    }
    return toResolvedDriveFolder({
      id: f.id,
      name: f.name ?? f.id,
      modifiedTime: f.modifiedTime ?? null,
      trashed: f.trashed === true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Drive throws "File not found" (404) for both missing files AND
    // files the service account has no access to. Both are "broken link"
    // from the Hub's perspective.
    if (/not found|404|file not found/i.test(msg)) return null
    throw e
  }
}

export async function getFileContent(fileId: string, mimeType: string): Promise<string> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  // Google Docs/Sheets/Slides — export as plain text
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = mimeType === "application/vnd.google-apps.spreadsheet"
      ? "text/csv"
      : "text/plain"

    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "text" },
    )
    return String(res.data)
  }

  // Plain text files
  if (mimeType.startsWith("text/")) {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" },
    )
    return String(res.data)
  }

  // PDFs — download binary and extract text
  if (mimeType === "application/pdf") {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    )
    return extractPdfText(res.data as ArrayBuffer)
  }

  // Word documents — export via Google's conversion
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" },
    )
    return String(res.data)
  }

  return `[Unsupported file type: ${mimeType}]`
}

function extractPdfText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const raw = new TextDecoder("latin1").decode(bytes)

  const textBlocks: string[] = []

  const btEtRegex = /BT\s([\s\S]*?)ET/g
  let match
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1]
    const tjRegex = /\(([^)]*)\)\s*Tj/g
    let tj
    while ((tj = tjRegex.exec(block)) !== null) {
      textBlocks.push(tj[1])
    }
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g
    let tja
    while ((tja = tjArrayRegex.exec(block)) !== null) {
      const parts = tja[1].match(/\(([^)]*)\)/g)
      if (parts) {
        textBlocks.push(parts.map((p) => p.slice(1, -1)).join(""))
      }
    }
  }

  const text = textBlocks.join(" ")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return text || "[PDF content could not be extracted — may be image-based]"
}
