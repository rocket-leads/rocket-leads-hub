import { notFound } from "next/navigation"
import { fetchClientById } from "@/lib/integrations/monday"
import { auth } from "@/lib/auth"
import { getUserLocale } from "@/lib/i18n/server"
import { WizardShell } from "./_components/wizard-shell"

/**
 * Per-client onboarding wizard. Each AM walks through here after a
 * kick-off - the rail on the left shows the 7-step sequence, the right
 * pane renders the active step's own action UI (generate brief, create
 * Drive folder, compose onboarding email, …).
 *
 * State is fetched client-side via React Query against
 * /api/clients/[id]/onboarding so the wizard can refetch after each
 * mutation without a full page reload. The server-rendered shell only
 * needs the client name (header) + id (passed as a prop).
 */
export default async function OnboardingWizardPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await auth()
  if (!session) notFound()
  const locale = await getUserLocale(session.user?.id)

  // Server-side fetch of the basic client info - just to render the
  // header above the shell. The full wizard payload is fetched client-
  // side so React Query can drive refresh on every save.
  const client = await fetchClientById(id).catch(() => null)
  if (!client) notFound()

  return (
    <WizardShell
      mondayItemId={id}
      clientName={client.name || client.companyName || "-"}
      locale={locale}
    />
  )
}
