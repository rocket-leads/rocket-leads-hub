"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type DateRange = { startDate: string; endDate: string }

type Preset = { label: string; key: string }

const PRESETS: Preset[] = [
  { label: "Today", key: "today" },
  { label: "Yesterday", key: "yesterday" },
  { label: "Last 7 days", key: "last7" },
  { label: "This month", key: "thisMonth" },
  { label: "Last month", key: "lastMonth" },
  { label: "This quarter", key: "thisQuarter" },
]

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getRange(key: string): DateRange {
  const now = new Date()
  const today = toISO(now)

  switch (key) {
    case "today":
      return { startDate: today, endDate: today }
    case "yesterday": {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      const s = toISO(d)
      return { startDate: s, endDate: s }
    }
    case "last7": {
      const d = new Date(now)
      d.setDate(d.getDate() - 6)
      return { startDate: toISO(d), endDate: today }
    }
    case "thisMonth":
      return { startDate: today.slice(0, 8) + "01", endDate: today }
    case "lastMonth": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const last = new Date(now.getFullYear(), now.getMonth(), 0)
      return { startDate: toISO(first), endDate: toISO(last) }
    }
    case "thisQuarter": {
      const q = Math.floor(now.getMonth() / 3)
      const first = new Date(now.getFullYear(), q * 3, 1)
      return { startDate: toISO(first), endDate: today }
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
  const [activePreset, setActivePreset] = useState("thisMonth")

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
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            className="h-8 w-[140px] text-sm"
            value={value.startDate}
            onChange={(e) => handleCustom("startDate", e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
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
  return getRange("thisMonth")
}
