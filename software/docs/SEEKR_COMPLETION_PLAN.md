# SEEKR Completion Plan

This is the full SEEKR path from internal alpha GCS to drone integration readiness. It is intentionally strict: the aircraft command path stays blocked until the GCS can prove auditability, replay, operator safety, and source health under rehearsal conditions.

## North Star

SEEKR should let a field operator run a search mission rehearsal, ingest real or fixture telemetry/map/detection context, trust what the GCS shows, export evidence, replay the run, and prove that no aircraft command path was enabled accidentally.

## Customer View

- [x] Map-first operator console opens locally and shows mission phase, coverage, drone status, alerts, detections, source health, readiness, replay, and exports.
- [x] Evidence and spatial assets can be inspected without hiding mission context.
- [x] Mission report, incident log, hash verification, source health, readiness, and replay are available as proof artifacts.
- [x] Local AI advice is advisory and bounded to validator-built proposals.
- [x] Real hold, return-home, mission upload, and geofence upload remain blocked.
- [ ] Field-laptop runbook is rehearsed by a fresh operator.
- [x] Operator can copy mission id, final hash, replay id, and build version from artifact surfaces.
- [x] UI surfaces source-health warnings in the topbar/footer without requiring modal discovery.
- [x] Compact field-laptop layouts are checked at 1280x720, 1440x900, and narrow viewport widths.

## Engineering View

- [x] Event-sourced mission state has hash-chain verification.
- [x] Replay export and replay seek rebuild state through the reducer.
- [x] API contracts cover core read-only and mutating surfaces.
- [x] Optional internal token auth protects mutating API paths.
- [x] `/api/session` exposes latest acceptance evidence without leaking secrets.
- [x] `/api/config` exposes operator-visible runtime config with secrets redacted.
- [x] `/api/source-health` includes expected-source counts, stale threshold, and last event sequence.
- [x] `/api/readiness` includes source-health and runtime-config warnings.
- [x] Playwright smoke is split into focused workflows with better failure isolation.
- [x] Startup retry behavior is regression-tested when the API is late.
- [x] Production preview build artifact has a smoke test.
- [x] Replay manifest reads verify event count and final hash before use.
- [x] Rehearsal exports include session manifest metadata.

## Security And Operations

- [x] Server binds to `127.0.0.1`.
- [x] Token auth secrets are never echoed by `/api/session` or `/api/config`.
- [x] Local-only threat model is documented.
- [x] Clean rehearsal data reset is guarded and scoped to `.tmp/rehearsal-data`.
- [x] Field-laptop firewall and shutdown/export notes are documented.
- [x] CORS policy has an explicit local-only regression test.
- [x] A release checksum is produced for field-laptop installs.
- [x] Local rehearsal evidence snapshots can be archived under `.tmp/rehearsal-evidence/`.
- [x] Fill-in rehearsal note templates can be generated under `.tmp/rehearsal-notes/`.
- [x] Completed rehearsal closeouts validate operator fields and before/after evidence before `freshOperatorCompleted: true`.
- [x] HIL failsafe/manual override evidence can be validated under `.tmp/hil-evidence/` without treating fixture/SITL output as a real HIL run; completion audit also rechecks the referenced actual hardware evidence, rehearsal evidence, and non-empty flight log before clearing the blocker.
- [x] Isaac Sim to Jetson capture evidence can be validated under `.tmp/isaac-evidence/` without treating the deterministic local fixture as a real Jetson capture; completion audit also rechecks the referenced actual Jetson evidence, Isaac source rehearsal evidence, capture manifest, and non-empty capture log before clearing the blocker.
- [x] Hardware-actuation policy review packages can be fail-closed under `.tmp/policy-evidence/` without installing a runtime policy or enabling command upload; completion audit also rechecks the referenced fail-closed policy, acceptance status, actual hardware evidence, and HIL evidence before clearing the blocker.
- [x] API-probe evidence can be persisted under `.tmp/api-probe/` so final `/api/session` acceptance readback is part of the audit trail.
- [x] Completion audit can distinguish local alpha readiness from real-world hardware blockers, requires acceptance to match the latest release checksum, command-boundary scan, and API-probe evidence, and only clears real MAVLink/ROS bench blockers when actual target-board evidence with `actualHardwareValidationComplete: true` and `hardwareValidationScope: "actual-target"`, live bridge-run evidence, and required-source rehearsal evidence exist.
- [x] Demo readiness packages can bundle acceptance, release, command-boundary scan, API-probe, completion-audit, hardware, and policy-gate pointers under `.tmp/demo-readiness/` without claiming real hardware validation.
- [x] Handoff indexes can verify the latest demo package, bench packet, acceptance, release, audit, safety scan, API-probe, hardware archive, policy gate, and overnight pointers under `.tmp/handoff-index/`, including demo-package-to-safety-scan/API-probe consistency, with SHA-256 digests for linked artifacts.
- [x] Handoff verification can recheck a latest or specified handoff index digest table under `.tmp/handoff-index/` without clearing real-world blockers.
- [x] Handoff bundles can copy a verified handoff index, its linked local artifacts, the latest gstack workflow-status artifact, and the latest source-control handoff artifact under `.tmp/handoff-bundles/` for internal review without clearing real-world blockers.
- [x] Handoff bundle verification can recheck copied bundle artifacts, copied workflow-status semantics, copied source-control handoff semantics, and high-confidence secret-scan coverage under `.tmp/handoff-bundles/` after packaging or transfer without clearing real-world blockers.
- [x] Goal audits can restate the objective as a prompt-to-artifact checklist under `.tmp/goal-audit/` without clearing physical hardware blockers.

## Drone Integration Gate

- [x] MAVLink adapter maps read-only fixture telemetry.
- [x] ROS 2 adapter maps read-only occupancy grid fixtures.
- [x] Adapter command methods reject upload/hold/RTH.
- [x] Hardware decision gate document exists.
- [x] Read-only real MAVLink connection design is documented for review.
- [x] Read-only real ROS 2 bridge design is documented for review.
- [x] Expected source config is tested with adapter source names.
- [x] Flight authority remains blocked until GCS alpha evidence is archived and reviewed.

## Build Order

1. Finish GCS internal alpha proof.
2. Harden local operations and fresh-machine setup.
3. Split UI smoke and add production preview smoke.
4. Add read-only real telemetry bridge design.
5. Build read-only adapter prototypes behind explicit config flags.
6. Rehearse with recorded logs only.
7. Decide whether a hardware command path is justified.

## Current Strict Status

GCS is a serious internal alpha. The next meaningful work is real-world evidence: a completed fresh-operator field-laptop closeout from an actual run, actual Jetson/Pi hardware readiness archives, real read-only MAVLink/ROS bench connections, HIL failsafe logs, Isaac Sim capture from the Jetson bench, and a human-reviewed policy package that still keeps runtime command authority disabled. Drone command upload remains blocked by design.
