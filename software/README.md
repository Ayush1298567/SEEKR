# SEEKR Software Prototype

This is a local software scaffold for SEEKR's non-flight-critical software side:

- Event-sourced GCS backend with hash-chained mission events, simulated drones, alerts, detections, evidence, replay, and command validation.
- Persisted replay manifests and replay selector that survive local server restart.
- WebSocket envelope stream for live UI updates.
- Operator console with map-first workflow, drone telemetry, alerts, detections, and bounded AI proposals.
- AI tool boundary that mirrors the decision doc: tools can query state, estimate coverage, validate plans, and propose actions before operator approval.
- Passive read-only planning that summarizes watch items and next checks without creating commands or mutating mission state.
- Read-only incident logs with event timeline, evidence index, command summary, and hash-chain status.
- Read-only readiness checklist API and operator modal for hash-chain, replay, report, fixture, AI, and safety-boundary proof.
- Source-health API and operator modal for simulator, adapter, import, command, and AI event freshness.
- Optional internal token auth for mutating routes during internal rehearsals.
- Run-session manifest with redacted launch/config details.
- Redacted runtime config endpoint with source-health, auth, storage, AI, and safety-boundary settings.
- Sanitized operator-input prompts that keep human decisions on validator-backed workflows.
- Optional local Ollama/Llama proposal advisor. The model can choose only from validator-built candidate plans and cannot call command APIs.
- Persistent local mission events and latest-state snapshot under `data/`.
- Seeded deterministic scenarios with scripted faults for repeatable simulator runs.
- Read-only MAVLink and ROS 2 fixture ingest adapters.
- Transcript-derived spatial asset ingest for Gaussian splat, point cloud, mesh, 4D reconstruction, spatial video, and VPS/VSP pose metadata.
- V2 Spatial AI Ops layer with Three.js previews, bag-lite imports, spatial manifests, and local spatial AI read tools.
- Flight-core and SITL process IO benches for PX4/ArduPilot-style traces with hardware transport still rejected.
- LiDAR/AI/DimOS research track for read-only point-cloud, SLAM, costmap, perception, and spatial-memory integration.
- Golden scenario fixtures, mission report export, replay seek, and hash-chain verification for V1 acceptance.

This is not flight firmware and does not command real aircraft. The hardware integration boundary is intentionally read-only until replay, validators, safety docs, and adapter contracts are proven.

## Run

```bash
npm ci
npm run setup:local
npm run doctor
npm run rehearsal:start
```

Open `http://127.0.0.1:5173`.

## Useful Scripts

```bash
npm run check
npm run setup:local
npm run doctor
npm run acceptance
npm run fixtures:update
npm run rehearsal:reset
npm run rehearsal:start
npm run smoke:rehearsal:start
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
npm run doctor
npm run handoff:bundle
npm run handoff:bundle:verify
npm run audit:plug-and-play
npm run audit:goal
npm run overnight
npm run bridge:mavlink
npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview
npm run bridge:ros2
npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview
npm run bridge:spatial -- --evidence-label spatial-bench
npm run bench:edge
npm run bench:flight
npm run bench:sitl
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
npm run bench:dimos
npm run safety:command-boundary
npm run probe:api
npm run probe:hardware
npm run probe:hardware:archive
npm run smoke:preview
npm run release:checksum
npm run acceptance:record
npm run test
npm run test:ai:local
npm run test:ui
npm run build
npm run server
npm run client
```

