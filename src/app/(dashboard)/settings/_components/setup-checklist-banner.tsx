"use client"

import Link from "next/link"
import { AlertTriangle, ChevronRight } from "lucide-react"
import type { ChecklistItem } from "@/lib/observability/setup-checklist"

/**
 * Banner at the top of Settings that calls out incomplete platform setup
 * - missing API tokens, board config, user role mappings. Each row is a
 * deeplink into the relevant tab (Tokens / Board / Users) so the admin
 * can act on it in two clicks.
 *
 * Drives off the same `fetchSetupChecklist()` data that lights the
 * sidebar Settings dot. Roy 2026-05-23: dot was unclear ("what does the
 * red dot mean?") - banner makes the answer explicit.
 */
export function SetupChecklistBanner({ items }: { items: ChecklistItem[] }) {
  if (items.length === 0) return null

  const TAB_LABELS: Record<ChecklistItem["tab"], string> = {
    tokens: "API Tokens",
    board: "Board Config",
    users: "Users",
    notifications: "Notifications",
  }

  return (
    <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-500/30 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <div className="text-sm font-medium text-foreground">
          Setup incomplete - {items.length} item{items.length === 1 ? "" : "s"} need attention
        </div>
      </div>
      <ul className="divide-y divide-amber-500/15">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/settings?tab=${item.tab}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-amber-500/10 transition-colors group"
            >
              <div className="min-w-0">
                <div className="text-sm text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground/80 mt-0.5">
                  Open Settings → {TAB_LABELS[item.tab]}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
