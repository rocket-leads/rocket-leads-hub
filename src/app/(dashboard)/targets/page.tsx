import { auth } from "@/lib/auth"
import { TargetsTabs } from "./_components/targets-tabs"

export default async function TargetsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Targets</h1>
        <p className="text-[13px] text-muted-foreground mt-1">Company-wide performance against monthly targets.</p>
      </div>
      <TargetsTabs isAdmin={isAdmin} />
    </div>
  )
}
