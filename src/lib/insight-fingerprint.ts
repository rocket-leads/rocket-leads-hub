/**
 * Stable fingerprint for an AI-generated insight so we can dedupe across
 * regenerations and persist done/later/skip feedback against it.
 *
 * The AI may rephrase the same observation slightly between runs, so this
 * is not bulletproof — but combined with feeding the manager's verdict
 * back into the prompt, it gives the AI enough context to avoid surfacing
 * the same suggestion twice.
 *
 * Hashing happens via the Web Crypto API so this works in both edge and
 * node runtimes (and in browsers).
 */
export async function fingerprintInsight(input: {
  type: string
  title: string
}): Promise<string> {
  const normalized = `${input.type}|${input.title}`.toLowerCase().trim()
  const bytes = new TextEncoder().encode(normalized)
  const hashBuffer = await crypto.subtle.digest("SHA-1", bytes)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}
