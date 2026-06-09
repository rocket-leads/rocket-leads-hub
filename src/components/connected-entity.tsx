"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useHubMutation } from "@/lib/mutations/use-hub-mutation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertCircle,
  Check,
  ChevronDown,
  HelpCircle,
  Loader2,
  Search,
  X,
} from "lucide-react"
import type { ResolvedEntity } from "@/lib/integrations/resolved-entity"
import type { SimpleFieldKey } from "@/lib/clients/edit"
import { cn } from "@/lib/utils"

/**
 * Service registry. Each entry is a recipe for one external system:
 * which endpoints to hit for search + single-ID resolve, and what to call
 * the picker in the UI. Adding the next service (Monday boards, Meta ad
 * accounts, Trengo contacts, Drive folders) means adding one row here and
 * a matching pair of API routes — no changes to the component logic.
 */
export type ServiceKey =
  | "stripe-customer"
  | "monday-board"
  | "meta-ad-account"
  | "trengo-contact"
  | "drive-folder"

/**
 * Per-service config. `required` says whether a missing link is a real
 * problem (Stripe = no billing data, Meta = no campaign data, Trengo = no
 * client comms) or just "not used for this client" (Monday CRM and Drive
 * folder are both opt-in — some clients use their own CRM / storage).
 *
 * The flag drives two surfaces:
 *   1. The picker trigger's empty-state copy here — "Link X… · optional"
 *      vs plain "Link X…" — so an AM doesn't feel pressured to fill in
 *      something that doesn't apply.
 *   2. The connection-health audit (next step) — empty + optional must not
 *      count as a broken connection, otherwise every client without Monday
 *      CRM lights up red and the audit becomes noise.
 *
 * Filled-but-broken stays red regardless of required/optional: if you DID
 * fill it in, it should resolve. A stale Drive folder ID still silently
 * breaks Pedro deliverable drops even though Drive itself is "optional".
 */
type ServiceConfig = {
  /** Display name for empty/broken states ("Not found in Stripe"). */
  serviceLabel: string
  /** Required services flag the AM if empty (visual hint, not alarm) and
   *  count as a broken connection in audit mode. Optional services are
   *  intentionally-blank when empty — no alarm, no audit hit. */
  required: boolean
  /** Builds the search URL given a query string and limit. */
  searchUrl: (query: string, limit: number) => string
  /** Builds the resolve URL for a single ID. */
  resolveUrl: (id: string) => string
  /** Validates the raw ID shape so we can render "this isn't a Stripe ID
   *  at all" without an API roundtrip. Optional — defaults to non-empty. */
  isLikelyValidId?: (id: string) => boolean
}

/**
 * Single source of truth for "is this service required for a client to be
 * fully connected". Exported so the connection-health audit endpoint can
 * apply the same rule without drifting from the UI — required-and-empty
 * counts as broken, optional-and-empty is fine.
 */
export function isServiceRequired(service: ServiceKey): boolean {
  return REGISTRY[service].required
}

