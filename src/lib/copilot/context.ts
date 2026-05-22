/**
 * Page context for the co-pilot. Captured client-side from the current
 * pathname + selected client (if any) and sent to /api/copilot/parse so
 * the LLM can resolve phrases like "this client" or "here" without the
 * user spelling things out.
 */

export type CopilotPageContext = {
  pathname: string
  /** Monday item ID when the user is on a client detail page. */
  currentClientId: string | null
  /** Active tab when on a client detail page (campaigns/billing/etc.). */
  currentClientTab: string | null
}

const CLIENT_DETAIL_RE = /^\/clients\/([^/?#]+)/

export function buildPageContext(
  pathname: string,
  searchParams: URLSearchParams | null,
): CopilotPageContext {
  let currentClientId: string | null = null
  let currentClientTab: string | null = null

  const detailMatch = pathname.match(CLIENT_DETAIL_RE)
  if (detailMatch) {
    currentClientId = decodeURIComponent(detailMatch[1])
    currentClientTab = searchParams?.get("tab") ?? null
  } else if (pathname.startsWith("/clients") && searchParams?.get("client")) {
    // Slide-over panel: /clients?client=<id>
    currentClientId = searchParams.get("client")
    currentClientTab = searchParams.get("tab") ?? null
  }

  return { pathname, currentClientId, currentClientTab }
}
