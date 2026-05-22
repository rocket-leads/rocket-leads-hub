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
            staleTime: 60 * 60 * 1000, // 1 hour
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
