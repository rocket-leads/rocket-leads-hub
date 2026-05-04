-- Replace `users.is_finance` with `finance` as a value in monday_column_role.
-- Finance is a functional role just like account_manager / campaign_manager
-- — keeping it in the same enum avoids a parallel boolean for every future
-- role we want to add (e.g. 'sales', 'ops').
--
-- We also relax `user_column_mappings.monday_person_name` to nullable: finance
-- doesn't correspond to a Monday board column (it's org-level, not per-client),
-- so there's no Monday person name to map against. The other roles still set
-- it; only finance leaves it null.

ALTER TABLE users
  DROP COLUMN IF EXISTS is_finance;

ALTER TABLE user_column_mappings
  ALTER COLUMN monday_person_name DROP NOT NULL;
