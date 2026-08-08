"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { useMemo, useState } from "react"
import { useRealtimeInvalidation } from "@/lib/realtime/use-realtime-invalidation"

// Bump this to invalidate ALL persisted client caches at once (e.g. after a
// query-data shape change that would render stale-persisted data incorrectly).
const PERSIST_BUSTER = "rl-rq-v1"

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 60 * 1000, // 1 hour - data is "fresh" this long → no refetch on revisit
        // gcTime keeps a query's cache alive after the last component using it
        // unmounts. Default is 5 min → navigate away for >5 min and the cache is
        // garbage-collected, so returning is a COLD fetch (the "even later it's
        // still slow" symptom). 2h keeps every visited page instant to return to.
        gcTime: 2 * 60 * 60 * 1000,
        // The cron + manual refresh button keep data current; refetching every
        // time the window regains focus just adds latency + external API load.
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient)

  // Persist the in-memory cache to localStorage so a full page reload restores
  // instantly (served from storage, revalidated in the background per staleTime)
  // instead of cold-fetching every query again. Client-only - during SSR there's
  // no localStorage, so we fall back to a plain provider (no hydration mismatch:
  // both just render children with no DOM of their own).
  const persister = useMemo(
    () =>
      typeof window !== "undefined"
        ? createSyncStoragePersister({
            storage: window.localStorage,
            key: "rl-hub-rq-cache",
            throttleTime: 1000,
          })
        : null,
    [],
  )

  if (!persister) {
    return (
      <QueryClientProvider client={queryClient}>
        <RealtimeBridge />
        {children}
      </QueryClientProvider>
    )
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Discard persisted entries older than 24h so a laptop reopened the next
        // day doesn't paint yesterday's numbers before revalidation kicks in.
        maxAge: 24 * 60 * 60 * 1000,
        buster: PERSIST_BUSTER,
        // Only persist successful queries - never cache an error or half-loaded
        // state to disk.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => query.state.status === "success",
        },
      }}
    >
      <RealtimeBridge />
      {children}
    </PersistQueryClientProvider>
  )
}

/** Mounted inside the query provider so `useQueryClient()` resolves. The
 *  hook subscribes to the Hub broadcast channel and invalidates matching
 *  React Query keys whenever the server pushes an event. */
function RealtimeBridge() {
  useRealtimeInvalidation()
  return null
}
