"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { saveApiToken } from "../actions"

type ServiceStatus = {
  is_valid: boolean | null
  last_verified: string | null
}

type Props = {
  statuses: Record<string, ServiceStatus>
}

const SERVICES = [
  { id: "monday", label: "Monday.com", description: "API token from Monday.com developer settings" },
  { id: "meta", label: "Meta (Facebook)", description: "Graph API access token — expires periodically" },
  { id: "stripe", label: "Stripe", description: "Secret key (sk_live_... or sk_test_...)" },
  { id: "trengo", label: "Trengo", description: "API token from Trengo settings" },
  { id: "google_drive", label: "Google (Drive + Sheets)", description: "Full service account JSON — used for knowledge folder + targets cost sheet" },
  { id: "slack", label: "Slack", description: "Bot User OAuth Token (starts with xoxb-) from your Slack App" },
  { id: "fathom", label: "Fathom", description: "API key from Fathom → Settings → API Access. Webhook secret goes in FATHOM_WEBHOOK_SECRET env var." },
]

function StatusDot({ status }: { status: ServiceStatus | undefined }) {
  if (!status || status.last_verified === null) {
    return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" title="Not tested" />
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${status.is_valid ? "bg-green-500" : "bg-red-500"}`}
      title={status.is_valid ? "Connected" : "Connection failed"}
    />
  )
}

export function ApiTokensTab({ statuses: initialStatuses }: Props) {
  const router = useRouter()
  // Local mirror of statuses — updated optimistically on save & after test results
  // so the dot reflects the latest state without a full page reload.
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>(initialStatuses)
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [testing, setTesting] = useState<Record<string, boolean>>({})
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  async function handleSave(service: string) {
    const token = tokens[service]?.trim()
    if (!token) return
    setSaving((s) => ({ ...s, [service]: true }))
    try {
      await saveApiToken(service, token)
      setTokens((t) => ({ ...t, [service]: "" }))
      setSaved((s) => ({ ...s, [service]: true }))
      setTimeout(() => setSaved((s) => ({ ...s, [service]: false })), 3000)
      // After save the token is fresh but unverified — reset dot to "Not tested" grey
      setStatuses((prev) => ({ ...prev, [service]: { is_valid: null, last_verified: null } }))
      setTestResults((r) => {
        const { [service]: _drop, ...rest } = r
        return rest
      })
      // Run the verification immediately so the dot turns green/red without an extra click
      void handleTest(service)
      router.refresh()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving((s) => ({ ...s, [service]: false }))
    }
  }

  async function handleTest(service: string) {
    setTesting((t) => ({ ...t, [service]: true }))
    try {
      const res = await fetch("/api/settings/test-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      })
      const data = await res.json()
      setTestResults((r) => ({ ...r, [service]: data }))
      // Update local statuses so the dot + "Last tested" timestamp react immediately
      setStatuses((prev) => ({
        ...prev,
        [service]: { is_valid: !!data.ok, last_verified: new Date().toISOString() },
      }))
    } catch {
      setTestResults((r) => ({ ...r, [service]: { ok: false, message: "Request failed" } }))
      setStatuses((prev) => ({
        ...prev,
        [service]: { is_valid: false, last_verified: new Date().toISOString() },
      }))
    } finally {
      setTesting((t) => ({ ...t, [service]: false }))
    }
  }


  return (
    <div className="space-y-4">
      {SERVICES.map((svc) => (
        <Card key={svc.id}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <StatusDot status={statuses[svc.id]} />
              <CardTitle className="text-base">{svc.label}</CardTitle>
            </div>
            <CardDescription>{svc.description}</CardDescription>
            {statuses[svc.id]?.last_verified && (
              <p className="text-xs text-muted-foreground">
                Last tested: {new Date(statuses[svc.id].last_verified!).toLocaleString("en-GB")}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={svc.id}>New token</Label>
              <Input
                id={svc.id}
                type="password"
                placeholder="Paste new token to update..."
                value={tokens[svc.id] ?? ""}
                onChange={(e) => setTokens((t) => ({ ...t, [svc.id]: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleSave(svc.id)}
                disabled={!tokens[svc.id]?.trim() || saving[svc.id]}
              >
                {saving[svc.id] ? "Saving..." : "Save token"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleTest(svc.id)}
                disabled={testing[svc.id]}
              >
                {testing[svc.id] ? "Testing..." : "Test connection"}
              </Button>
            </div>
            {saved[svc.id] && (
              <p className="text-sm text-green-500">Token saved successfully.</p>
            )}
            {testResults[svc.id] && (
              <p className={`text-sm ${testResults[svc.id].ok ? "text-green-500" : "text-red-500"}`}>
                {testResults[svc.id].message}
              </p>
            )}
            {svc.id === "slack" && statuses.slack?.is_valid && (
              <div className="pt-2 border-t border-border/40">
                <p className="text-xs text-muted-foreground">
                  Connection is live. Set up notifications and run previews in the{" "}
                  <span className="font-medium text-foreground">Notifications</span> tab.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
