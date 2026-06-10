"use client"

import { useState } from "react"
import { ExternalLink, Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Three-path picker for the Meta BM onboarding guide. The client picks
 * which scenario applies to them and the matching panel expands with
 * step-by-step instructions + Meta deep-links.
 *
 * Manual instructions until Sprint 6 swaps in the Embedded Signup
 * "Connect with Meta" button. The component will absorb the swap-in
 * without restructuring — the button just becomes a new "Path 0" above
 * the three manual paths, defaulted open.
 */

type Path = "no_bm" | "bm_no_account" | "ready_for_partner"

export function MetaOnboardGuide() {
  const [open, setOpen] = useState<Path | null>(null)

  return (
    <div className="space-y-3">
      <PathCard
        id="no_bm"
        title="Ik heb nog geen Business Manager"
        subtitle="Geen probleem — we maken er samen één aan."
        open={open === "no_bm"}
        onToggle={() => setOpen(open === "no_bm" ? null : "no_bm")}
      >
        <Steps>
          <Step n={1}>
            Open{" "}
            <ExtLink href="https://business.facebook.com/overview">
              business.facebook.com
            </ExtLink>{" "}
            en log in met je persoonlijke Facebook-account. (Don't worry:
            dat wordt geen "zakelijk" account, je gebruikt het alleen om de
            BM te beheren.)
          </Step>
          <Step n={2}>
            Klik op <Kbd>Create Account</Kbd> rechtsboven. Vul je
            bedrijfsnaam, naam, en zakelijk e-mailadres in.
          </Step>
          <Step n={3}>
            Bevestig je e-mailadres via de mail die je krijgt.
          </Step>
          <Step n={4}>
            Klaar! Ga nu door naar het volgende scenario hieronder — we
            moeten nog een ad account aanmaken in je BM en Rocket Leads
            als partner toevoegen.
          </Step>
        </Steps>
      </PathCard>

      <PathCard
        id="bm_no_account"
        title="Ik heb een BM, maar nog geen ad account erin"
        subtitle="In 2 minuten geregeld."
        open={open === "bm_no_account"}
        onToggle={() => setOpen(open === "bm_no_account" ? null : "bm_no_account")}
      >
        <Steps>
          <Step n={1}>
            Open je BM in{" "}
            <ExtLink href="https://business.facebook.com/settings/ad-accounts">
              Business Settings → Ad Accounts
            </ExtLink>
            .
          </Step>
          <Step n={2}>
            Klik <Kbd>Add</Kbd> → <Kbd>Create a new ad account</Kbd>. Geef
            het een herkenbare naam (bv. je bedrijfsnaam), kies tijdzone{" "}
            <strong>Europe/Amsterdam</strong> en valuta <strong>EUR</strong>.
          </Step>
          <Step n={3}>
            Bij "Used for", selecteer <Kbd>My business</Kbd>.
          </Step>
          <Step n={4}>
            Voeg een betaalmethode toe (creditcard of automatische
            incasso) onder <Kbd>Payment Methods</Kbd>.
          </Step>
          <Step n={5}>
            Ga door naar het laatste scenario hieronder om Rocket Leads als
            partner toe te voegen.
          </Step>
        </Steps>
      </PathCard>

      <PathCard
        id="ready_for_partner"
        title="Ik ben klaar om Rocket Leads als partner toe te voegen"
        subtitle="De laatste stap."
        open={open === "ready_for_partner"}
        onToggle={() =>
          setOpen(open === "ready_for_partner" ? null : "ready_for_partner")
        }
      >
        <Steps>
          <Step n={1}>
            Open{" "}
            <ExtLink href="https://business.facebook.com/settings/partners">
              Business Settings → Partners
            </ExtLink>
            .
          </Step>
          <Step n={2}>
            Klik <Kbd>Add</Kbd> → <Kbd>Give a partner access to your assets</Kbd>.
          </Step>
          <Step n={3}>
            Vul ons Business Manager ID in:{" "}
            <span className="font-mono font-semibold text-foreground bg-muted px-2 py-0.5 rounded">
              1234567890
            </span>
            <span className="text-xs text-muted-foreground ml-2">
              (Vraag je AM om het juiste ID als bovenstaande niet klopt)
            </span>
          </Step>
          <Step n={4}>
            Selecteer onder <strong>Ad Accounts</strong> het ad account dat
            we gaan gebruiken → geef ons{" "}
            <strong>Manage campaigns</strong> + <strong>View performance</strong>{" "}
            rechten.
          </Step>
          <Step n={5}>
            Selecteer onder <strong>Pages</strong> je Facebook-pagina en
            geef ons <strong>Create content</strong> + <strong>Advertise</strong>{" "}
            rechten.
          </Step>
          <Step n={6}>
            Klik <Kbd>Save changes</Kbd>. Wij krijgen automatisch een
            notificatie en accepteren binnen 1 werkdag.
          </Step>
        </Steps>
        <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs flex items-start gap-2">
          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span className="text-emerald-700 dark:text-emerald-300">
            Daarna ben je klaar. Laat het je accountmanager weten dat je dit
            hebt afgerond.
          </span>
        </div>
      </PathCard>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function PathCard({
  id: _id,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  id: Path
  title: string
  subtitle: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
      >
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-5 pb-5 border-t border-border/40 pt-4">{children}</div>}
    </div>
  )
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-3 text-sm leading-relaxed">{children}</ol>
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold tabular-nums">
        {n}
      </span>
      <span className="text-foreground/90 pt-0.5">{children}</span>
    </li>
  )
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-primary transition-colors"
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-medium rounded bg-muted border border-border/60 font-mono">
      {children}
    </kbd>
  )
}
