# SEEKR Software Architecture

## Current Prototype

```text
React GCS UI
  |
  | HTTP + WebSocket envelopes
  v
Express GCS Server
  |
  | command lifecycle
  v
Event-sourced mission engine
  |
  +-- deterministic simulator
  +-- replay/export/evidence
  +-- map fusion testbed
  +-- spatial asset registry
  +-- spatial preview/import services
  +-- AI proposal boundary
  +-- MAVLink/ROS fixture ingest
  +-- append-only persistence
```

The stack is intentionally local-only. It can run during tabletop exercises or controlled field tests without internet. Mission events are append-only and hash-chained; mission state is a reducer-built read model.

## Module Boundaries

- `src/shared/schemas.ts` defines Zod schemas for state, events, commands, telemetry, map deltas, evidence, scenarios, replays, and AI proposals.
- `src/shared/envelopes.ts` defines WebSocket envelopes.
- `src/server/domain/missionReducer.ts` rebuilds mission state from mission events.
- `src/server/domain/mapFusion.ts` owns deterministic map-delta validation, confidence fusion, conflict cells, and conflict alerts.
- `src/server/domain/spatialAssets.ts` owns validation for local Gaussian splat, point cloud, mesh, 4D reconstruction, spatial video, and VPS/VSP pose metadata.
- `src/server/domain/spatialPreview.ts` creates lightweight, deterministic preview geometry for the Three.js operator viewer.
- `src/server/domain/passivePlan.ts` creates read-only operator watch lists and next checks from reducer state without appending mission events.
- `src/server/domain/incidentLog.ts` creates read-only incident artifacts from the event log, evidence index, command lifecycle, and hash-chain status.
- `src/server/domain/operatorInput.ts` creates sanitized human-in-the-loop prompts that point operators back to validator-backed workflows.
- `src/server/importers/` owns V2 local import services for spatial manifests, bag-lite records, and hash-checked mission event logs.
- `src/server/domain/taskAllocator.ts` owns frontier targeting and deterministic reassignment scoring.
- `src/server/domain/commandHandler.ts` routes every operator/AI action through a command lifecycle.
- `src/server/domain/validators.ts` owns battery, geofence, estimator, link, offline, no-fly, clustering, and stale-proposal checks.
- `src/server/sim/` owns deterministic scenarios, seeded simulator ticks, planners, and scripted faults.
- `src/server/persistence/` owns event, snapshot, replay, and evidence stores.
- `src/server/adapters/` owns read-only MAVLink and ROS 2 fixture mapping.
- `src/server/ai/` owns the tool registry, deterministic proposal engine, and optional local Ollama/Llama advisory provider.
- `src/server/report.ts` generates Markdown/JSON mission report artifacts from reducer state and the event log.
- `src/server/api/` owns HTTP routes and WebSocket broadcast.
- `src/client/` owns the operator UI.

## Safety Boundary

The server is not flight-critical. Real flight safety must stay in PX4/ArduPilot and onboard failsafes. V1 can propose, validate, approve, replay, and ingest read-only fixtures, but real upload remains disabled until the command class passes safety-case gates. Local Llama output is never executed directly; it can only select one of the server's validator-built candidate plans and provide title/rationale text.

Spatial assets are operator context, replay metadata, and local estimator corrections only. Gaussian splats, point clouds, meshes, 4D reconstructions, and spatial video are stored as URI-backed references; binary scene blobs are not embedded in state or reports. VPS/VSP pose fixes can update local drone pose and estimator quality in the reducer, but they never dispatch aircraft commands.

The V2 spatial viewer is a client-side Three.js layer over reducer state and preview metadata. It renders mission-local previews for assets, drones, detections, zones, and no-fly planning boxes without changing mission state.

## Replay And Evidence

Mission exports include schema/software version, event count, scenario id, event log, snapshot, evidence index, spatial asset metadata in adapter metadata, import summaries, and final state hash. Exported replay manifests are persisted under the local SEEKR data directory and reloaded on boot. Replay seek rebuilds from genesis through the requested sequence using the same reducer path as live simulation. On server boot, valid persisted event logs rebuild state; tampered logs are rejected by hash-chain verification.
