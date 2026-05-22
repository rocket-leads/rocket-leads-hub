"use client"

import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Sparkles, Lightbulb, Compass, Video, ImageIcon, FileCode, Megaphone, RefreshCw, Users } from "lucide-react"
import { PhasedTopTabs, type TabPhase } from "@/components/ui/phased-top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { ClientPicker } from "./client-picker"
import { Campaign } from "./pedro-campaign"
import { Research } from "./pedro-research"
import { PedroRefresh } from "./pedro-refresh"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "../page"

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

  const PHASES: TabPhase<Section>[] = useMemo(
    () =>
      PHASE_SHAPE.map((phase) => ({
        id: phase.id,
        label: t(phase.labelKey, locale),
        tabs: phase.tabs.map((tab) => ({
          id: tab.id,
          label: t(tab.labelKey, locale),
          icon: tab.icon,
        })),
      })),
    [locale],
  )

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

      {/* Sticky client picker — single source of truth across all tabs */}
      <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
        <div className="flex items-center gap-3">
          <div className="shrink-0 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
            <Users className="h-3 w-3" />
            {t("pedro.picker.active_client", locale)}
          </div>
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
              {selectedClient.hasSavedCampaign ? t("pedro.picker.saved", locale) : ""}
            </span>
          )}
        </div>
      </div>

      <PhasedTopTabs<Section> phases={PHASES} value={section} onChange={setSection} className="mb-6" />

      <div>
        {needsClient && !selectedClientId ? (
          <NoClientSelected />
        ) : section === "research" ? (
          <Research
            clientId={selectedClientId}
            clientName={selectedClient?.name ?? ""}
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
            section={section as CampaignSection}
            setSection={(s) => setSection(s)}
            clients={clients}
            selectedClientId={selectedClientId}
            selectedClientName={selectedClient?.name ?? ""}
            onSelectClient={(id, _name) => setSelectedClientId(id)}
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
