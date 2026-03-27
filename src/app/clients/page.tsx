import { auth } from "@/lib/auth"

export default async function ClientsPage() {
  const session = await auth()

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Rocket Leads Hub</h1>
      <p className="text-muted-foreground mb-2">
        Ingelogd als: <span className="text-foreground">{session?.user?.email}</span>
      </p>
      <p className="text-muted-foreground">
        Rol: <span className="text-foreground">{session?.user?.role ?? "laden..."}</span>
      </p>
    </div>
  )
}
