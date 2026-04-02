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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveColumnMappings, type ColumnMapping } from "../actions"

type User = {
  id: string
  email: string
  name: string | null
  role: "admin" | "member" | "guest"
}

type Props = {
  users: User[]
  mondayPeople: string[]
  existingMappings: ColumnMapping[]
}

const COLUMN_ROLES = [
  { key: "account_manager", label: "Account Manager" },
  { key: "campaign_manager", label: "Campaign Manager" },
  { key: "appointment_setter", label: "Appointment Setter" },
] as const

const NONE_VALUE = "__none__"

export function ColumnMappingTab({ users, mondayPeople, existingMappings }: Props) {
  // Build initial state from existing mappings: { [userId]: { [columnRole]: mondayPersonName } }
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const m of existingMappings) {
      if (!map[m.user_id]) map[m.user_id] = {}
      map[m.user_id][m.monday_column_role] = m.monday_person_name
    }
    return map
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function handleChange(userId: string, columnRole: string, personName: string) {
    setSaved(false)
    setMappings((prev) => {
      const userMap = { ...(prev[userId] ?? {}) }
      if (personName === NONE_VALUE) {
        delete userMap[columnRole]
      } else {
        userMap[columnRole] = personName
      }
      return { ...prev, [userId]: userMap }
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const flat: ColumnMapping[] = []
      for (const [userId, roles] of Object.entries(mappings)) {
        for (const [columnRole, personName] of Object.entries(roles)) {
          if (personName) {
            flat.push({ user_id: userId, monday_column_role: columnRole, monday_person_name: personName })
          }
        }
      }
      await saveColumnMappings(flat)
      setSaved(true)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // Only show non-admin users (admins always see everything)
  const nonAdminUsers = users.filter((u) => u.role !== "admin")

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-1">User Column Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Link Monday.com people columns to hub users. Non-admin users will only see clients
          where they are assigned as Account Manager, Campaign Manager, or Appointment Setter.
          Admins always have full access.
        </p>
      </div>

      {nonAdminUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No member or guest users to configure. Only non-admin users need column mappings.
        </p>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hub User</TableHead>
                  {COLUMN_ROLES.map((col) => (
                    <TableHead key={col.key}>{col.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonAdminUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{user.name ?? "—"}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </TableCell>
                    {COLUMN_ROLES.map((col) => (
                      <TableCell key={col.key}>
                        <Select
                          value={mappings[user.id]?.[col.key] ?? NONE_VALUE}
                          onValueChange={(v) => handleChange(user.id, col.key, v ?? NONE_VALUE)}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Not linked" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NONE_VALUE}>Not linked</SelectItem>
                            {mondayPeople.map((name) => (
                              <SelectItem key={name} value={name}>
                                {name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Mappings"}
            </Button>
            {saved && (
              <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100">
                Saved
              </Badge>
            )}
          </div>
        </>
      )}

      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm text-muted-foreground">
          <strong>How it works:</strong> For each hub user, select the name that appears in
          the Monday.com Account Manager, Campaign Manager, or Appointment Setter column. When a non-admin user opens
          the Clients page, they will only see clients where at least one of their mapped columns
          matches. If a user has no mappings, they see all clients (no restriction).
        </p>
      </div>
    </div>
  )
}
