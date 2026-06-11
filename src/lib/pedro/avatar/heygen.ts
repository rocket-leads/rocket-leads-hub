import type {
  AvatarProvider,
  AvatarRenderInput,
  AvatarRenderJob,
} from "@/lib/pedro/avatar/types"

/**
 * Heygen provider - STUB IMPLEMENTATION.
 *
 * Heygen has a real REST API (https://api.heygen.com/v2/...) for
 * generating avatar videos from text. This stub describes the call
 * shapes Pedro needs without making the actual requests yet - keeps
 * the abstraction layer compileable while we firm up:
 *
 *  1. Which Heygen account RL uses (single-org or per-client?)
 *  2. Whether avatars are RL-shared or per-client custom-trained
 *  3. Storage destination for finished videos (Google Drive client
 *     folder vs internal Supabase Storage bucket)
 *  4. Webhook for completion vs polling (we default to polling for
 *     simplicity in MVP)
 *
 * To turn this on:
 *  - Save the Heygen API key in Settings → API Tokens (already wired)
 *  - Replace the `throw` calls below with `fetch()` to Heygen's
 *    /v2/video/generate, /v2/video_status.get, /v2/avatars endpoints
 *  - Wire pollStatus into a setTimeout / cron loop that flips
 *    pedro_avatar_jobs.status when Heygen reports succeeded/failed
 *
 * See PEDRO_VISION.md "AI Avatar Workflow" for the full architecture.
 */
export class HeygenProvider implements AvatarProvider {
  readonly id = "heygen" as const
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(private readonly apiKey: string) {}

  async startRender(_input: AvatarRenderInput): Promise<AvatarRenderJob> {
    throw new Error(
      "HeygenProvider.startRender not yet implemented - see lib/pedro/avatar/heygen.ts comment block",
    )
  }

  async pollStatus(_externalJobId: string): Promise<AvatarRenderJob> {
    throw new Error(
      "HeygenProvider.pollStatus not yet implemented - see lib/pedro/avatar/heygen.ts comment block",
    )
  }

  async listAvatars(): Promise<Array<{ id: string; name: string; previewUrl?: string }>> {
    // Returning [] is safe for now - Pedro UI shows "configure Heygen
    // first" until this returns real data.
    return []
  }
}
