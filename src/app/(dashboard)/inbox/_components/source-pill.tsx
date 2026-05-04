import {
  MessageSquare,
  Hash,
  LayoutGrid,
  Bot,
  Eye,
  Video,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { InboxSource } from "@/types/inbox"

type SourceConfig = {
  label: string
  icon: LucideIcon
  /** Pre-composed Tailwind classes that pair an icon-tone color with a soft
   *  background tint matching the brand colour from the Phase C design doc. */
  cls: string
}

/**
 * Per-source visual config — colours follow the Phase C design doc:
 *   Slack purple · Trengo cyan · Monday orange · Manual zinc · Automation amber
 * Watch list and Meeting reuse blue/emerald to stay distinct from the four core
 * channels without burning the brand palette.
 */
const SOURCE_CONFIG: Record<InboxSource, SourceConfig | null> = {
  // Manual is the implicit default — surfacing a pill for "you typed this in
  // yourself" is just visual noise.
  manual: null,
  trengo: {
    label: "Trengo",
    icon: MessageSquare,
    cls: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  slack: {
    label: "Slack",
    icon: Hash,
    cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  monday: {
    label: "Monday",
    icon: LayoutGrid,
    cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  automation: {
    label: "Automation",
    icon: Bot,
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  watchlist: {
    label: "Watch list",
    icon: Eye,
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  meeting: {
    label: "Meeting",
    icon: Video,
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
}

type Props = {
  source: InboxSource
  /** Compact omits the label text and shows just the icon — for tight rows. */
  compact?: boolean
  className?: string
}

export function SourcePill({ source, compact = false, className }: Props) {
  const cfg = SOURCE_CONFIG[source]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <span
      title={`Source: ${cfg.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        cfg.cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {!compact && cfg.label}
    </span>
  )
}