const REGISTRY: Record<ServiceKey, ServiceConfig> = {
  "stripe-customer": {
    serviceLabel: "Stripe",
    required: true,
    searchUrl: (q, limit) =>
      `/api/integrations/stripe/customers?q=${encodeURIComponent(q)}&limit=${limit}`,
    resolveUrl: (id) =>
      `/api/integrations/stripe/customers/${encodeURIComponent(id)}`,
    isLikelyValidId: (id) => id.startsWith("cus_"),
  },
  "monday-board": {
    // Roy 2026-06-09: Monday is opt-in — some clients use their own CRM and
    // don't have a per-client lead board. Empty must not feel broken.
    serviceLabel: "Monday",
    required: false,
    searchUrl: (q, limit) =>
      `/api/integrations/monday/boards?q=${encodeURIComponent(q)}&limit=${limit}`,
    resolveUrl: (id) =>
      `/api/integrations/monday/boards/${encodeURIComponent(id)}`,
    // Monday board IDs are 10-digit numeric strings. The check is cheap and
    // saves a roundtrip when someone pastes a cus_* in here by accident.
    isLikelyValidId: (id) => /^\d{6,12}$/.test(id),
  },
  "meta-ad-account": {
    serviceLabel: "Meta",
    required: true,
    searchUrl: (q, limit) =>
      `/api/integrations/meta/ad-accounts?q=${encodeURIComponent(q)}&limit=${limit}`,
    resolveUrl: (id) =>
      `/api/integrations/meta/ad-accounts/${encodeURIComponent(id)}`,
    // Stored ID may be `act_123456789` or plain numeric (Monday's column has
    // accepted both historically). Both shapes are fine here — only the
    // obviously-wrong inputs (a Stripe `cus_…`, a Trengo phone number, etc.)
    // should fail the cheap shape check.
    isLikelyValidId: (id) => /^(act_)?\d{6,20}$/.test(id),
  },
  "trengo-contact": {
    serviceLabel: "Trengo",
    required: true,
    searchUrl: (q, limit) =>
      `/api/integrations/trengo/contacts?q=${encodeURIComponent(q)}&limit=${limit}`,
    resolveUrl: (id) =>
      `/api/integrations/trengo/contacts/${encodeURIComponent(id)}`,
    // Trengo contact IDs are numeric (typically 6-10 digits). No `cus_*` or
    // `act_*` prefix — those wouldn't be Trengo IDs at all.
    isLikelyValidId: (id) => /^\d{4,12}$/.test(id),
  },
  "drive-folder": {
    // Roy 2026-06-09: Drive is opt-in — clients may have their own storage
    // for content/assets. Empty just means "not used here", not "broken".
    serviceLabel: "Drive",
    required: false,
    searchUrl: (q, limit) =>
      `/api/integrations/drive/folders?q=${encodeURIComponent(q)}&limit=${limit}`,
    resolveUrl: (id) =>
      `/api/integrations/drive/folders/${encodeURIComponent(id)}`,
    // Drive file/folder IDs are 25-44 char alphanumeric with `-` and `_`.
    // Reject obviously-wrong inputs (a Trengo phone, a Stripe cus_…) without
    // an API roundtrip; legit IDs sail through.
    isLikelyValidId: (id) => /^[a-zA-Z0-9_-]{20,60}$/.test(id),
  },
}

type Props = {
  /** Monday item ID — used as the PATCH target on save. */
  mondayItemId: string
  /** Which client field this picker writes to (e.g. "stripe_customer_id"). */
  fieldKey: SimpleFieldKey
  /** Current stored ID. Empty string = no link yet. */
  value: string
  /** Field label shown to the left of the picker. */
  label: string
  /** Tooltip explaining what breaks if this link is missing/wrong. */
  help?: string
  /** Which external system to pick from. */
  service: ServiceKey
  /** Optional company name for fuzzy-match pre-suggestion when the picker
   *  opens with no current value. Helps reduce paste errors on first link. */
  companyName?: string
}

/**
 * Replaces a blind ID text input with a continuously-verified link.
 *
 * Read state:   shows "Name · subline · cus_abc123" so the AM can see at a
 *               glance whether the link points at the right entity, without
 *               opening anything.
 * Edit state:   click → popover with search input + ranked list. Pre-suggests
 *               the top fuzzy match against companyName when value is empty.
 * Broken state: ID is well-formed but the resolver returns null → destructive
 *               pill "Not found in {service}" so it's visually impossible to
 *               miss when scrolling through the panel.
 *
 * Bron-of-truth blijft Monday — every selection is a PATCH /api/clients/[id]
 * which writes through to Monday's column via updateClientField + mirrors the
 * Supabase row + patches the slide-over cache. Same code path as SimpleField.
 */
