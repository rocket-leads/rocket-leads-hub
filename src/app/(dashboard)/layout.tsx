import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"
import { ClientSearch } from "@/components/client-search"
import { CommandBar } from "@/components/copilot/command-bar"
import { NotificationBell } from "@/components/copilot/notification-bell"
import { ApiHealthBanner } from "@/components/api-health-banner"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 ml-[240px] min-h-screen bg-background flex flex-col">
          {/* Persistent top bar — keeps the global client search reachable
              from every page. Sticky so it survives long scrolls; translucent
              + backdrop-blur so content reads cleanly through it. h-12 keeps
              the visual weight light (Roy specifically asked for a small
              search field, not a full nav bar). z-40 sits beneath the
              client slide-over (z-50) so the panel still covers it. */}
          <header className="sticky top-0 z-40 flex h-14 items-center justify-end gap-2 px-8 bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
            <CommandBar />
            <NotificationBell />
            <ClientSearch />
          </header>
          {/* Global API health banner — visible on every page when any
              integration token is invalid. Sits right under the sticky
              header so it can't be missed (Roy 2026-05-27: Meta token
              expired and signal was buried in Settings). Renders nothing
              when everything is OK. */}
          <ApiHealthBanner />
          {/* Page padding rhythm: pt-2 (header gives breathing room) and pb-10
              so long scrolls don't end flush with the viewport edge. */}
          <div className="flex-1 px-8 pt-2 pb-10">{children}</div>
        </main>
      </div>
    </Providers>
  )
}
