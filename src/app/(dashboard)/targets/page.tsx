import { redirect } from "next/navigation"

// Targets was split into three sidebar dashboards (Marketing & Sales /
// Delivery / Finance). The bare /targets URL now lands on the first one, so
// old links + the Slack "Open Targets" deep link keep working.
export default function TargetsPage() {
  redirect("/targets/marketing")
}
