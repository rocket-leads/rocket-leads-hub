import { listFolderFiles, listFolderTree, type DriveFile } from "@/lib/integrations/google-drive"

/**
 * Brand-asset detection in a client's Drive folder.
 *
 * Roy 2026-06-11: Pedro tot nu toe alleen Drive-foto's scande voor
 * reference images. Klanten dumpen vaak ook hun brand book / style
 * guide / kleurenpalet / logo's in dezelfde root - en die zijn juist
 * de hardste bron van waarheid over de huisstijl. Voorbeeld TMM
 * Technology: `tmm-styleguide.eps` + `kleuren.pdf` + `logo-tmm-tech-rgb`
 * subfolder. Die negeerden we volledig.
 *
 * Deze module:
 *   1. Scant root + 1 niveau diep voor file-naam patronen
 *   2. Categoriseert: brandbook, styleGuide, colors, logo, photo
 *   3. Levert een prompt-klare blok om in de Gemini image-gen prompt
 *      te injecten zodat het model weet welke brand-referenties bestaan
 *
 * Vision/OCR op de gevonden PDFs (extract hex codes uit "kleuren.pdf",
 * voorkeur-logo selecteren) is een volgende stap. Voor nu: detect +
 * inject so Pedro stops being blind to deze files.
 */

export type BrandAssetCategory =
  | "brandbook"
  | "style_guide"
  | "colors"
  | "logo"
  | "fonts"
  | "other_brand"

export type BrandAsset = {
  fileId: string
  fileName: string
  mimeType: string
  category: BrandAssetCategory
  /** Folder path waar we 'm vonden (relatief vanaf de Drive root). Empty
   *  string = direct in root. Helpt CM 'm terugvinden. */
  folderPath: string
  webViewLink: string
}

/** Lower-case substring patterns per categorie. Volgorde van checks
 *  is belangrijk: meer-specifiek eerst zodat "brandbook" niet als
 *  generieke "brand" wordt geclassificeerd. */
const PATTERNS: Array<{ category: BrandAssetCategory; needles: string[] }> = [
  {
    category: "brandbook",
    needles: ["brandbook", "brand book", "brand-book", "merkboek"],
  },
  {
    category: "style_guide",
    needles: [
      "styleguide",
      "style guide",
      "style-guide",
      "stijlgids",
      "huisstijl",
      "brand guidelines",
      "brand-guidelines",
    ],
  },
  {
    category: "colors",
    needles: ["kleuren", "colors", "colours", "palette", "color-palette", "kleurpalet"],
  },
  {
    category: "logo",
    needles: ["logo", "wordmark", "beeldmerk"],
  },
  {
    category: "fonts",
    needles: ["font", "typeface", "lettertype", "typografie", "typography"],
  },
  {
    category: "other_brand",
    needles: ["branding", "merk-identiteit", "merkidentiteit", "brand identity", "brand-identity"],
  },
]

const PHOTO_MIME_PREFIXES = ["image/", "video/"]

function classify(fileName: string): BrandAssetCategory | null {
  const n = fileName.toLowerCase()
  for (const { category, needles } of PATTERNS) {
    if (needles.some((needle) => n.includes(needle))) return category
  }
  return null
}

function buildWebViewLink(file: DriveFile): string {
  // Google Drive folders use a different URL pattern, but everything
  // detected here is a file. Falls back to the open-in-Drive viewer.
  return `https://drive.google.com/file/d/${file.id}/view`
}

/**
 * Scan a Drive root folder + its direct subfolders for brand-asset
 * files. Limited to depth-1 to keep the call fast; brand assets sit at
 * the top of well-organized Drives. Logo subfolders ("logo-rgb-blue/")
 * are also captured because their NAMES match the category.
 */
