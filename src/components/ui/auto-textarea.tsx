"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Auto-growing textarea — same visual style as shadcn `Input` but
 * vertical, and the height tracks content automatically. No manual
 * drag-to-resize handle; users never see content cut off behind a
 * scrollbar because the field grows to fit.
 *
 * Why a wrapper instead of a CSS-only solution: textareas with
 * `field-sizing: content` only work on Chromium + Safari (no Firefox)
 * and don't give us control over minRows / maxRows. The ref-based
 * scrollHeight approach is one extra render but cross-browser stable.
 *
 *   <AutoTextarea
 *     value={...}
 *     onChange={...}
 *     placeholder="..."
 *     minRows={3}              // ≈ visual baseline
 *     maxRows={20}             // ceiling; scrollbar appears past this
 *   />
 */
type AutoTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows" | "style"> & {
  minRows?: number
  maxRows?: number
}

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea({ className, minRows = 3, maxRows = 20, value, defaultValue, onChange, ...rest }, forwardedRef) {
    const innerRef = React.useRef<HTMLTextAreaElement>(null)
    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement)

    const recompute = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      // Reset to a known small height so scrollHeight reflects content,
      // not the previous size. Reading clientHeight beforehand avoids
      // tiny layout flickers during fast typing.
      const previous = el.style.height
      el.style.height = "auto"
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20")
      const minH = lineHeight * minRows + 16 /* py-2 */
      const maxH = lineHeight * maxRows + 16
      const target = Math.min(Math.max(el.scrollHeight, minH), maxH)
      el.style.height = `${target}px`
      el.style.overflowY = el.scrollHeight > maxH ? "auto" : "hidden"
      if (previous === el.style.height) return
    }, [minRows, maxRows])

    // Resize when value changes externally (e.g. AI generation
    // streaming into the field) and once on mount.
    React.useLayoutEffect(() => {
      recompute()
    }, [recompute, value, defaultValue])

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      onChange?.(e)
      // Run on next frame so the value has been applied before
      // re-measuring; otherwise we re-measure stale content.
      requestAnimationFrame(recompute)
    }

    return (
      <textarea
        ref={innerRef}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        // Visual baseline matches shadcn Input: same border, radius,
        // padding, focus ring. The `resize-none` is intentional — the
        // auto-grow logic above handles sizing.
        className={cn(
          "w-full rounded-lg border border-input bg-transparent px-3.5 py-2 text-sm leading-snug transition-colors outline-none resize-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30",
          className,
        )}
        {...rest}
      />
    )
  },
)

export { AutoTextarea }
