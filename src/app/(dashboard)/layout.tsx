import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"
import { ClientSearch } from "@/components/client-search"
import { CommandBar } from "@/components/copilot/command-bar"
import { NotificationBell } from "@/components/copilot/notification-bell"
import { ApiHealthBanner } from "@/components/api-health-banner"
import { GlobalClientSlideOver } from "@/components/global-client-slide-over"
import { WeeklyUpdatesChip } from "@/app/(dashboard)/clients/_components/weekly-update-drafts-banner"
import { auth } from "@/lib/auth"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Session is needed by the global client slide-over (currentUser prop).
  // The session call is already cached at the request level by NextAuth,
  // and every dashboard child page also calls auth(), so this is a cache
  // hit in practice - no extra round-trip per page load.
  const session = await auth()
  const currentUser = session?.user?.id
    ? {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "",
        role: session.user.role ?? "member",
      }
    : null

  return (
    <Providers>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 ml-[240px] min-h-screen bg-background flex flex-col">
          {/* Persistent top bar - keeps the global client search reachable
              from every page. Sticky so it survives long scrolls; translucent
              + backdrop-blur so content reads cleanly through it. h-12 keeps
              the visual weight light (Roy specifically asked for a small
              search field, not a full nav bar). z-40 sits beneath the
              client slide-over (z-50) so the panel still covers it. */}
          <header className="sticky top-0 z-40 flex h-14 items-center justify-end gap-2 px-8 bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
            {/* Order matters (Roy 2026-06-11): scheduled-deliverable chips
                first (calendar), then the AI surfaces (Co-pilot command
                bar + NotificationBell). Keeps the "agenda"-style work to
                the left of the "AI"-style work so the two don't read as
                the same thing. */}
            <WeeklyUpdatesChip />
            <CommandBar />
            <NotificationBell />
            <ClientSearch />
          </header>
          {/* Global API health banner - visible on every page when any
              integration token is invalid. Sits right under the sticky
              header so it can't be missed (Roy 2026-05-27: Meta token
              expired and signal was buried in Settings). Renders nothing
              when everything is OK. */}
          <ApiHealthBanner />
          {/* Page padding rhythm: pt-2 (header gives breathing room) and pb-10
              so long scrolls don't end flush with the viewport edge. */}
          <div className="flex-1 px-8 pt-2 pb-10">{children}</div>
        </main>
        {/* Global slide-over - listens for `?client=<id>` in the URL and
            opens the client panel over the current page. Skipped on
            /clients + /watchlist where those pages mount their own
            slide-over with `allClients` for in-panel quick-switch. */}
        <GlobalClientSlideOver currentUser={currentUser} />
      </div>
    </Providers>
  )
}