export async function findBrandAssetsInDrive(
  rootFolderId: string,
  opts: { maxFiles?: number } = {},
): Promise<BrandAsset[]> {
  const maxFiles = Math.max(1, Math.min(60, opts.maxFiles ?? 30))
  const found: BrandAsset[] = []

  // Step 1 - root folder. listFolderTree already returns metadata for
  // root + subfolders. We use it to discover subfolder ids; the files
  // inside come from listFolderFiles per folder.
  let subFolders: Array<{ id: string; name: string; path: string }> = []
  try {
    const tree = await listFolderTree(rootFolderId, { maxDepth: 1, maxFolders: 40 })
    subFolders = tree.map((f) => ({ id: f.id, name: f.name, path: f.path }))
  } catch {
    // Tree fetch failed - fall back to root-only scan.
  }

  const folderTargets: Array<{ id: string; path: string; name: string }> = [
    { id: rootFolderId, path: "", name: "" },
    ...subFolders
      .filter((f) => f.id !== rootFolderId)
      .map((f) => ({ id: f.id, path: f.path, name: f.name })),
  ]

  // Subfolders whose NAMES themselves match a brand category - e.g. a
  // "logo-tmm-tech-rgb" subfolder. Surface those as logical brand-asset
  // pointers even when their files don't match the patterns individually.
  for (const sf of subFolders) {
    const cat = classify(sf.name)
    if (cat) {
      found.push({
        fileId: sf.id,
        fileName: sf.name,
        mimeType: "application/vnd.google-apps.folder",
        category: cat,
        folderPath: sf.path,
        webViewLink: `https://drive.google.com/drive/folders/${sf.id}`,
      })
    }
  }

  // Step 2 - per folder, list files and classify by name. We skip mass
  // photo files at this layer (image-vision already handles those); only
  // files matching a brand pattern survive.
  for (const target of folderTargets) {
    if (found.length >= maxFiles) break
    let files: DriveFile[] = []
    try {
      files = await listFolderFiles(target.id)
    } catch {
      continue
    }
    for (const f of files) {
      if (found.length >= maxFiles) break
      const category = classify(f.name)
      if (!category) continue
      // Skip Google Photo MIMEs unless the name explicitly screams logo -
      // a generic photo named "team-photo.jpg" matches no pattern, but
      // "RL-logo.png" should land in the logo bucket.
      const isPhotoLike = PHOTO_MIME_PREFIXES.some((p) => f.mimeType.startsWith(p))
      if (isPhotoLike && category !== "logo") continue
      found.push({
        fileId: f.id,
        fileName: f.name,
        mimeType: f.mimeType,
        category,
        folderPath: target.path,
        webViewLink: buildWebViewLink(f),
      })
    }
  }

  // Dedup by fileId in case a subfolder shows up twice (root scan +
  // tree scan).
  const seen = new Set<string>()
  const unique: BrandAsset[] = []
  for (const a of found) {
    if (seen.has(a.fileId)) continue
    seen.add(a.fileId)
    unique.push(a)
  }
  return unique
}

const CATEGORY_LABEL: Record<BrandAssetCategory, string> = {
  brandbook: "Brand book",
  style_guide: "Style guide",
  colors: "Brand colors",
  logo: "Logo",
  fonts: "Brand fonts",
  other_brand: "Brand identity",
}

/**
 * Format the discovered brand assets as a prompt-ready block for the
 * Gemini image-gen prompt. Empty when no assets were found.
 */
export function brandAssetsPromptBlock(assets: BrandAsset[]): string {
  if (assets.length === 0) return ""
  // Group by category so the prompt reads as a brief inventory.
  const byCat = new Map<BrandAssetCategory, BrandAsset[]>()
  for (const a of assets) {
    const list = byCat.get(a.category) ?? []
    list.push(a)
    byCat.set(a.category, list)
  }
  const lines: string[] = [
    "BRAND REFERENCE FILES IN CLIENT'S DRIVE",
    "These files were placed in the client's Drive by them or their team. They ARE the source of truth for their visual identity. Respect them strictly - colors, logo treatments, fonts, layout principles all derive from these. Never invent brand colors or logo placement when reference files exist.",
  ]
  const order: BrandAssetCategory[] = [
    "brandbook",
    "style_guide",
    "colors",
    "logo",
    "fonts",
    "other_brand",
  ]
  for (const cat of order) {
    const list = byCat.get(cat)
    if (!list || list.length === 0) continue
    lines.push(`- ${CATEGORY_LABEL[cat]}:`)
    for (const a of list) {
      const loc = a.folderPath ? ` (in ${a.folderPath})` : ""
      lines.push(`  · ${a.fileName}${loc}`)
    }
  }
  return lines.join("\n")
}
