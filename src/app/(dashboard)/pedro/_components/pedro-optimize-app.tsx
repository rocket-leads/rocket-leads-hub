"use client"

import { useState, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { Users } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { ClientPicker } from "./client-picker"
import { PedroRefresh } from "./pedro-refresh"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { PedroClient } from "./types"

// Pedro Optimize — the "iterate on a live campaign" entry point.
//
// Today this is exactly the creative-refresh tool: pick a Live client,
// Pedro reads Meta performance and proposes iterations on the winners
// in the same hook/angle/format DNA. The page is intentionally its own
// route (Roy 2026-05-23, split from the unified Pedro page) so a future
// "what do you want to optimize? creatives / funnel / ads / opvolging"
// picker has somewhere to land without pushing the on-board flow off
// the screen.
const CLIENT_STORAGE_KEY = "pedro.selectedClientId"

type Props = { clients: PedroClient[] }

export function PedroOptimizeApp({ clients }: Props) {
  const searchParams = useSearchParams()
  const locale = useLocale()

  const urlClientId = searchParams.get("clientId")
  const autoStart = searchParams.get("auto") === "1"

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
            <span className="shrink-0 text-xs text-muted-foreground hidden md:inline">
              {selectedClient.boardType === "onboarding" ? t("pedro.picker.onboarding", locale) : t("pedro.picker.live", locale)}
            </span>
          )}
        </div>
      </div>

      {selectedClientId ? (
        <PedroRefresh
          clients={clients}
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
