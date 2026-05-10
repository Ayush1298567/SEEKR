# SEEKR GCS Internal Alpha Todo

This is the working checklist for getting the GCS from demo-ready to serious internal alpha. The drone/aircraft command path remains out of scope until this list proves the GCS can be operated, audited, replayed, and recovered consistently.

## Alpha Gate

- [x] Acceptance command exists and runs check, local AI smoke, UI smoke, and build.
- [x] Acceptance command records `/api/session` visible acceptance evidence after the full gate passes.
- [x] Readiness API and modal prove hash-chain, replay, report, incident log, fixture, AI, and safety-boundary status.
- [x] Source-health API and modal show event-source freshness from the mission log.
- [x] Mutating API routes can be protected by optional internal auth.
- [x] Run-session manifest captures launch config, software version, data paths, and process identity.
- [x] Run-session manifest reports latest acceptance status, strict AI smoke, release checksum, and command boundary.
- [x] Expected source config flags missing MAVLink/ROS/detection/spatial sources before field rehearsal.
- [x] UI smoke is split into focused workflows with clearer failures.
- [x] Local field-laptop runbook exists for setup, launch, acceptance, export, and shutdown.
- [x] Clean-data rehearsal path is documented and tested.
- [x] Local rehearsal evidence command archives read-only API snapshots before/after a field-laptop run.
- [x] Rehearsal note command generates fill-in fresh-operator notes without claiming completion.
- [x] Rehearsal closeout command validates filled operator notes before `freshOperatorCompleted: true`.
- [x] Completion audit command reports local alpha status separately from real-world blockers.

## Operator Trust

- [x] Hash-chain verification is available through `/api/verify`.
- [x] Replay manifests persist and reload after restart.
- [x] Mission report export contains final hash and limitations.
- [x] Incident log export is read-only.
- [x] Readiness modal is read-only.
- [x] Source-health modal is read-only.
- [x] Readiness links directly to source-health stale sources.
- [x] UI footer distinguishes transient API disconnect, stale source, and command rejection.
- [x] Operator can copy mission id, final hash, and replay id from artifact modals.
- [x] Operator can reset demo data directory intentionally with a guarded script.
- [x] Operator can see current build/software version in the UI.

## API Hardening

- [x] Command lifecycle routes validate through the normal command handler.
- [x] Ingest routes reject malformed/stale/low-confidence payloads before mutation.
- [x] Reports, incident logs, passive plans, input requests, readiness, and source health are read-only.
- [x] Optional `SEEKR_INTERNAL_TOKEN` protects mutating routes.
- [x] Auth failures are tested for commands, ingest, import, AI proposal creation, export, and compatibility routes.
- [x] Read-only routes remain open in local mode unless auth is explicitly required.
- [x] Request body size and JSON parse errors return predictable API errors.
- [x] API error response schema is documented.
- [x] Add `/api/session` for process/run config.
- [x] Add acceptance evidence to `/api/session`.
- [x] Add `/api/config` read-only operator-visible config with secrets redacted.
- [x] Add expected-source config to `/api/source-health`.
- [x] Add a config validation warning to readiness.

## Persistence And Replay

- [x] Append-only events are serialized in order.
- [x] Persisted events rebuild reducer state on startup.
- [x] Tampered event logs fail hash-chain validation.
- [x] Replay seek rebuilds from event genesis.
- [x] Session manifest records boot time, data directory, event path, replay dir, and env toggles.
- [x] Rehearsal export includes session manifest metadata.
- [x] Replay manifest verifies event count and final hash on read.
- [x] Add retention policy docs for `data/`, `.tmp/`, exports, and evidence URI references.
- [x] Add fixture to import a saved mission-events bundle and verify replay parity.

## Source Health

- [x] Source health derives event sources without appending events.
- [x] Live channels warn when stale during running mission.
- [x] Expected sources can be configured by env.
- [x] Missing expected sources appear before any event arrives.
- [x] Per-source stale thresholds can be configured.
- [x] Source health appears in readiness summary.
- [x] Source health includes last event sequence.
- [x] Source health includes rejected import/ingest counts when available.
- [x] UI shows source status in the topbar or footer.

## UI Workflows

- [x] Operator can start/pause/reset mission.
- [x] Operator can create local no-fly planning constraints.
- [x] Operator can review detections and evidence.
- [x] Operator can export report and incident log.
- [x] Operator can export/reload/start/seek replay.
- [x] Operator can open readiness and source-health modals.
- [x] Split UI smoke into mission controls, evidence, spatial, artifacts, replay, readiness/source-health.
- [x] Add failure screenshots to docs/runbook.
- [x] Add small version/status panel.
- [x] Add keyboard-safe modal closing.
- [x] Add loading/error states for artifact modals.
- [x] Check layout at 1280x720, 1440x900, and compact field-laptop viewport.

