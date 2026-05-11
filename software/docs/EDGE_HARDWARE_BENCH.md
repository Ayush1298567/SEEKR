# SEEKR Edge Hardware Bench Plan

This plan is for testing how SEEKR would run around drone hardware without enabling flight command authority. The GCS remains the system of record; Jetson/Pi boards are treated as read-only bridge/perception targets.

## Current Truth

- GCS internal alpha works in simulator, replay, readiness, and local fixture ingest.
- Flight-core and SITL benches exist; real hardware command support is not complete or enabled.
- Real MAVLink/ROS 2 mission upload, hold, return-home, set-mode, arm, takeoff, and aircraft geofence upload remain blocked.
- The next useful proof is hardware-in-the-loop read-only ingest: heartbeat, battery, local pose, map deltas, detections, spatial metadata, source health, replay, and reports.

## Target Roles

### NVIDIA Jetson Orin Nano

Use for onboard edge perception and ROS 2 bridge experiments.

Bench target:

- JetPack 6 / Ubuntu 22.04-family setup for Isaac ROS Humble workflows.
- Docker or equivalent container runtime.
- ROS 2 Humble for Isaac ROS packages.
- `tegrastats` and `nvpmodel` available for power/performance telemetry.
- Expected sources set before launch:

  ```bash
  SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception"
  ```

Notes from current official docs:

- NVIDIA Isaac ROS targets Jetson Orin with JetPack 6.0 and notes that Jetson Orin Nano 4GB may not have enough memory for many Isaac ROS packages.
- NVIDIA Isaac Sim HIL tutorials describe using Isaac Sim sensor data with Isaac ROS on Jetson and monitoring performance with `jtop`.

### Raspberry Pi 5

Use for lightweight read-only bridge tests, not GPU Isaac ROS.

Bench target:

- Ubuntu 24.04 LTS with ROS 2 Jazzy for aarch64 bridge tests, or Raspberry Pi OS for non-ROS transport experiments.
- 8GB+ preferred for sustained bridge loads.
- Active cooling and 5V/5A USB-C power.
- `vcgencmd` available for thermal/throttle checks.
- Expected sources set before launch:

  ```bash
  SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map"
  ```

Notes from current official docs:

- Raspberry Pi 5 has a 2.4GHz quad-core Arm Cortex-A76 CPU, VideoCore VII GPU, up to 16GB LPDDR4X, dual MIPI camera/display connectors, and PCIe 2.0 x1.
- ROS 2 Jazzy binary packages support Ubuntu 24.04 on amd64 and aarch64.

## Local Probes Added

Run on this Mac for dry-run shape, then run again on the target board for real host proof:

```bash
npm run probe:hardware
npm run probe:hardware -- --target jetson-orin-nano
npm run probe:hardware -- --target raspberry-pi-5
npm run probe:hardware:archive
npm run bench:edge
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
```

`npm run bench:edge` starts a temporary local SEEKR API, runs the read-only MAVLink bridge over heartbeat/battery/pose/estimator/radio fixtures, runs the read-only ROS 2 map bridge over occupancy-grid and nvblox-style costmap fixtures, runs the read-only spatial bridge over a LiDAR point-cloud fixture, verifies source health and hardware readiness, exports a replay, and verifies the replay integrity. It is the closest current substitute for a Jetson/Pi bench run without physical hardware attached.
`npm run probe:hardware:archive` writes JSON and Markdown evidence under `.tmp/hardware-evidence/` by default. It is still read-only and keeps `commandUploadEnabled: false`. The archive also records `actualHardwareValidationComplete`, `hardwareValidationScope`, and per-target `actualTargetHostValidated`; off-board runs must show `hardwareValidationScope: "off-board-readiness"` and do not count as Jetson/Pi validation. The completion audit and bench evidence packet create separate Jetson Orin Nano and Raspberry Pi 5 items so each actual-board archive can be collected and reviewed independently.
`npm run bench:sitl:io` replays deterministic PX4/ArduPilot process-output fixtures into the SITL adapters and proves hardware transport records are rejected.

Bridge runners:

