# Integration Roadmap

V1 is simulator-first with read-only fixture integrations. Real aircraft command authority remains out of scope.

## 0. Onboard Flight Core

Goal: build and test the onboard flight executive before wiring it to PX4/ArduPilot.

Current implementation:

- `src/flight/` contains the flight state, command, safety policy, failsafe state machine, and deterministic simulator/SITL executive.
- `npm run bench:flight` runs arm, takeoff, waypoint, hold, return-home, land, hardware rejection, geofence rejection, and critical-battery failsafe.
- `npm run bench:sitl` runs PX4 and ArduPilot style SITL command mapping over the same flight core.
- `npm run bench:sitl:io` replays captured-process-style PX4/ArduPilot stdout fixtures and reports `commandUploadEnabled: false`.
- Hardware transport commands are rejected unless a future policy explicitly enables hardware actuation.

Acceptance:

- `npm run bench:flight` passes.
- Hardware transport commands are rejected by default.
- Failsafe transitions block non-recovery commands.
- SITL transport can be tested without touching real motors.
- PX4 and ArduPilot SITL mappings produce command traces and reject hardware transport.
- Process-facing SITL records parse without enabling hardware command upload.

## 1. MAVLink Telemetry Read-Only

Goal: read real vehicle state without command authority.

Design:

- Adapter runs in a read-only process or module with no mission upload, command-long, set-mode, arm, takeoff, hold, return-home, or geofence calls exposed.
- Adapter config must declare endpoint, system id filters, and source name. The expected source should be configured as `mavlink:telemetry:<droneId>` so `/api/source-health` can warn before first valid heartbeat.
- Each accepted message becomes a normalized local ingest payload, then a hash-chained mission event.
- Invalid, stale, or unsupported messages are counted by adapter logs first; only valid telemetry mutates the reducer.
- `/api/config`, `/api/readiness`, and `/api/source-health` must show the adapter is expected, observed, and still read-only before any rehearsal.

Map these messages into `TelemetrySample`, then reducer-built drone state:

- HEARTBEAT -> status/mode/liveness
- BATTERY_STATUS or SYS_STATUS -> battery
- LOCAL_POSITION_NED or ODOMETRY -> position
- ESTIMATOR_STATUS / EKF_STATUS_REPORT -> estimator quality
- RADIO_STATUS -> link quality where available

Acceptance:

- UI shows real drone heartbeat, battery, local pose, and mode.
- No command upload is enabled.
- `GET /api/hardware-readiness?target=jetson-orin-nano` or `?target=raspberry-pi-5` has no blocking failures on the actual bench target.
- `npm run probe:hardware:archive -- --target <target>` creates JSON/Markdown evidence for the bench notes.
- `npm run bridge:mavlink -- --dry-run --fixture heartbeat,battery-status,local-position-ned` validates captured telemetry before forwarding it to GCS ingest.
- `npm run bridge:mavlink -- --dry-run --binary-file <capture.bin>` parses common MAVLink v1/v2 telemetry captures with checksum validation before any live posting.
- `npm run bridge:mavlink -- --udp-port <port> --duration-ms <ms> --max-packets <n> --evidence-label mavlink-udp-bench` listens for bounded read-only MAVLink UDP telemetry, writes `.tmp/bridge-evidence/`, and never exposes command endpoints.
- `npm run bench:edge` passes with MAVLink fixture forwarding, ROS 2 map/costmap forwarding, LiDAR spatial fixture forwarding, source health, replay export, and replay integrity.
- Mission events record adapter telemetry source.
- Fixture endpoint: `POST /api/ingest/fixtures/mavlink/:name`.
- Readiness safety boundary still reports command upload, hold, and return-home probes as blocked.

## 2. Detection Event Ingest

Goal: accept onboard detector events from ROS 2, HTTP, or MAVLink extension messages.

Map into `Detection`:

- detection id
- drone id
- timestamp
- class/kind
- confidence
- local/world pose
- evidence frame id or thumbnail reference

Acceptance:

- Detections appear in the UI and can be reviewed.
- Detection review never changes raw evidence.
- Fixture endpoint: `POST /api/ingest/fixtures/detection/:name`.

## 3. Map Delta Ingest

Goal: consume compact occupancy/map deltas.

Design:

- ROS 2 bridge is read-only and subscribes to map/pose topics only.
- Bridge config must declare topic names, frame id, transform source, source name, and stale threshold. Expected source should be configured as `ros2-slam:map`.
- Occupancy grids and map deltas must pass transform-confidence, bounds, size, and staleness validation before reducer mutation.
- Bridge must not expose services/actions that can command navigation, mission upload, or mode changes.
- Source health tracks the last event sequence and age for the map source.

Supported paths:

