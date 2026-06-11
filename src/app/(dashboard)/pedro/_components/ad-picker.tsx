"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  Loader2,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  Check,
  ChevronDown,
  Upload,
  Image as ImageIcon,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * AdPicker - Roy 2026-06-10. Text-only cards, geen Meta-thumbnail UI
 * (Meta retourneert te onbetrouwbaar). Per ad een Upload knop waarmee
 * de CM een screenshot kan toevoegen die Pedro gebruikt als reference
 * image bij image generation.
 *
 * Flow:
 *   1. CM kiest een campagne uit z'n selected list
 *   2. Ads tonen als compacte text cards (naam, copy, perf, manager link)
 *   3. CM kan per ad een screenshot uploaden (persistent per ad)
 *   4. Klikt 1 ad → Generate 3 varianten op die DNA (+ screenshot als ref)
 */

type Ad = {
  adId: string
  adName: string
  adsetName: string
  campaignId: string
  campaignName: string
  body: string
  title: string
  description: string
  callToActionType: string
  spend30d: number
  leads30d: number
  cpl30d: number | null
  ctr30d: number
  impressions30d: number
  adsManagerUrl: string
}

type Campaign = {
  id: string
  name: string
  adCount: number
  totalSpend30d: number
  totalLeads30d: number
  avgCpl30d: number | null
  ads: Ad[]
}

type ApiResponse = {
  clientId: string
  clientName: string
  windowDays: number
  windowStart: string
  windowEnd: string
  campaigns: Campaign[]
  warning?: string
  error?: string
}

type ScreenshotInfo = {
  signedUrl: string | null
  storagePath: string
}

type Props = {
  clientId: string | null
  loading: boolean
  hasOutput: boolean
  onGenerate: (extraBody: {
    sourceAdId: string
    sourceScreenshotPath?: string
  }) => Promise<void>
}

const fmtEur = (n: number): string =>
  new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 0 }).format(n)

const fmtCpl = (cpl: number | null): string =>
  cpl == null ? "-" : `€${cpl.toFixed(2)}`

