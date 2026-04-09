import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

export type ActionPriority = 1 | 2 | 3 | 4 | 5

export type ActionCategory =
  | "payment-overdue"
  | "campaign-critical"
  | "performance-warning"
  | "monday-inactive"
  | "autopilot"

export type ActionResult = {
  priority: ActionPriority
  category: ActionCategory
  label: string
  reason: string
  color: "red" | "amber" | "green"
}

export function computeActionCategory(
  client: MondayClient,
  kpi: KpiSummary | undefined,
  billing: BillingSummary | undefined,
  mondayActive: boolean | undefined,
): ActionResult {
  // Priority 1: Payment overdue
  if (billing?.status === "overdue" && billing.outstanding > 0) {
    return {
      priority: 1,
      category: "payment-overdue",
      label: "Payment Overdue",
      reason: `€${billing.outstanding.toLocaleString("en-GB", { minimumFractionDigits: 2 })} overdue`,
      color: "red",
    }
  }

  // Priority 2: Campaign critical (spend with 0 leads, or CPL/CPA spike 50%+)
  if (kpi) {
    if (kpi.adSpend > 50 && kpi.leads === 0) {
      return {
        priority: 2,
        category: "campaign-critical",
        label: "Zero Leads",
        reason: `€${kpi.adSpend.toFixed(0)} spent with 0 leads in 7 days`,
        color: "red",
      }
    }

    if (kpi.cpl > 0 && kpi.prevCpl > 0) {
      const cplChange = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
      if (cplChange > 50) {
        return {
          priority: 2,
          category: "campaign-critical",
          label: "CPL Critical",
          reason: `CPL €${kpi.cpl.toFixed(2)} — up ${cplChange.toFixed(0)}% vs prev week`,
          color: "red",
        }
      }
    }

    if (kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0) {
      const cpaChange = ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
      if (cpaChange > 50) {
        return {
          priority: 2,
          category: "campaign-critical",
          label: "CPA Critical",
          reason: `CPA €${kpi.costPerAppointment.toFixed(0)} — up ${cpaChange.toFixed(0)}% vs prev week`,
          color: "red",
        }
      }
    }
  }

  // Priority 3: Performance warning (CPL/CPA up 25-50%)
  if (kpi) {
    if (kpi.cpl > 0 && kpi.prevCpl > 0) {
      const cplChange = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
      if (cplChange > 25) {
        return {
          priority: 3,
          category: "performance-warning",
          label: "CPL Rising",
          reason: `CPL €${kpi.cpl.toFixed(2)} — up ${cplChange.toFixed(0)}% vs prev week`,
          color: "amber",
        }
      }
    }

    if (kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0) {
      const cpaChange = ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
      if (cpaChange > 25) {
        return {
          priority: 3,
          category: "performance-warning",
          label: "CPA Rising",
          reason: `CPA €${kpi.costPerAppointment.toFixed(0)} — up ${cpaChange.toFixed(0)}% vs prev week`,
          color: "amber",
        }
      }
    }
  }

  // Priority 4: Monday CRM inactive (Live client but CRM not being used)
  if (client.campaignStatus === "Live" && mondayActive === false) {
    return {
      priority: 4,
      category: "monday-inactive",
      label: "CRM Inactive",
      reason: "Monday board not being used — check with appointment setter",
      color: "amber",
    }
  }

  // Priority 5: Autopilot — everything looks fine
  const cplInfo = kpi && kpi.cpl > 0 ? `CPL €${kpi.cpl.toFixed(2)}` : ""
  const leadsInfo = kpi && kpi.leads > 0 ? `${kpi.leads} leads` : ""
  const summary = [cplInfo, leadsInfo].filter(Boolean).join(" · ") || "No data"

  return {
    priority: 5,
    category: "autopilot",
    label: "On Track",
    reason: summary,
    color: "green",
  }
}

export function groupByAction(
  clients: MondayClient[],
  kpiSummaries: Record<string, KpiSummary> | undefined,
  billingSummaries: Record<string, BillingSummary> | undefined,
  mondayActiveMap: Record<string, boolean> | undefined,
) {
  const immediate: Array<{ client: MondayClient; action: ActionResult }> = []
  const monitor: Array<{ client: MondayClient; action: ActionResult }> = []
  const autopilot: Array<{ client: MondayClient; action: ActionResult }> = []

  for (const client of clients) {
    const kpi = kpiSummaries?.[client.mondayItemId]
    const billing = client.stripeCustomerId ? billingSummaries?.[client.stripeCustomerId] : undefined
    const mondayActive = mondayActiveMap?.[client.mondayItemId]

    const action = computeActionCategory(client, kpi, billing, mondayActive)

    if (action.priority <= 2) {
      immediate.push({ client, action })
    } else if (action.priority <= 4) {
      monitor.push({ client, action })
    } else {
      autopilot.push({ client, action })
    }
  }

  // Sort within groups by priority, then by client name
  const sortFn = (a: { action: ActionResult; client: MondayClient }, b: { action: ActionResult; client: MondayClient }) =>
    a.action.priority - b.action.priority || a.client.name.localeCompare(b.client.name)

  immediate.sort(sortFn)
  monitor.sort(sortFn)
  autopilot.sort(sortFn)

  return { immediate, monitor, autopilot }
}
