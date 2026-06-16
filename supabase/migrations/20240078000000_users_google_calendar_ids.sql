-- Per-user Google Calendar subcalendar selection.
--
-- Until now the Hub calendar view always read from `primary` only, which
-- was fine when each user's Hub-connected account had one calendar. For
-- shared accounts (contact@rocket-leads.nl) the user sees dozens of
-- subcalendars in Google's UI and needs to pick which ones flow into the
-- Hub grid. NULL = follow Google's own `selected` flag on each CalendarList
-- entry (the default a user sees on calendar.google.com). Empty array =
-- explicit "none". Populated = explicit allow-list of calendar IDs.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS google_calendar_ids TEXT[];
