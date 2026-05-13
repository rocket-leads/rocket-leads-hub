import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Inter } from "next/font/google"
import localFont from "next/font/local"
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Read the user's theme preference from a cookie at render time so the
  // <html> ships with the right `dark` class already applied — no flash, no
  // client-side bootstrap script, no React 19 / Next 16 "script tag inside
  // React component" warning. ThemeToggle keeps the cookie in sync.
  const themeCookie = (await cookies()).get("theme")?.value
  const isDark = themeCookie === "dark"

  // html intentionally has no fixed height — pinning it to `h-full` locks it
  // at exactly viewport height, which causes intermittent page-scroll bugs
  // when the body content overflows (browser falls back to body-scroll, which
  // is flaky after route changes + on touch). `min-h-screen` on body keeps
  // the background filling the viewport on short pages without capping html.
  return (
    <html
      lang="en"
      className={`${inter.variable} ${clashGrotesk.variable} antialiased${isDark ? " dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  )
}