`npm run bridge:ros2` accepts ROS 2 map fixtures by name and prefixed pose/detection/spatial fixtures, for example `--fixture occupancy-grid,nvblox-costmap,pose:pose-stamped,odometry:odometry,detection:evidence-linked-detection,spatial:lidar-point-cloud`. It also accepts ROS 2 topic-echo JSON records through `--file` or `--stdin`, including `{ "topic": "/...", "msg": { ... } }` envelopes and single-topic `--topic /drone/pose` input for `ros2 topic echo --json` style streams. It still posts only to read-only ingest endpoints.
`npm run bridge:ros2:live` wraps live `ros2 topic echo --json <topic>` processes and streams newline-delimited topic output through the same read-only normalizer. Use `--command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview` before a bench run to show the exact subscriptions and write `.tmp/bridge-evidence/`; during a run, add `--base-url http://127.0.0.1:8787 --duration-ms 30000 --max-records 200 --evidence-label ros2-bench`. It does not call ROS services/actions or SEEKR command endpoints.
`npm run bridge:mavlink` accepts fixture/JSON input, raw MAVLink v1/v2 capture input through `--binary-file <path>` or `--hex <frame-hex>`, and bounded UDP telemetry listening through `--udp-port <port> --duration-ms <ms> --max-packets <n>`. Add `--evidence-label mavlink-udp-bench` on bounded UDP runs to write `.tmp/bridge-evidence/`. These paths decode common telemetry frames only and still post only to `/api/ingest/telemetry`; a localhost UDP smoke is not proof of a real aircraft link.
`npm run bridge:mavlink:serial` opens a configured serial device path read-only for a bounded capture window, parses MAVLink telemetry bytes with the same checksum-aware decoder, and posts only to `/api/ingest/telemetry`. Use `--command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview` before connecting hardware, then add `--base-url http://127.0.0.1:8787 --duration-ms 30000 --max-bytes 1000000 --evidence-label mavlink-bench` during a bench run. Configure baud/permissions outside SEEKR; this wrapper never opens a write stream. Bridge evidence is saved under `.tmp/bridge-evidence/` when `--evidence-label` or `--out-dir` is provided.

## Local AI

SEEKR auto-detects Ollama at `http://127.0.0.1:11434` and defaults to `llama3.2:latest` when available. Override with:

```bash
SEEKR_AI_PROVIDER=ollama npm run dev
SEEKR_OLLAMA_URL=http://127.0.0.1:11434 npm run dev
SEEKR_OLLAMA_MODEL=llama3.2:latest npm run dev
SEEKR_OLLAMA_TIMEOUT_MS=20000 npm run dev
SEEKR_AI_PROVIDER=rules npm run dev
```

`SEEKR_AI_PROVIDER=rules` forces deterministic proposals. Local Llama remains advisory only: its output is constrained to selecting from prevalidated candidate plans, and approvals still go through command lifecycle validation.
If the model chooses an invalid, unsafe, or low-value hold candidate while action candidates exist, SEEKR falls back to the deterministic priority candidate.
`npm run test:ai:local` runs strict Ollama smoke cases for normal assignment, prompt-injection notes, spatial metadata injection, and conflict-driven no-fly drafting. It requires Ollama and `llama3.2:latest` unless `SEEKR_OLLAMA_MODEL` points to another local model, then writes `.tmp/ai-smoke-status.json` for `/api/readiness`; acceptance rejects the marker unless those named safety scenarios are present, each saved case records the selected plan kind, validator pass, no unsafe operator-facing text, and no mutation while thinking. Spatial asset, passive-plan, incident-log, readiness, and operator-input read tools remain advisory and are covered by Vitest/API/UI checks.

## Architecture

```text
src/shared        Shared Zod schemas, TypeScript types, and WebSocket envelopes
src/server        GCS API, event reducer, simulator, validators, AI tools, replay, reports, adapters
src/client        React operator console
fixtures          Golden scenarios plus MAVLink, ROS 2 map, detection, spatial, and import samples
docs              API, architecture, and integration roadmap
```

## Hardware Integration Boundary

Add real adapters under `src/server/adapters/` later:

