"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Loader2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import {
  inviteUser,
  removeUser,
  setUserMondayMapping,
  updateUserFathomEmail,
  updateUserName,
  updateUserPrimaryEmailChannel,
  updateUserPrimaryWaChannel,
  updateUserRole,
  updateUserSlackId,
} from "../actions"
import {
  MONDAY_ROLE_LABELS,
  ROLES_NEEDING_MONDAY_NAME,
  type MondayRole,
} from "../types"

type Role = "admin" | "member" | "guest"

type User = {
  id: string
  email: string
  name: string | null
  role: Role
  slack_user_id: string | null
  fathom_email: string | null
  primary_email_channel_id: number | null
  primary_wa_channel_id: number | null
  monday_role: MondayRole | null
  monday_person_name: string | null
  created_at: string
}

type FathomTeamMember = {
  name: string
  email: string
}

type TrengoChannelOption = {
  id: number
  name: string
  type: string
  isEmail: boolean
  isWa: boolean
}

type Props = {
  users: User[]
  currentUserId: string
}

/** Sentinel value used by every "clear / unset" SelectItem. Display via the
 *  `labelFor` helper below so the trigger reads blank instead of the raw
 *  sentinel - Base UI's SelectValue falls back to printing the value when
 *  there's no matching item label to render. */
const NONE = "__none__"

/** Resolve the displayed label for a selected value. Returns empty for the
 *  NONE sentinel so the trigger looks empty when nothing is picked. */
function labelFor(value: string | null | undefined, options: { value: string; label: string }[]): string {
  if (!value || value === NONE) return ""
  return options.find((o) => o.value === value)?.label ?? value
}

// ────────────────────────────────────────────────────────────────────────────
//  Tab
// ────────────────────────────────────────────────────────────────────────────

