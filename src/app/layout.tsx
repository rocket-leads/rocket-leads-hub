import type { Metadata } from "next"
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${clashGrotesk.variable} h-full antialiased dark`} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  )
}
