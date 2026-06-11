/**
 * Delivery teams - single source of truth used by both the Slack team-watchlist
 * summary and the Targets/Delivery dashboard.
 *
 * A client (or revenue row) belongs to a team if its account manager OR its
 * campaign manager appears in the team's members list. Anyone whose name
 * doesn't match a team falls into "Other" downstream.
 */
export const TEAMS: Array<{ name: string; members: string[] }> = [
  { name: "Roel & Mike", members: ["Roel van der Harst", "Mike Sauer"] },
  { name: "Danny & Stefan", members: ["Danny Palmeri", "Stefan vd Wijdeven"] },
]

/** Team display label for a person name, or null if they're not on any team. */
export function teamForMember(name: string | null | undefined): string | null {
  if (!name) return null
  for (const team of TEAMS) {
    if (team.members.includes(name)) return team.name
  }
  return null
}
