"use client"

import { useMutation, useQueryClient, type UseMutationOptions } from "@tanstack/react-query"
import { INVALIDATION_GROUPS, type InvalidationGroupName } from "./invalidation-groups"

/**
 * `useMutation` wrapper that invalidates the right React Query keys after
 * success, based on the `invalidates` group name(s) you pass. Replaces
 * hand-rolled `queryClient.invalidateQueries({ queryKey: [...] })` calls
 * that drift out of sync when new surfaces start reading the same data.
 *
 * Usage:
 *   const m = useHubMutation({
 *     invalidates: ["CLIENT_DETAIL"],
 *     mutationFn: async (next: string) => {
 *       const r = await fetch(`/api/clients/${id}`, {
 *         method: "PATCH",
 *         headers: { "Content-Type": "application/json" },
 *         body: JSON.stringify({ fieldKey: "company_name", value: next }),
 *       })
 *       if (!r.ok) throw new Error("Update failed")
 *     },
 *   })
 *
 * Pass multiple group names when a mutation crosses boundaries - e.g.
 * an agreement edit touches both BILLING and CLIENT_DETAIL.
 *
 * The user's existing `onSuccess` (if any) still runs first; invalidation
 * happens after, so optimistic UI fans out without races.
 */
type HubMutationOptions<TData, TError, TVariables, TContext> = UseMutationOptions<
  TData,
  TError,
  TVariables,
  TContext
> & {
  invalidates: ReadonlyArray<InvalidationGroupName>
}

export function useHubMutation<TData, TError, TVariables, TContext = unknown>(
  options: HubMutationOptions<TData, TError, TVariables, TContext>,
) {
  const queryClient = useQueryClient()
  const { invalidates, onSuccess: userOnSuccess, ...rest } = options

  return useMutation<TData, TError, TVariables, TContext>({
    ...rest,
    onSuccess: async (data, vars, ctx, mutateResult) => {
      if (userOnSuccess) await userOnSuccess(data, vars, ctx, mutateResult)
      const seen = new Set<string>()
      for (const groupName of invalidates) {
        for (const key of INVALIDATION_GROUPS[groupName]) {
          const sig = JSON.stringify(key)
          if (seen.has(sig)) continue
          seen.add(sig)
          void queryClient.invalidateQueries({ queryKey: key, exact: false })
        }
      }
    },
  })
}
