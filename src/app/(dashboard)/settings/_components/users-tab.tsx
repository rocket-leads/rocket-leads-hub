"use client"

import { useState } from "react"
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
import {
  inviteUser,
  removeUser,
  setUserMondayMapping,
  updateUserRole,
  updateUserSlackId,
  type MondayRole,
} from "../actions"

type Role = "admin" | "member" | "guest"

type User = {
  id: string
  email: string
  name: string | null
  role: Role
  slack_user_id: string | null
  monday_role: MondayRole | null
  monday_person_name: string | null
  created_at: string
}

type Props = {
  users: User[]
  currentUserId: string
  mondayPeople: string[]
}

const NONE = "__none__"

const MONDAY_ROLE_LABELS: Record<MondayRole, string> = {
  account_manager: "Account Manager",
  campaign_manager: "Campaign Manager",
  appointment_setter: "Appointment Setter",
}

export function UsersTab({ users: initial, currentUserId, mondayPeople }: Props) {
  const [users, setUsers] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  // Invite form state
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
    try {
      const result = await inviteUser({
        email: inviteEmail,
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
          name: null,
          role: inviteRole,
          slack_user_id: inviteSlackId.trim() || null,
          monday_role: inviteMondayRole,
          monday_person_name: inviteMondayName,
          created_at: new Date().toISOString(),
        },
      ])
      setInviteEmail("")
      setInviteRole("member")
      setInviteMondayRole(null)
      setInviteMondayName(null)
      setInviteSlackId("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user")
    } finally {
      setInviting(false)
    }
  }

  async function handleRemove(userId: string, email: string) {
    if (!confirm(`Remove ${email}? They will lose access immediately.`)) return
    const previous = users
    setUsers((u) => u.filter((user) => user.id !== userId))
    try {
      await removeUser(userId)
    } catch (e) {
      setUsers(previous)
      setError(e instanceof Error ? e.message : "Failed to remove user")
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
        <div className="lg:col-span-2">
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <Input
            type="email"
            required
            placeholder="name@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Hub role</label>
          <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="guest">Guest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Monday role</label>
          <Select
            value={inviteMondayRole ?? NONE}
            onValueChange={(v) => {
              const next = v === NONE ? null : (v as MondayRole)
              setInviteMondayRole(next)
              if (!next) setInviteMondayName(null)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>None</SelectItem>
              <SelectItem value="account_manager">Account Manager</SelectItem>
              <SelectItem value="campaign_manager">Campaign Manager</SelectItem>
              <SelectItem value="appointment_setter">Appointment Setter</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Monday name</label>
          <Select
            value={inviteMondayName ?? NONE}
            onValueChange={(v) => setInviteMondayName(v === NONE ? null : v)}
            disabled={!inviteMondayRole}
          >
            <SelectTrigger>
              <SelectValue placeholder={inviteMondayRole ? "Pick a person" : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {mondayPeople.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium">Slack ID</label>
          <Input
            placeholder="U01ABC234XY"
            className="font-mono"
            value={inviteSlackId}
            onChange={(e) => setInviteSlackId(e.target.value)}
          />
        </div>
        <div className="lg:col-span-6 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Monday role + name controls which clients this user sees (non-admins).
            Slack ID enables DM notifications. All optional at invite time.
          </p>
          <Button type="submit" disabled={inviting}>
            {inviting ? "Adding..." : "Add user"}
          </Button>
        </div>
        {error && <p className="lg:col-span-6 text-sm text-destructive">{error}</p>}
      </form>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="w-[130px]">Hub role</TableHead>
              <TableHead className="w-[180px]">Monday role</TableHead>
              <TableHead className="w-[200px]">Monday name</TableHead>
              <TableHead className="w-[200px]">Slack user ID</TableHead>
              <TableHead className="w-[100px]">Joined</TableHead>
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

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {user.name ?? <span className="text-muted-foreground">Pending invitation</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{user.email}</p>
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
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="guest">Guest</SelectItem>
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
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>None</SelectItem>
                        <SelectItem value="account_manager">Account Manager</SelectItem>
                        <SelectItem value="campaign_manager">Campaign Manager</SelectItem>
                        <SelectItem value="appointment_setter">Appointment Setter</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={user.monday_person_name ?? NONE}
                        onValueChange={(v) => handleMondayNameChange(user.id, v ?? NONE)}
                        disabled={!user.monday_role}
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue
                            placeholder={user.monday_role ? "Pick a person" : "—"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>—</SelectItem>
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
                          <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" title="Unsaved" />
                        )}
                        {!slackIsSaving && slackIsSaved && (
                          <Check className="h-3.5 w-3.5 text-green-500" aria-label="Saved" />
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>

                  <TableCell>
                    {user.id !== currentUserId && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleRemove(user.id, user.email)}
                        title="Remove user"
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
        Hub role controls access. Monday role + name decide which clients non-admin
        users see (admins always see all). Slack ID is used for DM notifications.
        All fields autosave. Reference for label: {Object.values(MONDAY_ROLE_LABELS).join(" · ")}.
      </p>
    </div>
  )
}
