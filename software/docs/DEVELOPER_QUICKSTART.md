# SEEKR Developer Quickstart

## Setup

```bash
npm ci
npm run setup:local
```

Run the app:

```bash
npm run doctor
npm run rehearsal:start
```

Run the full gate:

```bash
npm run acceptance
```

`npm run test:ai:local` requires Ollama and `llama3.2:latest` unless `SEEKR_OLLAMA_MODEL` points to another installed model.

## Core Commands

```bash
npm run check
npm run setup:local
npm run doctor
npm run rehearsal:start
npm run test
npm run test:ui
npm run test:ai:local
npm run build
npm run bench:edge
npm run bench:flight
npm run bench:sitl
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
npm run bench:dimos
npm run safety:command-boundary
npm run probe:hardware
npm run probe:hardware:archive
npm run probe:api
npm run smoke:preview
npm run release:checksum
npm run acceptance:record
npm run rehearsal:reset
npm run rehearsal:evidence
npm run rehearsal:note
npm run rehearsal:closeout
npm run hil:failsafe:evidence
npm run isaac:hil:evidence
npm run policy:hardware:gate
npm run audit:completion
npm run demo:package
npm run bench:evidence:packet
npm run handoff:index
npm run handoff:verify
npm run qa:gstack
npm run audit:gstack
npm run audit:source-control
npm run audit:todo
npm run smoke:rehearsal:start
npm run doctor
npm run handoff:bundle
npm run handoff:bundle:verify
npm run audit:plug-and-play
npm run audit:goal
npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0
npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points
npm run overnight
```

## Useful Environment Variables

- `SEEKR_DATA_DIR`: local event, snapshot, evidence, and replay directory.
- `SEEKR_ENV_FILE`: optional project-root-contained env file path, default `.env`.
- `SEEKR_LOAD_DOTENV=false`: disables automatic `.env` loading.
- `SEEKR_INTERNAL_TOKEN`: protects mutating routes.
- `SEEKR_EXPECTED_SOURCES`: expected rehearsal adapters, for example `mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception`.
- `SEEKR_SOURCE_STALE_MS`: source-health stale threshold.
- `SEEKR_AI_PROVIDER=ollama`: local Ollama proposal advisor.
- `SEEKR_AI_PROVIDER=rules`: deterministic proposals without Ollama.
- `SEEKR_OLLAMA_URL`: local Ollama API URL, default `http://127.0.0.1:11434`.
- `SEEKR_OLLAMA_MODEL`: local Ollama model name.
- `SEEKR_OLLAMA_TIMEOUT_MS`: local Ollama request timeout.

## Readiness Evidence

- `/api/config`: redacted runtime config and warnings.
- `/api/session`: boot/session manifest.
- `/api/readiness`: hash, replay, export, fixture, source-health, config, AI, and safety boundary checks.
- `/api/source-health`: adapter/import/command/AI freshness.
- `/api/verify`: hash-chain proof.
- `/api/replays`: persisted replay manifests and integrity status.
- `/api/replays/:id/verify`: replay manifest integrity proof.
- `/api/hardware-readiness?target=jetson-orin-nano`: read-only edge bench profile for Jetson/Pi targets.

## Overnight Loop

`npm run release:checksum` writes local install-integrity JSON/SHA-256/Markdown evidence under `.tmp/release-evidence/` after a production build, including `.gitignore` and `.npmrc` so repository-safety and npm engine-strict policy files are covered by the release hash.

`npm run acceptance:record` writes `.tmp/acceptance-status.json` after the acceptance steps pass; it validates the latest passing `.tmp/safety-evidence/` command-boundary scan, keeps caller-supplied acceptance/release/safety evidence paths under the project root, requires the strict local AI smoke marker to contain the named baseline/no-fly/prompt-injection safety scenarios with no thinking-time mutation, and `/api/session` shows status, recency, current-boot state, strict AI evidence including scenario names, release checksum summary, command-boundary scan summary, and the command-upload safety boundary.

`npm run probe:api` starts a temporary local API and checks config redaction, `/api/session` acceptance evidence summaries when acceptance is passing, readiness, hardware readiness, source health, hash verification, replay listing, and malformed JSON handling.

