#!/usr/bin/env bash
set -u -o pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.tmp/overnight"
STATUS_FILE="$LOG_DIR/STATUS.md"
RUN_SECONDS="${SEEKR_OVERNIGHT_SECONDS:-28800}"
SLEEP_SECONDS="${SEEKR_OVERNIGHT_SLEEP_SECONDS:-900}"
GSTACK_BIN="${GSTACK_BIN:-$HOME/.gstack/repos/gstack/bin}"
START_TS="$(date +%s)"
END_TS="$((START_TS + RUN_SECONDS))"
mkdir -p "$LOG_DIR"

cd "$ROOT_DIR" || exit 1

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_DIR/overnight.log"
}

run_step() {
  local name="$1"
  shift
  local out="$LOG_DIR/${CYCLE}-$(echo "$name" | tr ' /:' '---').log"
  log "START $name"
  "$@" >"$out" 2>&1
  local status=$?
  if [ "$status" -eq 0 ]; then
    log "PASS  $name"
  else
    log "FAIL  $name (exit $status, see $out)"
  fi
  return "$status"
}

write_status() {
  local verdict="$1"
  cat >"$STATUS_FILE" <<EOF
# SEEKR Overnight Loop Status

- Last update: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- Cycle: $CYCLE
- Verdict: $verdict
- Log directory: $LOG_DIR
- Remaining unchecked TODOs:

\`\`\`text
$(rg -n "\\[ \\]" docs/SEEKR_GCS_ALPHA_TODO.md 2>/dev/null || true)
$(rg -n "\\[ \\]" docs/SEEKR_COMPLETION_PLAN.md 2>/dev/null || true)
\`\`\`

## Last Commands

- npm run check
- npm run test:ui
- npm run build
- npm run probe:preview
- npm run smoke:rehearsal:start
- npm run release:checksum
- npm run probe:hardware
- npm run probe:hardware:archive
- npm run bench:edge
- npm run bench:flight
- npm run bench:sitl
- npm run bench:sitl:io -- --fixture px4-process-io
- npm run bench:sitl:io -- --fixture ardupilot-process-io
- npm run bench:dimos
- npm run safety:command-boundary
- npm run test:ai:local
- npm run acceptance:record
- npm run probe:api

EOF
}

finish() {
  local status=$?
  if [ -n "${CAFFEINATE_PID:-}" ]; then
    kill "$CAFFEINATE_PID" >/dev/null 2>&1 || true
  fi
  log "overnight loop exiting with status $status"
  exit "$status"
}
trap finish EXIT INT TERM

log "starting SEEKR overnight loop for ${RUN_SECONDS}s"
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dimsu -t "$RUN_SECONDS" &
  CAFFEINATE_PID=$!
  log "caffeinate pid $CAFFEINATE_PID"
fi

CYCLE=0
while [ "$(date +%s)" -lt "$END_TS" ]; do
  CYCLE=$((CYCLE + 1))
  log "cycle $CYCLE begin"
  FAILURES=0

  run_step "npm-check" npm run check || FAILURES=$((FAILURES + 1))
  run_step "playwright-ui" npm run test:ui || FAILURES=$((FAILURES + 1))
  run_step "build" npm run build || FAILURES=$((FAILURES + 1))
  run_step "preview-smoke" npm run probe:preview || FAILURES=$((FAILURES + 1))
  run_step "rehearsal-start-smoke" npm run smoke:rehearsal:start || FAILURES=$((FAILURES + 1))
  run_step "release-checksum" npm run release:checksum || FAILURES=$((FAILURES + 1))
  run_step "hardware-probe" npm run probe:hardware || FAILURES=$((FAILURES + 1))
  run_step "hardware-archive" npm run probe:hardware:archive || FAILURES=$((FAILURES + 1))
  run_step "edge-bench" npm run bench:edge || FAILURES=$((FAILURES + 1))
  run_step "flight-bench" npm run bench:flight || FAILURES=$((FAILURES + 1))
  run_step "sitl-bench" npm run bench:sitl || FAILURES=$((FAILURES + 1))
  run_step "sitl-process-io-px4" npm run bench:sitl:io -- --fixture px4-process-io || FAILURES=$((FAILURES + 1))
  run_step "sitl-process-io-ardupilot" npm run bench:sitl:io -- --fixture ardupilot-process-io || FAILURES=$((FAILURES + 1))
  run_step "dimos-bench" npm run bench:dimos || FAILURES=$((FAILURES + 1))
  run_step "command-boundary-scan" npm run safety:command-boundary || FAILURES=$((FAILURES + 1))
  run_step "local-ai" npm run test:ai:local || FAILURES=$((FAILURES + 1))
  if [ "$FAILURES" -eq 0 ]; then
    run_step "acceptance-record" npm run acceptance:record || FAILURES=$((FAILURES + 1))
  fi
  if [ "$FAILURES" -eq 0 ]; then
    run_step "api-probe-final" npm run probe:api || FAILURES=$((FAILURES + 1))
  fi

  if [ "$FAILURES" -eq 0 ]; then
    write_status "pass"
    [ -x "$GSTACK_BIN/gstack-timeline-log" ] && "$GSTACK_BIN/gstack-timeline-log" '{"skill":"checkpoint","event":"completed","branch":"seekr-overnight","summary":"Overnight cycle passed check, UI, build, preview smoke, rehearsal-start smoke, API probe, and local AI."}' >/dev/null 2>&1 || true
  else
    write_status "fail: $FAILURES step(s)"
    [ -x "$GSTACK_BIN/gstack-timeline-log" ] && "$GSTACK_BIN/gstack-timeline-log" '{"skill":"checkpoint","event":"failed","branch":"seekr-overnight","summary":"Overnight cycle found failing verification step. See .tmp/overnight logs."}' >/dev/null 2>&1 || true
  fi

  log "cycle $CYCLE complete with $FAILURES failure(s)"
  if [ "$(date +%s)" -lt "$END_TS" ]; then
    sleep "$SLEEP_SECONDS"
  fi
done

log "time budget complete"
