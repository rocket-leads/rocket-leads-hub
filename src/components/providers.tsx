"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { useRealtimeInvalidation } from "@/lib/realtime/use-realtime-invalidation"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
  )

  return (
    <QueryClientProvider client={queryClient}>
      <RealtimeBridge />
      {children}
    </QueryClientProvider>
  )
}

/** Mounted inside QueryClientProvider so `useQueryClient()` resolves. The
 *  hook subscribes to the Hub broadcast channel and invalidates matching
 *  React Query keys whenever the server pushes an event. */
function RealtimeBridge() {
  useRealtimeInvalidation()
  return null
}
