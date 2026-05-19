import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"
import { ClientSearch } from "@/components/client-search"

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
          <header className="sticky top-0 z-40 flex h-12 items-center justify-end gap-2 px-6 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/30">
            <ClientSearch />
          </header>
          {/* Top padding tightened (py-8 → pt-4 pb-8) since the topbar now
              contributes its own breathing room above the page title. */}
          <div className="flex-1 px-8 pt-4 pb-8">{children}</div>
        </main>
      </div>
    </Providers>
  )
}