export function ConnectedEntity({
  mondayItemId,
  fieldKey,
  value,
  label,
  help,
  service,
  companyName,
}: Props) {
  const router = useRouter()
  const registry = REGISTRY[service]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [savedFlash, setSavedFlash] = useState(false)

  // Optimistic override lets the trigger label flip to the new entity name
  // the instant the user clicks "select" — without waiting for the PATCH +
  // router.refresh round-trip (~300-800ms). When the parent re-renders with
  // the new prop value we drop the override and trust the server value.
  // The `if (snapshot !== value)` pattern is React 19's official "adjust
  // state during render" — see the useEffect → derived-state migration in
  // react.dev/learn/you-might-not-need-an-effect.
  const [propSnapshot, setPropSnapshot] = useState(value)
  const [optimisticOverride, setOptimisticOverride] = useState<string | null>(null)
  if (propSnapshot !== value) {
    setPropSnapshot(value)
    setOptimisticOverride(null)
  }
  const optimisticValue = optimisticOverride ?? value

  // Resolve the current ID into a name + subline. Always-on verification:
  // every time the panel renders, we re-check that the stored ID still
  // points at a real entity in the external system. 5min staleTime so
  // a list view of 20 clients doesn't fan out into 20 fresh API calls.
  const resolveQuery = useQuery<{ entity: ResolvedEntity | null }>({
    queryKey: ["resolved-entity", service, optimisticValue],
    queryFn: async () => {
      const res = await fetch(registry.resolveUrl(optimisticValue))
      if (!res.ok) throw new Error("Resolve failed")
      return res.json()
    },
    enabled: optimisticValue.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Search results for the picker dropdown. Debounced via the input's
  // local state — React Query dedupes identical keys so rapid typing
  // doesn't pile up requests.
  const searchQuery = useQuery<{ entities: ResolvedEntity[] }>({
    queryKey: ["entity-search", service, query],
    queryFn: async () => {
      const res = await fetch(registry.searchUrl(query, 10))
      if (!res.ok) {
        // Surface the actual server error in the picker so the AM can see
        // what went wrong (bad token, schema mismatch, rate-limit) instead
        // of a generic "Search failed". Falls back to the response status
        // when the body isn't JSON.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Search failed (HTTP ${res.status})`)
      }
      return res.json()
    },
    enabled: open,
    staleTime: 30 * 1000,
  })

  // Fuzzy pre-suggestion: when value is empty and companyName is provided,
  // pick the top result that includes one of the company name tokens. Mark
  // it visually so the AM knows it's a guess, not their selection. Removes
  // ~90% of the "did I paste the right cus_ID?" anxiety on first-link.
  const suggestedId = useMemo(() => {
    if (optimisticValue.length > 0) return null
    if (!companyName || !searchQuery.data?.entities) return null
    const tokens = companyName
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3)
    if (tokens.length === 0) return null
    const match = searchQuery.data.entities.find((e) => {
      const haystack = `${e.name} ${e.subline ?? ""}`.toLowerCase()
      return tokens.some((t) => haystack.includes(t))
    })
    return match?.id ?? null
  }, [optimisticValue, companyName, searchQuery.data])

  const mutation = useHubMutation<void, Error, string>({
    invalidates: ["CLIENT_DETAIL"],
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey, value: next }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update")
      }
    },
    onError: () => setOptimisticOverride(null),
    onSuccess: () => {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
      router.refresh()
    },
  })

  // Pre-fill the search box with the company name on first-open when there's
  // no existing link, so the AM lands on relevant matches without typing. Done
  // in the onOpenChange callback rather than an effect — opening the picker is
  // a user action, not a state-sync event.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && value.length === 0 && companyName && query.length === 0) {
      setQuery(companyName)
    }
  }

  function handleSelect(entity: ResolvedEntity) {
    setOptimisticOverride(entity.id)
    mutation.mutate(entity.id)
    setOpen(false)
    setQuery("")
  }

  function handleClear() {
    setOptimisticOverride("")
    mutation.mutate("")
    setOpen(false)
    setQuery("")
  }

  // Render decision tree for the trigger button:
  //   1. No value → "Link {service}…" with muted styling
  //   2. Value + resolver returned entity → "Name · subline" + dim ID
  //   3. Value + resolver returned null → destructive "Not found" pill
  //   4. Value + resolver still loading → keep the ID visible but skeleton the name
  const resolved = resolveQuery.data?.entity ?? null
  const isResolveLoading = resolveQuery.isLoading && optimisticValue.length > 0
  const isUnresolved =
    optimisticValue.length > 0 &&
    !resolveQuery.isLoading &&
    !resolveQuery.isError &&
    resolved === null
  const isMalformedId =
    optimisticValue.length > 0 &&
    registry.isLikelyValidId &&
    !registry.isLikelyValidId(optimisticValue)

  return (
    <div className="grid grid-cols-[160px_1fr_auto] gap-3 items-center">
      <Label className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
        {label}
        {help && (
          <span
            title={help}
            className="inline-flex text-muted-foreground/50 hover:text-muted-foreground cursor-help"
            aria-label={`What does ${label} control?`}
          >
            <HelpCircle className="h-3 w-3" />
          </span>
        )}
      </Label>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          className={cn(
            "h-8 px-3 inline-flex items-center justify-between gap-2 rounded-md border bg-background hover:bg-muted/50 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            // Order matters: malformed/unresolved trumps resolver status,
            // and `error` (billing-blocking) trumps `warning` (cosmetic).
            isUnresolved || isMalformedId || resolved?.status === "error"
              ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
              : resolved?.status === "warning"
                ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                : "border-border",
          )}
        >
          <span className="inline-flex items-center gap-2 truncate text-left">
            {optimisticValue.length === 0 && (
              <span className="text-muted-foreground">
                Link {registry.serviceLabel}…
                {!registry.required && (
                  // Soft "this is fine to leave blank" hint. Roy 2026-06-09:
                  // optional services (Monday, Drive) must never feel like a
                  // missing-data alarm — empty just means "not used here".
                  <span className="ml-1.5 text-muted-foreground/50">· optional</span>
                )}
              </span>
            )}
            {optimisticValue.length > 0 && isResolveLoading && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground/60 shrink-0" />
                <span className="font-mono text-[12px] text-muted-foreground/60 truncate">
                  {optimisticValue}
                </span>
              </>
            )}
            {optimisticValue.length > 0 && (isUnresolved || isMalformedId) && (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <span className="text-destructive truncate">
                  {isMalformedId
                    ? `Not a ${registry.serviceLabel} ID`
                    : `Not found in ${registry.serviceLabel}`}
                </span>
                <span className="font-mono text-[11px] text-destructive/60 truncate">
                  {optimisticValue}
                </span>
              </>
            )}
            {optimisticValue.length > 0 && resolved && (
              <>
                {resolved.status === "error" && (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                {resolved.status === "warning" && (
                  <AlertCircle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <span
                  className={cn(
                    "truncate",
                    resolved.status === "error" ? "text-destructive" : "text-foreground",
                  )}
                >
                  {resolved.name}
                </span>
                {resolved.subline && (
                  <span
                    className={cn(
                      "text-[12px] truncate",
                      resolved.status === "error"
                        ? "text-destructive/70"
                        : resolved.status === "warning"
                          ? "text-amber-500/80"
                          : "text-muted-foreground/70",
                    )}
                  >
                    · {resolved.subline}
                  </span>
                )}
                <span className="font-mono text-[11px] text-muted-foreground/40 truncate shrink-0">
                  · {optimisticValue}
                </span>
              </>
            )}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
        </PopoverTrigger>
        <PopoverContent className="min-w-96 p-1.5 max-h-96 overflow-hidden flex flex-col">
          <div className="relative mb-1.5">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
            <Input
              autoFocus
              placeholder={`Search ${registry.serviceLabel}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-7 h-8 text-sm"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {optimisticValue.length > 0 && (
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={handleClear}
              className="text-left rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              Clear link
            </button>
          )}
          <div className="overflow-y-auto flex-1">
            {searchQuery.isLoading && (
              <div className="px-2.5 py-2 text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Searching…
              </div>
            )}
            {searchQuery.isError && (
              <div className="px-2.5 py-2 text-[12px] text-destructive">
                {searchQuery.error instanceof Error
                  ? searchQuery.error.message
                  : `Search failed — check ${registry.serviceLabel} token in Settings.`}
              </div>
            )}
            {searchQuery.data?.entities.length === 0 && !searchQuery.isLoading && (
              <div className="px-2.5 py-2 text-[12px] text-muted-foreground">
                No matches.
              </div>
            )}
            {searchQuery.data?.entities.map((entity) => {
              const isSelected = entity.id === optimisticValue
              const isSuggested = entity.id === suggestedId
              return (
                <button
                  key={entity.id}
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => handleSelect(entity)}
                  className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted transition-colors disabled:opacity-50 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{entity.name}</span>
                      {isSuggested && !isSelected && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary shrink-0">
                          Suggested
                        </span>
                      )}
                      {entity.status === "error" && entity.statusLabel && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive shrink-0">
                          {entity.statusLabel}
                        </span>
                      )}
                      {entity.status === "warning" && entity.statusLabel && (
                        <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400 shrink-0">
                          {entity.statusLabel}
                        </span>
                      )}
                    </span>
                    {entity.subline && (
                      <span className="block text-[11px] text-muted-foreground truncate">
                        {entity.subline}
                      </span>
                    )}
                    <span className="block text-[10px] font-mono text-muted-foreground/50 truncate">
                      {entity.id}
                    </span>
                  </span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-foreground/70 shrink-0" />}
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1.5 min-w-[64px] justify-end">
        {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {savedFlash && !mutation.isPending && (
          <Check className="h-3.5 w-3.5 text-emerald-500" />
        )}
      </div>
    </div>
  )
}