`npm run rehearsal:evidence -- --label <run-name>` snapshots `/api/session`, `/api/config`, `/api/readiness`, `/api/hardware-readiness`, `/api/source-health`, `/api/verify`, and `/api/replays` from a running local API into `.tmp/rehearsal-evidence/`. It is for operator notes only and does not prove Jetson/Pi, real MAVLink/ROS, HIL, or aircraft command authority.

`npm run rehearsal:evidence -- --label jetson-bench --require-source mavlink:telemetry:drone-1,ros2-pose:telemetry,lidar-slam:lidar+spatial` makes the evidence snapshot fail unless those read-only sources are present in `/api/source-health` with passing status and at least one event. Use this during real bench runs so missing MAVLink/ROS/LiDAR sources cannot be mistaken for validated integration.

`npm run rehearsal:note -- --label <run-name>` writes a fill-in JSON/Markdown rehearsal note under `.tmp/rehearsal-notes/`. It deliberately records `freshOperatorCompleted: false` until a human fills the required run timestamps, replay id, final hash, and deviations.

`npm run rehearsal:closeout -- --operator <name> --machine <id> --before <json> --after <json> --replay-id <id> --final-hash <hash> ...` validates a filled operator note and writes a completed closeout with `freshOperatorCompleted: true`. It still remains local rehearsal evidence, not hardware validation.

`npm run hil:failsafe:evidence -- --operator <name> --target jetson-orin-nano --vehicle <id> --autopilot px4 --failsafe link-loss --failsafe-triggered-at <iso> --manual-override-observed-at <iso> --estop-verified-at <iso> --aircraft-safe-at <iso> --manual-override-result <text> --onboard-failsafe-result <text> --deviations <text> --hardware-evidence <json> --rehearsal-evidence <json> --flight-log <path> --command-upload-enabled false` validates a real HIL failsafe/manual override run and writes `.tmp/hil-evidence/`. It blocks completion unless the linked hardware evidence is actual target-board validation, the rehearsal evidence is valid, the flight log is non-empty, and command upload was observed false.

`npm run isaac:hil:evidence -- --operator <name> --target jetson-orin-nano --isaac-sim-host <host> --isaac-sim-version <version> --isaac-ros-version <version> --sensor-suite <text> --capture-started-at <iso> --capture-ended-at <iso> --capture-result <text> --deviations <text> --hardware-evidence <json> --rehearsal-evidence <json> --capture-manifest <json> --capture-log <path> --command-upload-enabled false` validates real Isaac Sim to Jetson HIL capture evidence and writes `.tmp/isaac-evidence/`. It blocks completion unless actual Jetson hardware, fresh Isaac source-health events, a positive capture manifest, a non-empty capture log, and disabled command upload are all present.

`npm run policy:hardware:gate -- --operator <name> --target jetson-orin-nano --vehicle <id> --reviewers "Safety Lead,Test Director" --reviewed-at <iso> --policy <json> --hardware-evidence <json> --hil-evidence <json> --command-upload-enabled false` validates a future hardware-actuation review package and writes `.tmp/policy-evidence/`. It blocks unless acceptance is current, actual target-board evidence is present, HIL failsafe/manual override evidence is completed, at least two reviewers are named, the candidate policy requires manual override/E-stop, and every authorization field remains false. A passing result is only `ready-for-human-review`; it does not install a runtime policy or enable command upload.

`npm run demo:package -- --label <demo-name>` writes `.tmp/demo-readiness/` JSON/Markdown after acceptance and completion audit. It packages the latest acceptance, release checksum, command-boundary scan, API probe, completion audit, source-control handoff, hardware archive, policy gate, and overnight status pointers for an internal demo handoff while keeping all hardware claims false, listing real-world blockers from the audit, adding an operator/safety/DX/replay/demo-readiness perspective review, and adding a next-evidence checklist with the runbook and command that should produce each missing artifact. The DX perspective uses source-control handoff evidence when present, reports missing, unsafe, or pre-acceptance GitHub publication state as a gap, and records clean published local HEAD evidence as ready for review only when it is current against acceptance. Stale overnight status is a warning, not a hardware validation claim.

