/**
 * Strip HTML tags and decode common entities to plain text.
 *
 * Used by webhook ingesters (Monday in particular sends update bodies as
 * rich HTML with mention anchors). Anchor text is preserved by virtue of
 * the regex only removing the tags, so `<a ...>@Arno Vosters</a>` becomes
 * `@Arno Vosters` — which is exactly what we want to surface in inbox rows.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, "")
    // Truncated input: rows stored before our ingest-time strip got a 100-
    // char title cap that sometimes lopped off in the middle of an HTML tag
    // (`<a class="..." href="...26220-st…`). The full-tag regex above won't
    // touch that — there's no closing `>`. Drop everything from a dangling
    // `<` to end-of-string so the user sees clean truncated text instead of
    // broken markup. Matches strictly at end so a stray `<3` in body text
    // doesn't get clobbered.
    .replace(/<[^>]*$/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}
