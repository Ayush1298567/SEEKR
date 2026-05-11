# SEEKR Field Laptop Runbook

This runbook is for local internal rehearsals. It does not enable aircraft command upload.

## Prerequisites

- Node.js 20 or newer.
- Ollama running locally with `llama3.2:latest`, or set `SEEKR_OLLAMA_MODEL` to another installed model.
- No public network exposure. SEEKR binds to `127.0.0.1`.
- Optional internal token for rehearsal: set `SEEKR_INTERNAL_TOKEN`.

## Clean Rehearsal Data

Use the guarded reset script. It only resets `.tmp/rehearsal-data`.

```bash
npm run rehearsal:reset
```

Then launch with a clean data directory:

```bash
SEEKR_DATA_DIR=.tmp/rehearsal-data npm run dev
```

## Rehearsal Launch

Recommended field-laptop command:

```bash
SEEKR_DATA_DIR=.tmp/rehearsal-data \
SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception" \
npm run dev
```

Open `http://127.0.0.1:5173`.

If auth is enabled, set the browser token:

```js
localStorage.setItem("seekr.internalToken", "change-me")
```

Refresh the page after setting the token.

## Acceptance

Run before a rehearsal:

```bash
npm run acceptance
npm run rehearsal:note -- --label planned-run
```

This runs typecheck, Vitest, edge bench, flight bench, SITL bench, SITL process IO fixture replays, DimOS read-only export bench, command-boundary static scan, strict local AI smoke, Playwright UI smoke, production preview smoke, bounded rehearsal-start smoke, release checksum evidence, acceptance-status recording, and the API probe. The preview smoke builds the production shell and verifies the server can serve the built shell, a built asset, redacted config, and readiness. The rehearsal-start smoke launches the operator wrapper on temporary local ports, checks API/client/source-health/readiness, writes exact ordered smoke rows, and shuts down without validating hardware. The checksum step writes JSON, SHA-256, and Markdown evidence under `.tmp/release-evidence/`, including `.gitignore` and `.npmrc` repository-safety files. The recorder validates the latest passing command-boundary scan and writes `.tmp/acceptance-status.json` for `/api/session`; the final API probe checks that the session-visible acceptance evidence, including strict AI scenario names, can be read back. The strict local AI smoke requires Ollama and the configured model.
`npm run rehearsal:note` writes a fill-in Markdown/JSON template under `.tmp/rehearsal-notes/`. It should not be treated as a completed fresh-operator rehearsal until the operator fills the required timestamps, replay id, final hash, shutdown record, and deviations.

If a UI smoke test fails, keep the generated Playwright failure artifacts under `test-results/`. The config retains a trace and screenshot on failure; attach those files to the rehearsal notes with the failing command and timestamp.

## Operator Evidence Set

Probe these before and after the run:

```bash
npm run rehearsal:evidence -- --label before-run
curl -s http://127.0.0.1:8787/api/session
curl -s http://127.0.0.1:8787/api/config
curl -s http://127.0.0.1:8787/api/readiness
curl -s http://127.0.0.1:8787/api/source-health
curl -s http://127.0.0.1:8787/api/verify
curl -s http://127.0.0.1:8787/api/replays
npm run rehearsal:evidence -- --label after-run
```

`npm run rehearsal:evidence` writes JSON and Markdown snapshots under `.tmp/rehearsal-evidence/` for the listed read-only endpoints plus hardware-readiness safety status. Keep those files with the operator notes. They prove the local API state observed during the rehearsal only; they do not prove Jetson/Pi hardware, real MAVLink/ROS links, HIL behavior, or aircraft command authority.
On a bench run that is meant to validate read-only sources, use required-source checks so the snapshot fails when source health lacks fresh events:

```bash
npm run rehearsal:evidence -- --label after-jetson-bench --require-source mavlink:telemetry:drone-1,ros2-pose:telemetry,lidar-slam:lidar+spatial
```

After the after-run snapshot, update the `.tmp/rehearsal-notes/` Markdown note with the before/after evidence paths, replay id, final state hash, and shutdown timestamp.
Then write the completed closeout JSON/Markdown:

```bash
npm run rehearsal:closeout -- \
  --label completed-run \
  --operator "<operator name>" \
  --machine "<machine id>" \
  --setup-started-at "<timestamp>" \
  --acceptance-completed-at "<timestamp>" \
  --before ".tmp/rehearsal-evidence/<before>.json" \
  --mission-exported-at "<timestamp>" \
  --replay-id "<replay id>" \
  --final-hash "<64-char final hash>" \
  --after ".tmp/rehearsal-evidence/<after>.json" \
  --shutdown-completed-at "<timestamp>" \
  --deviations "none"
```

`rehearsal:closeout` validates the before/after evidence snapshots and required operator fields, then writes a completed closeout under `.tmp/rehearsal-notes/` with `freshOperatorCompleted: true`. It still does not prove actual Jetson/Pi validation unless the linked hardware archive says `actualHardwareValidationComplete: true`.

The readiness report may warn when no replay exists. Export a mission package from the UI to clear that warning.
The session manifest should include `acceptance.status`. `pass` means the latest acceptance gate was recorded for this software version; `currentBoot: false` means the server booted after that acceptance run and should be noted in rehearsal notes.
For Jetson/Pi bench notes, run `npm run probe:hardware:archive -- --target <target>` and keep the JSON/Markdown files from `.tmp/hardware-evidence/`. If the archive says `hardwareValidationScope: "off-board-readiness"` or `actualHardwareValidationComplete: false`, it is setup/readiness evidence only and must not be cited as actual Jetson/Pi validation.
For field-laptop install notes, keep the latest JSON/SHA-256/Markdown files from `.tmp/release-evidence/`. These files prove local install integrity only; they do not prove hardware validation.

## Shutdown

1. Export the mission package.
2. Open the incident log and mission report.
3. Confirm `/api/verify` returns `ok: true`.
4. Confirm `/api/readiness` has no blocking failures.
5. Stop the dev server with `Ctrl-C`.
6. Keep `.tmp/rehearsal-data/replays/` and `.tmp/rehearsal-data/mission-events.ndjson` with the rehearsal notes.

See `docs/RETENTION_POLICY.md` for what to preserve, what can be deleted, and how evidence URI references should be handled.

## Safety Boundary

Do not connect this build to aircraft command channels. MAVLink and ROS 2 command upload, hold, and return-home methods remain rejected in code and should remain rejected in readiness.
