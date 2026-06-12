"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { saveBoardConfig } from "../actions"
import { MondayWebhooksCard } from "./monday-webhooks-card"

type BoardConfig = {
  onboarding_board_id: string
  current_board_id: string
  onboarding_columns: Record<string, string>
  current_columns: Record<string, string>
  client_board_columns: Record<string, string>
}

type Props = { config: BoardConfig; defaults: BoardConfig }

const ONBOARDING_FIELDS = [
  { key: "client_board_id", label: "Client Board ID column" },
  { key: "kick_off_date", label: "Kick-off date" },
  { key: "meta_ad_account_id", label: "Meta Ad Account ID" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "trengo_contact_id", label: "Trengo Contact ID" },
  { key: "google_drive_id", label: "Google Drive ID" },
  { key: "account_manager", label: "Account Manager" },
  { key: "campaign_manager", label: "Campaign Manager" },
  { key: "first_name", label: "First name client" },
  { key: "ad_budget", label: "Ad budget" },
  { key: "service_fee", label: "Service fee" },
  { key: "follow_up_status", label: "Follow-up status (RL vs Client)" },
  { key: "follow_up_fee", label: "Follow-up fee" },
  { key: "cycle_start_date", label: "New cycle start (Monday date column)" },
  { key: "next_invoice_date", label: "Invoice date (derived; cycle − 7d)" },
  { key: "contact_direction", label: "Contact direction" },
  { key: "contact_channel", label: "Contact channel (WhatsApp / Email)" },
  { key: "phone", label: "Client phone (WhatsApp number)" },
  { key: "email", label: "Client email" },
  { key: "campaign_status", label: "Campaign status / phase" },
  { key: "meta_connected", label: "Meta connected" },
]

const CURRENT_FIELDS = [
  { key: "client_board_id", label: "Client Board ID column" },
  { key: "country", label: "Country" },
  { key: "meta_ad_account_id", label: "Meta Ad Account ID" },
  { key: "stripe_customer_id", label: "Stripe Customer ID" },
  { key: "trengo_contact_id", label: "Trengo Contact ID" },
  { key: "google_drive_id", label: "Google Drive ID" },
  { key: "account_manager", label: "Account Manager" },
  { key: "campaign_manager", label: "Campaign Manager" },
  { key: "appointment_setter", label: "Appointment Setter" },
  { key: "first_name", label: "First name client" },
  { key: "ad_budget", label: "Ad budget" },
  { key: "service_fee", label: "Service fee" },
  { key: "follow_up_status", label: "Follow-up status (RL vs Client)" },
  { key: "follow_up_fee", label: "Follow-up fee" },
  { key: "cycle_start_date", label: "New cycle start (Monday date column)" },
  { key: "next_invoice_date", label: "Invoice date (derived; cycle − 7d)" },
  { key: "contact_direction", label: "Contact direction" },
  { key: "contact_channel", label: "Contact channel (WhatsApp / Email)" },
  { key: "phone", label: "Client phone (WhatsApp number)" },
  { key: "email", label: "Client email" },
  { key: "campaign_status", label: "Campaign status" },
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
  defaults,
  onChange,
}: {
  title: string
  fields: { key: string; label: string }[]
  values: Record<string, string>
  defaults?: Record<string, string>
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
              placeholder={defaults?.[f.key] ?? ""}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="h-8 text-sm font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export function BoardConfigTab({ config: initial, defaults }: Props) {
  const locale = useLocale()
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
          <CardTitle className="text-base">{t("settings.board.boards.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("settings.board.boards.onboarding", locale)}</Label>
            <Input
              className="font-mono"
              value={config.onboarding_board_id}
              onChange={(e) => setConfig((c) => ({ ...c, onboarding_board_id: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("settings.board.boards.current", locale)}</Label>
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
          <CardTitle className="text-base">{t("settings.board.columns.title", locale)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FieldGroup
            title={t("settings.board.group.onboarding", locale)}
            fields={ONBOARDING_FIELDS}
            values={config.onboarding_columns}
            defaults={defaults.onboarding_columns}
            onChange={(k, v) => updateNested("onboarding_columns", k, v)}
          />
          <Separator />
          <FieldGroup
            title={t("settings.board.group.current", locale)}
            fields={CURRENT_FIELDS}
            values={config.current_columns}
            defaults={defaults.current_columns}
            onChange={(k, v) => updateNested("current_columns", k, v)}
          />
          <Separator />
          <FieldGroup
            title={t("settings.board.group.client", locale)}
            fields={CLIENT_BOARD_FIELDS}
            values={config.client_board_columns}
            defaults={defaults.client_board_columns}
            onChange={(k, v) => updateNested("client_board_columns", k, v)}
          />
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving}>
        {saving ? t("settings.board.action.saving", locale) : saved ? t("settings.board.action.saved", locale) : t("settings.board.action.save", locale)}
      </Button>

      {/* Real-time sync - registers Monday webhooks against the boards
          configured above so status / name / create / delete events push to
          the Hub within seconds. Without this, the Hub relies on the daily
          refresh-cache cron and can be up to 24h stale. */}
      <MondayWebhooksCard />
    </div>
  )
}
