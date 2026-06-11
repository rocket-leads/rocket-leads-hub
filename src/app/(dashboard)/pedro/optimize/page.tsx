import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { loadPedroClients } from "../_components/load-clients"
import { PedroOptimizeApp } from "../_components/pedro-optimize-app"

export const dynamic = "force-dynamic"
export const metadata = { title: "Pedro · Optimize - Rocket Leads Hub" }

export default async function PedroOptimizePage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const clients = await loadPedroClients({
    userId: session.user.id,
    role: session.user.role,
  })

  return <PedroOptimizeApp clients={clients} />
}
