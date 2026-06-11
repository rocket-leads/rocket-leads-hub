import { NextResponse } from "next/server"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Migration drift detector - surfaces SQL files that exist in
 * `supabase/migrations/` but haven't been applied to the linked Supabase
 * project. Pairs with the Health tab so we never again ship a feature
 * that silently breaks because nobody ran the migration (see: empty
 * Users tab bug, 2026-05-21).
 *
 * Reads:
 *   - `supabase/migrations/*.sql` (in the deploy bundle / repo)
 *   - `supabase_migrations.schema_migrations.version` (what's actually
 *     applied; Supabase CLI writes one row per migration file).
 *
 * Pending = file exists but no schema_migrations row matches its
 * `<timestamp>` prefix. Admin-only.
 */
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // ── Files on disk ────────────────────────────────────────────────
  const migrationsDir = join(process.cwd(), "supabase", "migrations")
  let files: string[]
  try {
    files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort()
  } catch (e) {
    return NextResponse.json(
      { error: `Failed to read migrations dir: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // Each file is `<14-digit-version>_<slug>.sql`. The version prefix is
  // exactly what Supabase CLI writes into `schema_migrations.version`.
  const fileVersions = files.map((name) => ({
    file: name,
    version: name.slice(0, 14),
    label: name.replace(/^\d+_/, "").replace(/\.sql$/, ""),
  }))

  // ── Applied versions per Supabase ────────────────────────────────
  const supabase = await createAdminClient()
  const { data: applied, error: appliedError } = await supabase
    .schema("supabase_migrations")
    .from("schema_migrations")
    .select("version")

  if (appliedError) {
    return NextResponse.json(
      {
        error: `Failed to read schema_migrations: ${appliedError.message}`,
        hint: appliedError.hint,
      },
      { status: 500 },
    )
  }

  const appliedSet = new Set((applied ?? []).map((r) => r.version))
  const pending = fileVersions.filter((f) => !appliedSet.has(f.version))

  return NextResponse.json({
    totalFiles: fileVersions.length,
    appliedCount: appliedSet.size,
    pendingCount: pending.length,
    pending: pending.map((p) => ({ version: p.version, label: p.label, file: p.file })),
  })
}
