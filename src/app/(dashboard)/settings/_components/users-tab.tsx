"use client"

import { useState } from "react"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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

const NONE = "__none__"
const UNSET_LABEL = "—"

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
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleInvite()
        }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 rounded-md border p-4"
      >
        <div className="lg:col-span-3">
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.first_name", locale)}</label>
          <Input
            placeholder="Roy"
            value={inviteFirstName}
            onChange={(e) => setInviteFirstName(e.target.value)}
          />
        </div>
        <div className="lg:col-span-3">
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.last_name", locale)}</label>
          <Input
            placeholder="Vosters"
            value={inviteLastName}
            onChange={(e) => setInviteLastName(e.target.value)}
          />
        </div>
        <div className="lg:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.email", locale)}</label>
          <Input
            type="email"
            required
            placeholder="name@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.hub_role", locale)}</label>
          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">{t("settings.users.role.admin", locale)}</SelectItem>
              <SelectItem value="member">{t("settings.users.role.member", locale)}</SelectItem>
              <SelectItem value="guest">{t("settings.users.role.guest", locale)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.monday_role", locale)}</label>
          <Select
            value={inviteMondayRole ?? NONE}
            onValueChange={(v) => {
              const next = v === NONE ? null : (v as MondayRole)
              setInviteMondayRole(next)
              if (!next || !ROLES_NEEDING_MONDAY_NAME.has(next)) setInviteMondayName(null)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={UNSET_LABEL} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{UNSET_LABEL}</SelectItem>
              {(Object.keys(MONDAY_ROLE_LABELS) as MondayRole[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {MONDAY_ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.monday_name", locale)}</label>
          <Select
            value={inviteMondayName ?? NONE}
            onValueChange={(v) => setInviteMondayName(v === NONE ? null : v)}
            disabled={!inviteMondayRole || !ROLES_NEEDING_MONDAY_NAME.has(inviteMondayRole)}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  !inviteMondayRole
                    ? UNSET_LABEL
                    : !ROLES_NEEDING_MONDAY_NAME.has(inviteMondayRole)
                    ? t("settings.users.select.not_applicable", locale)
                    : t("settings.users.select.pick_person", locale)
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{UNSET_LABEL}</SelectItem>
              {mondayPeople.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">{t("settings.users.invite.slack_id", locale)}</label>
          <Input
            placeholder="U01ABC234XY"
            className="font-mono"
            value={inviteSlackId}
            onChange={(e) => setInviteSlackId(e.target.value)}
          />
        </div>
        <div className="lg:col-span-6 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t("settings.users.invite.helper", locale)}
          </p>
          <Button type="submit" disabled={inviting}>
            {inviting ? t("settings.users.invite.action.adding", locale) : t("settings.users.invite.action.add", locale)}
          </Button>
        </div>
        {error && <p className="lg:col-span-6 text-sm text-destructive">{error}</p>}
      </form>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.users.col.user", locale)}</TableHead>
              <TableHead className="w-[130px]">{t("settings.users.col.hub_role", locale)}</TableHead>
              <TableHead className="w-[180px]">{t("settings.users.col.monday_role", locale)}</TableHead>
              <TableHead className="w-[200px]">{t("settings.users.col.monday_name", locale)}</TableHead>
              <TableHead className="w-[200px]">{t("settings.users.col.slack_id", locale)}</TableHead>
              <TableHead className="w-[210px]" title="Trengo email channel outbound client-updates leave through for this user's clients.">
                Email channel
              </TableHead>
              <TableHead className="w-[210px]" title="Trengo WhatsApp channel the AM's HSM template is approved on.">
                WhatsApp channel
              </TableHead>
              <TableHead className="w-[220px]">{t("settings.users.col.fathom_email", locale)}</TableHead>
              <TableHead className="w-[100px]">{t("settings.users.col.joined", locale)}</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
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

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Input
                          placeholder={t("settings.users.row.name_placeholder", locale)}
                          className="h-8 max-w-[200px] font-medium"
                          value={nameDraft}
                          onChange={(e) =>
                            setNameDrafts((d) => ({ ...d, [user.id]: e.target.value }))
                          }
                          onBlur={() => handleNameSave(user.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              ;(e.target as HTMLInputElement).blur()
                            }
                          }}
                        />
                        <div className="w-4 shrink-0 flex items-center justify-center">
                          {nameIsSaving && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          )}
                          {!nameIsSaving && nameIsDirty && nameTrimmed.length > 0 && (
                            <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" title={t("settings.users.row.unsaved", locale)} />
                          )}
                          {!nameIsSaving && nameIsSaved && (
                            <Check className="h-3.5 w-3.5 text-green-500" aria-label={t("settings.users.row.saved", locale)} />
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {user.email}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.role}
                        onValueChange={(v) => handleRoleChange(user.id, v as Role)}
                        disabled={user.id === currentUserId}
                      >
                        <SelectTrigger className="h-8 w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">{t("settings.users.role.admin", locale)}</SelectItem>
                          <SelectItem value="member">{t("settings.users.role.member", locale)}</SelectItem>
                          <SelectItem value="guest">{t("settings.users.role.guest", locale)}</SelectItem>
                        </SelectContent>
                      </Select>
                      {roleSaving[user.id] && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <Select
                      value={user.monday_role ?? NONE}
                      onValueChange={(v) => handleMondayRoleChange(user.id, v ?? NONE)}
                    >
                      <SelectTrigger className="h-8 w-[170px]">
                        <SelectValue placeholder={UNSET_LABEL} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{UNSET_LABEL}</SelectItem>
                        {(Object.keys(MONDAY_ROLE_LABELS) as MondayRole[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {MONDAY_ROLE_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.monday_person_name ?? NONE}
                        onValueChange={(v) => handleMondayNameChange(user.id, v ?? NONE)}
                        disabled={!user.monday_role || !ROLES_NEEDING_MONDAY_NAME.has(user.monday_role)}
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue
                            placeholder={
                              !user.monday_role
                                ? UNSET_LABEL
                                : !ROLES_NEEDING_MONDAY_NAME.has(user.monday_role)
                                ? t("settings.users.select.not_applicable", locale)
                                : t("settings.users.select.pick_person", locale)
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{UNSET_LABEL}</SelectItem>
                          {mondayPeople.map((name) => (
                            <SelectItem key={name} value={name}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {mondaySaving[user.id] && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        placeholder="U01ABC234XY"
                        className="h-8 font-mono text-xs"
                        value={slackDraft}
                        onChange={(e) =>
                          setSlackDrafts((d) => ({ ...d, [user.id]: e.target.value }))
                        }
                        onBlur={() => handleSlackIdSave(user.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                      />
                      <div className="w-4 shrink-0 flex items-center justify-center">
                        {slackIsSaving && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                        {!slackIsSaving && slackIsDirty && slackTrimmed.length > 0 && (
                          <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" title={t("settings.users.row.unsaved", locale)} />
                        )}
                        {!slackIsSaving && slackIsSaved && (
                          <Check className="h-3.5 w-3.5 text-green-500" aria-label={t("settings.users.row.saved", locale)} />
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.primary_email_channel_id?.toString() ?? NONE}
                        onValueChange={(v) => handleEmailChannelChange(user.id, v ?? NONE)}
                        disabled={emailChannelOptions.length === 0}
                      >
                        <SelectTrigger className="h-8 w-[200px]">
                          <SelectValue
                            placeholder={
                              emailChannelOptions.length === 0
                                ? "No email channels"
                                : "Pick email channel"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {emailChannelOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {emailChannelSaving[user.id] && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.primary_wa_channel_id?.toString() ?? NONE}
                        onValueChange={(v) => handleWaChannelChange(user.id, v ?? NONE)}
                        disabled={waChannelOptions.length === 0}
                      >
                        <SelectTrigger className="h-8 w-[200px]">
                          <SelectValue
                            placeholder={
                              waChannelOptions.length === 0
                                ? "No WA channels"
                                : "Pick WhatsApp channel"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {waChannelOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {waChannelSaving[user.id] && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.fathom_email ?? NONE}
                        onValueChange={(v) => handleFathomEmailChange(user.id, v ?? NONE)}
                        disabled={fathomTeamMembers.length === 0}
                      >
                        <SelectTrigger className="h-8 w-[210px]">
                          <SelectValue
                            placeholder={
                              fathomTeamMembers.length === 0 ? t("settings.users.select.connect_fathom", locale) : t("settings.users.select.pick_fathom", locale)
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
                          {fathomTeamMembers.map((m) => (
                            <SelectItem key={m.email} value={m.email}>
                              {m.name} <span className="text-muted-foreground">({m.email})</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {fathomSaving[user.id] && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB")}
                  </TableCell>

                  <TableCell>
                    {user.id !== currentUserId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(user.id, user.email)}
                        title={t("settings.users.row.remove_title", locale)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("settings.users.footer", locale)}
      </p>
    </div>
  )
}
