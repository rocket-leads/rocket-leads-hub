import { Sidebar } from "@/components/sidebar"
import { Providers } from "@/components/providers"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <div className="min-h-screen flex">
        <Sidebar />
        <main className="flex-1 ml-[240px] min-h-screen bg-background">
          <div className="px-10 py-8 max-w-[1440px]">{children}</div>
        </main>
      </div>
    </Providers>
  )
}
