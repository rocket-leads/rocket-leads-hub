"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { saveBoardConfig } from "../actions"

type BoardConfig = {
  onboarding_board_id: string
  current_board_id: string
  onboarding_columns: Record<string, string>
  current_columns: Record<string, string>
  client_board_columns: Record<string, string>
}

type Props = { config: BoardConfig }

const ONBOARDING_FIELDS = [
  { key: "client_board_id", label: "Client Board ID column" },
  { key: "kick_off_date", label: "Kick-off date" },
  { key: "meta_ad_account_id", label: "Meta Ad Account ID" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "trengo_contact_id", label: "Trengo Contact ID" },
  { key: "account_manager", label: "Account Manager" },
  { key: "campaign_manager", label: "Campaign Manager" },
  { key: "first_name", label: "First name client" },
  { key: "ad_budget", label: "Ad budget" },
  { key: "contact_direction", label: "Contact direction" },
  { key: "contact_channel", label: "Contact channel" },
  { key: "campaign_status", label: "Campaign status" },
  { key: "google_drive_folder_id", label: "Google Drive Folder ID" },
]

const CURRENT_FIELDS = [
  { key: "client_board_id", label: "Client Board ID column" },
  { key: "country", label: "Country" },
  { key: "meta_ad_account_id", label: "Meta Ad Account ID" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "trengo_contact_id", label: "Trengo Contact ID" },
  { key: "account_manager", label: "Account Manager" },
  { key: "campaign_manager", label: "Campaign Manager" },
  { key: "first_name", label: "First name client" },
  { key: "ad_budget", label: "Ad budget" },
  { key: "contact_direction", label: "Contact direction" },
  { key: "contact_channel", label: "Contact channel" },
  { key: "campaign_status", label: "Campaign status" },
  { key: "google_drive_folder_id", label: "Google Drive Folder ID" },
]

const CLIENT_BOARD_FIELDS = [
  { key: "date_created", label: "Date created (lead)" },
  { key: "date_appointment", label: "Date appointment" },
  { key: "lead_status", label: "Lead status" },
  { key: "lead_status_2", label: "Lead status 2 (taken calls filter)" },
  { key: "deal_value", label: "Deal value / revenue" },
  { key: "utm", label: "UTM / ad name" },
  { key: "date_deal", label: "Date deal closed" },
  { key: "taken_call_status_value", label: "Taken call status value (e.g. 'Afspraak')" },
]

function FieldGroup({
  title,
  fields,
  values,
  onChange,
}: {
  title: string
  fields: { key: string; label: string }[]
  values: Record<string, string>
  onChange: (key: string, value: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            <Input
              value={values[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardConfigTab({ config: initial }: Props) {
  const [config, setConfig] = useState<BoardConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function updateNested(section: keyof BoardConfig, key: string, value: string) {
    setConfig((c) => ({
      ...c,
      [section]: { ...(c[section] as Record<string, string>), [key]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveBoardConfig(config as unknown as Record<string, unknown>)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monday.com Board IDs</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Onboarding Board ID</Label>
            <Input
              className="font-mono"
              value={config.onboarding_board_id}
              onChange={(e) => setConfig((c) => ({ ...c, onboarding_board_id: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Current Clients Board ID</Label>
            <Input
              className="font-mono"
              value={config.current_board_id}
              onChange={(e) => setConfig((c) => ({ ...c, current_board_id: e.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Column Mappings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FieldGroup
            title="Onboarding Board Columns"
            fields={ONBOARDING_FIELDS}
            values={config.onboarding_columns}
            onChange={(k, v) => updateNested("onboarding_columns", k, v)}
          />
          <Separator />
          <FieldGroup
            title="Current Clients Board Columns"
            fields={CURRENT_FIELDS}
            values={config.current_columns}
            onChange={(k, v) => updateNested("current_columns", k, v)}
          />
          <Separator />
          <FieldGroup
            title="Client Board Columns (default for all clients)"
            fields={CLIENT_BOARD_FIELDS}
            values={config.client_board_columns}
            onChange={(k, v) => updateNested("client_board_columns", k, v)}
          />
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : saved ? "Saved!" : "Save configuration"}
      </Button>
    </div>
  )
}