```bash
npm run bridge:mavlink -- --dry-run --fixture heartbeat,battery-status
npm run bridge:mavlink -- --base-url http://127.0.0.1:8787 --fixture heartbeat,battery-status,local-position-ned
npm run bridge:mavlink -- --dry-run --binary-file .tmp/bench-captures/mavlink.bin
npm run bridge:mavlink -- --dry-run --hex "<single-mavlink-frame-hex>"
npm run bridge:mavlink -- --base-url http://127.0.0.1:8787 --udp-host 127.0.0.1 --udp-port 14550 --duration-ms 30000 --max-packets 200 --evidence-label mavlink-udp-bench
npm run bridge:mavlink:serial -- --command-preview --device /dev/ttyUSB0 --evidence-label mavlink-preview
npm run bridge:mavlink:serial -- --base-url http://127.0.0.1:8787 --device /dev/ttyUSB0 --duration-ms 30000 --max-bytes 1000000 --evidence-label mavlink-bench
npm run bridge:ros2 -- --dry-run --fixture occupancy-grid
npm run bridge:ros2 -- --base-url http://127.0.0.1:8787 --fixture occupancy-grid,nvblox-costmap,pose:pose-stamped,odometry:odometry,detection:evidence-linked-detection,spatial:lidar-point-cloud
ros2 topic echo --json /drone/pose | npm run bridge:ros2 -- --stdin --topic /drone/pose --base-url http://127.0.0.1:8787
npm run bridge:ros2 -- --dry-run --file .tmp/bench-captures/ros2-topic-echo.ndjson
npm run bridge:ros2:live -- --command-preview --topic /drone/pose,/map,/lidar/points --evidence-label ros2-preview
npm run bridge:ros2:live -- --base-url http://127.0.0.1:8787 --topic /drone/pose,/map,/lidar/points --duration-ms 30000 --max-records 200 --evidence-label ros2-bench
npm run bridge:spatial -- --dry-run --fixture lidar-point-cloud --evidence-label spatial-preview
npm run bridge:spatial -- --base-url http://127.0.0.1:8787 --fixture lidar-point-cloud --evidence-label spatial-bench
npm run bench:sitl:io -- --fixture px4-process-io
npm run bench:sitl:io -- --fixture ardupilot-process-io
npm run bench:dimos
```

The bridge runners post only to read-only ingest endpoints (`/api/ingest/telemetry`, `/api/ingest/map-deltas`, `/api/ingest/detections`, and `/api/ingest/spatial-assets`). They do not call command, mission upload, hold, return-home, or geofence endpoints.
The MAVLink bridge can parse raw v1/v2 capture bytes and bounded UDP datagrams for HEARTBEAT, SYS_STATUS, BATTERY_STATUS, LOCAL_POSITION_NED, ESTIMATOR_STATUS, and RADIO_STATUS. Add `--evidence-label <label>` on bounded UDP runs to write `.tmp/bridge-evidence/`. This is for validating captured telemetry before/after a bench run and for local UDP rehearsals; it does not by itself prove a real aircraft link, and unsupported messages are rejected instead of guessed.
The serial MAVLink wrapper opens an explicit device path read-only for a bounded byte capture, then runs the same checksum-aware telemetry parser. Use `--command-preview --evidence-label <label>` to record the plan before connecting hardware. Baud rate, permissions, and USB/serial setup stay outside SEEKR; this wrapper never opens a write stream or command endpoint. When `--evidence-label` or `--out-dir` is provided, the wrapper writes JSON and Markdown bridge evidence under `.tmp/bridge-evidence/`.
The ROS 2 bridge can replay fixture records, topic-echo JSON envelopes (`{ "topic": "/...", "msg": { ... } }`), and single-topic stdin/file streams via `--topic`. Topic names help route PoseStamped/Odometry, OccupancyGrid/costmap, detection, and PointCloud2-style LiDAR metadata into read-only ingest. This is still capture replay, not proof that DDS subscriptions are connected to a real bench target.
The live ROS 2 wrapper starts `ros2 topic echo --json` for explicit topics and streams newline-delimited records into the same read-only ingest path. Use `--command-preview --evidence-label <label>` before the run to capture the subscription plan, then run the bounded live command with `--evidence-label` during the bench session. It writes `.tmp/bridge-evidence/`, does not call ROS services/actions, and does not touch SEEKR command endpoints.
The spatial bridge forwards point-cloud/spatial asset records into `/api/ingest/spatial-assets` and writes `.tmp/bridge-evidence/` when `--evidence-label` or `--out-dir` is provided. Treat local fixture/file/stdin evidence as rehearsal only; real LiDAR/depth proof still requires actual target-board evidence plus required-source rehearsal evidence from the same run.

When the server is running:

```bash
curl -s "http://127.0.0.1:8787/api/hardware-readiness?target=jetson-orin-nano"
curl -s "http://127.0.0.1:8787/api/hardware-readiness?target=raspberry-pi-5"
```

The report is read-only. It should warn when run off-board because `darwin/arm64` is not the target runtime. On the real board, `host-platform` should pass.

## Bench Sequence

