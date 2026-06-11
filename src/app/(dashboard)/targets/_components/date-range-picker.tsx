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
  /**
   * Latest selectable day. Anything after this is disabled in the calendar - used to
   * prevent picking today when the underlying data only goes up to yesterday.
   */
  maxDate?: Date
}

function formatLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  if (isSameDay(start, end)) return format(start, "d MMM yyyy")
  if (sameYear) return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`
}

export function DateRangePicker({ startDate, endDate, onChange, maxDate }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<RdpDateRange | undefined>({ from: startDate, to: endDate })
  // Track the click count since the popover opened. We only commit once the user has
  // explicitly picked TWO dates (start + end). Without this guard, react-day-picker
  // can emit a same-day range on the very first click - which previously slammed the
  // popover closed before the user got to pick the end date.
  const [clickCount, setClickCount] = useState(0)

  const handleSelect = (range: RdpDateRange | undefined) => {
    setPending(range)
    if (clickCount === 0) {
      // First click - keep the popup open so the user can pick the end date.
      setClickCount(1)
      return
    }
    if (range?.from && range?.to) {
      onChange(range.from, range.to)
      setOpen(false)
    }
  }

  return (
    <Popover.Root
      // `modal` ensures the popover gets its own interaction layer when
      // mounted inside another modal (e.g. the client slide-over Dialog).
      // Without this the Popover.Portal renders outside the Dialog's tree
      // and the Dialog's modal layer silently blocks all clicks on the
      // calendar, so the picker appears to "not open" (2026-05 bug Roy hit
      // on Ludidi's slide-over).
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setPending({ from: startDate, to: endDate })
          setClickCount(0)
        }
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
        {/* z-[70] sits above the slide-over (z-50) AND the in-panel client
            switcher (z-60). The Positioner is the layer that gets the
            absolute/fixed positioning, so z-index belongs here, not just
            on Popup. */}
        <Popover.Positioner sideOffset={6} align="start" className="z-[70]">
          <Popover.Popup
            className={cn(
              "rdp-popup bg-card border border-border rounded-lg shadow-lg p-3",
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
              {...(maxDate ? { disabled: { after: maxDate } } : {})}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
