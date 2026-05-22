-- Dedupe table for the cron watchdog (`/api/cron/watchdog`). Without this,
-- a single broken cron would spam Slack every 15 minutes until somebody
-- noticed and fixed it. With it, we send exactly one alert per "incident"
-- — defined as a new started_at on a cron whose status flipped to error,
-- or a fresh stuck-window detection.
--
-- last_started_at: the most recent `cron_runs.started_at` we've alerted on
-- for this cron. If the next watchdog tick finds the same value, we skip.
--
-- last_alert_kind: `failed` or `stuck`. Tracks what we last alerted about
-- so a flapping cron (fails → recovers → fails again) re-alerts on the
-- next failure rather than getting eaten by the dedupe.
--
-- last_alerted_at: just for the Health tab + debugging. Not used by the
-- dedupe logic itself.

CREATE TABLE IF NOT EXISTS cron_alert_state (
  cron_name        text PRIMARY KEY,
  last_started_at  timestamptz,
  last_alert_kind  text CHECK (last_alert_kind IN ('failed', 'stuck')),
  last_alerted_at  timestamptz NOT NULL DEFAULT now()
);
