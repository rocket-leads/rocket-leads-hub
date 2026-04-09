import { TargetsTabs } from "./_components/targets-tabs"

export default function TargetsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold tracking-tight">Targets</h1>
        <p className="text-sm text-muted-foreground">Company-wide performance against monthly targets.</p>
      </div>
      <TargetsTabs />
    </div>
  )
}
