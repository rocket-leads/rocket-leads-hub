"use client"

import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Users, Settings as SettingsIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { ClientPicker } from "./client-picker"
import { OptimizeWizard } from "./optimize-wizard"
import { PedroSettingsPanel } from "./pedro-settings-panel"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "./types"

// Pedro Optimize - the "iterate on a live campaign" entry point.
//
// Roy 2026-06-11 v5 reorg: vervangt de tab-based UX door een step-wizard
// die de onboarding-shell spiegelt. Stap 1 = winning ad kiezen, dan
// per deliverable een aparte stap. Zie OptimizeWizard voor de details.
// Landing Page is uit Pedro Optimize gehaald - dat hoort thuis in de
// onboarding wizard (waar de brief + angles aanwezig zijn voor context).

const CLIENT_STORAGE_KEY = "pedro.selectedClientId"

type Props = { clients: PedroClient[] }

export function PedroOptimizeApp({ clients }: Props) {
  const searchParams = useSearchParams()
  const locale = useLocale()

  const urlClientId = searchParams.get("clientId")
  const autoStart = searchParams.get("auto") === "1"

  // Shared storage key with the on-board app so a client picked in one
  // tab carries to the other - the AM almost always wants the same
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

  // Inline accordion below the client-picker card. Toggle via the ⚙ button
  // that replaces the old "Drive" shortcut — the Drive link still lives
  // inside the panel itself (Bronnen → Klant-Drive). Roy 2026-06-13.
  const [settingsOpen, setSettingsOpen] = useState(false)

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
          {selectedClient && (
            <button
              type="button"
              onClick={() => setSettingsOpen((s) => !s)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium transition-colors",
                settingsOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground hover:bg-accent",
              )}
              title="Pedro instellingen voor deze klant"
              aria-expanded={settingsOpen}
            >
              <SettingsIcon className="h-4 w-4" />
              Instellingen
            </button>
          )}
          {selectedClient && (
            <span className="shrink-0 text-xs text-muted-foreground hidden md:inline">
              {selectedClient.boardType === "onboarding" ? t("pedro.picker.onboarding", locale) : t("pedro.picker.live", locale)}
            </span>
          )}
        </div>
      </div>

      {selectedClient && (
        <PedroSettingsPanel
          open={settingsOpen}
          clientId={selectedClient.id}
          clientName={selectedClient.name}
          googleDriveId={selectedClient.googleDriveId || null}
        />
      )}

      {selectedClientId ? (
        <OptimizeWizard
          selectedClientId={selectedClientId}
          selectedClientName={selectedClient?.name ?? ""}
          autoStart={autoStart}
        />
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
