"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { ClientHeader } from "@/app/(dashboard)/clients/[id]/_components/client-header"
import { ClientTabs } from "@/app/(dashboard)/clients/[id]/_components/client-tabs"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"
import { cn } from "@/lib/utils"

type ClientDetailResponse = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
}

type Props = {
  /** Monday item ID of the client to show. Null/undefined = panel closed. */
  clientId: string | null
  onClose: () => void
  currentUser: CurrentUser
}

export function ClientSlideOver({ clientId, onClose, currentUser }: Props) {
  const open = !!clientId

  const detailQuery = useQuery<ClientDetailResponse>({
    queryKey: ["client-detail", clientId],
    queryFn: () => fetch(`/api/clients/${clientId}`).then((r) => r.json()),
    enabled: !!clientId,
    staleTime: 60 * 1000,
  })

  // ESC closes — base-ui handles this, but we want the URL state to clear too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose()
    }
    if (open) window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm",
            // Backdrop fades faster than the panel slides — feels snappier and the
            // panel reads as the leading element of the transition.
            "duration-100 ease-out",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 w-full lg:w-[70%] max-w-[1500px]",
            "bg-background shadow-2xl ring-1 ring-foreground/10 outline-none",
            "flex flex-col",
            // 120ms with ease-out matches Linear/Discord feel — fast enough to
            // feel instant on click but long enough that the slide motion still
            // reads as deliberate.
            "duration-[120ms] ease-out",
            "data-open:animate-in data-open:slide-in-from-right",
            "data-closed:animate-out data-closed:slide-out-to-right",
          )}
        >
          {/* Close button */}
          <DialogPrimitive.Close
            className="absolute top-4 right-4 z-10 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors outline-none"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          {/* Hidden title for accessibility — base-ui requires one */}
          <DialogPrimitive.Title className="sr-only">
            Client details
          </DialogPrimitive.Title>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailQuery.isLoading && <SlideOverLoading />}
            {detailQuery.isError && (
              <div className="text-sm text-destructive">
                Failed to load client. {detailQuery.error instanceof Error ? detailQuery.error.message : ""}
              </div>
            )}
            {detailQuery.data && (
              <SlideOverContent
                client={detailQuery.data.client}
                supabaseClientId={detailQuery.data.supabaseClientId}
                access={detailQuery.data.access}
                currentUser={currentUser}
              />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SlideOverLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-80" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function SlideOverContent({
  client,
  supabaseClientId,
  access,
  currentUser,
}: {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
  currentUser: CurrentUser
}) {
  return (
    <>
      <ClientHeader client={client} canViewBilling={access.canViewBilling} />
      <ClientTabs
        client={client}
        supabaseClientId={supabaseClientId}
        access={access}
        currentUser={currentUser}
      />
    </>
  )
}
