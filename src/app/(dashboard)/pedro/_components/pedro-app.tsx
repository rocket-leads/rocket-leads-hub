"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Sparkles, Lightbulb, Compass, Video, ImageIcon, FileCode, Megaphone, RefreshCw, Users } from "lucide-react"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { ClientPicker } from "./client-picker"
import { CampaignPicker } from "./campaign-picker"
import { Campaign } from "./pedro-campaign"
import { Research } from "./pedro-research"
import { PedroRefresh } from "./pedro-refresh"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "../page"
import type { PedroCampaign } from "@/app/api/pedro/campaigns/route"

// Pedro is split into three conceptual phases (Roy 2026-05-22):
//
//   1. Voorbereiding — Brief + Research + Angles. Everything the CM
//      needs to lock in before generating deliverables.
//   2. Deliverables  — Video scripts, Creatives (Manus prompt), LP
//      (Lovable prompt), Ad copy. What gets handed to the client.
//   3. Tools         — Refresh (live-campaign creative iteration).
//      Stand-alone optimization, not part of the build flow.
//
// Insights moved to its own /insights top-level page since it's
// agency-wide (no client picker) and conceptually a separate product.
type Section =
  | "brief"
  | "research"
  | "angles"
  | "script"
  | "creatives"
  | "lp"
  | "ad-copy"
  | "refresh"

type CampaignSection = Exclude<Section, "research" | "refresh">

/** Per-phase tab shape — icons + ids never change; labels flip with
 *  the locale toggle so PHASES is built per render via useMemo. */
const PHASE_SHAPE = [
  {
    id: "preparation",
    labelKey: "pedro.phase.preparation" as const,
    tabs: [
      { id: "brief" as const, labelKey: "pedro.tab.brief" as const, icon: Sparkles },
      { id: "research" as const, labelKey: "pedro.tab.research" as const, icon: Lightbulb },
      { id: "angles" as const, labelKey: "pedro.tab.angles" as const, icon: Compass },
    ],
  },
  {
    id: "deliverables",
    labelKey: "pedro.phase.deliverables" as const,
    tabs: [
      // Order matters: LP defines the kernboodschap, creatives follow
      // (headlines align to LP hero), ad copy aligns to BOTH so the
      // creative + LP + copy all read as one campaign. Roy 2026-05-22:
      // earlier flow had creatives before LP which inverted the dependency.
      { id: "script" as const, labelKey: "pedro.tab.script" as const, icon: Video },
      { id: "lp" as const, labelKey: "pedro.tab.lp" as const, icon: FileCode },
      { id: "creatives" as const, labelKey: "pedro.tab.creatives" as const, icon: ImageIcon },
      { id: "ad-copy" as const, labelKey: "pedro.tab.ad_copy" as const, icon: Megaphone },
    ],
  },
  {
    id: "tools",
    labelKey: "pedro.phase.tools" as const,
    tabs: [
      { id: "refresh" as const, labelKey: "pedro.tab.refresh" as const, icon: RefreshCw },
    ],
  },
] as const

const VALID_SECTIONS = new Set<Section>([
  "brief",
  "research",
  "angles",
  "script",
  "creatives",
  "lp",
  "ad-copy",
  "refresh",
])

// All Pedro sections currently require a selected client.
const CLIENT_REQUIRED_SECTIONS = new Set<Section>([
  "brief",
  "research",
  "angles",
  "script",
  "creatives",
  "lp",
  "ad-copy",
  "refresh",
])

const CLIENT_STORAGE_KEY = "pedro.selectedClientId"

type Props = { clients: PedroClient[] }

