"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { updateUserRole } from "../actions"

type User = {
  id: string
  email: string
  name: string | null
  role: "admin" | "member" | "guest"
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

  async function handleRoleChange(userId: string, role: "admin" | "member" | "guest") {
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

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[140px]">Change role</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div>
                  <p className="font-medium">{user.name ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={ROLE_COLORS[user.role]}>
                  {user.role}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(user.created_at).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Select
                    value={user.role}
                    onValueChange={(v) =>
                      handleRoleChange(user.id, v as "admin" | "member" | "guest")
                    }
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