`npm run bench:evidence:packet -- --label <bench-name>` writes `.tmp/bench-evidence-packet/` JSON/Markdown from the latest demo package. It converts the next-evidence checklist into ordered operator task cards with preconditions and done criteria, while keeping real aircraft command upload, hardware actuation, and runtime policy installation false.

`npm run handoff:index -- --label <handoff-name>` writes `.tmp/handoff-index/` JSON/Markdown after the demo package and bench packet. It verifies those artifacts point at the latest acceptance, release, completion audit, safety scan, API probe, hardware archive, policy gate, and overnight status before internal review, checks that acceptance and the demo package embed the same latest command-boundary scan and API-probe evidence, verifies API-probe readback for acceptance timestamp, command count, exact strict local AI scenario names, release checksum, and command-boundary scan, records SHA-256 digests for linked artifacts, and does not clear any real-world blocker.

`npm run handoff:verify` reads the latest handoff index and verifies every recorded artifact digest without regenerating acceptance or package evidence. Use `npm run handoff:verify -- --index .tmp/handoff-index/<file>.json` when reviewing a specific copied index.

`npm run qa:gstack` regenerates the local `.gstack/qa-reports/` browser QA Markdown report and desktop/mobile screenshots from a clean production-shell run. Run it after acceptance or `npm run smoke:preview` when preparing the final gstack workflow artifact; it verifies `/api/session`, readiness, hash-chain verification, and `commandUploadEnabled: false` without clearing hardware blockers.

`npm run audit:gstack` writes `.tmp/gstack-workflow-status/` JSON/Markdown with health, review, planning, QA, perspective status/score/next-action detail, per-workflow installed skill availability, whether the `gstack` CLI is on PATH, the Git metadata path when present, latest gstack health-history status/path, and the latest local `.gstack/qa-reports/` browser QA report status/path plus named screenshot paths when present. Run it before final bundling so the review bundle can copy the same workflow artifact that `audit:goal` will check. Health history that predates acceptance or lacks a parseable `ts` or `timestamp` field, stale browser QA, and no-Git review limitations remain explicit limitations when applicable; browser QA reports with failed check rows or missing referenced screenshots fail the workflow audit. Current local health and browser coverage still come from the latest acceptance/check/Playwright outputs.

`npm run audit:source-control` writes `.tmp/source-control-handoff/` JSON/Markdown for the GitHub handoff state. It records package/README repository references, local Git metadata, configured remotes, the GitHub remote refs/default branch with `git ls-remote`, local HEAD versus the GitHub default branch SHA, clean-worktree status, an exact ordered source-control check list, persisted blocked/warning check counts, and a manual publication next-action checklist for missing `.git`, origin, refs, unpublished HEAD, dirty worktrees, and re-audit steps; it is read-only and never initializes Git, commits, pushes, changes GitHub settings, validates hardware, or enables command upload.

`npm run audit:todo` writes `.tmp/todo-audit/` JSON/Markdown after `audit:completion`. It checks that unchecked items in `docs/SEEKR_GCS_ALPHA_TODO.md` and `docs/SEEKR_COMPLETION_PLAN.md` still cover the current real-world blocker categories, records exact ordered category rows plus top-level blocker/category summary counts, and fails if the completion audit artifact is missing or stale.

`npm run setup:local` writes `.tmp/plug-and-play-setup/` JSON/Markdown after preparing operator-local files. It creates `.env` from `.env.example` only when `.env` is missing, prepares `.tmp/rehearsal-data`, refuses env/data paths outside the project root, and keeps command upload plus hardware actuation disabled.

`npm run doctor` writes `.tmp/plug-and-play-doctor/` JSON/Markdown preflight evidence before final plug-and-play packaging or as a standalone local startup check. It checks package scripts including `setup:local`, package `engines`/`packageManager`, Node/package-lock readiness, `.npmrc` `engine-strict`, `.gitignore` protection for local secrets/generated artifacts including runtime `data/`, the latest source-control handoff artifact for `https://github.com/Ayush1298567/SEEKR`, local `tsx`/`concurrently`/`vite` dependency binaries needed by `npm run dev`, the `rehearsal:start` wrapper contract, project-local env setup, local Ollama model availability, API/client port availability or healthy already-running SEEKR listeners, local data directory safety, and command-upload/hardware-actuation environment flags without validating hardware. Occupied default ports pass only when `/api/health` and the client shell prove they are a healthy local SEEKR instance; non-SEEKR or unhealthy listeners stay warnings and carry read-only listener PID/cwd diagnostics when available. The rehearsal wrapper normalizes `PORT`/`SEEKR_API_PORT` and auto-selects free local API/client ports when unconfigured defaults are busy, while explicit operator port choices remain explicit. Rerun it after `smoke:rehearsal:start` and before review bundling so the packaged operator-start doctor references the same latest source-control handoff artifact as the review bundle. Missing Git metadata, missing GitHub refs, unpublished local HEAD, or dirty worktree state are recorded as non-blocking handoff warnings after semantic validation, while malformed or unsafe source-control handoff artifacts fail the local startup preflight.

