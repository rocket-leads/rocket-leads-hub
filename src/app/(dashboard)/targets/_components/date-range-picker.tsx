"use client"

import { useState } from "react"
import { Popover } from "@base-ui/react/popover"
import { Calendar as CalendarIcon } from "lucide-react"
import { DayPicker, type DateRange as RdpDateRange } from "react-day-picker"
import "react-day-picker/style.css"
import { format, isSameDay } from "date-fns"
import { cn } from "@/lib/utils"

interface Props {
  startDate: Date
  endDate: Date
  onChange: (start: Date, end: Date) => void
}

function formatLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  if (isSameDay(start, end)) return format(start, "d MMM yyyy")
  if (sameYear) return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`
}

export function DateRangePicker({ startDate, endDate, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<RdpDateRange | undefined>({ from: startDate, to: endDate })

  const handleSelect = (range: RdpDateRange | undefined) => {
    setPending(range)
    // Commit when both ends are selected
    if (range?.from && range?.to) {
      onChange(range.from, range.to)
      setOpen(false)
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setPending({ from: startDate, to: endDate })
      }}
    >
      <Popover.Trigger
        className={cn(
          "h-8 inline-flex items-center gap-2 px-3 rounded-md border border-border bg-card",
          "text-xs text-foreground hover:bg-muted/50 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-primary/40",
        )}
      >
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{formatLabel(startDate, endDate)}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start">
          <Popover.Popup
            className={cn(
              "rdp-popup bg-card border border-border rounded-lg shadow-lg p-3 z-50",
              "outline-none",
            )}
          >
            <DayPicker
              mode="range"
              numberOfMonths={2}
              selected={pending}
              onSelect={handleSelect}
              defaultMonth={startDate}
              showOutsideDays
              weekStartsOn={1}
              className="rdp-rl"
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