export function AdPicker({ clientId, loading, hasOutput, onGenerate }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [pickedCampaignId, setPickedCampaignId] = useState<string | null>(null)
  const [pickedAdId, setPickedAdId] = useState<string | null>(null)

  // Per-ad uploaded screenshots - keyed by adId. Loaded once on mount,
  // updated optimistically on upload.
  const [screenshots, setScreenshots] = useState<Record<string, ScreenshotInfo>>({})
  const [uploadingAdId, setUploadingAdId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewAdId, setPreviewAdId] = useState<string | null>(null)

  // Load campaigns/ads + screenshots in parallel on client change.
  useEffect(() => {
    if (!clientId) {
      setData(null)
      setScreenshots({})
      return
    }
    let cancelled = false
    setFetching(true)
    setFetchError(null)
    setPickedAdId(null)
    setPickedCampaignId(null)
    setScreenshots({})

    Promise.all([
      fetch(`/api/pedro/campaigns-with-ads/${encodeURIComponent(clientId)}`).then(
        (r) => r.json().catch(() => ({}) as ApiResponse),
      ),
      fetch(`/api/pedro/ad-source-screenshot/${encodeURIComponent(clientId)}`)
        .then((r) => r.json().catch(() => ({ screenshots: {} })))
        .catch(() => ({ screenshots: {} })),
    ])
      .then(([json, screenshotsRes]) => {
        if (cancelled) return
        const adsResponse = json as ApiResponse
        if (adsResponse.error) {
          setFetchError(adsResponse.error)
          setData(null)
          return
        }
        setData(adsResponse)
        const firstWithAds = adsResponse.campaigns.find((c) => c.ads.length > 0)
        if (firstWithAds) {
          setPickedCampaignId(firstWithAds.id)
        }
        const ss = (screenshotsRes as { screenshots?: Record<string, ScreenshotInfo> })
          ?.screenshots ?? {}
        setScreenshots(ss)
      })
      .catch((e) => {
        if (cancelled) return
        setFetchError(e instanceof Error ? e.message : "Laden mislukt")
      })
      .finally(() => {
        if (!cancelled) setFetching(false)
      })

    return () => {
      cancelled = true
    }
  }, [clientId])

  const activeCampaign = useMemo(
    () => data?.campaigns.find((c) => c.id === pickedCampaignId) ?? null,
    [data, pickedCampaignId],
  )

  const handleGenerate = useCallback(async () => {
    if (!pickedAdId || loading) return
    const screenshotPath = screenshots[pickedAdId]?.storagePath
    await onGenerate({
      sourceAdId: pickedAdId,
      ...(screenshotPath ? { sourceScreenshotPath: screenshotPath } : {}),
    })
  }, [pickedAdId, loading, screenshots, onGenerate])

  const uploadScreenshot = useCallback(
    async (adId: string, file: File) => {
      if (!clientId) return
      setUploadingAdId(adId)
      setUploadError(null)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(
          `/api/pedro/ad-source-screenshot/${encodeURIComponent(clientId)}/${encodeURIComponent(adId)}`,
          { method: "POST", body: formData },
        )
        const json = await res.json().catch(() => ({}))
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        // Refetch the single signed URL via the list endpoint.
        const listRes = await fetch(
          `/api/pedro/ad-source-screenshot/${encodeURIComponent(clientId)}`,
        )
        const listJson = await listRes.json().catch(() => ({ screenshots: {} }))
        setScreenshots(
          (listJson as { screenshots?: Record<string, ScreenshotInfo> })
            ?.screenshots ?? {},
        )
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Upload mislukt")
      } finally {
        setUploadingAdId(null)
      }
    },
    [clientId],
  )

  const deleteScreenshot = useCallback(
    async (adId: string) => {
      if (!clientId) return
      setUploadingAdId(adId)
      setUploadError(null)
      try {
        const res = await fetch(
          `/api/pedro/ad-source-screenshot/${encodeURIComponent(clientId)}/${encodeURIComponent(adId)}`,
          { method: "DELETE" },
        )
        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        setScreenshots((prev) => {
          const next = { ...prev }
          delete next[adId]
          return next
        })
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Verwijderen mislukt")
      } finally {
        setUploadingAdId(null)
      }
    },
    [clientId],
  )

  if (!clientId) {
    return (
      <div className="text-sm text-muted-foreground">
        Selecteer eerst een klant bovenaan.
      </div>
    )
  }

  if (fetching && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Campagnes + ads laden uit Meta (90d window)…
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Kon ads-lijst niet laden: {fetchError}
      </div>
    )
  }

  if (!data) return null

  if (data.warning) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        {data.warning}
      </div>
    )
  }

  if (data.campaigns.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Geen actieve campagnes in dit Meta account (laatste 90d).
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Campaign selector */}
      <div>
        <label className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
          Campagne
        </label>
        <div className="relative mt-1">
          <select
            value={pickedCampaignId ?? ""}
            onChange={(e) => {
              setPickedCampaignId(e.target.value || null)
              setPickedAdId(null)
            }}
            className="w-full appearance-none h-10 pl-3 pr-9 text-sm rounded-md border border-border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <option value="">- Kies een campagne -</option>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.adCount} ads · €{fmtEur(c.totalSpend30d)} · {c.totalLeads30d} leads · CPL {fmtCpl(c.avgCpl30d)})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Ads list (text-only) */}
      {activeCampaign && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
              Kies de ad om op te itereren ({activeCampaign.ads.length})
            </label>
            <div className="text-[11px] text-muted-foreground">
              Window: {data.windowDays}d ({data.windowStart} → {data.windowEnd})
            </div>
          </div>
          {activeCampaign.ads.length === 0 ? (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
              Deze campagne heeft geen ads in het {data.windowDays}d window.
            </div>
          ) : (
            // Roy 2026-06-10: grid layout (1 col mobile, 2 col md, 3 col
            // xl) zodat de CM in één scroll meer ads kan zien. AdRow is
            // self-contained dus past prima in een grid cell.
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 max-h-[640px] overflow-y-auto pr-1">
              {activeCampaign.ads.map((ad) => (
                <AdRow
                  key={ad.adId}
                  ad={ad}
                  selected={ad.adId === pickedAdId}
                  disabled={loading || hasOutput}
                  screenshot={screenshots[ad.adId]}
                  uploading={uploadingAdId === ad.adId}
                  onSelect={() => setPickedAdId(ad.adId)}
                  onUpload={(file) => uploadScreenshot(ad.adId, file)}
                  onDelete={() => deleteScreenshot(ad.adId)}
                  onPreview={() => setPreviewAdId(ad.adId)}
                />
              ))}
            </div>
          )}
          {uploadError && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Generate button */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 mt-2">
        <div className="text-xs text-muted-foreground">
          {pickedAdId ? (
            <>
              Pedro itereert op deze ad → 3 nieuwe varianten in dezelfde DNA.
              {screenshots[pickedAdId] && (
                <span className="ml-1 text-emerald-700 dark:text-emerald-400 font-medium">
                  + screenshot als reference.
                </span>
              )}
            </>
          ) : (
            "Kies een ad uit de lijst om Pedro 3 iteraties te laten genereren."
          )}
        </div>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!pickedAdId || loading || hasOutput}
          title={
            hasOutput
              ? "Refresh al gegenereerd - scroll naar de proposals."
              : !pickedAdId
                ? "Kies eerst een ad"
                : "Genereer 3 varianten op deze ad"
          }
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm whitespace-nowrap"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {loading ? "Pedro denkt na…" : "Genereer 3 varianten"}
        </button>
      </div>

      {/* Screenshot preview modal */}
      {previewAdId && screenshots[previewAdId]?.signedUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-background/80 backdrop-blur-sm"
          onClick={() => setPreviewAdId(null)}
        >
          <div className="relative max-w-3xl max-h-[90vh] rounded-lg overflow-hidden shadow-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={screenshots[previewAdId]!.signedUrl!}
              alt="Ad screenshot preview"
              className="max-w-full max-h-[90vh] object-contain bg-card"
            />
            <button
              type="button"
              onClick={() => setPreviewAdId(null)}
              className="absolute top-2 right-2 inline-flex items-center justify-center h-8 w-8 rounded-md bg-background/90 backdrop-blur text-foreground hover:bg-background shadow"
              aria-label="Sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

type AdRowProps = {
  ad: Ad
  selected: boolean
  disabled: boolean
  screenshot: ScreenshotInfo | undefined
  uploading: boolean
  onSelect: () => void
  onUpload: (file: File) => void
  onDelete: () => void
  onPreview: () => void
}

function AdRow({
  ad,
  selected,
  disabled,
  screenshot,
  uploading,
  onSelect,
  onUpload,
  onDelete,
  onPreview,
}: AdRowProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div
      className={cn(
        "rounded-md border bg-background transition-all",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-border/80",
        disabled && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="w-full text-left p-3 disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground truncate" title={ad.adName}>
                {ad.adName}
              </span>
              {selected && (
                <div className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground shrink-0">
                  <Check className="h-2.5 w-2.5" />
                </div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate" title={ad.adsetName}>
              {ad.adsetName}
            </div>
            {ad.body && (
              <div
                className="text-[11px] text-muted-foreground line-clamp-2 italic mt-1"
                title={ad.body}
              >
                {ad.body}
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80 pt-1">
              <span className="font-medium text-foreground">€{fmtEur(ad.spend30d)}</span>
              <span>·</span>
              <span>{ad.leads30d} leads</span>
              <span>·</span>
              <span>CPL {fmtCpl(ad.cpl30d)}</span>
              <span>·</span>
              <span>CTR {ad.ctr30d.toFixed(2)}%</span>
            </div>
          </div>
        </div>
      </button>

      {/* Action row - Upload + Ads Manager link. */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border/50 bg-muted/15 text-[11px]">
        <div className="flex items-center gap-1.5">
          {screenshot ? (
            <>
              <button
                type="button"
                onClick={onPreview}
                disabled={!screenshot.signedUrl}
                className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium hover:underline disabled:opacity-50"
                title="Bekijk je uploaded screenshot"
              >
                <ImageIcon className="h-3 w-3" />
                Screenshot uploaded
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={uploading || disabled}
                className="inline-flex items-center text-muted-foreground hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
                title="Verwijder screenshot"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || disabled}
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
              title="Upload een screenshot van deze ad voor extra context naar Pedro"
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              {uploading ? "Uploaden…" : "Upload screenshot"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onUpload(f)
              e.target.value = ""
            }}
          />
        </div>
        <a
          href={ad.adsManagerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          title="Open deze ad in Meta Ads Manager (voor screenshot maken)"
        >
          <ExternalLink className="h-3 w-3" />
          Open in Ads Manager
        </a>
      </div>
    </div>
  )
}