`npm run rehearsal:start` is the plug-and-play local operator start command. It uses `.tmp/rehearsal-data` by default, declares expected read-only MAVLink/ROS/LiDAR/Isaac source categories for source-health visibility, normalizes the API port environment for both the server and Vite proxy, fails fast if `PORT` and `SEEKR_API_PORT` are both explicit and disagree, auto-selects free local ports when default ports are busy and no port variables were explicitly set, runs non-destructive `npm run setup:local`, refreshes `npm run audit:source-control`, runs `npm run doctor`, then launches `npm run dev`; it does not validate hardware or enable command upload.

`npm run smoke:rehearsal:start` writes `.tmp/rehearsal-start-smoke/` JSON/Markdown by launching `npm run rehearsal:start` on temporary local API/client ports, marking the internal doctor as `profile: "rehearsal-start-smoke"`, checking `/api/config`, `/api/source-health`, `/api/readiness`, and the client shell, verifying command upload remains disabled, and shutting the process group down. The artifact must keep the exact ordered smoke rows for wrapper start, API/client, runtime config, source-health, readiness, and shutdown. It is a bounded local startup proof only; it does not validate hardware.

`npm run audit:plug-and-play` writes `.tmp/plug-and-play-readiness/` JSON/Markdown after acceptance, API probe, gstack QA/workflow evidence, source-control handoff evidence, TODO audit, setup, rehearsal-start smoke, the final operator-start doctor rerun, and bundle verification. It proves the local app, local Ollama AI smoke, API readback, browser QA, review bundle, setup artifact, operator-start doctor artifact, rehearsal-start smoke artifact, operator quickstart, rehearsal start wrapper, and safety boundary are ready for an internal-alpha plug-and-play operator while keeping physical hardware blockers explicit. API readback must match the latest acceptance timestamp, local-AI summary including exact required strict smoke scenario names, release checksum, and command-boundary scan summaries before the readiness audit can pass. Source-control handoff gaps are reported as warnings only after the ready artifact passes the shared read-only semantic guard and was generated no earlier than the latest acceptance record; unsafe, malformed, or pre-acceptance ready source-control handoff artifacts fail. It fails if the operator-start doctor predates acceptance, does not reference the latest source-control handoff artifact, has extra/reordered/missing package-script/runtime/repository-safety/source-control-handoff/start-wrapper/env/local-AI/port/data/safety rows, has a non-passing critical operator-doctor check, `docs/OPERATOR_QUICKSTART.md` omits setup/source-control audit/start, occupied-port recovery, local AI as advisory-only with no command-payload creation or validation bypass, API evidence, source-health, real-world blockers, or disabled command/hardware authority, the operator start wrapper drops its local defaults or setup-before-source-control-before-doctor-before-dev ordering, the rehearsal-start smoke artifact is missing, failing, extra-rowed, or reordered, or the verified review bundle points at stale handoff, gstack workflow, gstack QA, TODO audit, source-control handoff, plug-and-play setup, operator-start plug-and-play doctor, rehearsal-start smoke, or packaged operator quickstart evidence.

