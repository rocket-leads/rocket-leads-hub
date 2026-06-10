"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Loader2, AlertTriangle, Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * InlineEditField — click-to-edit text without a separate edit mode.
 *
 * Roy 2026-06-10: weg met de aparte "Bewerk" knop met potloodje
 * rechtsboven. Elk veld in de variant card moet direct klikbaar zijn,
 * inline edit, auto-save op blur.
 *
 * UX:
 *  - Display mode: tekst met subtiele hover-state (light bg op hover).
 *  - Click → switch naar textarea/input. Focus auto.
 *  - Blur → save via callback. Spinner tijdens save.
 *  - On save fail: rode rand + tooltip; tekst blijft editable zodat
 *    de CM kan retryen.
 *  - Escape → cancel + revert naar laatst-opgeslagen waarde.
 *  - Cmd/Ctrl+Enter → save + blur.
 *  - Empty allowed only when `allowEmpty=true`. Otherwise blur with
 *    empty value reverts.
 */

type Props = {
  value: string
  onSave: (next: string) => Promise<void>
  /** Visual variant. `single` renders an input (no line breaks);
   *  `multi` renders an autosized textarea. */
  variant?: "single" | "multi"
  /** Placeholder text when empty. */
  placeholder?: string
  /** Min rows for textarea variant. */
  minRows?: number
  /** Max chars enforced client-side (matches server cap). */
  maxLength?: number
  /** Allow saving empty values (= clearing the field). Default false. */
  allowEmpty?: boolean
  /** Visual style hooks. */
  className?: string
  /** Optional disabled state — read-only when true. */
  disabled?: boolean
}

export function InlineEditField({
  value,
  onSave,
  variant = "multi",
  placeholder = "(leeg — klik om te bewerken)",
  minRows = 1,
  maxLength,
  allowEmpty = false,
  className,
  disabled = false,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  // Tracks the most recent committed value — used to revert on Escape
  // and skip save when nothing changed.
  const committedRef = useRef(value)

  // Stay in sync with parent prop changes when not editing (e.g. after
  // a remote refresh of the variant data).
  useEffect(() => {
    if (!editing) {
      committedRef.current = value
      setDraft(value)
    }
  }, [value, editing])

  // Auto-focus on edit-enter + auto-size textarea.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (variant === "multi" && inputRef.current instanceof HTMLTextAreaElement) {
        autoSize(inputRef.current)
      }
    }
  }, [editing, variant])

  const startEdit = useCallback(() => {
    if (disabled || saving) return
    setError(null)
    setDraft(committedRef.current)
    setEditing(true)
  }, [disabled, saving])

  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraft(committedRef.current)
    setError(null)
  }, [])

  const commit = useCallback(async () => {
    if (saving) return
    const next = draft.trim()
    const prev = committedRef.current.trim()
    // No change → just exit edit mode.
    if (next === prev) {
      setEditing(false)
      return
    }
    if (!allowEmpty && !next) {
      // Revert to committed value rather than wipe.
      setDraft(committedRef.current)
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      committedRef.current = next
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1200)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt")
      // Keep editing open so the CM can retry.
    } finally {
      setSaving(false)
    }
  }, [draft, saving, allowEmpty, onSave])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        cancelEdit()
        return
      }
      if (e.key === "Enter") {
        if (variant === "single" || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          void commit()
        }
      }
    },
    [variant, commit, cancelEdit],
  )

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setDraft(e.target.value)
      if (variant === "multi" && e.target instanceof HTMLTextAreaElement) {
        autoSize(e.target)
      }
    },
    [variant],
  )

  if (!editing) {
    const isEmpty = !value || !value.trim()
    return (
      <button
        type="button"
        onClick={startEdit}
        disabled={disabled}
        title="Klik om te bewerken"
        className={cn(
          "block w-full text-left rounded px-1.5 -mx-1.5 py-0.5 transition-colors",
          "hover:bg-accent/30",
          isEmpty && "text-muted-foreground/50 italic",
          savedFlash && "bg-emerald-500/10",
          disabled && "opacity-60 cursor-not-allowed hover:bg-transparent",
          className,
        )}
      >
        <span className="whitespace-pre-wrap break-words">
          {isEmpty ? placeholder : value}
        </span>
        {savedFlash && (
          <Check className="inline-block h-3 w-3 ml-1.5 text-emerald-600 dark:text-emerald-400" />
        )}
      </button>
    )
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        {variant === "multi" ? (
          <textarea
            ref={(el) => {
              inputRef.current = el
            }}
            value={draft}
            onChange={onChange}
            onBlur={commit}
            onKeyDown={onKeyDown}
            rows={minRows}
            disabled={saving}
            maxLength={maxLength}
            className={cn(
              "w-full text-sm rounded-md border bg-background px-2 py-1.5 -mx-0.5 resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
              error ? "border-red-500/50" : "border-border",
              className,
            )}
          />
        ) : (
          <input
            ref={(el) => {
              inputRef.current = el
            }}
            type="text"
            value={draft}
            onChange={onChange}
            onBlur={commit}
            onKeyDown={onKeyDown}
            disabled={saving}
            maxLength={maxLength}
            className={cn(
              "w-full text-sm rounded-md border bg-background px-2 h-9 -mx-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
              error ? "border-red-500/50" : "border-border",
              className,
            )}
          />
        )}
        {saving && (
          <Loader2 className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <div className="text-[11px] text-red-600 dark:text-red-400 inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          {error}
        </div>
      )}
    </div>
  )
}

function autoSize(el: HTMLTextAreaElement): void {
  el.style.height = "auto"
  el.style.height = `${Math.max(el.scrollHeight, 36)}px`
}
