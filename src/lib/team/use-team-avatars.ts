"use client"

import { useQuery } from "@tanstack/react-query"

/**
 * Returns a lookup `(name) => avatarUrl | undefined` for teammate profile
 * photos. Backed by /api/team/avatars (name → uploaded photo). Photos rarely
 * change, so the cache is held for the session; a missing name just means the
 * caller renders coloured initials instead.
 */
export function useTeamAvatars(): (name: string | null | undefined) => string | undefined {
  const { data } = useQuery<{ avatars: Record<string, string> }>({
    queryKey: ["team-avatars"],
    queryFn: () => fetch("/api/team/avatars").then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
  })
  const avatars = data?.avatars
  return (name) => {
    const key = (name ?? "").trim().toLowerCase()
    return key ? avatars?.[key] : undefined
  }
}
