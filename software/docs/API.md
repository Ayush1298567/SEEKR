# SEEKR Local API

Base URL: `http://127.0.0.1:8787/api`

## State And Events

- `GET /health`
- `GET /session`
- `GET /config`
- `GET /state`
- `GET /events?sinceSeq=`
- `GET /verify`
- `GET /scenarios`
- `GET /passive-plan`
- `GET /operator-input-request`
- `GET /readiness`
- `GET /hardware-readiness?target=jetson-orin-nano|raspberry-pi-5`
- `GET /source-health`
- `GET /tools`

`GET /passive-plan` returns `{ ok, plan }` with `mode: "passive-read-only"`, current-state watch items, and non-command next actions for evidence review, spatial inspection, replay/export, and hash-chain verification. It does not append events or create command lifecycle records.
`GET /operator-input-request` returns a structured human-in-the-loop prompt with options, rationale, refs, and safety notes. It is read-only and does not record the prompt as a mission event.
`GET /readiness` returns `{ ok, generatedAt, missionId, stateSeq, checks, summary }`. Checks use stable IDs and `{ id, label, status, details, blocking }` for hash-chain verification, persisted replay availability, report export readiness, incident log readiness, fixture ingest availability, source health, runtime config, local AI status, strict local AI smoke evidence, safety boundary, and current open blockers. It is read-only; missing replay export, unavailable local Ollama, missing strict AI smoke evidence, source-health warnings, and config warnings are nonblocking, while hash/report/incident/fixture/safety failures are blocking.
`GET /hardware-readiness` returns a read-only bench report for `jetson-orin-nano` or `raspberry-pi-5`. It checks host OS/architecture, Node runtime, memory/disk budget, expected MAVLink/ROS sources, Docker/Podman, ROS 2 CLI, Jetson/Pi board telemetry tools, Isaac fit, bench fixtures, and the real-command safety boundary. Platform/tool mismatches are warnings when run off-board; command-upload acceptance is a blocking failure. It does not append mission events.
`GET /session` returns a redacted run-session manifest: software/schema version, boot time, PID, data directory, event/replay counts, latest acceptance evidence, and selected config flags. Acceptance evidence is read from `.tmp/acceptance-status.json` or `SEEKR_ACCEPTANCE_STATUS_PATH`; it reports `pass`, `missing`, `stale`, `software-mismatch`, `incomplete`, or `unsafe`, whether the result was recorded after the current server boot, strict local AI status, release checksum summary, latest passing command-boundary scan summary, and `commandUploadEnabled: false`. Secrets such as `SEEKR_INTERNAL_TOKEN` are never returned.
`GET /config` returns redacted operator-visible runtime config: ports, bind host, data paths, AI provider/model, auth state, expected sources, source-health stale threshold, and the explicit safety boundary. It never returns token values.
`GET /source-health` derives simulator, telemetry, map, detection, spatial, import, command, AI, and replay source health from the mission event log. It returns source status, channels, event counts, last event sequence, last update age, linked drone ids, expected-source flags, expected-source counts, stale threshold, and stale source IDs without appending events.

Expected sources can be declared before a rehearsal:

```bash
SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception" npm run dev
```

The live-source stale threshold defaults to 120 seconds and can be configured:

```bash
SEEKR_SOURCE_STALE_MS=180000 npm run dev
```

JSON is also accepted:

```json
[
  { "sourceAdapter": "mavlink", "channels": ["telemetry"], "droneIds": ["drone-1"] },
  { "sourceAdapter": "ros2-slam", "channels": ["map"] },
  { "sourceAdapter": "lidar-slam", "channels": ["lidar", "slam"] },
  { "sourceAdapter": "isaac-nvblox", "channels": ["costmap", "perception"] }
]
```

## Commands

- `POST /commands`
- `POST /commands/:id/approve`
- `POST /commands/:id/cancel`

Command body:

```json
{
  "kind": "zone.assign",
  "target": { "droneId": "drone-1", "zoneId": "zone-a" },
  "params": { "droneId": "drone-1", "zoneId": "zone-a" },
  "requestedBy": "operator"
}
```

When `SEEKR_INTERNAL_TOKEN` is set, mutating routes and replay/export session mutations require either:

```text
Authorization: Bearer <token>
x-seekr-token: <token>
```

The browser client reads the token from `localStorage.seekr.internalToken` or `VITE_SEEKR_INTERNAL_TOKEN`. Leaving `SEEKR_INTERNAL_TOKEN` unset preserves local no-auth development behavior.

Local no-fly planning constraint:

