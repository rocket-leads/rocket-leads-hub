/**
 * Strip HTML tags and decode common entities to plain text.
 *
 * Used by webhook ingesters (Monday in particular sends update bodies as
 * rich HTML with mention anchors). Anchor text is preserved by virtue of
 * the regex only removing the tags, so `<a ...>@Arno Vosters</a>` becomes
 * `@Arno Vosters` - which is exactly what we want to surface in inbox rows.
 *
 * For full HTML email bodies (Trengo's `/messages` returns these for any
 * mail with a real client), we also need to nuke the contents of
 * `<style>`, `<script>`, `<head>` and `<link>` blocks - otherwise the
 * CSS / Google Fonts `@import` URLs survive the tag-only strip and the
 * chat bubble renders "family=Inter:wght@100;200;300;…" garbage at the
 * top of the body (Roy 2026-06-12 screenshot of the Saxo confirmation
 * mail). And the leftover URL-only parens that Trengo emits from
 * `<a href="X">text</a>` -> `text (X)` get collapsed to just the text.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  return html
    // 1. Nuke whole blocks whose CONTENT (not just tag) is noise.
    //    Order matters: do these before the generic tag-strip so the
    //    inner text gets discarded with the wrapper.
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
    // 2. Convert structural tags to whitespace before stripping the
    //    rest, so paragraph + line-break boundaries survive as spaces
    //    in the resulting plain text.
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    // 3. Strip every remaining tag, preserving inner text.
    .replace(/<[^>]+>/g, "")
    // 4. Defensive truncation guard: a 100-char title cap sometimes
    //    lopped a row off mid-tag (`<a class="..." href="...st…`); the
    //    full-tag regex won't touch that - no closing `>`. Drop
    //    everything from a dangling `<` to end-of-string. Anchored at
    //    end so a stray `<3` in body text doesn't get clobbered.
    .replace(/<[^>]*$/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // 5. Trengo's email-to-text renderer emits `text (https://…)` for
    //    every anchor. For asset-/font-/tracking-style URLs (Google
    //    Fonts, social-icon links, copyright pages, deep article
    //    URLs) the URL adds noise without value - the visible text
    //    next to it is what the AM reads. Drop the parenthesized URL
    //    and let the surrounding text stand on its own. Conservative
    //    regex: only matches `(http(s)://…)` so plain prose with
    //    parens stays intact.
    .replace(/\s?\(https?:\/\/[^\s)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
