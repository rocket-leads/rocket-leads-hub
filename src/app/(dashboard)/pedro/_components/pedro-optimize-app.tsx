"use client"

import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Users, Compass, Video, ImageIcon, Megaphone, FolderOpen } from "lucide-react"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { ClientPicker } from "./client-picker"
import { OptimizeSuggestions } from "./optimize-suggestions"
import { AnglesRefresh } from "./angles-refresh"
import { ScriptRefresh } from "./script-refresh"
import { CreativeRefresh } from "./creative-refresh"
import { AdCopyRefresh } from "./ad-copy-refresh"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "./types"

// Pedro Optimize — the "iterate on a live campaign" entry point.
//
// Roy 2026-05-23: Optimize used to only do creative refresh. Now it has
// four tabs that mirror the deliverables tabs in Onboard — Angles,
// Video Scripts, Creatives, Ad Copy — so the CM can refresh any stage
// without having to re-do the on-board flow from scratch. Each tab
// reads live Meta performance and proposes new variants in that stage's
// shape.
type Section = "angles" | "script" | "creatives" | "ad-copy"

const TAB_SHAPE: Array<{ id: Section; labelKey: Parameters<typeof t>[0]; icon: typeof Compass }> = [
  { id: "angles", labelKey: "pedro.tab.angles", icon: Compass },
  { id: "script", labelKey: "pedro.tab.script", icon: Video },
  { id: "creatives", labelKey: "pedro.tab.creatives", icon: ImageIcon },
  { id: "ad-copy", labelKey: "pedro.tab.ad_copy", icon: Megaphone },
]

const VALID_SECTIONS = new Set<Section>(["angles", "script", "creatives", "ad-copy"])

const CLIENT_STORAGE_KEY = "pedro.selectedClientId"

type Props = { clients: PedroClient[] }

export function PedroOptimizeApp({ clients }: Props) {
  const searchParams = useSearchParams()
  const locale = useLocale()

  const urlClientId = searchParams.get("clientId")
  const autoStart = searchParams.get("auto") === "1"

  // Tab seed: ?tab=X in the URL wins on first load (Watch List "Ask Pedro"
  // can deep-link to a specific stage). Otherwise default to Creatives
  // since that's what Optimize did exclusively before tabs shipped — keeps
  // the existing muscle memory.
  const initialSection: Section = (() => {
    const tab = searchParams.get("tab")
    if (tab && VALID_SECTIONS.has(tab as Section)) return tab as Section
    return "creatives"
  })()

  const [section, setSection] = useState<Section>(initialSection)

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab && VALID_SECTIONS.has(tab as Section)) {
      setSection(tab as Section)
    }
  }, [searchParams])

  // Shared storage key with the on-board app so a client picked in one
  // tab carries to the other — the AM almost always wants the same
  // client across both flows.
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

  const TABS: TopTab<Section>[] = useMemo(
    () =>
      TAB_SHAPE.map((tab) => ({
        id: tab.id,
        label: t(tab.labelKey, locale),
        icon: tab.icon,
      })),
    [locale],
  )

  return (
    <div className="pedro-root">
      <PageHeader
        title={t("pedro.title", locale)}
        actions={
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-[blink_2s_infinite]" />
            {t("pedro.status.online", locale)}
          </span>
        }
      />

      {/* Action Needed strip — top of Optimize so the CM lands on
          "deze klanten moeten nu". Clicking a chip drops the client into
          the same selectedClientId state the picker uses, so the tabs
          below immediately reload for that client. Roy 2026-06-09. */}
      <OptimizeSuggestions
        selectedClientId={selectedClientId}
        onSelect={setSelectedClientId}
      />

      <div className="mb-5 rounded-2xl border border-border/60 bg-card p-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <ClientPicker
              clients={clients}
              selectedId={selectedClientId}
              onSelect={(id) => setSelectedClientId(id)}
              onAutoFill={() => {
                /* No auto-fill on the optimize side. */
              }}
              hideAutoFill
            />
          </div>
          {/* Drive folder shortcut — verify which client photos are
              available before/after image-gen. Roy 2026-06-09. */}
          {selectedClient?.googleDriveId && (
            <a
              href={`https://drive.google.com/drive/folders/${selectedClient.googleDriveId}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium text-foreground hover:bg-accent transition-colors"
              title="Open de Drive folder van deze klant in een nieuw tab"
            >
              <FolderOpen className="h-4 w-4" />
              Drive
            </a>
          )}
          {selectedClient && (
            <span className="shrink-0 text-xs text-muted-foreground hidden md:inline">
              {selectedClient.boardType === "onboarding" ? t("pedro.picker.onboarding", locale) : t("pedro.picker.live", locale)}
            </span>
          )}
        </div>
      </div>

      <TopTabs<Section> tabs={TABS} value={section} onChange={setSection} className="mb-6" />

      {selectedClientId ? (
        <>
          {section === "angles" && (
            <AnglesRefresh
              selectedClientId={selectedClientId}
              selectedClientName={selectedClient?.name ?? ""}
              autoStart={autoStart}
            />
          )}
          {section === "script" && (
            <ScriptRefresh
              selectedClientId={selectedClientId}
              selectedClientName={selectedClient?.name ?? ""}
              autoStart={autoStart}
            />
          )}
          {section === "creatives" && (
            <CreativeRefresh
              selectedClientId={selectedClientId}
              selectedClientName={selectedClient?.name ?? ""}
              autoStart={autoStart}
            />
          )}
          {section === "ad-copy" && (
            <AdCopyRefresh
              selectedClientId={selectedClientId}
              selectedClientName={selectedClient?.name ?? ""}
              autoStart={autoStart}
            />
          )}
        </>
      ) : (
        <NoClientSelected />
      )}
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
