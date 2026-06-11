"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Video,
  Clock,
  Users,
  Check,
  Loader2,
  ArrowRight,
  RefreshCw,
  FileText,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { cn } from "@/lib/utils"
import type { SerializedStep, WizardClient } from "../wizard-shell"

type Props = {
  step: SerializedStep
  mondayItemId: string
  client: WizardClient
  allSteps: SerializedStep[]
  locale: Locale
  nextKey: string | undefined
  onStepSaved: (nextStepKey?: string) => void
}

type Candidate = {
  id: string
  fathom_recording_id: string
  title: string | null
  scheduled_at: string | null
  duration_sec: number | null
  recording_url: string | null
  share_url: string | null
  attendees:
    | Array<{ name?: string; email?: string; is_external?: boolean }>
    | null
  summary: string | null
  link_status: string
  meeting_type: string | null
  match_score: number | null
}

type LinkedContent = {
  meetingId: string
  fathomRecordingId: string
  recordingUrl: string | null
  shareUrl: string | null
  transcriptLength: number
  summaryPresent: boolean
}

/**
 * Stap 2 - Fathom transcript link. AM picks which Fathom recording is
 * the kick-off for this client. Confidence pre-scoring already happened
 * in the Fathom webhook (match_candidates jsonb on each meeting row), so
 * this UI just surfaces what Fathom already suggested as the AM's most
 * likely candidates.
 *
 * Empty state ("transcript nog niet binnen") just means the Fathom
 * webhook hasn't fired yet - usually 5-15 min after meeting ends. AM
 * refreshes manually when they expect it to have landed.
 */
export function TranscriptLinkStep({
  step,
  mondayItemId,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  const queryClient = useQueryClient()
  const linkedContent = (step.content as LinkedContent | null) ?? null

  const candidatesQuery = useQuery<{ candidates: Candidate[] }>({
    queryKey: ["onboarding-transcript-candidates", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/onboarding/transcript`).then((r) => r.json()),
    // Only poll while step is open and not yet linked - once done, stop.
    refetchInterval: step.done ? false : 60 * 1000,
    enabled: !step.done,
  })

  const link = useMutation({
    mutationFn: async (vars: { meetingId: string }) => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Link failed")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-wizard", mondayItemId] })
      onStepSaved(nextKey)
    },
  })

  // ── Linked state - show what was linked + jump-to-next + "wijzigen" override ──
  if (step.done && linkedContent) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {t("onboarding.wizard.transcript.linked.title", locale)}
            </span>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-3 w-3" />
              <span>
                {linkedContent.summaryPresent
                  ? t("onboarding.wizard.transcript.linked.summary_yes", locale)
                  : t("onboarding.wizard.transcript.linked.summary_no", locale)}
                {linkedContent.transcriptLength > 0 && (
                  <> · {Math.round(linkedContent.transcriptLength / 1000)}k chars transcript</>
                )}
              </span>
            </div>
            {linkedContent.shareUrl && (
              <a
                href={linkedContent.shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t("onboarding.wizard.transcript.linked.open_fathom", locale)}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Unlink - revert step done state so the AM can pick again.
              // We don't actively unlink the meeting from Supabase (that
              // would force re-ingest); we just re-open the step.
              void fetch(`/api/clients/${mondayItemId}/onboarding`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  stepKey: step.key,
                  done: false,
                  content: null,
                }),
              }).then(() => {
                queryClient.invalidateQueries({
                  queryKey: ["onboarding-wizard", mondayItemId],
                })
              })
            }}
          >
            {t("onboarding.wizard.transcript.change", locale)}
          </Button>
        </div>
      </div>
    )
  }

  const candidates = candidatesQuery.data?.candidates ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {t("onboarding.wizard.transcript.hint", locale)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => candidatesQuery.refetch()}
          disabled={candidatesQuery.isFetching}
          className="gap-1 text-xs"
        >
          <RefreshCw
            className={cn(
              "h-3 w-3",
              candidatesQuery.isFetching && "animate-spin",
            )}
          />
          {t("onboarding.wizard.transcript.refresh", locale)}
        </Button>
      </div>

      {candidatesQuery.isLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("onboarding.wizard.transcript.loading", locale)}
        </div>
      )}

      {!candidatesQuery.isLoading && candidates.length === 0 && (
        <div className="rounded-xl border border-border/60 bg-card/50 px-5 py-10 text-center">
          <Video className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <h3 className="text-sm font-medium mb-1">
            {t("onboarding.wizard.transcript.empty.title", locale)}
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {t("onboarding.wizard.transcript.empty.body", locale)}
          </p>
        </div>
      )}

      {candidates.length > 0 && (
        <ul className="space-y-2">
          {candidates.map((c, idx) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              isTop={idx === 0}
              pending={link.isPending && link.variables?.meetingId === c.id}
              onUse={() => link.mutate({ meetingId: c.id })}
              locale={locale}
            />
          ))}
        </ul>
      )}

      {link.isError && (
        <div className="text-xs text-destructive">
          {link.error instanceof Error ? link.error.message : "Link failed"}
        </div>
      )}
    </div>
  )
}

function CandidateRow({
  candidate,
  isTop,
  pending,
  onUse,
  locale,
}: {
  candidate: Candidate
  isTop: boolean
  pending: boolean
  onUse: () => void
  locale: Locale
}) {
  const date = candidate.scheduled_at ? new Date(candidate.scheduled_at) : null
  const duration = candidate.duration_sec
    ? `${Math.round(candidate.duration_sec / 60)} min`
    : null
  const externalCount =
    candidate.attendees?.filter((a) => a.is_external).length ?? 0
  const externalNames = (candidate.attendees ?? [])
    .filter((a) => a.is_external)
    .map((a) => a.name || a.email)
    .slice(0, 2)
    .join(", ")

  return (
    <li
      className={cn(
        "rounded-xl border bg-card/50 p-4 transition-colors",
        isTop ? "border-primary/40 bg-primary/5" : "border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h4 className="text-sm font-medium truncate">
              {candidate.title || t("onboarding.wizard.transcript.untitled", locale)}
            </h4>
            {isTop && (
              <span className="inline-flex items-center rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-medium">
                {t("onboarding.wizard.transcript.most_likely", locale)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
            {date && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {date.toLocaleString(locale === "en" ? "en-GB" : "nl-NL", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {duration && <> · {duration}</>}
              </span>
            )}
            {externalCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {externalNames || `${externalCount} external`}
              </span>
            )}
          </div>
        </div>
        <Button
          size="sm"
          onClick={onUse}
          disabled={pending}
          className="gap-1.5 shrink-0"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          {t("onboarding.wizard.transcript.use_this", locale)}
        </Button>
      </div>
      {candidate.summary && (
        <p className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-1">
          {candidate.summary}
        </p>
      )}
    </li>
  )
}
