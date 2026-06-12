import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { createAdminClient } from "@/lib/supabase/server"
import { encrypt } from "@/lib/encryption"

async function isAllowed(email: string): Promise<boolean> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle()
  return !!data
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Calendar.readonly is added so the Hub Calendar page can read each
      // user's primary Google Calendar server-side. offline + consent are
      // mandatory to receive a refresh_token (Google only hands one out on
      // explicit consent; without it we'd have to bounce the user back to
      // sign-in every hour when the access_token expires).
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      const email = user.email ?? ""
      if (!(await isAllowed(email))) return false

      // Persist the OAuth tokens so the Calendar integration can call
      // Google Calendar v3 with the user's identity later. Encrypted with
      // the same AES-256-GCM helper as api_tokens. Google only includes
      // refresh_token on the first consent — preserve any existing one
      // when a later sign-in omits it (e.g. the user re-signed-in without
      // a full consent screen).
      if (account?.provider === "google" && account.access_token) {
        try {
          const supabase = await createAdminClient()
          const expiresAt =
            typeof account.expires_at === "number"
              ? new Date(account.expires_at * 1000).toISOString()
              : null
          const update: Record<string, string | null> = {
            google_access_token: encrypt(account.access_token),
            google_token_expires_at: expiresAt,
          }
          if (account.refresh_token) {
            update.google_refresh_token = encrypt(account.refresh_token)
          }
          const { error } = await supabase
            .from("users")
            .update(update)
            .eq("email", email)
          if (error) console.error("Supabase Google token persist error:", error)
        } catch (err) {
          console.error("Failed to persist Google OAuth tokens:", err)
        }
      }

      // Backfill name from the Google profile when the row was pre-created by
      // inviteUser (which leaves name NULL) and the admin hasn't typed one in
      // manually. Don't overwrite an existing name - admins can edit it in
      // Settings → Users and we shouldn't clobber their edit.
      const googleName = user.name?.trim()
      if (googleName) {
        try {
          const supabase = await createAdminClient()
          const { error } = await supabase
            .from("users")
            .update({ name: googleName })
            .eq("email", email)
            .or("name.is.null,name.eq.")
          if (error) console.error("Supabase name backfill error:", error)
        } catch (err) {
          console.error("Failed to backfill user name:", err)
        }
      }

      return true
    },

    async session({ session }) {
      if (!session.user?.email) return session

      try {
        const supabase = await createAdminClient()
        const { data } = await supabase
          .from("users")
          .select("id, role")
          .eq("email", session.user.email)
          .single()

        if (data) {
          session.user.id = data.id
          session.user.role = data.role

          // Detect the finance role from user_column_mappings - orthogonal to
          // the access role, so a finance person can still be a member or an
          // admin. Used by the sidebar to swap to a finance-tailored nav and
          // by gates that surface billing-only flows.
          const { data: financeRow } = await supabase
            .from("user_column_mappings")
            .select("user_id")
            .eq("user_id", data.id)
            .eq("monday_column_role", "finance")
            .maybeSingle()
          session.user.isFinance = !!financeRow
        }
      } catch (err) {
        console.error("Failed to load user role:", err)
      }

      return session
    },
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
})
