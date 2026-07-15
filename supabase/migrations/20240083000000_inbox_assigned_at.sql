-- Explicit "picked up" (Opgepakt / Assigned) state for external chat tickets.
--
-- Until now Assigned was DERIVED from "the thread has a team reply", which
-- couldn't be toggled by hand and couldn't be moved back to Open. Roy wants a
-- real 3-state machine (Open / Assigned / Closed) with manual transitions: a
-- "pick up" button, reversible either way. `assigned_at` is that marker,
-- stamped thread-wide (like `archived_at`): non-null = picked up. Replying
-- auto-sets it; the button toggles it.

alter table inbox_events add column if not exists assigned_at timestamptz;
