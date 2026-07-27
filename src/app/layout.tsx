import type { Metadata } from "next"
import type { CSSProperties } from "react"
import { cookies } from "next/headers"
import { Inter, Schibsted_Grotesk, Instrument_Serif, Geist_Mono } from "next/font/google"
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/types"
import "./globals.css"

// Inter kept as a fallback face for legacy surfaces.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] })

// 187N design-system fonts. Schibsted Grotesk = display + UI, Instrument Serif
// = the italic emphasis phrases in sublines, Geist Mono = numbers + uppercase
// micro-labels. Wired to the --client-font-* / --f-serif vars in client.css.
const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
})
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  display: "swap",
})
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
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
  const cookieStore = await cookies()
  const localeCookie = cookieStore.get("locale")?.value
  const lang = isLocale(localeCookie) ? localeCookie : DEFAULT_LOCALE

  // Compact density via uniform CSS `zoom` (applied on <body> in globals.css),
  // so rem utilities and px-based 187N chrome shrink together and stay
  // consistent at any density. Forced here (not cookie-read) so a stale legacy
  // `ui-scale` cookie can't override it. Bump toward 1 for larger, down for denser.
  const htmlStyle = { "--ui-scale": "0.8" } as CSSProperties

  // data-theme="corporate" activates the 187N corporate signature (warm cream,
  // editorial type, coral→purple mark, chamfered black CTAs). Light-only — the
  // former dark-mode bootstrap + toggle are gone.
  return (
    <html
      lang={lang}
      data-theme="corporate"
      className={`${inter.variable} ${schibsted.variable} ${instrumentSerif.variable} ${geistMono.variable} antialiased`}
      style={htmlStyle}
      suppressHydrationWarning
    >
      {/* min-height is set (zoom-compensated) on `body` in globals.css - a
          Tailwind min-h-screen class here would override it uncompensated. */}
      <body className="bg-background text-foreground">{children}</body>
    </html>
  )
}
