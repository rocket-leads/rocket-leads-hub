"use client"

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { getInitials } from "@/lib/initials"
import { avatarColorClass } from "@/lib/avatar-color"
import { cn } from "@/lib/utils"

/**
 * The single avatar surface for Hub *users* (people on the team). Shows the
 * uploaded profile photo when there is one, otherwise falls back to the
 * person's initials. Wraps the shadcn/Base-UI Avatar primitive so every
 * place a teammate shows up - sidebar, inbox cards, comments, message
 * threads - renders identically.
 *
 * Photos are managed in Settings → Me and stored in the `user-avatars`
 * bucket (see lib/integrations/user-avatar-storage.ts).
 */
export function UserAvatar({
  name,
  avatarUrl,
  size = "default",
  className,
  fallbackClassName,
  autoColor = false,
  title,
}: {
  name: string | null | undefined
  avatarUrl?: string | null
  size?: "sm" | "default" | "lg"
  className?: string
  /** Override the fallback (no-photo) chip colours - e.g. the sidebar keeps
   *  its brand-purple square look. */
  fallbackClassName?: string
  /** When there is no photo, give the initials a unique colour derived from
   *  the name (so each teammate reads as a consistent colour). Ignored when
   *  `fallbackClassName` is passed - an explicit override always wins. */
  autoColor?: boolean
  /** Native tooltip on hover (the person's full name). */
  title?: string
}) {
  const auto = autoColor && !fallbackClassName ? avatarColorClass(name) : undefined
  return (
    <Avatar size={size} className={className} title={title}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? ""} /> : null}
      <AvatarFallback className={cn(auto && `${auto} font-semibold`, fallbackClassName)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  )
}