1. Run `npm run acceptance` on the development machine.
2. Build the target image with Node.js 20+, Docker/Podman, ROS 2, and board telemetry tools.
3. Copy the repo to the board or mount it read-only from a dev workstation.
4. Run:

   ```bash
   npm ci
   npm run bench:edge -- --target <target>
   npm run probe:hardware -- --target <target>
   npm run probe:hardware:archive -- --target <target>
   ```

5. Launch SEEKR with expected sources and a clean data directory:

   ```bash
   SEEKR_DATA_DIR=.tmp/rehearsal-data \
   SEEKR_EXPECTED_SOURCES="mavlink:telemetry:drone-1,ros2-slam:map,detection:spatial,lidar-slam:lidar,lidar-slam:slam,isaac-nvblox:costmap,isaac-nvblox:perception" \
   npm run server
   ```

6. Ingest fixtures first:

   ```bash
   curl -X POST http://127.0.0.1:8787/api/ingest/fixtures/mavlink/heartbeat
   curl -X POST http://127.0.0.1:8787/api/ingest/fixtures/mavlink/battery-status
   curl -X POST http://127.0.0.1:8787/api/ingest/fixtures/ros2-map/occupancy-grid
   curl -X POST http://127.0.0.1:8787/api/ingest/fixtures/detection/evidence-linked-detection
   curl -X POST http://127.0.0.1:8787/api/import/fixtures/isaac-sim-hil-lite
   ```

7. Confirm:

   ```bash
   curl -s http://127.0.0.1:8787/api/source-health
   curl -s http://127.0.0.1:8787/api/hardware-readiness
   curl -s http://127.0.0.1:8787/api/readiness
   npm run rehearsal:evidence -- --label jetson-bench --require-source mavlink:telemetry:drone-1,ros2-pose:telemetry,lidar-slam:lidar+spatial,isaac-nvblox:costmap
   ```

   Before the real bench session, generate operator task cards from the latest demo package:

   ```bash
   npm run bench:evidence:packet -- --label jetson-bench
   npm run handoff:index -- --label jetson-bench
   npm run handoff:verify
   npm run qa:gstack
   npm run audit:gstack
   npm run audit:source-control
   npm run audit:todo
   npm run setup:local
   npm run doctor
   npm run smoke:rehearsal:start
   npm run handoff:bundle -- --label jetson-bench
   npm run handoff:bundle:verify
   npm run audit:plug-and-play
   ```

   The packet is a plan only. It keeps command upload disabled and does not clear any hardware blocker until the named evidence artifacts are collected. The handoff index only checks that the latest package, packet, acceptance, audit, safety scan, and pointer artifacts agree, then records linked-artifact SHA-256 digests for review. The verifier rechecks that digest table, `qa:gstack` refreshes the local browser QA report/screenshots, `audit:gstack` captures the current workflow-status artifact plus latest local gstack browser QA report status when present, `audit:source-control` records GitHub/local-Git handoff state as separate publication evidence, `audit:todo` checks that unchecked planning TODOs still cover the current blocker categories, setup/doctor/smoke evidence proves the local startup path before packaging, the bundle command copies the verified local artifacts plus those workflow/QA/source-control/TODO/setup/doctor/smoke artifacts and strict local AI smoke status into `.tmp/handoff-bundles/`, the bundle verifier rechecks copied-file digests, copied strict-AI smoke/workflow/QA/source-control/TODO/setup/doctor/smoke semantics, and secret-scan coverage, and `audit:plug-and-play` proves the local app/AI/API/QA/review-bundle surface is ready before the packet is handed to an internal reviewer.

8. For an actual HIL failsafe run, archive manual override and E-stop evidence:

   ```bash
   npm run hil:failsafe:evidence -- \
     --label jetson-link-loss \
     --operator "<name>" \
     --target jetson-orin-nano \
     --vehicle "<bench-vehicle-id>" \
     --autopilot px4 \
     --failsafe link-loss \
     --failsafe-triggered-at "<iso>" \
     --manual-override-observed-at "<iso>" \
     --estop-verified-at "<iso>" \
     --aircraft-safe-at "<iso>" \
     --manual-override-result "<what the operator did>" \
     --onboard-failsafe-result "<what PX4/ArduPilot did onboard>" \
     --deviations "none" \
     --hardware-evidence .tmp/hardware-evidence/<actual-target-archive>.json \
     --rehearsal-evidence .tmp/rehearsal-evidence/<after-source-evidence>.json \
     --flight-log .tmp/hil-evidence/<flight-log>.txt \
     --command-upload-enabled false
   ```