```json
{
  "kind": "no_fly_zone.add",
  "target": { "bounds": { "x": 30, "y": 22, "width": 3, "height": 3 } },
  "params": {
    "bounds": { "x": 30, "y": 22, "width": 3, "height": 3 },
    "reason": "Operator marked local hazard"
  },
  "requestedBy": "operator"
}
```

This updates only local GCS planning state. It does not upload a geofence or command aircraft.

Command kinds:

- `mission.start`
- `mission.pause`
- `mission.reset`
- `trust.set`
- `zone.assign`
- `drone.action`
- `detection.review`
- `alert.ack`
- `no_fly_zone.add`
- `scenario.load`
- `ai.proposal.approve`
- `replay.start`
- `replay.seek`
- `ingest.telemetry`
- `ingest.map-delta`
- `ingest.detection`

## Scenario Shortcuts

- `POST /scenarios/:id/load`

## Replay And Evidence

- `GET /missions/:missionId/export`
- `GET /missions/:missionId/report`
- `GET /missions/:missionId/incident-log`
- `GET /missions/:missionId/verify`
- `GET /replays`
- `GET /replays/:id/state`
- `GET /replays/:id/verify`
- `POST /replays/:id/start`
- `POST /replays/:id/seek`
- `GET /evidence/:assetId`
- `GET /spatial-assets`
- `GET /spatial-assets/:assetId`
- `GET /spatial-assets/:assetId/preview`

Replay responses include `ok`, `mode`, `replayId`, `currentSeq`, `totalEventCount`, `playing`, `speed`, `finalStateHash`, and reducer-built `state`.
Mission exports are written to the local replay manifest store under the configured SEEKR data directory, so `GET /replays` and replay start/seek survive server restart. Export manifests include the redacted session/config metadata captured at export time. `GET /replays` includes per-manifest integrity status, and `GET /replays/:id/verify` returns event-count, final-hash, and hash-chain verification errors/warnings for that replay. Invalid replay manifests are not loaded.
The operator UI reads this replay list on load and after export.
Mission reports default to Markdown. `GET /missions/:missionId/report?format=json` returns the same report sections as structured JSON: timeline, drone health, zone coverage, detections, evidence assets, command lifecycles, AI proposals, task ledger, hash status, and limitations.
Reports also include a spatial asset summary when Gaussian splat, point cloud, mesh, 4D reconstruction, spatial video, or VPS/VSP pose metadata has been ingested.
Incident logs default to Markdown. `GET /missions/:missionId/incident-log?format=json` returns a read-only incident artifact with counts, filtered timeline, evidence index, command summary, final state hash, and safety notes.
Spatial preview responses contain lightweight render data for the V2 Three.js viewer. They do not stream or embed real `.splat`, point-cloud, mesh, or video binaries.

## AI Boundary

- `GET /ai/status`
- `GET /tools`
- `POST /tools/:name/invoke`
- `POST /ai/proposals`
- `POST /ai/proposals/:id/approve`

AI proposals create drafts only. Approval routes through normal command lifecycle events.
Proposal responses include a `diff` with affected drone/zone, current value, proposed value, validator blockers/warnings, and stale-after metadata.
Approved `set-no-fly-zone` drafts create `no_fly_zone.added` events and update the mission `noFlyZones` array.

When Ollama is available locally, `/ai/proposals` can use `llama3.2:latest` or `SEEKR_OLLAMA_MODEL` as an advisory chooser. The model only selects from server-built candidate plans; invalid or unsafe output falls back to deterministic rules. Set `SEEKR_AI_PROVIDER=rules` to force deterministic mode.

Additional read tools derived from the spatial transcript review:

- `query_spatial_assets`
- `explain_spatial_asset`
- `summarize_spatial_scene`
- `find_coverage_gaps_3d`
- `correlate_detection_evidence`
- `explain_vps_pose_shift`
- `rank_spatial_assets`
- `generate_search_brief`
- `generate_passive_plan`
- `export_incident_log`
- `request_operator_input`

`generate_passive_plan` mirrors `GET /passive-plan` as an AI read tool. It is advisory only and returns no executable command payload.
`export_incident_log` mirrors `GET /missions/:missionId/incident-log?format=json` as an AI read tool and does not append events.
`request_operator_input` returns a sanitized operator question with bounded choices. It cannot execute answers or call command APIs.

## Read-Only Ingest

