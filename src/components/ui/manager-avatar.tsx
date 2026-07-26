"use client"

import { UserAvatar } from "@/components/ui/user-avatar"
import { AvatarGroup } from "@/components/ui/avatar"
import { useTeamAvatars } from "@/lib/team/use-team-avatars"

/**
 * A single teammate's avatar (Account or Campaign manager) - photo if they
 * uploaded one in Settings → Me, otherwise coloured initials. Used before the
 * owner name on Watch List cards.
 */
export function ManagerAvatar({
  name,
  size = "sm",
}: {
  name: string | null | undefined
  size?: "sm" | "default" | "lg"
}) {
  const lookup = useTeamAvatars()
  if (!name?.trim()) return null
  return <UserAvatar name={name} avatarUrl={lookup(name)} size={size} autoColor title={name} />
}

/**
 * The AM + CM avatars stacked with a slight overlap (AvatarGroup) - shown
 * before the client name in the Clients table. Skips empty managers; renders
 * nothing when neither is set.
 */
export function ManagerAvatarPair({
  accountManager,
  campaignManager,
  size = "sm",
}: {
  accountManager: string | null | undefined
  campaignManager: string | null | undefined
  size?: "sm" | "default" | "lg"
}) {
  const lookup = useTeamAvatars()
  const people = [
    { role: "AM", name: accountManager },
    { role: "CM", name: campaignManager },
  ].filter((p) => p.name?.trim())

  if (people.length === 0) return null

  return (
    <AvatarGroup>
      {people.map((p) => (
        <UserAvatar
          key={p.role}
          name={p.name}
          avatarUrl={lookup(p.name)}
          size={size}
          autoColor
          title={`${p.role === "AM" ? "Account manager" : "Campaign manager"}: ${p.name}`}
        />
      ))}
    </AvatarGroup>
  )
}