`npm run handoff:bundle -- --label <review-name>` verifies the handoff digest table and requires passing or limitation-only gstack workflow-status with `gstackAvailable: true`, exact ordered health/review/planning/QA workflow rows, exact ordered operator/safety/DX/replay/demo-readiness perspective rows, `pass-with-limitations` for limitation-only evidence, preserved manifest-level limitation details including unavailable gstack CLI details, preserved limitation details for stale or missing health/QA evidence, per-workflow skill availability, Git review evidence paths when Git metadata is present or no-Git limitations when the workspace lacks `.git`, health-history status/path, QA screenshot path preservation, TODO audit artifacts with exact ordered blocker category IDs, matching top-level/category blocker counts, well-formed supporting TODO/blocker match evidence, a read-only source-control handoff artifact with local Git/GitHub publication, local-head, and clean-worktree state preserved for review, no ready source-control handoff generated before the latest acceptance record, a passing plug-and-play setup artifact, a passing operator-start plug-and-play doctor artifact with repository-safety/source-control-handoff/runtime/startup evidence that is fresh against acceptance and matches the source-control handoff being packaged, a passing exact-row rehearsal-start smoke artifact, and operator quickstart coverage for setup/source-control audit/start, occupied-port recovery, local AI as advisory-only with no command-payload creation or validation bypass, API evidence, source-health, real-world blockers, and disabled authority, then copies the handoff index, linked local artifacts, the workflow artifact, the workflow-referenced local gstack browser QA report and screenshots, the TODO audit artifact, the source-control handoff artifact, the plug-and-play setup artifact, the operator-start plug-and-play doctor artifact, the rehearsal-start smoke artifact, and `docs/OPERATOR_QUICKSTART.md` into `.tmp/handoff-bundles/` with a manifest for internal review. It is a packaging step only: all hardware claims and authorization fields remain false.

`npm run handoff:bundle:verify` verifies the latest copied bundle manifest, every copied file digest, copied acceptance status with the exact required strict local AI scenario names, copied API-probe readback of the same acceptance timestamp, command count, scenario names, release checksum, command-boundary scan, and disabled command upload, copied gstack workflow semantics including exact workflow/perspective order and perspective status/score/next-action detail, copied gstack QA report and screenshot inclusion plus report-content pass/command-safety, copied TODO audit exact blocker-category order/top-level-count/support-shape semantics, copied source-control handoff semantics including ready-artifact freshness against copied acceptance, copied plug-and-play setup exact env/data/safety row semantics, copied operator-start plug-and-play doctor exact repository-safety/source-control-handoff/runtime/start-wrapper/AI/port/data/safety row semantics and freshness against copied acceptance, copied rehearsal-start smoke exact ordered startup/source-health/readiness/shutdown row semantics, copied operator quickstart setup/source-control audit/start/occupied-port recovery/advisory-AI/API/source-health/safety guidance including no AI-created command payloads or validation bypass, critical operator-doctor check pass status with only source-control/port/data-directory warnings allowed, and full high-confidence secret-scan coverage. Use `npm run handoff:bundle:verify -- --bundle .tmp/handoff-bundles/<file>.json` for a specific review bundle after transfer.

`npm run audit:goal` writes `.tmp/goal-audit/` JSON/Markdown after handoff verification, `audit:gstack`, `audit:todo`, bundling, bundle verification, and `audit:plug-and-play`. It restates the objective as a prompt-to-artifact checklist across named files including `docs/OPERATOR_QUICKSTART.md`, commands, safety boundary, acceptance/release/API probe evidence that directly matches session-visible timestamp, local-AI summary including exact required strict smoke scenario names, release checksum, and command-boundary summaries to acceptance, completion audit, demo/handoff/bundle/gstack chain, plug-and-play readiness that is current against acceptance and references the current API probe, source-control handoff, and operator quickstart evidence, TODO/blocker consistency, `docs/goal.md`, and explicit real-world blockers with a persisted remaining-blocker count/list.

`npm run probe:hardware:archive` writes `.tmp/hardware-evidence/` archives with `actualHardwareValidationComplete` and `hardwareValidationScope`. On this Mac it should remain `off-board-readiness`; actual Jetson/Pi validation requires running the command on the target board. The bench evidence packet now emits separate target cards for `npm run probe:hardware:archive -- --target jetson-orin-nano` and `npm run probe:hardware:archive -- --target raspberry-pi-5`.

`npm run bridge:mavlink -- --dry-run --binary-file <capture.bin>` parses common MAVLink v1/v2 telemetry frames from a captured binary file before posting anything to SEEKR. Use this for bench-capture inspection only; live serial/UDP evidence is still a real-world blocker until it is run against hardware and archived.

