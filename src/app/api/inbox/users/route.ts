import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

/**
 * Lightweight user list for the inbox composer (assignee picker). Returns
 * everyone in the users table, sorted by name. Available to any signed-in
 * user - assignment doesn't grant access, so listing isn't sensitive.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, role")
    .order("name", { ascending: true, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ users: data ?? [] })
}
