# SEEKR V1 Test Matrix

- Unit: map fusion, spatial asset validation, spatial previews, bag-lite imports, validators, task ledger, AI boundary, passive plans, incident logs, operator-input prompts, source health including expected sources/stale thresholds/last event sequence, adapter mappers, SITL process IO, report generation.
- AI strictness: actual local Ollama smoke when available, local AI prepare model-to-acceptance binding, loopback Ollama URL preservation, exact required strict-smoke scenario-name validation through acceptance, `/api/session`, API probe, plug-and-play readiness, and goal audit, saved per-case validator/no-unsafe-operator-text/no-mutation proof in strict smoke status, mocked provider edge cases, prompt-injection fallback, spatial asset read tools, passive-plan generation, incident-log export, operator-input sanitization, spatial focused-search drafting, conflict no-fly drafting, stale/rejected proposal blocking, and no direct command mutation.
- Golden: `rubble-training` and `wilderness-ravine` event logs and final hashes.
- API: health, session manifest, redacted runtime config, optional internal auth, state, events, commands, scenarios, passive plan, operator-input request, readiness, source health, tools, replay, evidence, reports, incident logs, verify, spatial preview, MAVLink/ROS/detection/spatial ingest, and V2 import endpoints.
- WebSocket: initial snapshot envelope and reconnect latest snapshot.
- Persistence: append-only restore, snapshot read, persisted replay manifest reload, hash-chain tamper detection.
- UI: split Playwright workflows for mission controls/command review, evidence/spatial preview, and artifacts/readiness/source health/replay/layer toggles.
- Review bundle summaries: top-level fresh-clone local HEAD, clone HEAD, source-control handoff local HEAD, and source-control remote-default SHA publication, plus copied-bundle verification that those summaries match the copied fresh-clone operator smoke artifact.
- Evidence and handoff: command-boundary scan, preview smoke, bounded rehearsal-start smoke, fresh-clone operator smoke, release checksum, acceptance recording with project-root-contained evidence paths, final API probe, bridge evidence artifacts, completion audit, source-control handoff audit for the GitHub landing README ordered fresh-clone path, shallow fresh-clone contents for startup-critical package/env/AI-prep/start-wrapper/operator files, fresh-clone landing README contract proof, fresh-clone shared operator-quickstart contract proof, fresh-clone `npm ci --dry-run` install consistency, local Git metadata, GitHub refs/default branch, local branch, local HEAD publication, clean worktree status, exact ordered source-control check IDs, persisted blocked/warning counts, generatedAt freshness against acceptance in demo DX review, bundle creation, bundle verification, and plug-and-play readiness, and publication next-action checklist with a shared read-only semantic validator, TODO/blocker consistency audit with exact ordered category rows, demo package with source-control-aware DX perspective review, bench evidence packet, handoff index with API-probe acceptance timestamp/command-count/exact strict-AI readback including loopback Ollama URL, handoff digest verification, repeatable gstack browser QA report/screenshot generation, gstack workflow status with exact workflow/perspective row order, helper-tool root/count/name evidence when installed without the umbrella CLI, parser-compatible `health:gstack` health-history, browser-QA freshness, and named QA screenshot paths, local setup env/data preparation, local AI model preparation evidence, operator-start plug-and-play doctor runtime/dependency/repository-safety/source-control-handoff preflight including runtime `data` ignore coverage, dev-server binaries, unsafe source-control artifact blocking, healthy already-running SEEKR port recognition, auto-recoverable unconfigured default-port conflict recognition, explicit occupied-port warning coverage, read-only listener diagnostics for occupied non-SEEKR ports, shared contract rejection when non-SEEKR port warnings drop listener diagnostics or auto-recoverable port passes drop fallback proof, source-control evidence matching against the packaged source-control handoff, and profile separation from rehearsal-start smoke doctor artifacts, shared exact-row plug-and-play setup/operator-start doctor artifact contract validation, operator quickstart GitHub clone/software-directory/setup/ai:prepare/source-control audit/start/occupied-port recovery/`ollama pull llama3.2` model preparation/strict-AI-smoke/advisory-AI/evidence/safety coverage through the shared operator-quickstart contract with exact missing-signal reporting in bundle paths including no AI-created command payloads or validation bypass, rehearsal start wrapper defaults plus API-port normalization, free-port fallback, and setup-before-ai-prepare-before-source-control-before-doctor-before-dev ordering, exact ordered rehearsal-start smoke evidence for setup/ai-prepare/source-control/doctor/API/client/source-health/readiness/shutdown, exact fresh-clone operator smoke evidence for GitHub clone/install/operator-start/final-doctor checks and source-control HEAD summary preservation, handoff review bundle with copied exact-order workflow status, browser QA report/screenshots, exact-order TODO audit, source-control handoff plus top-level repository URL/configured-remotes/local-branch/default-branch/ref-count/blocked-check-count/warning-check-count/local/remote SHA and clean-worktree summary, plug-and-play setup, local AI prepare, operator-start doctor preflight, rehearsal-start smoke, fresh-clone operator smoke, strict local AI smoke status, and operator quickstart, review-bundle digest/acceptance/strict-AI smoke/API-probe exact strict-AI readback/workflow exact row order/QA report-content/screenshot/TODO exact category order/source-control summary agreement/setup/local-AI-prepare/doctor/exact-row rehearsal-start-smoke/fresh-clone-operator-smoke/operator-quickstart freshness/secret-scan coverage verification, plug-and-play readiness audit with top-level source-control repository URL/configured-remotes/local-branch/default-branch/ref-count/blocked-check-count/warning-check-count/SHA and clean-worktree summary agreement, top-level operator-start port fallback/listener summary agreement, top-level fresh-clone repository/local HEAD/clone HEAD/source-control HEAD/model/status/checked-row summary agreement, review-bundle repository URL/configured-remotes/local-branch/default-branch/ref-count/blocked-check-count/warning-check-count/SHA and clean-worktree summary agreement, persisted blocker-count/ID/list agreement, completion-audit `complete`/blocker-ID/list consistency, and direct unavailable-CLI gstack helper-tool evidence preservation, source-control handoff warnings only after semantic validation, stale review-bundle, stale source-control bundle pointer, source-control summary drift in plug-and-play readiness and goal audit, pre-acceptance source-control handoff blocking, stale setup bundle pointer, stale local AI prepare bundle pointer, stale operator doctor source-control evidence, stale rehearsal-start-smoke bundle pointer, stale fresh-clone-smoke bundle pointer and stale top-level fresh-clone summary blocking, missing strict-AI smoke status pointer blocking in plug-and-play readiness and goal audit, missing operator quickstart GitHub clone coverage, missing operator quickstart source-control audit coverage, missing operator quickstart local Ollama model-prep and ai:prepare coverage, missing operator quickstart strict-AI smoke proof coverage, missing operator quickstart advisory-AI command-safety coverage, missing packaged operator quickstart GitHub clone coverage, missing packaged operator quickstart source-control audit coverage, missing packaged operator quickstart local Ollama model-prep and ai:prepare coverage, missing packaged operator quickstart strict-AI smoke proof coverage, missing packaged operator quickstart advisory-AI command-safety coverage, unsafe start-wrapper, missing or check-only copied local AI prepare artifact, unsafe copied strict-AI smoke proof including non-loopback Ollama URLs, pre-acceptance operator-start doctor blocking, missing doctor-row blocking, extra/reordered doctor-row blocking, extra/reordered workflow/perspective row blocking, extra/reordered TODO category blocking, extra/reordered rehearsal-start smoke row blocking, and critical-versus-soft doctor status blocking with source-control warnings allowed, and goal audit with persisted remaining-blocker count/ID/list plus stale plug-and-play readiness evidence and stale blocker-count evidence blocking.

Primary commands:

```bash
npm run acceptance
npm run check
npm run setup:local
npm run ai:prepare
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
npm run health:gstack
npm run audit:gstack
npm run audit:source-control
npm run audit:todo
npm run setup:local
npm run ai:prepare
npm run smoke:rehearsal:start
npm run doctor
npm run smoke:fresh-clone
npm run handoff:bundle
npm run handoff:bundle:verify
npm run audit:plug-and-play
npm run audit:goal
npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview
npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview
npm run bridge:spatial -- --dry-run --fixture lidar-point-cloud --evidence-label spatial-preview
```
