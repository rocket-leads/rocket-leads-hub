import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export async function Navbar() {
  const session = await auth()

  return (
    <header className="border-b border-border bg-card">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/clients">
            <Image src="/logo.png" alt="Rocket Leads" width={240} height={131} className="h-8 w-auto" priority />
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              href="/clients"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Clients
            </Link>
            <Link
              href="/targets"
              className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Targets
            </Link>
            {session?.user.role === "admin" && (
              <Link
                href="/settings"
                className="px-3 py-1.5 text-sm rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Settings
              </Link>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">
            {session?.user.email}
          </span>
          <Badge variant="outline" className="text-xs capitalize">
            {session?.user.role}
          </Badge>
          <form
            action={async () => {
              "use server"
              await signOut({ redirectTo: "/auth/signin" })
            }}
          >
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
