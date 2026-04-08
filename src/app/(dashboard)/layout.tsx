import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"
import { ClientSearch } from "@/components/client-search"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 ml-[240px] min-h-screen bg-background">
          <div className="sticky top-0 z-30 flex items-center justify-end px-10 py-3 bg-background/80 backdrop-blur-sm border-b border-border/30">
            <ClientSearch />
          </div>
          <div className="px-10 py-8 max-w-[1440px]">{children}</div>
        </main>
      </div>
    </Providers>
  )
}
