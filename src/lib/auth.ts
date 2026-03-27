import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import { createAdminClient } from "@/lib/supabase/server"

const ALLOWED_DOMAIN = "rocketleads.com"
const ALLOWED_EMAILS = [
  "rocketleadsnl@gmail.com",
  "rocketleadshq@gmail.com",
]

function isAllowed(email: string): boolean {
  if (ALLOWED_EMAILS.includes(email)) return true
  const domain = email.split("@")[1]
  return domain === ALLOWED_DOMAIN
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
      if (!isAllowed(email)) return false

      // Upsert user in Supabase
      try {
        const supabase = await createAdminClient()
        const { error } = await supabase.from("users").upsert(
          {
            email,
            name: user.name ?? "",
          },
          { onConflict: "email", ignoreDuplicates: true }
        )
        if (error) console.error("Supabase upsert error:", error)
      } catch (err) {
        console.error("Failed to upsert user:", err)
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