## AI Boundary

- [x] Local Ollama smoke proves advisory output and no mutation while thinking.
- [x] Prompt-injection detection notes are sanitized.
- [x] Prompt-injection spatial metadata is sanitized.
- [x] AI can only select from validator-built candidate plans.
- [x] AI provider/model appears in `/api/session`.
- [x] Readiness warns when strict local AI test has not been run in current session.
- [x] AI proposal creation can be auth-protected when `SEEKR_INTERNAL_TOKEN` is set.
- [x] Add record of AI fallback reason in proposal tool calls.

## Security And Local Operations

- [x] Document local-only threat model.
- [x] Optional token auth for mutating API paths.
- [x] Token is never echoed by session/config endpoints.
- [x] CORS policy remains local-only by default.
- [x] CORS policy has an explicit local-only regression test.
- [x] Add field-laptop firewall/runbook note.
- [x] Add `.env.example` with safe defaults.
- [x] Add startup script for local rehearsal.
- [x] Add shutdown/export checklist.
- [x] Add release checksum evidence for field-laptop installs.
- [x] Add local rehearsal evidence snapshots for operator notes.
- [x] Add required-source checks to rehearsal evidence so real bench MAVLink/ROS/LiDAR sources must have fresh source-health events.
- [x] Add fill-in rehearsal note template generation for fresh-operator runs.
- [x] Add completed rehearsal closeout validation for fresh-operator runs.
- [x] Add command-boundary static scan evidence to catch accidental hardware command-path regressions.
- [x] Add persisted API-probe evidence so final session-visible acceptance readback is part of the audit/handoff chain.
- [x] Add HIL failsafe/manual override evidence archive validator without claiming a real run.
- [x] Add Isaac Sim to Jetson capture evidence archive validator without claiming a real run.
- [x] Add local completion audit evidence for readiness reviews.
- [x] Add demo readiness handoff package that preserves real-world blockers, false hardware claims, and next-evidence guidance.
- [x] Add bench evidence packet task cards for collecting the remaining real-world evidence without enabling command authority.
- [x] Add persisted bridge-run evidence for MAVLink serial and live ROS 2 wrappers so bench captures do not rely on terminal output.
- [x] Add handoff index evidence that verifies the latest demo package, bench packet, audit, acceptance, release, safety scan, hardware archive, policy gate, and overnight pointers agree, with linked-artifact SHA-256 digests.
- [x] Add handoff verification evidence that rechecks linked-artifact digests without regenerating the handoff index.
- [x] Add handoff bundle evidence that copies verified local handoff artifacts, latest gstack workflow-status artifact, and source-control handoff artifact for internal review without claiming hardware validation.
- [x] Add handoff bundle verification evidence that rechecks copied review artifacts, copied workflow-status semantics, copied source-control handoff semantics, and high-confidence secret-scan coverage after packaging without claiming hardware validation.
- [x] Add goal audit evidence that restates the objective as a prompt-to-artifact checklist without clearing real-world blockers.

## Drone Integration Prerequisites