9. For an actual Isaac Sim to Jetson capture run, archive capture evidence:

   ```bash
   npm run isaac:hil:evidence -- \
     --label jetson-isaac-capture \
     --operator "<name>" \
     --target jetson-orin-nano \
     --isaac-sim-host "<sim-host>" \
     --isaac-sim-version "<version>" \
     --isaac-ros-version "<version>" \
     --sensor-suite "rgb-depth-lidar" \
     --capture-started-at "<iso>" \
     --capture-ended-at "<iso>" \
     --capture-result "<telemetry/costmap/detection/point-cloud summary>" \
     --deviations "none" \
     --hardware-evidence .tmp/hardware-evidence/<actual-target-archive>.json \
     --rehearsal-evidence .tmp/rehearsal-evidence/<after-isaac-source-evidence>.json \
     --capture-manifest .tmp/isaac-evidence/<capture-manifest>.json \
     --capture-log .tmp/isaac-evidence/<capture-log>.txt \
     --command-upload-enabled false
   ```

10. Export a replay and archive `mission-events.ndjson`, `latest-state.json`, `replays/*.json`, HIL evidence, Isaac capture evidence, and board telemetry logs.

## What Counts As A Pass

- `npm run probe:hardware -- --target <target>` has no blocking failures.
- `npm run probe:hardware:archive -- --target <target>` produces JSON/Markdown evidence.
- Bench evidence task cards are target-specific: collect Jetson with `--target jetson-orin-nano` and Raspberry Pi 5 with `--target raspberry-pi-5`.
- `host-platform` passes on the actual board.
- The archive has `actualHardwareValidationComplete: true` only when every requested target has a passing `host-platform` check.
- `safety-boundary` passes and command upload remains false.
- Source health observes MAVLink, ROS 2, LiDAR/SLAM, costmap, and perception sources on Jetson rehearsals.
- MAVLink serial or UDP bridge evidence under `.tmp/bridge-evidence/` shows decoded telemetry posted only to `/api/ingest/telemetry`, with no command endpoints touched and `commandUploadEnabled: false`; serial evidence also reports `serialWriteOpened: false`.
- `npm run rehearsal:evidence -- --require-source ...` passes for the real source adapters used in the run, proving `/api/source-health` saw fresh read-only events instead of only expected-source config.
- ROS 2 PoseStamped/Odometry records appear as `ros2-pose` telemetry without any ROS service/action calls, and live bridge evidence under `.tmp/bridge-evidence/` reports `ros2ServicesTouched: false` and `ros2ActionsTouched: false`.
- Spatial bridge evidence under `.tmp/bridge-evidence/` reports `bridgeMode: spatial-assets`, posted spatial records, `commandEndpointsTouched: false`, and `commandUploadEnabled: false`; it only counts as real LiDAR/depth proof when paired with actual target-board and required-source rehearsal evidence.
- `npm run hil:failsafe:evidence` writes a completed artifact only for actual target-board evidence, valid source evidence, non-empty flight log, manual override, E-stop verification, and `commandUploadEnabled false`.
- `npm run isaac:hil:evidence` writes a completed artifact only for actual Jetson evidence, valid Isaac source evidence, a positive capture manifest, non-empty capture log, and `commandUploadEnabled false`.
- `npm run policy:hardware:gate` can only reach `ready-for-human-review` when the candidate policy keeps authorization false and points at real acceptance, actual target-board, and completed HIL evidence.
- Replays export and verify.
- Board telemetry shows no sustained thermal throttling or memory pressure during the run.

## What Still Has To Be Proven Or Built

- Real bench evidence from the current MAVLink serial or UDP harness connected to a serial/UDP telemetry source.
- Real bench evidence from the live read-only ROS 2 topic wrapper subscribing to map/pose/detection/spatial topics and posting normalized payloads to SEEKR.
- A live LiDAR/depth point-cloud bridge run that records frame id, timestamp, bounds, density, transform confidence, and rejection counts from hardware.
- Live source-health proof for `lidar`, `slam`, `costmap`, and `perception` on Jetson hardware.
- Isaac ROS camera/perception graph integration on Jetson.
- A live DimOS or equivalent replay/simulation process run. The current `npm run bench:dimos` only proves the read-only export contract using deterministic fixture data.
- RTAB-Map, LIO-SAM, FAST-LIO2, and Isaac ROS Nvblox comparison on recorded data before live hardware.
- Hardware-in-the-loop fixtures captured from a real Isaac Sim to Jetson bench run. A deterministic `isaac-sim-hil-lite` local fixture exists for import/source-health proof only.
- Command safety case for any future hold/RTH/upload path. This is still blocked.

See `docs/LIDAR_AI_DIMOS_RESEARCH.md` for the current research position and candidate stack.
