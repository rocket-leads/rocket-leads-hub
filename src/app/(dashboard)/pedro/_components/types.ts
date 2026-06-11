export type PedroClient = {
  id: string // monday_item_id
  name: string
  status: string // "live" | "onboarding" | etc - Monday's raw label
  boardType: "onboarding" | "current"
  /** Hub data signals so the AM picks the right variant when there are
   *  duplicates (e.g. two "Financieel Verder" rows). Pedro auto-brief
   *  pulls richer context from clients with more of these. */
  meetingCount: number
  hasKickoff: boolean
  hasEval: boolean
  hasSavedCampaign: boolean
  /** Google Drive folder id from Monday. Used by the "Open Drive" link
   *  in Pedro Optimize so the CM can verify which photos are actually
   *  available before/after generating images. Empty when missing. */
  googleDriveId: string
}
