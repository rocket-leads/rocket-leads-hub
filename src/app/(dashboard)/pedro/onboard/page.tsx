import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { loadPedroClients } from "../_components/load-clients"
import { PedroOnboardApp } from "../_components/pedro-onboard-app"

export const dynamic = "force-dynamic"
export const metadata = { title: "Pedro · On-board — Rocket Leads Hub" }

export default async function PedroOnboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const clients = await loadPedroClients({
    userId: session.user.id,
    role: session.user.role,
  })

  return <PedroOnboardApp clients={clients} />
}
