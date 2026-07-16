"use client"

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { getInitials } from "@/lib/initials"

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
}: {
  name: string | null | undefined
  avatarUrl?: string | null
  size?: "sm" | "default" | "lg"
  className?: string
  /** Override the fallback (no-photo) chip colours - e.g. the sidebar keeps
   *  its brand-purple square look. */
  fallbackClassName?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name ?? ""} /> : null}
      <AvatarFallback className={fallbackClassName}>{getInitials(name)}</AvatarFallback>
    </Avatar>
  )
}
