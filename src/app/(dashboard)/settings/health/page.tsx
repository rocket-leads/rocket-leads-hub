import { redirect } from "next/navigation"

// Health page merged into Settings as a tab on 2026-05-21. Keep this route
// as a forwarding stub so existing bookmarks and the old "Health →" link
// continue to work.
export default async function HealthRedirect() {
  redirect("/settings?tab=health")
}
