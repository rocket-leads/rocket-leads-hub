import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { PedroChat } from "./_components/pedro-chat"

export const metadata = { title: "Pedro" }

export default async function PedroChatPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const canSeeFinance = session.user.role === "admin" || !!session.user.isFinance

  return <PedroChat userName={session.user.name ?? null} canSeeFinance={canSeeFinance} />
}
