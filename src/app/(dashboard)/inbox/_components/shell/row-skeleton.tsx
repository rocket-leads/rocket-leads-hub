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
    <div className="w-full rounded-lg px-2.5 py-2">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="ml-auto h-2.5 w-8" />
          </div>
          <Skeleton className="h-2.5 w-3/4" />
        </div>
      </div>
    </div>
  )
}

/** A short stack of row skeletons for a loading feed. */
export function InboxRowSkeletonList({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-0.5" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <InboxRowSkeleton key={i} />
      ))}
    </div>
  )
}
