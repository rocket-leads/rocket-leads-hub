"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Hub button system — herMon-style primary/secondary split.
 *
 *   default   = solid brand-purple, white text — the only call-to-action
 *               variant. Use sparingly per surface (1-2 max) so it stays
 *               loud.
 *   secondary = white card-coloured background + visible border + dark
 *               text — the workhorse "neutral action" (Filter, Edit, etc.).
 *               Reads as a button without competing with the primary.
 *   outline   = same as secondary, kept for back-compat with old call sites.
 *   ghost     = transparent, no border, hover-only tint — for tertiary
 *               actions (close buttons, icon-only nav).
 *   destructive = subtle red tint, reserved for delete confirms.
 *   link      = inline text link, no chrome.
 *
 * Rounding is `rounded-xl` (~12px after the radius bump) so they sit in the
 * same visual family as Card. `font-medium` + `text-sm` is the default
 * weight across every size — keeps the visual ribbon tidy.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/92 [a]:hover:bg-primary/92",
        outline:
          "border-border bg-card text-foreground shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] hover:bg-muted/40 hover:border-border aria-expanded:bg-muted/40 aria-expanded:text-foreground",
        secondary:
          "border-border bg-card text-foreground shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)] hover:bg-muted/40 hover:border-border aria-expanded:bg-muted/40 aria-expanded:text-foreground",
        ghost:
          "hover:bg-muted/50 hover:text-foreground aria-expanded:bg-muted/50 aria-expanded:text-foreground dark:hover:bg-muted/40",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 rounded-lg px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-[0.9375rem] has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-lg in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-lg in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
