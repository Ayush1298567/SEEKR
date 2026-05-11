# SEEKR V1 Test Matrix

- Unit: map fusion, spatial asset validation, spatial previews, bag-lite imports, validators, task ledger, AI boundary, passive plans, incident logs, operator-input prompts, source health including expected sources/stale thresholds/last event sequence, adapter mappers, SITL process IO, report generation.
- AI strictness: actual local Ollama smoke when available, exact required strict-smoke scenario-name validation through acceptance, `/api/session`, API probe, plug-and-play readiness, and goal audit, mocked provider edge cases, prompt-injection fallback, spatial asset read tools, passive-plan generation, incident-log export, operator-input sanitization, spatial focused-search drafting, conflict no-fly drafting, stale/rejected proposal blocking, and no direct command mutation.
- Golden: `rubble-training` and `wilderness-ravine` event logs and final hashes.
- API: health, session manifest, redacted runtime config, optional internal auth, state, events, commands, scenarios, passive plan, operator-input request, readiness, source health, tools, replay, evidence, reports, incident logs, verify, spatial preview, MAVLink/ROS/detection/spatial ingest, and V2 import endpoints.
- WebSocket: initial snapshot envelope and reconnect latest snapshot.
- Persistence: append-only restore, snapshot read, persisted replay manifest reload, hash-chain tamper detection.
- UI: split Playwright workflows for mission controls/command review, evidence/spatial preview, and artifacts/readiness/source health/replay/layer toggles.
- Evidence and handoff: command-boundary scan, preview smoke, bounded rehearsal-start smoke, release checksum, acceptance recording with project-root-contained evidence paths, final API probe, bridge evidence artifacts, completion audit, source-control handoff audit for local Git metadata, GitHub refs/default branch, local HEAD publication, clean worktree status, exact ordered source-control check IDs, persisted blocked/warning counts, generatedAt freshness against acceptance in demo DX review, bundle creation, bundle verification, and plug-and-play readiness, and publication next-action checklist with a shared read-only semantic validator, TODO/blocker consistency audit with exact ordered category rows, demo package with source-control-aware DX perspective review, bench evidence packet, handoff index with API-probe acceptance timestamp/command-count/exact strict-AI readback, handoff digest verification, repeatable gstack browser QA report/screenshot generation, gstack workflow status with exact workflow/perspective row order, health-history, browser-QA freshness, and named QA screenshot paths, local setup env/data preparation, operator-start plug-and-play doctor runtime/dependency/repository-safety/source-control-handoff preflight including runtime `data` ignore coverage, dev-server binaries, unsafe source-control artifact blocking, healthy already-running SEEKR port recognition, read-only listener diagnostics for occupied non-SEEKR ports, source-control evidence matching against the packaged source-control handoff, and profile separation from rehearsal-start smoke doctor artifacts, shared exact-row plug-and-play setup/operator-start doctor artifact contract validation, operator quickstart setup/source-control audit/start/advisory-AI/evidence/safety coverage through the shared operator-quickstart contract including no AI-created command payloads or validation bypass, rehearsal start wrapper defaults plus setup-before-source-control-before-doctor-before-dev ordering, exact ordered rehearsal-start smoke evidence for setup/source-control/doctor/API/client/source-health/readiness/shutdown, handoff review bundle with copied exact-order workflow status, browser QA report/screenshots, exact-order TODO audit, source-control handoff, plug-and-play setup, operator-start doctor preflight, rehearsal-start smoke, and operator quickstart, review-bundle digest/acceptance/API-probe exact strict-AI readback/workflow exact row order/QA report-content/screenshot/TODO exact category order/source-control/setup/doctor/exact-row rehearsal-start-smoke/operator-quickstart freshness/secret-scan coverage verification, plug-and-play readiness audit with persisted blocker-count/list agreement, source-control handoff warnings only after semantic validation, stale review-bundle, stale source-control bundle pointer, pre-acceptance source-control handoff blocking, stale setup bundle pointer, stale operator doctor source-control evidence, stale rehearsal-start-smoke bundle pointer, missing operator quickstart source-control audit coverage, missing operator quickstart advisory-AI command-safety coverage, missing packaged operator quickstart source-control audit coverage, missing packaged operator quickstart advisory-AI command-safety coverage, unsafe start-wrapper, pre-acceptance operator-start doctor blocking, missing doctor-row blocking, extra/reordered doctor-row blocking, extra/reordered workflow/perspective row blocking, extra/reordered TODO category blocking, extra/reordered rehearsal-start smoke row blocking, and critical-versus-soft doctor status blocking with source-control warnings allowed, and goal audit with persisted remaining-blocker count/list plus stale plug-and-play readiness evidence and stale blocker-count evidence blocking.

Primary commands:

```bash
npm run acceptance
npm run check
npm run setup:local
npm run doctor
npm run rehearsal:start
npm run test:ai:local
npm run test:ui
npm run build
npm run bench:edge
npm run bench:flight
npm run bench:sitl
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
npm run bench:dimos
npm run safety:command-boundary
npm run smoke:preview
npm run smoke:rehearsal:start
npm run release:checksum
npm run acceptance:record
npm run probe:api
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
npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview
npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview
npm run bridge:spatial -- --dry-run --fixture lidar-point-cloud --evidence-label spatial-preview
```