- ROS 2 occupancy grid / voxel map bridge
- MCAP replay import
- custom HTTP map-delta ingestion

Acceptance:

- GCS map updates from external source.
- Map latency and source are logged.
- Unknown/known/occupied/frontier states stay separate.
- Fixture endpoint: `POST /api/ingest/fixtures/ros2-map/:name`.
- Bridge fixture replay: `npm run bridge:ros2 -- --fixture pose:pose-stamped,odometry:odometry` maps PoseStamped/Odometry-style records into telemetry with `sourceAdapter: "ros2-pose"`.
- Topic-echo replay: `ros2 topic echo --json /drone/pose | npm run bridge:ros2 -- --stdin --topic /drone/pose --base-url http://127.0.0.1:8787` maps a captured read-only topic stream without DDS service/action exposure. NDJSON envelopes with `topic` plus `msg`/`message` can mix `/map`, costmap, pose/odometry, detection, and PointCloud2-style LiDAR metadata in one replay file.
- Oversized, stale, low-transform, malformed, and out-of-bounds deltas are rejected before state mutation.

## 4. Replay And Evidence Package

Goal: export a mission bundle that can reconstruct what happened.

Bundle:

- hash-chained mission events
- mission state snapshots
- detections and reviews
- command lifecycle events
- evidence asset index
- adapter source metadata
- software/schema version

Acceptance:

- Replay reconstructs the same final state hash.
- Tampered event logs fail hash-chain validation.
- `GET /api/missions/:missionId/report` returns a Markdown V1 report.
- `GET /api/missions/:missionId/verify` returns hash-chain status and final state hash.

## 5. Spatial Asset And VPS/VSP Ingest

Goal: use transcript-derived spatial computing ideas without adding cloud or flight command authority.

Supported metadata:

- Gaussian splat scene reference.
- Point cloud or mesh scene reference.
- 4D reconstruction or spatial video timeline reference.
- VPS/VSP pose correction tied to a known drone.

Acceptance:

- Spatial assets are event-sourced through `spatial.asset.ingested`.
- Scene assets require URI, frame, confidence, transform confidence, and map anchor.
- VPS/VSP pose fixes update local reducer state for drone pose/estimator only.
- AI read tools can query and explain spatial assets.
- Mission report and replay export include spatial asset metadata.
- Fixture endpoint: `POST /api/ingest/fixtures/spatial/:name`.

## 5A. LiDAR, SLAM, AI Perception, And DimOS Research

Goal: turn LiDAR/depth/camera/IMU outputs into operator-visible map, pose, detection, and spatial-memory evidence without granting command authority.

Research source of truth:

- `docs/LIDAR_AI_DIMOS_RESEARCH.md`

Supported candidate inputs:

- ROS 2 `sensor_msgs/PointCloud2`.
- ROS 2 `nav_msgs/Odometry` or `geometry_msgs/PoseStamped`.
- RTAB-Map visual/LiDAR SLAM outputs.
- LIO-SAM or FAST-LIO2 LiDAR-inertial odometry outputs.
- Isaac ROS Nvblox 3D reconstruction and 2D costmaps on Jetson.
- DimOS replay/simulation or stream outputs, converted through a read-only sidecar adapter.
- Local detector outputs from CPU/GPU models.

Rules:

- All adapters are one-way into SEEKR ingest endpoints.
- LiDAR/AI/DimOS can create telemetry, map, detection, spatial asset, source-health, replay, and report evidence.
- LiDAR/AI/DimOS cannot arm, take off, set mode, hold, return home, upload geofences, upload waypoints, or bypass command validators.
- DimOS is treated as a pre-release research sidecar until its install/runtime, stream schemas, and safety behavior are proven in replay/SITL/HIL.

Acceptance:

- Point-cloud or costmap fixtures ingest and replay with hash parity.
- Source health reports `lidar`, `slam`, `costmap`, and `perception` channels.
- Rejected/stale/low-transform LiDAR frames are counted without mutating mission state.
- `npm run bench:edge` includes a spatial/point-cloud proof.
- `npm run bench:dimos` runs the deterministic DimOS-style read-only replay/export contract. A live DimOS replay/simulation run remains future bench evidence and must still stay one-way into SEEKR ingest.
- Real command upload remains blocked.

## 6. Future Command Upload Behind Validators

Goal: allow approved commands to reach vehicles.

Rules:

- All command requests go through `validateMissionPlan`.
- Operator approval is required in `semi-auto`.
- Flight controller failsafes remain authoritative.
- Commands and acknowledgements are persisted.

Initial future commands:

- hold
- return home

Later commands:

- assign zone as mission item sequence
- focused-search waypoint

V1 status: blocked. Adapter command methods intentionally reject real hold, RTH, and mission upload.
