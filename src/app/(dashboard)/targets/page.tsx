import { auth } from "@/lib/auth"
import { TargetsTabs } from "./_components/targets-tabs"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function TargetsPage() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const locale = await getUserLocale(session?.user.id)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">{t("targets.title", locale)}</h1>
        <p className="text-[13px] text-muted-foreground mt-1">{t("targets.subtitle", locale)}</p>
      </div>
      <TargetsTabs isAdmin={isAdmin} />
    </div>
  )
}
