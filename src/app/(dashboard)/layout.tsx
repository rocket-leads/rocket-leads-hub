import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"
import { ClientSearch } from "@/components/client-search"
import { CommandBar } from "@/components/copilot/command-bar"
import { ApiHealthBanner } from "@/components/api-health-banner"
import { GlobalClientSlideOver } from "@/components/global-client-slide-over"
import { TopbarBreadcrumb } from "@/components/topbar-breadcrumb"
import { auth } from "@/lib/auth"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Session is needed by the global client slide-over (currentUser prop).
  // Cache hit in practice - every dashboard child page also calls auth().
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
      {/* 187N atmosphere layer: structural grid + soft purple corner glow,
          fixed behind everything (pointer-events:none, z-0). */}
      <div className="bg-field" aria-hidden="true" />

      {/* 187N app shell: centered max-1720 grid, sidebar + main. */}
      <div className="app">
        <Sidebar />
        <main className="main">
          {/* Topbar: mono breadcrumb left, AI command bar + client search right. */}
          <div className="topbar">
            <TopbarBreadcrumb />
            <div className="topbar-right">
              <CommandBar />
              <ClientSearch />
            </div>
          </div>
          {/* Global API health banner - visible on every page when any
              integration token is invalid; renders nothing when OK. */}
          <ApiHealthBanner />
          {children}
        </main>
      </div>

      {/* Global slide-over - opens the client panel over the current page on
          `?client=<id>`. */}
      <GlobalClientSlideOver currentUser={currentUser} />
    </Providers>
  )
}
