"use client"

import { useState } from "react"
import { Check, Loader2 } from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { saveColumnMappings, updateUserSlackId, type ColumnMapping } from "../actions"

type User = {
  id: string
  email: string
  name: string | null
  role: "admin" | "member" | "guest"
  slack_user_id: string | null
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

export function ColumnMappingTab({ users: initialUsers, mondayPeople, existingMappings }: Props) {
  // Monday role mappings — batch save via "Save Mappings" button
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

  // Slack ID — autosave per row on blur
  const [users, setUsers] = useState(initialUsers)
  const [slackDrafts, setSlackDrafts] = useState<Record<string, string>>({})
  const [slackSaving, setSlackSaving] = useState<Record<string, boolean>>({})

  function handleMondayChange(userId: string, columnRole: string, personName: string) {
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

  async function handleSaveMappings() {
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

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1">User Mapping</h3>
        <p className="text-sm text-muted-foreground">
          Per Hub user: link the Monday.com person columns (controls which clients they see) and
          the Slack workspace user ID (used for DM delivery — daily summaries, alerts).
          Slack ID format: <code className="text-[11px] font-mono">U01ABC234XY</code> · find via
          Slack → profile → ⋮ → Copy member ID.
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hub User</TableHead>
              {COLUMN_ROLES.map((col) => (
                <TableHead key={col.key}>{col.label}</TableHead>
              ))}
              <TableHead className="w-[220px]">Slack user ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const draft = slackDrafts[user.id] ?? user.slack_user_id ?? ""
              const savedValue = user.slack_user_id ?? ""
              const trimmedDraft = draft.trim()
              const isSaving = !!slackSaving[user.id]
              const isDirty = trimmedDraft !== savedValue
              const isSaved = !isDirty && trimmedDraft.length > 0
              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{user.name ?? <span className="text-muted-foreground">—</span>}</p>
                      <p className="text-xs text-muted-foreground">
                        {user.email} · <span className="capitalize">{user.role}</span>
                      </p>
                    </div>
                  </TableCell>
                  {COLUMN_ROLES.map((col) => (
                    <TableCell key={col.key}>
                      <Select
                        value={mappings[user.id]?.[col.key] ?? NONE_VALUE}
                        onValueChange={(v) => handleMondayChange(user.id, col.key, v ?? NONE_VALUE)}
                      >
                        <SelectTrigger className="w-[180px]">
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
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        placeholder="U01ABC234XY"
                        className="h-8 font-mono text-xs"
                        value={draft}
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
                        {isSaving && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                        {!isSaving && isDirty && trimmedDraft.length > 0 && (
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-yellow-500"
                            title="Unsaved"
                          />
                        )}
                        {!isSaving && isSaved && (
                          <Check className="h-3.5 w-3.5 text-green-500" aria-label="Saved" />
                        )}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSaveMappings} disabled={saving}>
          {saving ? "Saving..." : "Save Monday Mappings"}
        </Button>
        {saved && (
          <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100">
            Saved
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-2">
          Slack IDs save automatically as you type.
        </span>
      </div>

      <div className="rounded-lg border border-dashed p-4">
        <p className="text-sm text-muted-foreground">
          <strong>Monday People Mapping:</strong> non-admin users only see clients where they
          are the linked Account Manager, Campaign Manager, or Appointment Setter. Admins always
          have full access regardless of mappings (the dropdowns are visible for transparency
          but won't restrict admin access).
        </p>
      </div>
    </div>
  )
}