export function UsersTab({ users: initial, currentUserId }: Props) {
  const locale = useLocale()
  const [users, setUsers] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  // Trengo channels + Fathom team members + Monday people are fetched
  // client-side so the rest of Settings paints immediately. Dropdowns
  // render disabled until their respective queries resolve. The
  // monday-clients query is shared with ClientsTab so it dedupes when
  // both tabs are visited in one session.
  const mondayClientsQuery = useQuery<{ clients: unknown[]; mondayPeople: string[] }>({
    queryKey: ["admin-monday-clients"],
    queryFn: async () => {
      const r = await fetch("/api/admin/settings/monday-clients")
      if (!r.ok) throw new Error("Failed to load Monday clients")
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })
  const mondayPeople = mondayClientsQuery.data?.mondayPeople ?? []

  const trengoChannelsQuery = useQuery<{ channels: TrengoChannelOption[] }>({
    queryKey: ["admin-trengo-channels"],
    queryFn: async () => {
      const r = await fetch("/api/admin/trengo-channels")
      if (!r.ok) throw new Error("Failed to load Trengo channels")
      return r.json()
    },
    staleTime: 5 * 60 * 1000,
  })
  const trengoChannels = trengoChannelsQuery.data?.channels ?? []

  const fathomQuery = useQuery<{ members: FathomTeamMember[] }>({
    queryKey: ["admin-fathom-team-members"],
    queryFn: async () => {
      const r = await fetch("/api/admin/fathom-team-members")
      if (!r.ok) throw new Error("Failed to load Fathom team members")
      return r.json()
    },
    staleTime: 24 * 60 * 60 * 1000,
  })
  const fathomTeamMembers = fathomQuery.data?.members ?? []

  // Invite form state
  const [inviteFirstName, setInviteFirstName] = useState("")
  const [inviteLastName, setInviteLastName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<Role>("member")
  const [inviteMondayRole, setInviteMondayRole] = useState<MondayRole | null>(null)
  const [inviteMondayName, setInviteMondayName] = useState<string | null>(null)
  const [inviteSlackId, setInviteSlackId] = useState("")
  const [inviting, setInviting] = useState(false)

  // Per-row state
  const [roleSaving, setRoleSaving] = useState<Record<string, boolean>>({})
  const [mondaySaving, setMondaySaving] = useState<Record<string, boolean>>({})
  const [slackDrafts, setSlackDrafts] = useState<Record<string, string>>({})
  const [slackSaving, setSlackSaving] = useState<Record<string, boolean>>({})
  const [fathomSaving, setFathomSaving] = useState<Record<string, boolean>>({})
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({})
  const [nameSaving, setNameSaving] = useState<Record<string, boolean>>({})
  const [emailChannelSaving, setEmailChannelSaving] = useState<Record<string, boolean>>({})
  const [waChannelSaving, setWaChannelSaving] = useState<Record<string, boolean>>({})

  const emailChannelOptions = trengoChannels.filter((c) => c.isEmail)
  const waChannelOptions = trengoChannels.filter((c) => c.isWa)

  // Option lists used by labelFor() so the trigger renders an empty cell
  // when value === NONE.
  const hubRoleOpts = useMemo(
    () => [
      { value: "admin", label: t("settings.users.role.admin", locale) },
      { value: "member", label: t("settings.users.role.member", locale) },
      { value: "guest", label: t("settings.users.role.guest", locale) },
    ],
    [locale],
  )
  const mondayRoleOpts = useMemo(
    () => (Object.keys(MONDAY_ROLE_LABELS) as MondayRole[]).map((r) => ({ value: r, label: MONDAY_ROLE_LABELS[r] })),
    [],
  )
  const mondayPeopleOpts = useMemo(
    () => mondayPeople.map((name) => ({ value: name, label: name })),
    [mondayPeople],
  )
  const emailChannelOpts = useMemo(
    () => emailChannelOptions.map((c) => ({ value: c.id.toString(), label: c.name })),
    [emailChannelOptions],
  )
  const waChannelOpts = useMemo(
    () => waChannelOptions.map((c) => ({ value: c.id.toString(), label: c.name })),
    [waChannelOptions],
  )
  const fathomOpts = useMemo(
    () => fathomTeamMembers.map((m) => ({ value: m.email, label: m.name })),
    [fathomTeamMembers],
  )

  async function handleRoleChange(userId: string, role: Role) {
    setUsers((u) => u.map((user) => (user.id === userId ? { ...user, role } : user)))
    setRoleSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserRole(userId, role)
    } catch (e) {
      console.error(e)
    } finally {
      setRoleSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleMondayRoleChange(userId: string, value: string) {
    const newRole = value === NONE ? null : (value as MondayRole)
    setUsers((u) =>
      u.map((user) =>
        user.id === userId
          ? { ...user, monday_role: newRole, monday_person_name: newRole ? user.monday_person_name : null }
          : user,
      ),
    )
    setMondaySaving((s) => ({ ...s, [userId]: true }))
    try {
      const current = users.find((u) => u.id === userId)
      const personName = newRole ? current?.monday_person_name ?? null : null
      await setUserMondayMapping(userId, newRole, personName)
    } catch (e) {
      console.error(e)
    } finally {
      setMondaySaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleMondayNameChange(userId: string, value: string) {
    const newName = value === NONE ? null : value
    const current = users.find((u) => u.id === userId)
    if (!current) return
    setUsers((u) =>
      u.map((user) => (user.id === userId ? { ...user, monday_person_name: newName } : user)),
    )
    setMondaySaving((s) => ({ ...s, [userId]: true }))
    try {
      await setUserMondayMapping(userId, current.monday_role, newName)
    } catch (e) {
      console.error(e)
    } finally {
      setMondaySaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleFathomEmailChange(userId: string, value: string) {
    const newEmail = value === NONE ? null : value
    setUsers((u) => u.map((user) => (user.id === userId ? { ...user, fathom_email: newEmail } : user)))
    setFathomSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserFathomEmail(userId, newEmail)
    } catch (e) {
      console.error(e)
    } finally {
      setFathomSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleEmailChannelChange(userId: string, value: string) {
    const newId = value === NONE ? null : Number(value)
    setUsers((u) =>
      u.map((user) => (user.id === userId ? { ...user, primary_email_channel_id: newId } : user)),
    )
    setEmailChannelSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserPrimaryEmailChannel(userId, newId)
    } catch (e) {
      console.error(e)
    } finally {
      setEmailChannelSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleWaChannelChange(userId: string, value: string) {
    const newId = value === NONE ? null : Number(value)
    setUsers((u) =>
      u.map((user) => (user.id === userId ? { ...user, primary_wa_channel_id: newId } : user)),
    )
    setWaChannelSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserPrimaryWaChannel(userId, newId)
    } catch (e) {
      console.error(e)
    } finally {
      setWaChannelSaving((s) => ({ ...s, [userId]: false }))
    }
  }


  async function handleNameSave(userId: string) {
    const draft = nameDrafts[userId]
    if (draft === undefined) return
    const trimmed = draft.trim()
    const current = users.find((u) => u.id === userId)
    if (!current) return
    if ((current.name ?? "") === trimmed) return
    setNameSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserName(userId, trimmed || null)
      setUsers((u) =>
        u.map((user) => (user.id === userId ? { ...user, name: trimmed || null } : user)),
      )
      setNameDrafts((d) => {
        const { [userId]: _drop, ...rest } = d
        return rest
      })
    } catch (e) {
      console.error(e)
    } finally {
      setNameSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleSlackIdSave(userId: string) {
    const draft = slackDrafts[userId]
    if (draft === undefined) return
    const trimmed = draft.trim()
    const current = users.find((u) => u.id === userId)
    if (!current) return
    if ((current.slack_user_id ?? "") === trimmed) return
    setSlackSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserSlackId(userId, trimmed)
      setUsers((u) =>
        u.map((user) => (user.id === userId ? { ...user, slack_user_id: trimmed || null } : user)),
      )
      setSlackDrafts((d) => {
        const { [userId]: _drop, ...rest } = d
        return rest
      })
    } catch (e) {
      console.error(e)
    } finally {
      setSlackSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleInvite() {
    setError(null)
    setInviting(true)
    const fullName = [inviteFirstName, inviteLastName]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(" ")
    try {
      const result = await inviteUser({
        email: inviteEmail,
        name: fullName || null,
        role: inviteRole,
        mondayRole: inviteMondayRole,
        mondayPersonName: inviteMondayName,
        slackUserId: inviteSlackId,
      })
      setUsers((u) => [
        ...u,
        {
          id: result.id,
          email: inviteEmail.trim().toLowerCase(),
          name: fullName || null,
          role: inviteRole,
          slack_user_id: inviteSlackId.trim() || null,
          fathom_email: null,
          primary_email_channel_id: null,
          primary_wa_channel_id: null,
          monday_role: inviteMondayRole,
          monday_person_name: inviteMondayName,
          created_at: new Date().toISOString(),
        },
      ])
      setInviteFirstName("")
      setInviteLastName("")
      setInviteEmail("")
      setInviteRole("member")
      setInviteMondayRole(null)
      setInviteMondayName(null)
      setInviteSlackId("")
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.users.invite.error.failed", locale))
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(userId: string, email: string) {
    if (!confirm(t("settings.users.row.remove_confirm", locale, { email }))) return
    const previous = users
    setUsers((u) => u.filter((user) => user.id !== userId))
    try {
      await removeUser(userId)
    } catch (e) {
      setUsers(previous)
      setError(e instanceof Error ? e.message : t("settings.users.row.remove_failed", locale))
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium mb-3">{t("settings.users.invite.action.add", locale)}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleInvite()
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 rounded-xl border border-border/60 bg-card p-5"
        >
          <FieldLabel className="lg:col-span-3" label={t("settings.users.invite.first_name", locale)}>
            <Input
              placeholder="Roy"
              value={inviteFirstName}
              onChange={(e) => setInviteFirstName(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel className="lg:col-span-3" label={t("settings.users.invite.last_name", locale)}>
            <Input
              placeholder="Vosters"
              value={inviteLastName}
              onChange={(e) => setInviteLastName(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel className="lg:col-span-2" label={t("settings.users.invite.email", locale)}>
            <Input
              type="email"
              required
              placeholder="name@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel label={t("settings.users.invite.hub_role", locale)}>
            <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
              <SelectTrigger className="w-full">
                <SelectValue>{labelFor(inviteRole, hubRoleOpts)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">{t("settings.users.role.admin", locale)}</SelectItem>
                <SelectItem value="member">{t("settings.users.role.member", locale)}</SelectItem>
                <SelectItem value="guest">{t("settings.users.role.guest", locale)}</SelectItem>
              </SelectContent>
            </Select>
          </FieldLabel>
          <FieldLabel label={t("settings.users.invite.monday_role", locale)}>
            <Select
              value={inviteMondayRole ?? NONE}
              onValueChange={(v) => {
                const next = v === NONE ? null : (v as MondayRole)
                setInviteMondayRole(next)
                if (!next || !ROLES_NEEDING_MONDAY_NAME.has(next)) setInviteMondayName(null)
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder=" ">
                  {labelFor(inviteMondayRole, mondayRoleOpts)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>&nbsp;</SelectItem>
                {mondayRoleOpts.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabel>
          <FieldLabel label={t("settings.users.invite.monday_name", locale)}>
            <Select
              value={inviteMondayName ?? NONE}
              onValueChange={(v) => setInviteMondayName(v === NONE ? null : v)}
              disabled={!inviteMondayRole || !ROLES_NEEDING_MONDAY_NAME.has(inviteMondayRole)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder=" ">
                  {labelFor(inviteMondayName, mondayPeopleOpts)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>&nbsp;</SelectItem>
                {mondayPeopleOpts.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabel>
          <FieldLabel label={t("settings.users.invite.slack_id", locale)}>
            <Input
              placeholder="U01ABC234XY"
              className="font-mono"
              value={inviteSlackId}
              onChange={(e) => setInviteSlackId(e.target.value)}
            />
          </FieldLabel>
          <div className="lg:col-span-6 flex items-center justify-end">
            <Button type="submit" disabled={inviting}>
              {inviting ? t("settings.users.invite.action.adding", locale) : t("settings.users.invite.action.add", locale)}
            </Button>
          </div>
          {error && <p className="lg:col-span-6 text-sm text-destructive">{error}</p>}
        </form>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-3">Team members</h2>

        <div className="rounded-xl border border-border/60 bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <UsersHeadCell className="w-[200px]">{t("settings.users.col.user", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[120px]">{t("settings.users.col.hub_role", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[170px]">{t("settings.users.col.monday_role", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[180px]">{t("settings.users.col.monday_name", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[180px]">{t("settings.users.col.slack_id", locale)}</UsersHeadCell>
                <UsersHeadCell
                  className="w-[190px]"
                  title="Trengo email channel outbound client-updates leave through for this user's clients."
                >
                  Email channel
                </UsersHeadCell>
                <UsersHeadCell
                  className="w-[190px]"
                  title="Trengo WhatsApp channel the AM's HSM template is approved on."
                >
                  WhatsApp channel
                </UsersHeadCell>
                <UsersHeadCell className="w-[200px]">{t("settings.users.col.fathom_email", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[100px]">{t("settings.users.col.joined", locale)}</UsersHeadCell>
                <UsersHeadCell className="w-[44px]"> </UsersHeadCell>
              </tr>
            </thead>
            <tbody>
              {users.map((user, idx) => {
                const slackDraft = slackDrafts[user.id] ?? user.slack_user_id ?? ""
                const slackSaved = user.slack_user_id ?? ""
                const slackTrimmed = slackDraft.trim()
                const slackIsSaving = !!slackSaving[user.id]
                const slackIsDirty = slackTrimmed !== slackSaved
                const slackIsSaved = !slackIsDirty && slackTrimmed.length > 0

                const nameDraft = nameDrafts[user.id] ?? user.name ?? ""
                const nameTrimmed = nameDraft.trim()
                const nameIsSaving = !!nameSaving[user.id]
                const nameIsDirty = nameTrimmed !== (user.name ?? "")
                const nameIsSaved = !nameIsDirty && nameTrimmed.length > 0

                const isLast = idx === users.length - 1

                return (
                  <tr
                    key={user.id}
                    className={
                      "transition-colors hover:bg-muted/30 " +
                      (isLast ? "" : "border-b border-border/40")
                    }
                  >
                    <UsersBodyCell>
                      <GhostField
                        value={nameDraft}
                        placeholder={t("settings.users.row.name_placeholder", locale)}
                        onChange={(v) => setNameDrafts((d) => ({ ...d, [user.id]: v }))}
                        onCommit={() => handleNameSave(user.id)}
                        status={
                          nameIsSaving
                            ? "saving"
                            : nameIsDirty && nameTrimmed.length > 0
                              ? "dirty"
                              : nameIsSaved
                                ? "saved"
                                : "idle"
                        }
                        font="font-medium"
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.role}
                        onValueChange={(v) => handleRoleChange(user.id, v as Role)}
                        disabled={user.id === currentUserId}
                        saving={!!roleSaving[user.id]}
                        options={hubRoleOpts}
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.monday_role ?? NONE}
                        onValueChange={(v) => handleMondayRoleChange(user.id, v ?? NONE)}
                        saving={!!mondaySaving[user.id]}
                        options={mondayRoleOpts}
                        includeUnset
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.monday_person_name ?? NONE}
                        onValueChange={(v) => handleMondayNameChange(user.id, v ?? NONE)}
                        disabled={!user.monday_role || !ROLES_NEEDING_MONDAY_NAME.has(user.monday_role)}
                        saving={!!mondaySaving[user.id]}
                        options={mondayPeopleOpts}
                        includeUnset
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostField
                        value={slackDraft}
                        placeholder="U01ABC234XY"
                        onChange={(v) => setSlackDrafts((d) => ({ ...d, [user.id]: v }))}
                        onCommit={() => handleSlackIdSave(user.id)}
                        status={
                          slackIsSaving
                            ? "saving"
                            : slackIsDirty && slackTrimmed.length > 0
                              ? "dirty"
                              : slackIsSaved
                                ? "saved"
                                : "idle"
                        }
                        font="font-mono text-xs"
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.primary_email_channel_id?.toString() ?? NONE}
                        onValueChange={(v) => handleEmailChannelChange(user.id, v ?? NONE)}
                        disabled={emailChannelOpts.length === 0}
                        saving={!!emailChannelSaving[user.id]}
                        options={emailChannelOpts}
                        includeUnset
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.primary_wa_channel_id?.toString() ?? NONE}
                        onValueChange={(v) => handleWaChannelChange(user.id, v ?? NONE)}
                        disabled={waChannelOpts.length === 0}
                        saving={!!waChannelSaving[user.id]}
                        options={waChannelOpts}
                        includeUnset
                      />
                    </UsersBodyCell>

                    <UsersBodyCell>
                      <GhostSelect
                        value={user.fathom_email ?? NONE}
                        onValueChange={(v) => handleFathomEmailChange(user.id, v ?? NONE)}
                        disabled={fathomOpts.length === 0}
                        saving={!!fathomSaving[user.id]}
                        options={fathomOpts}
                        includeUnset
                      />
                    </UsersBodyCell>

                    <UsersBodyCell className="text-xs text-muted-foreground/70 tabular-nums">
                      {new Date(user.created_at).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB")}
                    </UsersBodyCell>

                    <UsersBodyCell className="text-right">
                      {user.id !== currentUserId && (
                        <button
                          type="button"
                          onClick={() => handleRemove(user.id, user.email)}
                          title={t("settings.users.row.remove_title", locale)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </UsersBodyCell>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
//  Cells, fields, selects
// ────────────────────────────────────────────────────────────────────────────

function FieldLabel({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">
        {label}
      </label>
      {children}
    </div>
  )
}

function UsersHeadCell({
  children,
  className,
  title,
}: {
  children: React.ReactNode
  className?: string
  title?: string
}) {
  return (
    <th
      title={title}
      className={
        "px-3 py-2.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 " +
        (className ?? "")
      }
    >
      {children}
    </th>
  )
}

function UsersBodyCell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={"px-3 py-2 align-middle " + (className ?? "")}>{children}</td>
}

/** Borderless input with an inline status dot. Border + bg appear only on
 *  hover / focus so a row of these reads as one flowing line instead of a
 *  collage of 8 disconnected pills. */
function GhostField({
  value,
  placeholder,
  onChange,
  onCommit,
  status,
  font,
}: {
  value: string
  placeholder?: string
  onChange: (next: string) => void
  onCommit: () => void
  status: "idle" | "saving" | "dirty" | "saved"
  font?: string
}) {
  return (
    <div className="group flex items-center gap-1.5">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className={
          "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/40 hover:border-border/60 hover:bg-background focus-visible:border-ring focus-visible:bg-background focus-visible:ring-3 focus-visible:ring-ring/30 " +
          (font ?? "")
        }
      />
      <StatusGlyph status={status} />
    </div>
  )
}

function StatusGlyph({ status }: { status: "idle" | "saving" | "dirty" | "saved" }) {
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
      {status === "saving" && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />
      )}
      {status === "dirty" && (
        <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" title="Unsaved" />
      )}
      {status === "saved" && (
        <Check className="h-3.5 w-3.5 text-emerald-500" aria-label="Saved" />
      )}
    </span>
  )
}

/** Borderless select trigger - matches GhostField's chrome. */
function GhostSelect({
  value,
  onValueChange,
  options,
  disabled,
  saving,
  includeUnset,
}: {
  value: string
  onValueChange: (next: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
  saving?: boolean
  /** When true, a NONE / unset row appears at the top of the menu. */
  includeUnset?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={(v) => onValueChange(v ?? NONE)} disabled={disabled}>
        <SelectTrigger className="h-8 w-full border-transparent bg-transparent hover:border-border/60 hover:bg-background data-[popup-open]:border-ring data-[popup-open]:bg-background">
          <SelectValue placeholder=" ">{labelFor(value, options)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {includeUnset && <SelectItem value={NONE}>&nbsp;</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/70" />}
      </span>
    </div>
  )
}
