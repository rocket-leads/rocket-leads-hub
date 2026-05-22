"use client"

import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { HUB_CHANNEL } from "./broadcast"

/**
 * Subscribe to the Hub's cache-invalidation channel and call
 * `queryClient.invalidateQueries` whenever the server broadcasts a
 * matching `queryKey`. Replaces the "refresh button" pattern for crons
 * + webhooks: data changes server-side → broadcast → every open tab
 * re-fetches automatically.
 *
 * Mount once near the root of the app (e.g. in providers.tsx). One
 * subscription per tab covers every useQuery.
 */
export function useRealtimeInvalidation() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(HUB_CHANNEL)
      .on("broadcast", { event: "invalidate" }, (msg) => {
        const payload = msg.payload as { queryKey?: unknown[] } | undefined
        const key = payload?.queryKey
        if (!Array.isArray(key) || key.length === 0) return
        // exact: false → matches any query whose key starts with the
        // broadcast key. Lets the server send a coarse `["kpi-summaries"]`
        // and invalidate every per-client + windowed variant under it.
        void queryClient.invalidateQueries({ queryKey: key, exact: false })
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
