/**
 * Pedro avatar pipeline - provider abstraction.
 *
 * Goal: Pedro stops at "writing the script" and instead delivers a
 * client-ready video. Provider implementations (Heygen, D-ID, custom)
 * conform to this interface so the rest of Pedro doesn't care which
 * vendor is wiring the actual rendering.
 *
 * Status (2026-05-08): scaffolding only. Heygen API key is configurable
 * via Settings → API Tokens. Implementation of `HeygenProvider` is the
 * next milestone - see PEDRO_VISION.md "AI Avatar Workflow" section
 * for the full architecture spec.
 */

export type AvatarProviderId = "heygen" | "did" | "custom"

export type AvatarRenderInput = {
  /** Hub client for whom this video is being made (provenance + storage). */
  clientId: string
  /** Which campaign cycle the script comes from. */
  campaignNumber: number
  /** Free-text title for the rendered output (becomes filename). */
  title: string
  /** Pedro-generated script (one of multiple from the script stage). */
  script: string
  /** Avatar identity to use. Provider-specific id (Heygen avatar id /
   *  D-ID actor id / etc.). Roy or the CM picks one per client. */
  avatarId: string
  /** Provider-specific voice id, optional. */
  voiceId?: string
  /** Aspect - drives the format dropdown the CM picks (9:16 reel,
   *  1:1 square, 16:9 horizontal). */
  aspect: "9:16" | "1:1" | "16:9"
}

export type AvatarRenderJob = {
  /** Provider's job/task identifier - used for status polling. */
  externalJobId: string
  provider: AvatarProviderId
  status: "queued" | "rendering" | "succeeded" | "failed"
  /** When succeeded: URL to the rendered video. */
  videoUrl?: string
  /** When failed: provider error message. */
  error?: string
  /** Pedro-side row id, when persistence is wired. */
  pedroJobId?: string
}

export interface AvatarProvider {
  readonly id: AvatarProviderId
  /** Triggers a render job. Returns the provider's job id immediately -
   *  rendering is async and takes minutes. */
  startRender(input: AvatarRenderInput): Promise<AvatarRenderJob>
  /** Poll a job's status. Pedro polls every 30s until terminal. */
  pollStatus(externalJobId: string): Promise<AvatarRenderJob>
  /** List avatars the configured account has access to - shown in the
   *  CM's "pick an avatar" dropdown. */
  listAvatars(): Promise<Array<{ id: string; name: string; previewUrl?: string }>>
}
