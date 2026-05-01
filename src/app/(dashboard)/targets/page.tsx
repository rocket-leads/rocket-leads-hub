import { auth } from "@/lib/auth"
import { TargetsTabs } from "./_components/targets-tabs"

export default async function TargetsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold tracking-tight">Targets</h1>
        <p className="text-sm text-muted-foreground">Company-wide performance against monthly targets.</p>
      </div>
      <TargetsTabs isAdmin={isAdmin} />
    </div>
  )
}
