"use client"

import Image from "next/image"
import { Bot, Eye, Mail, Video, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { InboxChannelKind, InboxSource } from "@/types/inbox"

type SourceConfig = {
  /** Dictionary key for the user-facing label. Brand names stay as plain
   *  strings via a literal-key fallback (Trengo/Slack/Monday don't translate). */
  labelKey: DictionaryKey | null
  /** Plain label used when there's no translation key (brand names). */
  label: string
  /** Either a static brand SVG (Slack/Trengo/Monday) or a Lucide icon
   *  (Automation/Watchlist/Meeting) - branded sources get the real mark
   *  per Roy's request, internal/system sources stay on Lucide. */
  brandLogo?: string
  icon?: LucideIcon
  /** Pre-composed Tailwind classes that pair an icon-tone color with a soft
   *  background tint matching the brand colour from the Phase C design doc. */
  cls: string
}

const SOURCE_CONFIG: Record<InboxSource, SourceConfig | null> = {
  // Manual is the implicit default - surfacing a pill for "you typed this in
  // yourself" is just visual noise.
  manual: null,
  trengo: {
    labelKey: null,
    label: "Trengo",
    brandLogo: "/logos/brands/trengo.svg",
    cls: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  },
  slack: {
    labelKey: null,
    label: "Slack",
    brandLogo: "/logos/brands/slack.svg",
    cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  },
  monday: {
    labelKey: null,
    label: "Monday",
    brandLogo: "/logos/brands/monday.svg",
    cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  automation: {
    labelKey: "inbox.source.automation",
    label: "Automation",
    icon: Bot,
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  watchlist: {
    labelKey: "inbox.source.watchlist",
    label: "Watch list",
    icon: Eye,
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  meeting: {
    labelKey: "inbox.source.meeting",
    label: "Meeting",
    icon: Video,
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
}

type Props = {
  source: InboxSource
  /** Compact omits the label text and shows just the icon - for tight rows. */
  compact?: boolean
  /** When the source is Trengo, the channel medium swaps both the icon
   *  (WhatsApp brand mark / email envelope) and the pill label - so an AM
   *  can tell at a glance whether a task came in via WA or via email
   *  without opening the row. Ignored for non-Trengo sources. */
  channelKind?: InboxChannelKind
  className?: string
}

const CHANNEL_OVERRIDES: Record<
  Exclude<InboxChannelKind, null | "other">,
  { labelKey: DictionaryKey | null; label: string; brandLogo?: string; icon?: LucideIcon; cls: string }
> = {
  whatsapp: {
    labelKey: null,
    label: "WhatsApp",
    brandLogo: "/logos/brands/whatsapp.svg",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  email: {
    labelKey: "inbox.source.email",
    label: "Email",
    icon: Mail,
    cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
}

export function SourcePill({ source, compact = false, channelKind, className }: Props) {
  const locale = useLocale()
  const baseCfg = SOURCE_CONFIG[source]
  if (!baseCfg) return null

  // For Trengo we promote the channel medium to the pill itself - WhatsApp
  // and email each get their own brand-coloured mark + label so the row
  // shows what kind of message it actually was, not just "Trengo".
  const override =
    source === "trengo" && channelKind && channelKind !== "other"
      ? CHANNEL_OVERRIDES[channelKind]
      : null
  const cfg = override ?? baseCfg
  const label = cfg.labelKey ? t(cfg.labelKey, locale) : cfg.label

  return (
    <span
      title={`${t("inbox.source.tooltip_prefix", locale)} ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        cfg.cls,
        className,
      )}
    >
      {cfg.brandLogo ? (
        <Image
          src={cfg.brandLogo}
          alt=""
          width={12}
          height={12}
          className="h-3 w-3 object-contain"
          unoptimized
        />
      ) : cfg.icon ? (
        <cfg.icon className="h-3 w-3" />
      ) : null}
      {!compact && label}
    </span>
  )
}
