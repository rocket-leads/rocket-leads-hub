import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { createAdminClient } from "@/lib/supabase/server"

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
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      const email = user.email ?? ""
      if (!(await isAllowed(email))) return false

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
