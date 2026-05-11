"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

export type DateRange = { startDate: string; endDate: string }

type Preset = { label: string; key: string }

/** Preset keys + dictionary lookups. Built into Preset[] per render so the
 *  language switch flips the labels without changing the keys (which feed
 *  into getRange below). */
const PRESET_SHAPE: { key: string; labelKey: DictionaryKey }[] = [
  { key: "today", labelKey: "client.date.preset.today" },
  { key: "yesterday", labelKey: "client.date.preset.yesterday" },
  { key: "last7", labelKey: "client.date.preset.last7" },
  { key: "thisMonth", labelKey: "client.date.preset.this_month" },
  { key: "lastMonth", labelKey: "client.date.preset.last_month" },
  { key: "thisQuarter", labelKey: "client.date.preset.this_quarter" },
]

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getRange(key: string): DateRange {
  const now = new Date()
  const today = toISO(now)
  // Default end date = yesterday (today's data is incomplete until the day ends)
  const yd = new Date(now)
  yd.setDate(yd.getDate() - 1)
  const yesterday = toISO(yd)

  switch (key) {
    case "today":
      return { startDate: today, endDate: today }
    case "yesterday":
      return { startDate: yesterday, endDate: yesterday }
    case "last7": {
      const d = new Date(yd)
      d.setDate(d.getDate() - 6)
      return { startDate: toISO(d), endDate: yesterday }
    }
    case "thisMonth":
      return { startDate: yesterday.slice(0, 8) + "01", endDate: yesterday }
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { startDate: toISO(first), endDate: toISO(last) }
    }
    case "thisQuarter": {
      const q = Math.floor(now.getMonth() / 3)
      const first = new Date(now.getFullYear(), q * 3, 1)
      return { startDate: toISO(first), endDate: yesterday }
    }
    default:
      return { startDate: today.slice(0, 8) + "01", endDate: today }
  }
}

type Props = {
  value: DateRange
  onChange: (range: DateRange) => void
}

export function DateFilter({ value, onChange }: Props) {
  const locale = useLocale()
  const [activePreset, setActivePreset] = useState("last7")

  const PRESETS: Preset[] = useMemo(
    () => PRESET_SHAPE.map((p) => ({ key: p.key, label: t(p.labelKey, locale) })),
    [locale],
  )

  function handlePreset(key: string) {
    setActivePreset(key)
    onChange(getRange(key))
  }

  function handleCustom(field: "startDate" | "endDate", val: string) {
    setActivePreset("custom")
    onChange({ ...value, [field]: val })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            size="sm"
            variant={activePreset === p.key ? "default" : "outline"}
            onClick={() => handlePreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">{t("client.date.from", locale)}</Label>
          <Input
            type="date"
            className="h-8 w-[140px] text-sm"
            value={value.startDate}
            onChange={(e) => handleCustom("startDate", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("client.date.to", locale)}</Label>
          <Input
            type="date"
            className="h-8 w-[140px] text-sm"
            value={value.endDate}
            onChange={(e) => handleCustom("endDate", e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export function defaultDateRange(): DateRange {
  return getRange("last7")
}
