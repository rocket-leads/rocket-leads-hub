"use client"

import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { inviteUser, removeUser, updateUserRole, updateUserSlackId } from "../actions"

type Role = "admin" | "member" | "guest"

type User = {
  id: string
  email: string
  name: string | null
  role: Role
  slack_user_id: string | null
  created_at: string
}

type Props = { users: User[]; currentUserId: string }

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  member: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  guest: "bg-muted text-muted-foreground",
}

export function UsersTab({ users: initial, currentUserId }: Props) {
  const [users, setUsers] = useState(initial)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [slackDrafts, setSlackDrafts] = useState<Record<string, string>>({})
  const [slackSavedAt, setSlackSavedAt] = useState<Record<string, number>>({})
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<Role>("member")
  const [inviting, setInviting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRoleChange(userId: string, role: Role) {
    setUsers((u) => u.map((user) => (user.id === userId ? { ...user, role } : user)))
    setSaving((s) => ({ ...s, [userId]: true }))
    try {
      await updateUserRole(userId, role)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving((s) => ({ ...s, [userId]: false }))
    }
  }

  async function handleSlackIdSave(userId: string) {
    const draft = slackDrafts[userId]
    if (draft === undefined) return // never edited
    const trimmed = draft.trim()
    const current = users.find((u) => u.id === userId)
    if (!current) return
    if ((current.slack_user_id ?? "") === trimmed) return // no change
    setSaving((s) => ({ ...s, [`slack:${userId}`]: true }))
    try {
      await updateUserSlackId(userId, trimmed)
      setUsers((u) => u.map((user) => (user.id === userId ? { ...user, slack_user_id: trimmed || null } : user)))
      setSlackSavedAt((m) => ({ ...m, [userId]: Date.now() }))
      setTimeout(() => {
        setSlackSavedAt((m) => {
          const { [userId]: _drop, ...rest } = m
          return rest
        })
      }, 2000)
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : "Failed to save Slack ID")
    } finally {
      setSaving((s) => ({ ...s, [`slack:${userId}`]: false }))
    }
  }

  async function handleInvite() {
    setError(null)
    setInviting(true)
    try {
      await inviteUser(inviteEmail, inviteRole)
      setUsers((u) => [
        ...u,
        {
          id: crypto.randomUUID(),
          email: inviteEmail.trim().toLowerCase(),
          name: null,
          role: inviteRole,
          slack_user_id: null,
          created_at: new Date().toISOString(),
        },
      ])
      setInviteEmail("")
      setInviteRole("member")
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
        className="flex flex-wrap items-end gap-2 rounded-md border p-4"
      >
        <div className="flex-1 min-w-[240px]">
          <label className="mb-1.5 block text-sm font-medium">Email</label>
          <Input
            type="email"
            required
            placeholder="name@example.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
        </div>
        <div className="w-[140px]">
          <label className="mb-1.5 block text-sm font-medium">Role</label>
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
        <Button type="submit" disabled={inviting}>
          {inviting ? "Adding..." : "Add user"}
        </Button>
        {error && <p className="basis-full text-sm text-destructive">{error}</p>}
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-[200px]">Slack user ID</TableHead>
              <TableHead className="w-[180px]">Change role</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{user.name ?? <span className="text-muted-foreground">Pending invitation</span>}</p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={ROLE_COLORS[user.role]}>
                    {user.role}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Input
                      placeholder="U01ABC234XY"
                      className="h-8 font-mono text-xs"
                      value={slackDrafts[user.id] ?? user.slack_user_id ?? ""}
                      onChange={(e) => setSlackDrafts((d) => ({ ...d, [user.id]: e.target.value }))}
                      onBlur={() => handleSlackIdSave(user.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          ;(e.target as HTMLInputElement).blur()
                        }
                      }}
                    />
                    {saving[`slack:${user.id}`] && (
                      <span className="text-[10px] text-muted-foreground shrink-0">…</span>
                    )}
                    {slackSavedAt[user.id] && (
                      <span className="text-[10px] text-green-500 shrink-0">✓</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select
                      value={user.role}
                      onValueChange={(v) => handleRoleChange(user.id, v as Role)}
                      disabled={user.id === currentUserId}
                    >
                      <SelectTrigger className="h-8 w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="guest">Guest</SelectItem>
                      </SelectContent>
                    </Select>
                    {saving[user.id] && (
                      <span className="text-xs text-muted-foreground">Saving...</span>
                    )}
                  </div>
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
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
