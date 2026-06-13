#!/bin/bash
# Keep the Next.js dev server alive across:
#  - macOS App Nap idle throttling that kills the next-server worker
#  - Memory-pressure OOM kills during hot-reload of large modules
#  - Terminal close (nohup-style detach)
#
# Use:
#   ./scripts/keep-dev-alive.sh            (foreground - Ctrl+C stops it)
#   nohup ./scripts/keep-dev-alive.sh &     (background - survives terminal close)
#
# Stop: pkill -f keep-dev-alive  (or `kill -TERM` the PID this prints on start)

set -u
cd "$(dirname "$0")/.."

LOG="/tmp/dev.log"
PIDFILE="/tmp/keep-dev-alive.pid"

# Bail if another watchdog is already running so we don't dual-spawn.
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE")
  if ps -p "$OLD" >/dev/null 2>&1; then
    echo "Already running as PID $OLD"
    exit 0
  fi
fi
echo $$ > "$PIDFILE"
echo "Watchdog PID: $$"
echo "Log: $LOG"

# Trap signals so a clean Ctrl+C / `kill` removes the pidfile.
trap 'rm -f "$PIDFILE"; pkill -P $$; exit 0' INT TERM

while true; do
  # `caffeinate -i` only blocks idle-sleep WHILE the wrapped command
  # runs. The system still sleeps on lid-close or explicit Apple-menu
  # sleep, so it doesn't fight the user - just keeps the worker alive
  # during active hours.
  echo "[$(date '+%H:%M:%S')] starting next dev" | tee -a "$LOG"
  caffeinate -i npm run dev >> "$LOG" 2>&1
  CODE=$?
  echo "[$(date '+%H:%M:%S')] next dev exited (code $CODE), respawning in 2s" | tee -a "$LOG"
  sleep 2
done
