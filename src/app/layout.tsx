import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Inter } from "next/font/google"
import localFont from "next/font/local"
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/types"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
})

const clashGrotesk = localFont({
  src: [
    { path: "../fonts/ClashGrotesk-Medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ClashGrotesk-Semibold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/ClashGrotesk-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
  fallback: ["Inter", "sans-serif"],
})

export const metadata: Metadata = {
  title: "Rocket Leads Hub",
  description: "Rocket Leads Client Dashboard",
}

/**
 * Pre-React theme bootstrap. Runs synchronously before first paint to:
 *   1. Honour the `theme` cookie when present (user picked light/dark before)
 *   2. Otherwise mirror the OS preference via `prefers-color-scheme`
 *
 * Without this, a colleague who lands on the Hub for the first time always
 * gets light mode regardless of their system setting, and has to hunt for the
 * sidebar toggle to flip it. Inline so it can't be deferred / split into a
 * bundle that paints after first render - that would cause a white flash.
 *
 * The cookie-painted `dark` class on <html> (set below from the server) still
 * wins when a cookie is present; this script only kicks in for the unset
 * case.
 */
const themeInitScript = `(function(){try{
  var m=document.cookie.match(/(?:^|;\\s*)theme=([^;]+)/);
  var cookie=m?decodeURIComponent(m[1]):null;
  var dark=cookie==='dark'||(!cookie&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);
  var c=document.documentElement.classList;
  if(dark&&!c.contains('dark'))c.add('dark');
  if(!dark&&c.contains('dark')&&cookie==='light')c.remove('dark');
}catch(e){}})();`

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read both prefs from cookies. `theme` paints SSR dark/light when set;
  // `locale` drives <html lang> so screen readers + browser translation
  // prompts pick the right language.
  const cookieStore = await cookies()
  const themeCookie = cookieStore.get("theme")?.value
  const isDark = themeCookie === "dark"
  const localeCookie = cookieStore.get("locale")?.value
  const lang = isLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE

  // html intentionally has no fixed height - pinning it to `h-full` locks it
  // at exactly viewport height, which causes intermittent page-scroll bugs
  // when the body content overflows (browser falls back to body-scroll, which
  // is flaky after route changes + on touch). `min-h-screen` on body keeps
  // the background filling the viewport on short pages without capping html.
  return (
    <html
      lang={lang}
      className={`${inter.variable} ${clashGrotesk.variable} antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        {/* Raw <script dangerouslySetInnerHTML> - NOT <Script> from next/script.
            Next.js 16 only supports next/script for external src= URLs; using
            it for inline content triggers a "script tag inside React component
            won't execute" warning. The canonical App-Router pattern for inline
            theme bootstrap is the raw script tag (same as next-themes). Runs
            synchronously before React hydrates so the cold-start case (no
            cookie, OS prefers dark, SSR class is "light") is corrected before
            paint - no white flash. */}
        <script
          id="theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  )
}
