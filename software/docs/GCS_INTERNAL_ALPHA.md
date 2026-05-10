# GCS Internal Alpha Track

Goal: make the GCS trustworthy for internal mission rehearsals before enabling any real aircraft command path.

## Current Bar

- Event-sourced mission state, hash-chain verification, persisted replay, reports, incident logs, and readiness checks pass acceptance.
- Operator UI covers start/pause/reset, local no-fly planning, evidence review, replay, spatial preview, passive plans, readiness, and source health.
- MAVLink, ROS 2, detection, spatial, and import paths are still read-only fixture/local-ingest paths.
- Real hold, return-home, mission upload, geofence upload, and aircraft command dispatch remain blocked.

## Alpha Exit Criteria

- `npm run acceptance` passes on a clean checkout with Ollama `llama3.2:latest` or an explicitly configured `SEEKR_OLLAMA_MODEL`.
- `/api/session`, `/api/config`, `/api/readiness`, `/api/source-health`, `/api/verify`, and `/api/replays` give operators enough evidence to prove the current run is configured, replayable, and auditable.
- `npm run rehearsal:evidence` archives those local read-only API snapshots for operator notes without claiming hardware validation. Real bench snapshots can add `--require-source` entries so missing read-only MAVLink/ROS/LiDAR events fail the evidence capture instead of becoming a soft note.
- `npm run rehearsal:closeout` validates filled operator timestamps, before/after evidence, replay id, final hash, and deviations before a fresh-operator run can be marked complete.
- Source health identifies stale or missing simulator/adapter/import/AI streams without mutating mission state.
- Optional `SEEKR_INTERNAL_TOKEN` protects mutating routes during internal rehearsals while preserving no-auth local development when unset.
- Reports and incident logs export current mission evidence without embedding binary blobs.
- Replay export/reload/seek reproduces reducer-built state and final hashes.
- Any future real adapter work starts from read-only telemetry first; command upload remains behind the hardware decision gate.

## Next GCS-Only Work

1. Capture a fresh-operator field-laptop rehearsal closeout with the exact setup, acceptance, rehearsal-evidence snapshots, export, replay, and shutdown timestamps.
2. Link real Jetson/Pi hardware readiness archives back to session/config/readiness/source-health outputs after bench runs.
3. Keep read-only real MAVLink/ROS connection rehearsals separate from any future hardware-actuation policy review.
