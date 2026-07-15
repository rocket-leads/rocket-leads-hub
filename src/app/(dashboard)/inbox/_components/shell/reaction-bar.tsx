"use client"

import { useState, useRef, useEffect } from "react"
import { SmilePlus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReactionSummary } from "@/lib/inbox/reactions"

/** The quick-pick set, mirroring Monday's reaction bar. Toggling any of these
 *  (or a already-present reaction chip) calls onToggle. */
const QUICK_EMOJI = ["👍", "👏", "🙏", "❤️", "😀", "✅", "🎉", "👀", "🔥"]

type Props = {
  reactions: ReactionSummary[]
  onToggle: (emoji: string) => void
}

export function ReactionBar({ reactions, onToggle }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [pickerOpen])

  return (
    <div className="flex flex-wrap items-center gap-1.5" ref={wrapRef}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 h-7 text-sm transition-colors",
            r.mine
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
          )}
          title={r.mine ? "Remove your reaction" : "React"}
        >
          <span className="leading-none">{r.emoji}</span>
          <span className="text-xs font-medium tabular-nums">{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Add reaction"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            pickerOpen && "bg-muted text-foreground",
          )}
        >
          <SmilePlus className="h-4 w-4" />
        </button>
        {pickerOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1.5 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-lg">
            {QUICK_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onToggle(emoji)
                  setPickerOpen(false)
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125 hover:bg-muted"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