- `mavlinkAdapter.ts` for read-only MAVLink telemetry fixture mapping.
- `ros2SlamAdapter.ts` for ROS 2 occupancy-grid style map fixture mapping.
- `npm run bridge:ros2 -- --fixture pose:pose-stamped,odometry:odometry` maps ROS 2 PoseStamped/Odometry-style records into read-only telemetry ingest.
- `ros2 topic echo --json /drone/pose | npm run bridge:ros2 -- --stdin --topic /drone/pose --base-url http://127.0.0.1:8787` replays a single read-only topic stream into telemetry; topic envelopes can also carry `/map`, costmap, and PointCloud2-style LiDAR records.
- `npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview` shows the exact live read-only `ros2 topic echo --json` subscriptions before a bench run and writes bridge evidence; run without `--command-preview` plus `--base-url`, bounds, and `--evidence-label` to stream live records into SEEKR without ROS service/action calls.
- `npm run bridge:mavlink -- --binary-file <capture.bin>` and `--udp-port <port>` parse common MAVLink v1/v2 telemetry captures for read-only ingest dry-runs without exposing command endpoints.
- `npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview` records the read-only serial capture plan; running it without preview plus `--evidence-label` reads bytes from the device for the bounded window, posts decoded telemetry only to ingest endpoints, and writes `.tmp/bridge-evidence/`.
- Spatial fixtures for Gaussian splats, point clouds, 4D reconstructions, spatial video, and VPS/VSP pose corrections.
- `npm run bridge:spatial -- --evidence-label spatial-bench` forwards point-cloud/spatial fixtures into the read-only spatial ingest endpoint and writes `.tmp/bridge-evidence/`; fixture/local runs do not validate real LiDAR/depth hardware.
- `npm run bench:sitl:io` replays deterministic PX4/ArduPilot process-output fixtures while reporting `commandUploadEnabled: false`.
- `npm run probe:hardware:archive` writes JSON/Markdown bench evidence for Jetson/Pi readiness without mutating mission events. The archive includes `actualHardwareValidationComplete` and `hardwareValidationScope` so off-board Mac runs cannot be mistaken for actual target-board validation.
- `npm run probe:hardware:archive -- --target jetson-orin-nano` and `npm run probe:hardware:archive -- --target raspberry-pi-5` are the target-specific archive commands used by the bench evidence packet's separate Jetson and Raspberry Pi hardware task cards.
- `npm run bench:dimos` proves a DimOS-style replay/export can enter SEEKR as read-only telemetry, map, detection, and spatial evidence without command lifecycle mutation.
- `npm run policy:hardware:gate` validates a future hardware-actuation review package against acceptance, actual target-board hardware evidence, and completed HIL failsafe evidence. It writes fail-closed evidence only; it does not install a runtime policy or enable aircraft commands.
- V2 import fixtures for bag-lite JSON streams and spatial manifests.
- LiDAR/AI/DimOS research plan in `docs/LIDAR_AI_DIMOS_RESEARCH.md`.
- Replay/export paths for MCAP/NDJSON-style evidence bundles.

The simulator and read-only adapters publish the same event and state contracts. Real hold/RTH/upload authority is blocked in V1 and remains behind a future hardware decision gate.

## Internal Alpha Controls

Set `SEEKR_INTERNAL_TOKEN` to require `Authorization: Bearer <token>` or `x-seekr-token: <token>` on mutating routes. The browser client reads the token from `localStorage.seekr.internalToken` or `VITE_SEEKR_INTERNAL_TOKEN`.

Declare expected rehearsal sources with:

```bash
SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception" npm run dev
```

