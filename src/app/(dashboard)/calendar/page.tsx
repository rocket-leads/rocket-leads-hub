import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { hasCalendarConnected } from "@/lib/integrations/google-calendar"
import { PageHeader } from "@/components/ui/page-header"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import { CalendarView } from "./_components/calendar-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Calendar - Rocket Leads Hub" }

/**
 * Personal Calendar page. Shows the signed-in user's primary Google
 * Calendar events alongside their open Hub tasks (assignee = self,
 * due_date in view). Color-coded so an AM can see "meetings + to-do"
 * in one grid instead of switching to Google Calendar in another tab.
 *
 * Read-only — we never write back to Google. Reply-out / event-create
 * is a Phase B item, not in scope here.
 */
export default async function CalendarPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const locale = await getUserLocale(session.user.id)
  const connected = await hasCalendarConnected(session.user.id)

  return (
    <div>
      <PageHeader title={t("calendar.title", locale)} />
      <CalendarView initialConnected={connected} />
    </div>
  )
}
