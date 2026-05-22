"use server"

import { signOut } from "@/lib/auth"

/**
 * Server action wrapper around NextAuth's `signOut` so client components
 * (the sidebar user menu, for one) can wire a sign-out form without
 * having to live inside a server component to declare it inline.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/auth/signin" })
}
