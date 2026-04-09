import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import type { NextAuthRequest } from "next-auth"

const PUBLIC_PATHS = ["/auth/signin", "/api/auth", "/api/cron/"]

export default auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl

  // Allow public paths through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Redirect unauthenticated users to sign-in
  if (!req.auth) {
    const signInUrl = new URL("/auth/signin", req.url)
    signInUrl.searchParams.set("callbackUrl", req.url)
    return NextResponse.redirect(signInUrl)
  }

  // Redirect root to /clients
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/clients", req.url))
  }

  // Protect /settings — admin only
  if (pathname.startsWith("/settings") && req.auth.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/clients", req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|logo.png).*)"],
}
