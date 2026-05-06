/* eslint-disable no-restricted-globals */

// Service worker for the Rocket Leads Hub — handles browser push events.
//
// Receives JSON payloads of shape:
//   { title: string, body: string, url?: string, tag?: string }
// shows a notification, and routes the user to `url` (defaults to /inbox)
// when they click it. We focus an existing tab if one's already open
// instead of opening a new one — less window clutter for AMs that already
// have the Hub up.

self.addEventListener("push", (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: "Rocket Leads", body: event.data.text() }
  }

  const title = payload.title || "Rocket Leads"
  const body = payload.body || ""
  const tag = payload.tag || undefined
  const url = payload.url || "/inbox"

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/logos/logo-white-purple.svg",
      badge: "/logos/logo-white-purple.svg",
      data: { url },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/inbox"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an existing Hub tab when one's open — focus it and navigate
      // there. Otherwise open a fresh tab.
      const origin = self.location.origin
      for (const client of clients) {
        if (client.url.startsWith(origin)) {
          client.navigate(url).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