- `POST /ingest/telemetry`
- `POST /ingest/map-deltas`
- `POST /ingest/detections`
- `POST /ingest/adapter-events`
- `POST /ingest/spatial-assets`
- `POST /ingest/fixtures/mavlink/:name`
- `POST /ingest/fixtures/ros2-map/:name`
- `POST /ingest/fixtures/detection/:name`
- `POST /ingest/fixtures/spatial/:name`
- `POST /import/mission-events`
- `POST /import/spatial-manifest`
- `POST /import/rosbag-lite`
- `POST /import/fixtures/:name`

Telemetry accepts normalized `TelemetrySample` payloads, MAVLink-style fixtures, and bridge-normalized ROS 2 PoseStamped/Odometry-style records. Map deltas accept normalized `MapDelta` payloads or ROS 2 `OccupancyGrid`-style fixtures.
Map deltas are rejected before state mutation when oversized, out of bounds, stale, malformed, or below transform-confidence hard minimum.
Spatial assets accept metadata references for Gaussian splats, point clouds, meshes, 4D reconstructions, spatial video, and VPS/VSP pose fixes. Scene assets require a URI; VPS/VSP pose fixes may omit URI but must reference a known drone. Spatial assets are rejected before state mutation when stale, outside map bounds, low confidence, or below transform-confidence hard minimum. VPS/VSP pose fixes update local estimator state only and do not command aircraft.
Import endpoints are local-first V2 test surfaces. `rosbag-lite` accepts JSON records for telemetry, MAVLink, ROS 2 map grids, map deltas, detections, and spatial assets; unsupported records are returned in `summary.rejected`. `spatial-manifest` imports asset arrays. `mission-events` validates hash chains before replaying imported events into the local store.
The deterministic `isaac-sim-hil-lite` import fixture contains telemetry, costmap, detection, and point-cloud records from an Isaac Sim HIL-style pipeline. It is read-only fixture evidence, not live Jetson capture proof.

Read-only bridge runners wrap the ingest endpoints for bench testing:

```bash
npm run bridge:mavlink -- --fixture heartbeat,battery-status --base-url http://127.0.0.1:8787
npm run bridge:ros2 -- --fixture occupancy-grid,nvblox-costmap,detection:evidence-linked-detection,spatial:lidar-point-cloud --base-url http://127.0.0.1:8787
ros2 topic echo --json /drone/pose | npm run bridge:ros2 -- --stdin --topic /drone/pose --base-url http://127.0.0.1:8787
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
npm run probe:hardware:archive
npm run bench:edge
```

The bridge runners support `--dry-run`, `--file`, and `--stdin` for fixture capture replay. The MAVLink runner also supports `--binary-file`, `--hex`, and bounded `--udp-port` listening for common v1/v2 telemetry frames. The ROS 2 runner accepts map fixtures by default and prefixed `pose:<fixture>`, `odometry:<fixture>`, `detection:<fixture>`, or `spatial:<fixture>` inputs for read-only topic replay. For topic-echo streams, the ROS 2 runner accepts `{ "topic": "/...", "msg": { ... } }`/`message` envelopes, or `--topic <name>` for a single stdin/file stream. Topic names route PoseStamped/Odometry to telemetry, OccupancyGrid/costmap to map deltas, and PointCloud2-style LiDAR metadata to spatial point-cloud assets. They only call ingest endpoints and report `commandEndpointsTouched: false`.
The SITL process IO runner accepts `--fixture`, `--file`, or `--stdin` records from captured simulator stdout and reports `commandUploadEnabled: false`.

## Response Codes

- `400` malformed input, malformed JSON, or rejected fixture shape.
- `404` missing command, replay, evidence, or mission.
- `409` validation blocker for command/proposal execution.
- `413` request body exceeds the 2mb JSON limit.
- `202` accepted mutating command or ingest.
- `207` local import accepted with partial record rejection.

Error responses use a predictable JSON envelope:

```json
{
  "ok": false,
  "code": "MALFORMED_JSON",
  "error": "Request body must be valid JSON"
}
```

Validation errors include `details`; internal tokens and other secrets are never returned.

## Compatibility Endpoints

The original local prototype endpoints remain:

- `POST /mission/start`
- `POST /mission/pause`
- `POST /mission/reset`
- `POST /trust-mode`
- `POST /zones/assign`
- `POST /drones/:id/action`
- `POST /detections/:id/review`
- `POST /alerts/:id/ack`
- `POST /ai/propose`
- `GET /export`
- `GET /export/audit.ndjson`

## WebSocket

- `ws://127.0.0.1:8787/ws`

Envelope:

```json
{
  "type": "state.snapshot",
  "missionId": "seekr-local-v1",
  "seq": 42,
  "sentAt": 1777900000000,
  "payload": {}
}
```
