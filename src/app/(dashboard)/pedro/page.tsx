import { redirect } from "next/navigation"

/**
 * /pedro is a section parent - the actual flows live at:
 *   /pedro/onboard   - new client / new campaign from scratch
 *   /pedro/optimize  - iterate on a live campaign (creative refresh)
 *   /pedro/insights  - agency-wide vertical patterns
 *   /pedro/meetings  - kick-off + evaluation meeting list
 *
 * Hitting the bare /pedro URL should land on the most-common entry,
 * which is the on-board build flow.
 */
export default function PedroIndex() {
  redirect("/pedro/onboard")
}
