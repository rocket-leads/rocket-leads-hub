/**
 * Unified entity shape returned by every per-service `searchX` / `resolveX`
 * function in `lib/integrations/*`. The ConnectedEntity component on the
 * client renders this same shape regardless of which external system the
 * link points to - so all the per-service quirks live in the lib layer
 * and the picker stays one component.
 *
 * `name` is the primary label (always shown).
 * `subline` is the discriminating extra info (email, last invoice, status, etc.)
 *   - the thing that lets a human pick the right "John Doe" from three of them.
 * `status` lets a service flag an entity as not-healthy without a string match
 *   on the client (e.g. DISABLED ad accounts, void Stripe customers).
 */
export type ResolvedEntity = {
  id: string
  name: string
  subline?: string
  status?: "ok" | "warning" | "error"
  statusLabel?: string
}
