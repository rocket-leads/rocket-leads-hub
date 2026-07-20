"use client"

import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading placeholder that mirrors the inbox row shape (leading icon, two text
 * lines, trailing meta) so the list keeps its layout while data loads instead
 * of collapsing to a bare centred spinner. Roy 2026-07-20: skeletons read as
 * "loading this list", a spinner reads as "the app is thinking".
 */
export function InboxRowSkeleton() {
  return (
    <div className="w-full rounded-xl border border-border/60 bg-card pl-6 pr-5 py-3.5">
      <div className="flex items-start gap-3">
        <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-4/5" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-5 w-5 rounded-full" />
        </div>
      </div>
    </div>
  )
}

/** A short stack of row skeletons for a loading feed. */
export function InboxRowSkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <InboxRowSkeleton key={i} />
      ))}
    </div>
  )
}