`npm run bridge:mavlink -- --udp-port 14550 --duration-ms 30000 --max-packets 200 --evidence-label mavlink-udp-bench` listens for bounded MAVLink UDP telemetry, posts decoded telemetry only to `/api/ingest/telemetry`, and writes `.tmp/bridge-evidence/`. It is still read-only; use `--dry-run` for packet inspection without posting. Completion audit only treats UDP as real bench evidence when the bridge artifact reports a live UDP listener with packets, posted records, `commandEndpointsTouched: false`, and matching required-source rehearsal evidence.

`npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0` records the serial capture plan without opening the device. On a real bench, configure baud/permissions outside SEEKR, then run without `--command-preview` plus `--base-url http://127.0.0.1:8787 --duration-ms 30000 --max-bytes 1000000` to parse MAVLink bytes and post decoded telemetry only to `/api/ingest/telemetry`. The wrapper opens the device path read-only and never creates a write stream.

`npm run bridge:ros2 -- --fixture pose:pose-stamped,odometry:odometry` maps ROS 2 PoseStamped/Odometry-style records into read-only telemetry. It does not start DDS subscriptions by itself and does not expose ROS services/actions.

`ros2 topic echo --json /drone/pose | npm run bridge:ros2 -- --stdin --topic /drone/pose --base-url http://127.0.0.1:8787` replays one read-only ROS 2 topic stream into SEEKR ingest. JSON lines may also be wrapped as `{ "topic": "/...", "msg": { ... } }` so `/map`, costmap, pose/odometry, and PointCloud2-style LiDAR records can be routed in one file without enabling ROS services/actions.

`npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points` prints the exact live `ros2 topic echo --json` commands without spawning them. On a real bench, run it without `--command-preview` plus `--base-url http://127.0.0.1:8787 --duration-ms 30000 --max-records 200` to stream those topics through the same read-only ingest normalizer. The wrapper only uses `ros2 topic echo`; it does not touch ROS services/actions or SEEKR command routes.
`npm run bridge:spatial -- --dry-run --fixture lidar-point-cloud --evidence-label spatial-preview` writes a local `.tmp/bridge-evidence/` rehearsal artifact for point-cloud/spatial ingest. On a real bench, pair a non-dry-run spatial bridge artifact with actual target-board evidence and required-source rehearsal evidence before claiming LiDAR/depth proof.

`npm run audit:completion` writes JSON and Markdown under `.tmp/completion-audit/`. It returns success when the local alpha evidence is internally consistent, including acceptance matching the latest release checksum and command-boundary scan, while still reporting `complete: false` until real Jetson, Raspberry Pi, MAVLink/ROS, HIL, and Isaac bench blockers are closed. Jetson Orin Nano and Raspberry Pi 5 hardware readiness are separate blocker items so one target cannot accidentally clear the other.

`npm run safety:command-boundary` writes `.tmp/safety-evidence/` JSON/Markdown static-scan evidence. It fails if production source sets command-upload or hardware-actuation flags true, imports `commandAccepted` outside the adapter helper, exposes outbound MAVLink/PX4/ArduPilot command tokens outside SITL mapping, or stops rejecting real MAVLink/ROS adapter command methods.

`npm run overnight` keeps the machine awake, repeats check/UI/build/preview/rehearsal-start-smoke/release-checksum/hardware/archive/edge-bench/flight-bench/SITL-bench/SITL-process-IO/DimOS-bench/command-boundary-scan/local-AI/acceptance-record/final-API-probe verification, logs to `.tmp/overnight/`, and writes `.tmp/overnight/STATUS.md`.

## Known Alpha Limits

- Real aircraft command upload is blocked.
- Real MAVLink/ROS integration is fixture/local-ingest/capture-parse only until bench hardware is connected and archived.
- SITL process IO currently replays deterministic stdout fixtures; live PX4/ArduPilot process attachment still needs bench capture.
- DimOS is currently a read-only export contract bench, not a live robot runtime dependency.
- Binary spatial assets are not streamed; previews use metadata and generated geometry.
- The browser UI is local-first and not hardened as a multi-user web app.
- The repo is currently not initialized as a git repository in this workspace.