Use `GET /api/session`, `GET /api/readiness`, `GET /api/source-health`, `GET /api/verify`, and `GET /api/replays` as the internal alpha evidence set.
Use `GET /api/config` when an operator needs redacted runtime config, source-health threshold, expected sources, storage paths, and safety boundary settings.
Use `npm run probe:api` to smoke the local API surface and write `.tmp/api-probe/` evidence, including config redaction, `/api/session` acceptance evidence summaries with strict local AI scenario names when acceptance is passing, readiness, hardware readiness, source health, hash verification, replay listing, and malformed JSON handling.
Use `npm run rehearsal:evidence -- --label <run-name>` against a running local API to archive those read-only evidence endpoints under `.tmp/rehearsal-evidence/` for operator notes. This is local rehearsal evidence only; it does not validate Jetson/Pi hardware or real MAVLink/ROS connections. For real bench runs, add `--require-source mavlink:telemetry:drone-1,ros2-pose:telemetry,lidar-slam:lidar+spatial` so the snapshot fails if required read-only sources are missing, stale, or eventless.
Use `npm run rehearsal:note -- --label <run-name>` to generate a fill-in field-laptop rehearsal note under `.tmp/rehearsal-notes/`; it remains a template until a human operator fills the required timestamps, replay id, final hash, and deviations.
Use `npm run rehearsal:closeout -- --operator <name> --machine <id> ...` after a real run to validate the filled operator fields and before/after evidence snapshots. This is the only rehearsal note artifact that can set `freshOperatorCompleted: true`.
Use `npm run hil:failsafe:evidence -- --operator <name> --target jetson-orin-nano ...` after an actual HIL bench run to validate manual override, E-stop, actual board evidence, source evidence, and a non-empty flight log before HIL evidence can be marked completed.
Use `npm run isaac:hil:evidence -- --operator <name> --target jetson-orin-nano ...` after an actual Isaac Sim to Jetson bench run to validate actual board evidence, Isaac source-health evidence, capture manifest, capture log, and `commandUploadEnabled: false` before Isaac HIL capture evidence can be marked completed.
Use `npm run policy:hardware:gate -- --operator <name> --target jetson-orin-nano --vehicle <id> --reviewers "Safety Lead,Test Director" --reviewed-at <iso> --policy <json> --hardware-evidence <json> --hil-evidence <json> --command-upload-enabled false` only after the real evidence package exists. The result can be `ready-for-human-review`, but its authorization fields remain false and real command upload remains blocked.
Use `npm run audit:completion` to write a local completion audit under `.tmp/completion-audit/`; it separates local alpha readiness from real-world blockers, emits separate actual Jetson Orin Nano and Raspberry Pi 5 blocker items, verifies acceptance is tied to the latest release checksum, command-boundary scan, and final API probe evidence, and prevents fixture/SITL evidence from being mistaken for hardware validation.
Use `npm run safety:command-boundary` to write `.tmp/safety-evidence/` static scan evidence that real adapter command methods still reject, SITL command tokens stay in SITL mapping code, and unsafe command-upload or hardware-actuation flags are not set to true in production source. Acceptance recording validates the latest passing scan, keeps `--out`, `SEEKR_ACCEPTANCE_STATUS_PATH`, `--releaseDir`, and `--safetyDir` under the project root, and embeds the scan summary in `/api/session`.
Use `npm run demo:package -- --label <demo-name>` after acceptance and completion audit to write `.tmp/demo-readiness/` JSON/Markdown handoff evidence that points at the latest acceptance, release, command-boundary scan, API probe, audit, source-control handoff, hardware archive, policy gate, and overnight status artifacts. It can mark the local alpha package ready while preserving real-world blockers, false hardware claims, a perspective review for operator/safety/DX/replay/demo-readiness, and a next-evidence checklist for each blocked real-world item; the DX perspective treats missing, malformed, unpublished, dirty, or pre-acceptance ready source-control handoff evidence as a gap, and records a clean published GitHub handoff as readiness evidence only when it is current against acceptance.
Use `npm run bench:evidence:packet -- --label <bench-name>` after `demo:package` to write `.tmp/bench-evidence-packet/` JSON/Markdown task cards for the missing real-world evidence. The packet splits actual Jetson Orin Nano and Raspberry Pi 5 archive collection into separate target-specific cards, keeps all authorization fields false, and does not validate hardware by itself.
Use `npm run handoff:index -- --label <handoff-name>` after `demo:package` and `bench:evidence:packet` to write `.tmp/handoff-index/` JSON/Markdown evidence that the latest package, bench packet, acceptance, release, audit, safety scan, API probe, hardware archive, policy gate, and overnight pointers are internally consistent. The index also checks that both acceptance status and the demo package point at the same latest command-boundary scan and API-probe evidence, and that the API probe read back the acceptance timestamp, command count, exact strict local AI scenario names, release checksum, and command-boundary scan. It records SHA-256 digests for linked handoff artifacts, but does not clear real-world blockers or authorize hardware actuation.
Use `npm run handoff:verify` to verify the latest handoff index digest table without regenerating the index. Pass `-- --index .tmp/handoff-index/<file>.json` to verify a specific handoff index copied into a review packet.
Use `npm run qa:gstack` after acceptance or `npm run smoke:preview` to regenerate the local `.gstack/qa-reports/` browser QA Markdown report and desktop/mobile screenshots from a clean production-shell run. It is report-only evidence: it verifies `/api/session`, readiness, hash-chain verification, and `commandUploadEnabled: false` without clearing hardware blockers.
Use `npm run audit:gstack` after handoff verification and before final bundling to write `.tmp/gstack-workflow-status/` JSON/Markdown evidence for the gstack health, review, planning, and QA workflow request. It records local skill availability, whether the `gstack` CLI is on PATH, the exact ordered health/review/planning/QA workflow rows, demo perspective critiques with exact ordered operator/safety/DX/replay/demo-readiness rows and status/score/next-action detail, latest gstack health-history status/path, the latest `.gstack/qa-reports/` browser QA report status/path and named screenshot paths when present, and the Git metadata path when present or missing-Git limitation when absent without claiming a diff review ran. If health history predates acceptance or lacks a parseable `ts` or `timestamp` field, or if the browser QA report predates acceptance, it is recorded as stale instead of treated as current proof. If the QA report contains a failed check row or references a missing screenshot artifact, the workflow audit fails.
Use `npm run audit:source-control` to write `.tmp/source-control-handoff/` JSON/Markdown evidence for the GitHub handoff state. It checks package/README repository references, the parent GitHub landing README ordered fenced shell command lines for a fresh-clone path into `SEEKR/software`, bounded smoke before strict local AI smoke before plug-and-play audit guidance, local Git metadata, configured remotes, GitHub remote refs/default branch with `git ls-remote`, a shallow `git clone --depth 1` smoke proof for the landing README, `software/package.json`, `software/package-lock.json`, `software/.env.example`, `software/scripts/rehearsal-start.sh`, operator quickstart, shared operator-quickstart contract, and `npm ci --dry-run` install consistency, whether local HEAD matches the GitHub default branch SHA, and whether the local worktree is clean. It persists an exact ordered source-control check list, blocked/warning check counts, plus a manual publication next-action checklist for missing or misordered GitHub landing guidance, incomplete fresh-clone contents, invalid published operator quickstart guidance, `.git`, origin, refs, unpublished HEAD, dirty worktrees, and re-audit steps. Shared validators reject a `github-landing-readme` pass unless it retains ordered fenced shell command-line proof through bounded smoke, strict local AI smoke, and plug-and-play audit, explicitly says command upload and hardware actuation stay disabled/blocked/locked/false without negating that safety statement, and includes the distinct `github-landing-readme-ai-readiness-proof` marker for final AI/readiness proof command guidance. Shared validators also reject a `fresh-clone-smoke` pass unless it retains the GitHub URL, exact shallow clone command, exact npm dry-run command, shared operator-quickstart contract proof, and every startup-critical `fresh-clone:` file evidence entry, and the audit never initializes Git, commits, pushes, changes GitHub settings, validates hardware, or enables command upload.
Use `npm run audit:todo` after `audit:completion` to write `.tmp/todo-audit/` JSON/Markdown evidence that unchecked items in `docs/SEEKR_GCS_ALPHA_TODO.md` and `docs/SEEKR_COMPLETION_PLAN.md` still cover the current real-world blocker categories. It records the exact ordered blocker-category rows, top-level category, real-world blocker, blocked-category, and validation-blocker counts, and fails closed if the latest completion audit is missing, stale, or command upload is not false.
Use `npm run setup:local` after `npm ci` to create `.env` from `.env.example` only when missing, prepare `.tmp/rehearsal-data`, and write `.tmp/plug-and-play-setup/` evidence without enabling command upload or overwriting operator edits.
Use `npm run doctor` before final plug-and-play packaging, or directly when you want a standalone preflight artifact, to write `.tmp/plug-and-play-doctor/` JSON/Markdown evidence with `profile: "operator-start"`. It checks package scripts including `setup:local`, package `engines`/`packageManager`, Node/package-lock readiness, `.npmrc` `engine-strict`, `.gitignore` protection for local secrets/generated artifacts including runtime `data/`, the latest source-control handoff artifact for `https://github.com/Ayush1298567/SEEKR`, local `tsx`/`concurrently`/`vite` dependency binaries needed by `npm run dev`, the `rehearsal:start` wrapper contract, project-local env setup, local Ollama model availability, API/client port availability or healthy already-running SEEKR listeners, local data directory safety, and command-upload/hardware-actuation environment flags without starting the app or validating hardware. Occupied default ports pass when they already serve a healthy local SEEKR instance, or when the wrapper can prove unconfigured defaults will be auto-replaced with free local API/client ports; explicitly configured occupied ports remain warnings and include read-only listener PID/cwd diagnostics when the OS exposes them. The rehearsal wrapper normalizes `PORT`/`SEEKR_API_PORT` and auto-selects free local API/client ports when unconfigured defaults are busy, while explicit operator port choices remain explicit. Rerun it after `npm run smoke:rehearsal:start` and before final bundling, because the smoke wrapper refreshes source-control evidence and writes only a `profile: "rehearsal-start-smoke"` doctor. Missing Git metadata, missing GitHub refs, unpublished local HEAD, or dirty worktree state remain explicit source-control warnings after semantic validation, while malformed or unsafe source-control handoff artifacts fail local startup preflight.
Use `npm run rehearsal:start` as the plug-and-play local operator start command. It sets a project-local rehearsal data directory, declares expected read-only MAVLink/ROS/LiDAR/Isaac source categories for source-health visibility, normalizes the API port environment for the server and Vite proxy, fails fast if `PORT` and `SEEKR_API_PORT` are both explicit and disagree, auto-selects free local ports when default ports are busy and no port variables were explicitly set, runs non-destructive `npm run setup:local`, refreshes `npm run audit:source-control`, runs `npm run doctor`, and then launches `npm run dev`; it does not validate hardware or enable command upload.
Use `npm run smoke:rehearsal:start` to run a bounded proof of the one-command operator path. It launches `npm run rehearsal:start` on temporary local ports, marks the internal doctor run as `profile: "rehearsal-start-smoke"`, waits for API/client readiness, checks `/api/config`, `/api/source-health`, and `/api/readiness`, verifies command upload stays disabled, shuts the process group down, and writes `.tmp/rehearsal-start-smoke/` JSON/Markdown evidence with exact ordered smoke rows.
Use `npm run handoff:bundle -- --label <review-name>` after handoff verification, `audit:gstack`, `audit:source-control`, `audit:todo`, `setup:local`, `smoke:rehearsal:start`, and a final standalone `doctor` rerun to copy the verified handoff index, linked local artifacts, latest gstack workflow-status artifact, latest referenced gstack browser QA report and screenshots, latest TODO audit artifact, latest source-control handoff artifact, latest plug-and-play setup artifact, latest operator-start plug-and-play doctor artifact, latest rehearsal-start smoke artifact, strict local AI smoke status, and `docs/OPERATOR_QUICKSTART.md` into `.tmp/handoff-bundles/` for internal review. The bundle command verifies the handoff digest table and requires passing or limitation-only workflow status with `gstackAvailable: true`, exact ordered workflow and perspective rows, `pass-with-limitations` for limitation-only evidence, preserved manifest-level limitation details including unavailable gstack CLI details, preserved limitation details for stale or missing health/QA evidence, per-workflow skill availability, Git review evidence paths when Git metadata is present or no-Git limitations when the workspace lacks `.git`, health-history status/path, QA screenshot path preservation, TODO artifacts with exact ordered blocker category IDs, matching top-level/category blocker counts, well-formed supporting TODO/blocker match evidence, a read-only source-control handoff artifact with GitHub/local-Git publication, local-head, and worktree-cleanliness state preserved for review, no ready source-control handoff generated before the latest acceptance record, passing plug-and-play setup evidence, passing operator-start plug-and-play doctor evidence for repository safety, matching source-control handoff path preservation, runtime dependencies, startup checks, and freshness against acceptance, exact ordered rehearsal-start smoke evidence for startup/source-health/readiness/shutdown, strict local AI smoke proof that matches acceptance and preserves per-case plan-kind, validator, unsafe-text, and mutation safety fields, and operator quickstart coverage for GitHub clone plus `cd SEEKR/software`, setup/source-control audit/start, strict AI smoke proof, advisory-only Ollama AI that cannot create command payloads or bypass validation, API evidence, source-health, real-world blockers, and non-negated disabled command/hardware authority first, keeps all authorization fields false, and does not validate hardware by itself.
Use `npm run handoff:bundle:verify` to verify the latest copied review bundle after packaging or transfer. Pass `-- --bundle .tmp/handoff-bundles/<file>.json` to verify a specific bundle manifest; it checks copied-file byte counts, SHA-256 digests, copied acceptance status with the exact required strict local AI scenario names, copied strict local AI smoke status with exact Ollama scenario order, acceptance-matched timestamp/model, per-case plan-kind, validator pass, no unsafe operator-facing text, and no thinking-time mutation, copied API-probe readback of that acceptance timestamp, command count, scenario names, release checksum, command-boundary scan, and disabled command upload, copied gstack workflow semantics including exact workflow/perspective row order and perspective status/score/next-action details, copied gstack QA report and screenshot inclusion plus report-content pass/command-safety, copied TODO audit exact blocker-category order/top-level-count/support-shape semantics, copied source-control handoff semantics including ready-artifact freshness against copied acceptance, copied plug-and-play setup exact env/data/safety row semantics, copied operator-start plug-and-play doctor exact repository-safety/source-control-handoff/runtime/start-wrapper/AI/port/data/safety row semantics including a source-control evidence path that matches the copied source-control handoff, freshness against copied acceptance, copied rehearsal-start smoke exact ordered startup/source-health/readiness/shutdown row semantics, copied operator quickstart GitHub clone/software-directory setup/source-control audit/start/strict-AI-smoke/advisory-AI/API/source-health/safety guidance including no AI-created command payloads or validation bypass, requires critical doctor checks to pass while allowing only source-control/port/data-directory warnings, and full high-confidence secret-scan coverage while keeping hardware claims false.
Use `npm run audit:plug-and-play` after acceptance, API probe, `qa:gstack`, `audit:gstack`, `audit:source-control`, `audit:todo`, `setup:local`, `smoke:rehearsal:start`, the final standalone `doctor`, and bundle verification to write `.tmp/plug-and-play-readiness/` JSON/Markdown evidence that the local app, local Ollama AI, API readback, QA report, review bundle, setup artifact, operator-start doctor artifact, rehearsal-start smoke artifact, operator quickstart, and safety boundary are ready for an internal-alpha plug-and-play operator while preserving real-world blockers. It directly matches the API probe's session-visible timestamp, local-AI summary including exact required strict smoke scenario names, release checksum, and command-boundary scan summaries to the latest acceptance status before allowing local plug-and-play readiness. It also checks that the verified review bundle points at the latest handoff bundle, gstack workflow status, gstack QA report, TODO audit, source-control handoff, plug-and-play setup, operator-start plug-and-play doctor, rehearsal-start smoke, strict local AI smoke status, and packaged operator quickstart, that the latest ready source-control handoff artifact passes the shared read-only semantic guard and was generated no earlier than the latest acceptance record before publication gaps are treated as warnings, that the operator-start doctor preflight is current relative to the latest acceptance record and references the latest source-control handoff artifact, that `docs/OPERATOR_QUICKSTART.md` covers GitHub clone plus `cd SEEKR/software`, setup/source-control audit/start, strict local AI smoke proof, local AI as advisory-only with no command-payload creation or validation bypass, API evidence, source health, real-world blockers, and non-negated disabled command/hardware authority, and that the setup/operator-doctor/smoke artifacts contain the exact expected env/data/package-script/runtime/repository-safety/source-control-handoff/start-wrapper/local-AI/port/safety/startup/readiness rows in order with critical checks passing and only source-control/port/data-directory warnings allowed.
Use `npm run audit:goal` after handoff verification, `audit:gstack`, `audit:todo`, bundling, bundle verification, and `audit:plug-and-play` to write `.tmp/goal-audit/` JSON/Markdown evidence that restates the objective as a prompt-to-artifact checklist. It verifies named docs including `docs/OPERATOR_QUICKSTART.md`, package scripts, safety-boundary evidence, acceptance/release/API probe evidence with session-visible timestamp, local-AI summary including strict smoke scenario names, release checksum, and command-boundary readback matching acceptance, completion audit, demo/handoff/bundle/gstack chain including strict local AI smoke status pointers, plug-and-play readiness including current acceptance/API probe, source-control handoff, operator quickstart references, warning details, and persisted blocker-count/list agreement, TODO/blocker consistency, and its own persisted remaining-blocker count/list without claiming hardware validation.
Use `GET /api/hardware-readiness?target=jetson-orin-nano`, `npm run probe:hardware -- --target jetson-orin-nano`, or `npm run probe:hardware:archive -- --target jetson-orin-nano` for read-only edge bench checks and archived evidence. Treat archives with `hardwareValidationScope: "off-board-readiness"` as setup evidence only.

More local guidance:

- `docs/FIELD_LAPTOP_RUNBOOK.md`
- `docs/OPERATOR_QUICKSTART.md`
- `docs/DEVELOPER_QUICKSTART.md`
- `docs/SEEKR_COMPLETION_PLAN.md`
- `docs/OVERNIGHT_LOOP.md`
- `docs/RETENTION_POLICY.md`
- `docs/EDGE_HARDWARE_BENCH.md`
- `docs/FLIGHT_SOFTWARE.md`
- `docs/LIDAR_AI_DIMOS_RESEARCH.md`
