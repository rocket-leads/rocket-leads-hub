"use client"

import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import type { EnvPostureItem } from "@/lib/observability/env-posture"
import { cn } from "@/lib/utils"

/**
 * Read-only environment secrets panel. Shows which infra env vars are loaded
 * vs missing — presence only, values never leave the server. Collapsed by
 * default (it's reference, not a daily surface); the header carries the
 * "N/M loaded" roll-up so an admin sees the health without expanding.
 */
export function EnvPosturePanel({ items }: { items: EnvPostureItem[] }) {
  const [open, setOpen] = useState(false)

  const { loaded, total, criticalMissing, groups } = useMemo(() => {
    const loaded = items.filter((i) => i.loaded).length
    const criticalMissing = items.filter((i) => i.critical && !i.loaded).length
    const groups = new Map<string, EnvPostureItem[]>()
    for (const it of items) {
      const arr = groups.get(it.group) ?? []
      arr.push(it)
      groups.set(it.group, arr)
    }
    return { loaded, total: items.length, criticalMissing, groups }
  }, [items])

  return (
    <div className="section-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="section-title">Environment secrets</span>
        <span className="flex items-center gap-3">
          <span
            className={cn(
              "st-label",
              criticalMissing > 0 ? "error" : loaded === total ? "live" : "warn",
            )}
          >
            {loaded}/{total} loaded
            {criticalMissing > 0 && ` · ${criticalMissing} critical missing`}
          </span>
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground/60 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-[12px] text-muted-foreground">
            Infra secrets live in environment variables (rotated by redeploy),
            not in the database. This is presence only — values are never read
            here. Missing a critical one silently breaks a core capability.
          </p>
          {[...groups.entries()].map(([group, list]) => (
            <div key={group}>
              <div className="st-label mb-2">{group}</div>
              <div className="space-y-1.5">
                {list.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          it.loaded
                            ? "bg-emerald-500"
                            : it.critical
                              ? "bg-destructive"
                              : "bg-amber-500",
                        )}
                      />
                      <span className="font-mono text-[12px] truncate">{it.key}</span>
                      <span className="text-muted-foreground/60 truncate hidden sm:inline">
                        {it.label}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px] shrink-0",
                        it.loaded ? "text-emerald-600" : it.critical ? "text-destructive" : "text-amber-600",
                      )}
                    >
                      {it.loaded ? "loaded" : "missing"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
