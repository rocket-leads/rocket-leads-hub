import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { loadPedroClients } from "../pedro/_components/load-clients"
import { PedroOptimizeApp } from "../pedro/_components/pedro-optimize-app"

export const dynamic = "force-dynamic"
export const metadata = { title: "Optimaliseer - Rocket Leads Hub" }

/**
 * Top-level Optimaliseer route. Roy 2026-06-11: Pedro Optimize is uit
 * de Pedro group getild en heeft een eigen sidebar entry gekregen.
 * Hergebruikt de bestaande PedroOptimizeApp component met dezelfde
 * client loading; geen logica-wijziging onder de motorkap.
 */
export default async function OptimizePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const clients = await loadPedroClients({
    userId: session.user.id,
    role: session.user.role,
  })

  return <PedroOptimizeApp clients={clients} />
}
