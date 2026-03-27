import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export async function Navbar() {
  const session = await auth()

  return (
    <header className="border-b bg-background">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/clients" className="font-semibold text-sm">
            Rocket Leads Hub
          </Link>
          <nav className="flex items-center gap-4">
            <Link
              href="/clients"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clients
            </Link>
            {session?.user.role === "admin" && (
              <Link
                href="/settings"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
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