export function PedroApp({ clients }: Props) {
  const searchParams = useSearchParams()
  const locale = useLocale()

  // PHASES is built further down after savedVersionsQuery resolves
  // (needs the `done` status per tab). Placeholder until that block.

  const initialSection: Section = (() => {
    const tab = searchParams.get("tab")
    if (tab && VALID_SECTIONS.has(tab as Section)) return tab as Section
    if (searchParams.get("clientId")) return "refresh" // shorthand for Watch List
    return "brief"
  })()

  const [section, setSection] = useState<Section>(initialSection)

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab && VALID_SECTIONS.has(tab as Section)) {
      setSection(tab as Section)
    }
  }, [searchParams])

  // ── Single source of truth: client selection at Pedro level ──
  // Persists to localStorage so the AM doesn't lose context on reload.
  // URL param wins on first load (Watch List "Ask Pedro" deep-links).
  const urlClientId = searchParams.get("clientId")
  const [selectedClientId, setSelectedClientIdRaw] = useState<string | null>(() => {
    if (urlClientId) return urlClientId
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(CLIENT_STORAGE_KEY)
      if (stored && clients.some((c) => c.id === stored)) return stored
    }
    return null
  })

  function setSelectedClientId(id: string | null) {
    setSelectedClientIdRaw(id)
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(CLIENT_STORAGE_KEY, id)
      else window.localStorage.removeItem(CLIENT_STORAGE_KEY)
    }
  }

  // Sync URL → state when it changes (cross-page navigation)
  useEffect(() => {
    if (urlClientId && urlClientId !== selectedClientId) {
      setSelectedClientId(urlClientId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlClientId])

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  )

  const requestedAuto = searchParams.get("auto") === "1"
  const needsClient = CLIENT_REQUIRED_SECTIONS.has(section)

  // ── Campaign selection (Roy 2026-05-23) ────────────────────────
  // Per client there can be multiple named campaigns (different
  // audiences / TOV strategies, possibly running in parallel). The
  // picker shows the most-recently-used one by default but the CM can
  // flip to any older campaign to keep building on it. "Nieuwe
  // campagne" creates a fresh container — old work stays addressable
  // via the picker.
  const queryClient = useQueryClient()
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  // Bumps to force-remount Campaign + Research on a campaign switch so
  // component-internal state (brief, angles, etc.) resets to the
  // newly-selected campaign's data instead of carrying the previous.
  const [resetKey, setResetKey] = useState(0)

  const campaignsQuery = useQuery({
    queryKey: ["pedro-campaigns", selectedClientId],
    queryFn: async (): Promise<PedroCampaign[]> => {
      if (!selectedClientId) return []
      const res = await fetch(`/api/pedro/campaigns?clientId=${encodeURIComponent(selectedClientId)}`)
      if (!res.ok) return []
      const data = await res.json()
      return (data?.campaigns ?? []) as PedroCampaign[]
    },
    enabled: !!selectedClientId,
    staleTime: 30_000,
  })

  const campaigns = campaignsQuery.data ?? []
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? null
  const selectedCampaignNumber = selectedCampaign?.campaign_number ?? null

  // Auto-select the most-recently-used campaign whenever the client
  // changes (or the list resolves for the first time). Most-recent =
  // first in the list (the API orders by last_used_at desc).
  useEffect(() => {
    if (!selectedClientId) {
      setSelectedCampaignId(null)
      return
    }
    if (campaignsQuery.isLoading) return
    if (selectedCampaignId && campaigns.some((c) => c.id === selectedCampaignId)) return
    setSelectedCampaignId(campaigns[0]?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClientId, campaignsQuery.isLoading, campaigns.length])

  // Touch last_used_at when the CM actively selects a campaign so the
  // picker default tracks "where the team was last". Best-effort —
  // don't block the UI on the PATCH.
  const touchCampaign = useCallback((id: string) => {
    void fetch(`/api/pedro/campaigns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch: true }),
    }).catch(() => undefined)
  }, [])

  const handleSelectCampaign = useCallback(
    (c: PedroCampaign) => {
      if (c.id === selectedCampaignId) return
      setSelectedCampaignId(c.id)
      setResetKey((k) => k + 1)
      touchCampaign(c.id)
    },
    [selectedCampaignId, touchCampaign],
  )

  const handleCreateCampaign = useCallback(
    async (name: string) => {
      if (!selectedClientId) return
      const res = await fetch("/api/pedro/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, name: name || undefined }),
      })
      if (!res.ok) return
      const json = await res.json()
      const created = json.campaign as PedroCampaign | undefined
      await queryClient.invalidateQueries({ queryKey: ["pedro-campaigns", selectedClientId] })
      if (created) {
        setSelectedCampaignId(created.id)
        setResetKey((k) => k + 1)
        setSection("brief")
      }
    },
    [selectedClientId, queryClient],
  )

  const handleRenameCampaign = useCallback(
    async (c: PedroCampaign, newName: string) => {
      const res = await fetch(`/api/pedro/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) return
      await queryClient.invalidateQueries({ queryKey: ["pedro-campaigns", selectedClientId] })
    },
    [queryClient, selectedClientId],
  )

  const handleArchiveCampaign = useCallback(
    async (c: PedroCampaign) => {
      const res = await fetch(`/api/pedro/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      })
      if (!res.ok) return
      // If we archived the active one, fall back to the next most-recent.
      if (c.id === selectedCampaignId) {
        const fallback = campaigns.find((x) => x.id !== c.id) ?? null
        setSelectedCampaignId(fallback?.id ?? null)
        setResetKey((k) => k + 1)
      }
      await queryClient.invalidateQueries({ queryKey: ["pedro-campaigns", selectedClientId] })
    },
    [queryClient, selectedCampaignId, campaigns, selectedClientId],
  )

  // Saved-versions list for the *currently selected* campaign — drives
  // the ✓ done markers on the tab bar so the CM sees per-campaign
  // progress, not a cross-campaign smear.
  type SavedVersion = { stage: string; version_number: number; saved_at: string }
  const savedVersionsQuery = useQuery({
    queryKey: ["pedro-app-saved-versions", selectedClientId, selectedCampaignNumber],
    queryFn: async (): Promise<SavedVersion[]> => {
      if (!selectedClientId || selectedCampaignNumber == null) return []
      const res = await fetch(
        `/api/pedro/saved-versions?clientId=${encodeURIComponent(selectedClientId)}&campaignNumber=${selectedCampaignNumber}`,
      )
      if (!res.ok) return []
      const data = await res.json()
      return (data?.versions ?? []) as SavedVersion[]
    },
    enabled: !!selectedClientId && selectedCampaignNumber != null,
    staleTime: 30_000,
  })

  // Flat tab list — phases (Voorbereiding / Deliverables / Tools) were
  // dropped as part of the Hub-wide design uniformization (Roy 2026-05-23):
  // every other dashboard page uses a single TopTabs strip without grouped
  // sub-headers, so Pedro now matches. The PHASE_SHAPE structure is kept
  // as the source order — flattening preserves the original tab sequence
  // (Brief → Research → Angles → Script → LP → Creatives → Ad copy → Refresh).
  const TABS: TopTab<Section>[] = useMemo(() => {
    const savedStages = new Set<string>()
    for (const v of savedVersionsQuery.data ?? []) savedStages.add(v.stage)
    return PHASE_SHAPE.flatMap((phase) =>
      phase.tabs.map((tab) => ({
        id: tab.id,
        label: t(tab.labelKey, locale),
        icon: tab.icon,
        done: savedStages.has(tab.id),
      })),
    )
  }, [locale, savedVersionsQuery.data])

  return (
    <div className="pedro-root">
      <PageHeader
        title={t("pedro.title", locale)}
        subtitle={t("pedro.subtitle", locale)}
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-[blink_2s_infinite]" />
            {t("pedro.status.online", locale)}
          </span>
        }
      />

      {/* Sticky client picker — single source of truth across all tabs.
          The "ACTIVE CLIENT" ribbon label was dropped 2026-05-23 — no
          other Hub page hangs an uppercase ribbon between header and tabs,
          and the picker itself is self-explanatory. */}
      <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ClientPicker
              clients={clients}
              selectedId={selectedClientId}
              onSelect={(id) => setSelectedClientId(id)}
              onAutoFill={() => {
                /* The brief tab handles auto-fill itself when needed. */
              }}
              hideAutoFill
            />
          </div>
          {selectedClient && (
            <span className="shrink-0 text-xs text-muted-foreground hidden md:inline">
              {selectedClient.boardType === "onboarding" ? t("pedro.picker.onboarding", locale) : t("pedro.picker.live", locale)}
            </span>
          )}
        </div>

        {/* Per-client campaign picker. Each campaign is its own named
            container (different audience / TOV / launch). Defaults to
            the most-recently-used one; CM can switch to any previous
            one or create a new one inline. */}
        {selectedClient && (
          <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              {campaignsQuery.isLoading
                ? "Campagnes laden…"
                : campaigns.length === 0
                  ? "Nog geen campagne voor deze klant — maak er één aan om te starten."
                  : `${campaigns.length} ${campaigns.length === 1 ? "campagne" : "campagnes"} voor deze klant`}
            </div>
            <CampaignPicker
              campaigns={campaigns}
              selectedId={selectedCampaignId}
              loading={campaignsQuery.isLoading}
              onSelect={handleSelectCampaign}
              onCreate={handleCreateCampaign}
              onRename={handleRenameCampaign}
              onArchive={handleArchiveCampaign}
            />
          </div>
        )}
      </div>

      <TopTabs<Section> tabs={TABS} value={section} onChange={setSection} className="mb-6" />

      <div>
        {needsClient && !selectedClientId ? (
          <NoClientSelected />
        ) : section === "research" ? (
          <Research
            key={`research-${selectedClientId}-${selectedCampaignId}-${resetKey}`}
            clientId={selectedClientId}
            clientName={selectedClient?.name ?? ""}
            campaignNumber={selectedCampaignNumber ?? 1}
            onContinue={() => setSection("angles")}
          />
        ) : section === "refresh" ? (
          <PedroRefresh
            clients={clients}
            selectedClientId={selectedClientId}
            selectedClientName={selectedClient?.name ?? ""}
            autoStart={requestedAuto}
          />
        ) : (
          <Campaign
            // Remount key bumps when the CM switches campaign so the
            // Campaign component re-loads from the new campaign's
            // saved state instead of carrying the previous one.
            key={`campaign-${selectedClientId}-${selectedCampaignId}-${resetKey}`}
            section={section as CampaignSection}
            setSection={(s) => setSection(s)}
            clients={clients}
            selectedClientId={selectedClientId}
            selectedClientName={selectedClient?.name ?? ""}
            onSelectClient={(id, _name) => setSelectedClientId(id)}
            campaignNumber={selectedCampaignNumber ?? 1}
            // "New" mode = the active campaign has no saved versions yet
            // (just created, blank form). Otherwise we load whatever's
            // saved for that campaign.
            campaignMode={(savedVersionsQuery.data?.length ?? 0) === 0 ? "new" : "optimize"}
          />
        )}
      </div>
    </div>
  )
}

function NoClientSelected() {
  const locale = useLocale()
  return (
    <Card>
      <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-3">
        <Users className="h-8 w-8 text-muted-foreground/30" />
        <div className="space-y-1">
          <div className="font-heading font-semibold text-base">{t("pedro.no_client.title", locale)}</div>
          <p className="text-sm text-muted-foreground max-w-md">
            {t("pedro.no_client.body", locale)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
