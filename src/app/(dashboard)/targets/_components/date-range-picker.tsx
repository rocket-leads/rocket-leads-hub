"use client"

import { useState, useRef } from "react"
import { Popover } from "@base-ui/react/popover"
import { Calendar as CalendarIcon } from "lucide-react"
import { DayPicker } from "react-day-picker"
import "react-day-picker/style.css"
import { format, isSameDay, startOfDay, isAfter, isBefore } from "date-fns"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { getDatePresets } from "@/lib/targets/date-presets"

interface Props {
  startDate: Date
  endDate: Date
  onChange: (start: Date, end: Date) => void
  /**
   * Latest selectable day. Anything after this is disabled in both calendars -
   * used to prevent picking today when the underlying data only goes to yesterday.
   */
  maxDate?: Date
}

function formatLabel(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear()
  if (isSameDay(start, end)) return format(start, "d MMM yyyy")
  if (sameYear) return `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`
  return `${format(start, "d MMM yyyy")} – ${format(end, "d MMM yyyy")}`
}

const DOUBLE_CLICK_MS = 350

/**
 * Date range picker rebuilt 2026-09-02 (Roy: the old range-mode calendar
 * "only takes the from" / commits a same-day range on the first click).
 *
 * The old design used react-day-picker in `mode="range"` with a click-count
 * guard - fragile because range-mode collapses to a same-day range on the first
 * click and the guard committed on the second CLICK regardless of whether a real
 * end date was chosen. This version removes the ambiguity entirely:
 *
 *  - TWO independent single-date calendars: the LEFT one picks From, the RIGHT
 *    one picks To. Both always hold a value (seeded from the current range), so
 *    you can never end up with "only a from".
 *  - A quick-choice rail on the left with the same presets as the header, applied
 *    in one click.
 *  - Nothing commits until you hit Apply (or click a preset) - no popover slamming
 *    shut mid-pick.
 *  - Double-click a day → collapse the range to that single day (fast "just this
 *    day" selection).
 *  - Guards keep From ≤ To automatically (picking a From after To drags To with
 *    it, and vice-versa).
 */
export function DateRangePicker({ startDate, endDate, onChange, maxDate }: Props) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<Date>(startDate)
  const [to, setTo] = useState<Date>(endDate)
  const [fromMonth, setFromMonth] = useState<Date>(startDate)
  const [toMonth, setToMonth] = useState<Date>(endDate)
  const lastClick = useRef<{ side: "from" | "to"; ms: number; at: number } | null>(null)

  const presets = getDatePresets()

  // Re-seed the pending selection from the committed range every time the
  // popover opens, so an aborted edit (Cancel / click-away) is discarded.
  function reseed() {
    setFrom(startDate)
    setTo(endDate)
    setFromMonth(startDate)
    setToMonth(endDate)
    lastClick.current = null
  }

  function pick(side: "from" | "to", day: Date | undefined, modifiers: { disabled?: boolean }) {
    if (!day || modifiers.disabled) return
    const ms = startOfDay(day).getTime()
    const now = Date.now()
    const isDouble =
      lastClick.current?.side === side &&
      lastClick.current?.ms === ms &&
      now - (lastClick.current?.at ?? 0) < DOUBLE_CLICK_MS
    lastClick.current = isDouble ? null : { side, ms, at: now }

    if (isDouble) {
      // Double-click a single day → collapse the whole range to that one day.
      setFrom(day)
      setTo(day)
      setFromMonth(day)
      setToMonth(day)
      return
    }
    if (side === "from") {
      setFrom(day)
      setFromMonth(day)
      if (isAfter(day, to)) {
        setTo(day)
        setToMonth(day)
      }
    } else {
      setTo(day)
      setToMonth(day)
      if (isBefore(day, from)) {
        setFrom(day)
        setFromMonth(day)
      }
    }
  }

  function apply() {
    // Defensive normalise: from is never after to even if state briefly diverged.
    const start = isAfter(from, to) ? to : from
    const end = isAfter(from, to) ? from : to
    onChange(start, end)
    setOpen(false)
  }

  function applyPreset(range: { startDate: Date; endDate: Date }) {
    onChange(range.startDate, range.endDate)
    setOpen(false)
  }

  const activePreset = presets.find((p) => {
    const r = p.getRange()
    return isSameDay(r.startDate, from) && isSameDay(r.endDate, to)
  })?.label

  const disabledProp = maxDate ? { disabled: { after: maxDate } } : {}

  return (
    <Popover.Root
      // `modal` ensures the popover gets its own interaction layer when mounted
      // inside another modal (client slide-over Dialog) - without it the Portal
      // renders outside the Dialog tree and the modal layer swallows all clicks.
      modal
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) reseed()
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
        <Popover.Positioner sideOffset={6} align="start" className="z-[70]">
          <Popover.Popup
            className={cn(
              "rdp-popup bg-card border border-border rounded-lg shadow-lg outline-none overflow-hidden",
              "max-w-[calc(100vw-1rem)]",
            )}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                apply()
              }
            }}
          >
            <div className="flex flex-col sm:flex-row">
              {/* Quick-choice rail - same presets as the header, one-click apply. */}
              <div className="flex sm:flex-col gap-0.5 p-2 sm:border-r border-b sm:border-b-0 border-border sm:min-w-[136px] overflow-x-auto">
                <span className="hidden sm:block px-2 pt-1 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                  Quick ranges
                </span>
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(p.getRange())}
                    className={cn(
                      "text-left text-xs px-2.5 py-1.5 rounded-md whitespace-nowrap transition-colors",
                      "hover:bg-muted/60",
                      activePreset === p.label
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* From / To calendars. Left = From, right = To. */}
              <div className="p-3">
                <div className="flex flex-col sm:flex-row gap-3 sm:gap-5">
                  <FieldColumn label="From" value={from}>
                    <DayPicker
                      mode="single"
                      selected={from}
                      month={fromMonth}
                      onMonthChange={setFromMonth}
                      onDayClick={(day, modifiers) => pick("from", day, modifiers)}
                      weekStartsOn={1}
                      showOutsideDays
                      className="rdp-rl"
                      {...disabledProp}
                    />
                  </FieldColumn>
                  <FieldColumn label="To" value={to}>
                    <DayPicker
                      mode="single"
                      selected={to}
                      month={toMonth}
                      onMonthChange={setToMonth}
                      onDayClick={(day, modifiers) => pick("to", day, modifiers)}
                      weekStartsOn={1}
                      showOutsideDays
                      className="rdp-rl"
                      // The To calendar can't select before From.
                      disabled={
                        maxDate
                          ? [{ before: from }, { after: maxDate }]
                          : { before: from }
                      }
                    />
                  </FieldColumn>
                </div>

                {/* Footer: live preview of the pending range + commit. */}
                <div className="flex items-center justify-between gap-3 pt-2.5 mt-1 border-t border-border">
                  <span className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{formatLabel(from, to)}</span>
                    <span className="hidden md:inline"> · double-click a day for a single day</span>
                  </span>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={apply}>
                      Apply
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** A labelled calendar column: the "From"/"To" header chip showing the current
 *  pending value, above its calendar. Makes it unambiguous which side is which. */
function FieldColumn({ label, value, children }: { label: string; value: Date; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2 px-1 pb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">{label}</span>
        <span className="text-xs font-semibold text-foreground tabular-nums">{format(value, "d MMM yyyy")}</span>
      </div>
      {children}
    </div>
  )
}
