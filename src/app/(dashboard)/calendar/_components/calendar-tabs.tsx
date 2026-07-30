"use client"

import Link from "next/link"
import { CalendarDays, Video } from "lucide-react"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"

/**
 * Segmented control that sits at the top of the Calendar AND the
 * Recordings (formerly /meetings) page. Both pages share this so the
 * user can flip between "agenda for this week" and "Fathom recordings
 * archive" without going through the sidebar — Meetings was removed
 * as a standalone nav entry in favour of this tab pattern.
 */
export function CalendarTabs({
  active,
}: {
  active: "calendar" | "recordings"
}) {
  const locale = useLocale()
  return (
    <div className="mb-6 inline-flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
      <Tab
        href="/calendar"
        active={active === "calendar"}
        icon={<CalendarDays className="size-4" />}
        label={t("calendar.tab.calendar", locale)}
      />
      <Tab
        href="/meetings"
        active={active === "recordings"}
        icon={<Video className="size-4" />}
        label={t("calendar.tab.recordings", locale)}
      />
    </div>
  )
}

function Tab({
  href,
  active,
  icon,
  label,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </Link>
  )
}
