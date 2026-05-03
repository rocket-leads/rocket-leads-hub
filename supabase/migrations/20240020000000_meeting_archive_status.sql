-- Allow meetings to be archived from the Unlinked queue without deleting
-- the row. Used for sales calls that don't need client-linking (didn't
-- convert / out of scope) and any other meeting we want out of triage.
--
-- Archived meetings are hidden from Unlinked / Recent / Internal and only
-- visible on a dedicated Archived tab — so they're recoverable but don't
-- clutter the daily flow.

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_link_status_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_link_status_check
  CHECK (link_status IN ('linked', 'suggested', 'unlinked', 'internal', 'prospect', 'archived'));