- [x] Flight-core state, command, safety policy, and event contracts exist.
- [x] Flight command validator covers arm, takeoff, waypoint, hold, return-home, land, and hardware lockout.
- [x] Flight failsafe state machine covers battery, heartbeat, link, estimator, and geofence failures.
- [x] Deterministic onboard flight executive runs simulator/SITL command sequences.
- [x] Flight bench command proves arm/takeoff/waypoint/hold/RTH/land and safety rejections.
- [x] PX4 SITL adapter maps telemetry/modes/commands into flight-core traces.
- [x] ArduPilot SITL adapter maps telemetry/modes/commands into flight-core traces.
- [x] SITL bench command proves both autopilot mappings reject hardware transport.
- [x] MAVLink adapter command methods reject upload/hold/RTH.
- [x] ROS 2 adapter command methods reject upload/hold/RTH.
- [x] Jetson Orin Nano and Raspberry Pi 5 hardware readiness profiles exist.
- [x] Hardware readiness probe/API proves target host, tools, fixtures, source config, and command boundary without mutation.
- [x] Hardware readiness archive labels off-board evidence separately from actual target-board validation.
- [x] Edge hardware bench plan documents Jetson/Pi/Isaac/ROS test sequence.
- [x] Read-only MAVLink bridge runner forwards fixture/file/stdin telemetry to GCS ingest only.
- [x] Read-only ROS 2 map bridge runner forwards fixture/file/stdin map grids to GCS ingest only.
- [x] Edge bench rehearsal command runs temp API, bridge forwarding, source health, hardware readiness, export, and replay verify.
- [x] MAVLink fixture mapping covers heartbeat, battery, position, estimator, radio.
- [x] MAVLink binary capture parser covers heartbeat, battery, local position, estimator, and radio frames without command endpoints.
- [x] MAVLink UDP listener harness ingests bounded telemetry datagrams without command endpoints.
- [x] MAVLink UDP listener harness can write JSON/Markdown bridge evidence under `.tmp/bridge-evidence/`.
- [x] MAVLink serial capture wrapper ingests bounded telemetry bytes from a read-only device path without command endpoints.
- [x] MAVLink serial capture wrapper can write JSON/Markdown bridge evidence under `.tmp/bridge-evidence/`.
- [x] ROS 2 occupancy-grid fixture mapping exists.
- [x] ROS 2 PoseStamped/Odometry fixture mapping exists as read-only telemetry.
- [x] ROS 2 topic-echo envelope replay maps pose, costmap, and PointCloud2 metadata to read-only ingest endpoints.
- [x] Live ROS 2 topic-echo process wrapper exists for bounded read-only topic subscriptions.
- [x] Live ROS 2 topic wrapper can write JSON/Markdown bridge evidence under `.tmp/bridge-evidence/`.
- [x] Read-only real MAVLink connection design is documented.
- [x] Read-only real ROS 2 bridge design is documented.
- [x] Expected source config is tested with MAVLink/ROS source names.
- [x] Hardware decision gate links to GCS alpha evidence.
- [x] No real command path is enabled before the gate.
- [x] Hardware readiness archive command writes JSON/Markdown evidence without mutating mission events.
- [ ] Run hardware readiness probe on an actual Jetson Orin Nano.
- [ ] Run hardware readiness probe on an actual Raspberry Pi 5.
- [x] Wrap PX4 SITL adapter with a read-only process IO harness.
- [x] Wrap ArduPilot SITL adapter with a read-only process IO harness.
- [ ] Add HIL bench logs for failsafe behavior with manual override evidence.
- [x] Add fail-closed hardware-actuation policy review gate validator without installing a runtime policy.
- [ ] Add reviewed hardware-actuation policy file for a specific bench vehicle before any real command enablement.
- [ ] Connect read-only MAVLink bridge to a real serial/UDP telemetry source on bench hardware.
- [ ] Connect read-only ROS 2 bridge to real `/map`, pose, detection, LiDAR, and costmap topics on bench hardware.
- [x] Extend ROS 2 bridge runner from map grids to detection/spatial topics.
- [x] Add LiDAR point-cloud fixture ingest with density, bounds, frame id, transform confidence, and replay proof.
- [x] Spatial point-cloud bridge can write JSON/Markdown bridge evidence under `.tmp/bridge-evidence/`.
- [x] Add source-health channels for `lidar`, `slam`, `costmap`, and `perception`.
- [x] Research-spike DimOS replay/simulation and decide whether a `dimos-readonly` bridge is worth building.
- [x] Add DimOS/RTAB-Map/LIO-SAM/FAST-LIO2/Isaac ROS option matrix to the Jetson bench evidence package.
- [x] Add no-hardware `bench:dimos` for the deterministic DimOS-style read-only export contract.
- [x] Add deterministic Isaac Sim HIL-style bag-lite fixture for local import/source-health proof.
- [ ] Add Isaac Sim HIL fixture capture from Jetson bench run.

## Documentation

- [x] API docs include readiness and source health.
- [x] API docs include replay integrity verification and export run metadata.
- [x] V1 acceptance docs include readiness and source health.
- [x] Internal alpha track doc exists.
- [x] This todo is kept current as items land.
- [x] Add field rehearsal runbook.
- [x] Add operator quickstart.
- [x] Add developer quickstart with acceptance prerequisites.
- [x] Add known limitations section for alpha.

## Test Expansion

- [x] Unit tests cover readiness.
- [x] Unit tests cover source health.
- [x] API tests cover readiness and source health.
- [x] UI smoke covers readiness and source health.
- [x] Add auth middleware unit/API tests.
- [x] Add session manifest API tests.
- [x] Add expected-source source-health tests.
- [x] Split Playwright smoke into focused tests.
- [x] Add startup retry regression test where API is late.
- [x] Add build artifact smoke for production preview.
