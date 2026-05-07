import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

interface SavedResearch {
  id: string
  branche: string
  klantnaam: string
  label: string
  doelgroep: string
  propositie: string
  extraContext: string
  research: unknown
  savedAt: string
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").substring(0, 60)
}

// GET /api/pedro/research/library — list all saved research entries
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("pedro_research")
      .select("*")
      .order("saved_at", { ascending: false })
    if (error) throw error

    const items: SavedResearch[] = (data ?? []).map((r) => ({
      id: r.id,
      branche: r.branche ?? "",
      klantnaam: r.klantnaam ?? "",
      label: r.label ?? "",
      doelgroep: r.doelgroep ?? "",
      propositie: r.propositie ?? "",
      extraContext: r.extra_context ?? "",
      research: r.research,
      savedAt: r.saved_at,
    }))

    return NextResponse.json({ items })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// POST /api/pedro/research/library — save a research entry
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const body = await req.json()
    const { branche, klantnaam, label, doelgroep, propositie, extraContext, research } = body

    if (!research || !branche) {
      return NextResponse.json({ error: "Branche en research zijn verplicht" }, { status: 400 })
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const slugBranche = slugify(branche)
    const slugLabel = slugify(klantnaam || label || "research")
    const id = `${slugBranche}__${slugLabel}__${stamp}`
    const savedAt = new Date().toISOString()

    const supabase = await createAdminClient()
    const { error } = await supabase.from("pedro_research").insert({
      id,
      branche,
      klantnaam: klantnaam || "",
      label: label || "",
      doelgroep: doelgroep || "",
      propositie: propositie || "",
      extra_context: extraContext || "",
      research,
      saved_at: savedAt,
    })
    if (error) throw error

    return NextResponse.json({ id, savedAt })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Save failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/pedro/research/library?id=... — delete a research entry
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const id = req.nextUrl.searchParams.get("id")
    if (!id) return NextResponse.json({ error: "id is verplicht" }, { status: 400 })

    const supabase = await createAdminClient()
    const { error } = await supabase.from("pedro_research").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Delete failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
