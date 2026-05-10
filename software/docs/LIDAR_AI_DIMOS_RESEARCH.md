# LiDAR, AI, And DimOS Research Track

This track is for making SEEKR real in the field without weakening the current safety boundary. LiDAR, visual/depth perception, SLAM, local AI, and spatial memory should improve operator awareness, replay, coverage planning, and candidate search plans. They must not directly upload aircraft commands until SITL, HIL, manual override, and a reviewed hardware policy have passed.

## Current SEEKR Position

What already exists:

- Spatial asset ingest for point clouds, meshes, Gaussian splats, 4D reconstructions, spatial video, and VPS/VSP pose fixes.
- Local AI read tools for spatial summaries, spatial asset ranking, search briefs, and validator-bounded proposals.
- Read-only MAVLink telemetry fixture/file/stdin bridge, binary capture parser, bounded UDP listener, and serial capture wrapper.
- Read-only ROS 2 occupancy-grid, PoseStamped/Odometry, topic-echo envelope, and live topic wrapper paths.
- Jetson Orin Nano and Raspberry Pi 5 hardware readiness profiles.
- Flight-core, PX4/ArduPilot style SITL adapters, and benches proving the hardware transport lock.
- Deterministic `npm run bench:dimos` proof for a DimOS-style read-only export fixture.

What still has to be built:

- Live LiDAR or depth-camera point-cloud bridge.
- Real-source SLAM/odometry evidence from ROS 2, DimOS, Isaac ROS, RTAB-Map, LIO-SAM, or FAST-LIO2.
- Hardware costmap evidence for operator map overlays.
- Onboard detection/classification evidence from GPU or CPU models.
- HIL logs from Isaac Sim or a bench vehicle.
- A separate safety case before any real aircraft command output is enabled.

## DimOS Assessment

The likely project is `dimensionalOS/dimos`, not the unrelated human-motion paper repo `zkf1997/DIMOS`.

Useful properties:

- Apache-2.0 licensed.
- Python-first robotics SDK with LCM, shared-memory, DDS, and ROS 2 transports.
- Claims support for humanoids, quadrupeds, drones, cameras, LiDAR, spatial memory, navigation, perception, and agent-native MCP tooling.
- Includes drone references around MAVLink/DJI, plus replay/simulation workflows.
- Current repo metadata marks it as pre-release beta/alpha; treat it as a research integration candidate, not a safety-certified flight stack.

Recommended SEEKR usage:

1. Use DimOS as a **sidecar research stack** on Jetson/x86, not as the authority for aircraft control.
2. Run DimOS replay or simulation first and export read-only pose/map/perception traces into SEEKR.
3. Bridge DimOS streams into SEEKR through a small adapter that emits only:
   - telemetry source health
   - pose estimates
   - point-cloud/spatial asset metadata
   - occupancy/costmap deltas
   - detection events
4. Disable or ignore any DimOS agent skill that can move hardware, upload missions, set mode, arm, take off, hold, or RTH.
5. Only consider command integration after SEEKR's hardware decision gate has explicit evidence and policy approval.

## Open-Source Stack Candidates

| Candidate | Best SEEKR Role | Why It Matters | Risk |
| --- | --- | --- | --- |
| DimOS | Agentic robotics sidecar, stream/replay bridge, spatial memory research | Broad robot SDK with sensor streams, agents, drones, replay, MCP, and transports | Pre-release; must not own aircraft actuation |
| RTAB-Map | Practical visual/LiDAR SLAM comparison path | Mature open-source visual and LiDAR SLAM library for many sensor/platform combinations | Parameter-heavy; needs careful dataset-specific tuning |
| LIO-SAM | LiDAR+IMU pose and map source | Factor-graph LiDAR inertial odometry with real-time mapping | More ROS/3D LiDAR integration work |
| FAST-LIO2 | Fast onboard LiDAR-inertial odometry candidate | Designed for high-rate LiDAR odometry; paper reports UAV, ARM, and solid-state LiDAR use | C++/ROS integration and sensor calibration burden |
| Isaac ROS Nvblox | Jetson GPU depth/LiDAR 3D reconstruction and costmap source | Builds 3D reconstruction and 2D costmaps from depth/pose/3D LiDAR for Nav2 | Jetson/GPU dependency; Orin Nano memory budget matters |
| Nav2 | Ground-style costmap/planning reference | Rich ROS 2 costmap, behavior-tree, planner/controller ecosystem | Not a drone flight stack; use for advisory maps/plans |
| slam_toolbox | 2D LiDAR mapping baseline | ROS 2 laser/odometry SLAM with map save/localization services | Mainly 2D; less useful for aerial 3D scenes |

## Target Architecture

```text
LiDAR / depth / camera / IMU
        |
        v
ROS 2 / DimOS / Isaac ROS / SLAM stack
        |
        | read-only adapter
        v
SEEKR ingest endpoints
  - /api/ingest/telemetry
  - /api/ingest/map-deltas
  - /api/ingest/detections
  - /api/ingest/spatial-assets
        |
        v
Mission event log -> source health -> readiness -> replay/report -> operator UI -> local AI read tools
```

The adapter contract is intentionally one-way. SEEKR can learn from LiDAR and AI, but LiDAR and AI cannot bypass validators or command aircraft.

## Build Plan

### Phase 1: Offline Evidence

- Add LiDAR point-cloud fixture metadata with density, bounds, frame id, timestamp, transform confidence, and source adapter.
- Add a ROS bag-lite fixture with pose, point cloud, occupancy grid, and detection records.
- Add `isaac-sim-hil-lite` as a deterministic Isaac Sim HIL-style import fixture for telemetry, costmap, detection, and point-cloud replay.
- Extend `npm run bench:edge` to ingest the richer spatial/point-cloud fixture and prove replay/report inclusion.

### Phase 2: Live Read-Only Bridges

- Implemented locally: the ROS 2 bridge accepts fixture/file/stdin records and live `ros2 topic echo --json` wrappers for:
  - `sensor_msgs/PointCloud2`
  - `nav_msgs/Odometry`
  - `geometry_msgs/PoseStamped`
  - detection topics
  - nvblox/Nav2 costmap topics
- Implemented locally: source-health channels for `lidar`, `slam`, `costmap`, and `perception`.
- Implemented locally: rejected-ingest counters make malformed/stale LiDAR frames visible without mutating mission state.
- Still required: real bench captures from those topics on Jetson or another target board, plus bridge evidence and required-source rehearsal evidence from the same run.

### Phase 3: DimOS Research Spike

- Install DimOS in an isolated Python environment on a dev machine.
- Run the replay/simulation blueprint that needs no hardware.
- Capture stream/log outputs and identify the smallest stable export format.
- `npm run bench:dimos` proves the SEEKR-side read-only export contract with deterministic fixture data.
- Still run a real DimOS replay/simulation process and decide whether a live `dimos-readonly` sidecar bridge is worth building before calling the DimOS runtime itself proven.

### Phase 4: Jetson Bench

- Run Isaac ROS Nvblox, RTAB-Map, LIO-SAM, or FAST-LIO2 on Jetson with recorded data first.
- Export:
  - CPU/GPU/memory/thermal logs
  - pose drift notes
  - costmap latency
  - rejected frame counts
  - SEEKR replay hash
- Keep aircraft command output blocked.

### Phase 5: HIL And Safety Case

- Use Isaac Sim/PX4/ArduPilot SITL to inject LiDAR/depth/pose streams.
- Use `npm run bench:sitl:io` fixtures as the local process IO contract before attaching real PX4/ArduPilot SITL logs.
- Prove fail-safe behavior under lost pose, stale LiDAR, bad transform, low confidence, low battery, link loss, and operator override.
- Only after reviewed evidence should a hardware-actuation policy file even exist.

## Decision

Use LiDAR and AI aggressively for sensing, mapping, detection, spatial memory, replay, and operator decision support. Do not use DimOS, Nav2, Isaac ROS, or any LLM/agent framework as the first real flight command path.

The correct near-term move is a read-only spatial/perception bridge plus offline/SITL/HIL evidence. That gets SEEKR closer to real autonomy while keeping the current aircraft command lock intact.

## Sources

- DimOS repository: https://github.com/dimensionalOS/dimos
- DimOS release notes: https://github.com/dimensionalOS/dimos/releases
- DimOS AGENTS.md: https://raw.githubusercontent.com/dimensionalOS/dimos/main/AGENTS.md
- DimOS package metadata/license: https://raw.githubusercontent.com/dimensionalOS/dimos/main/pyproject.toml
- RTAB-Map paper: https://arxiv.org/abs/2403.06341
- LIO-SAM paper: https://arxiv.org/abs/2007.00258
- FAST-LIO2 paper: https://arxiv.org/abs/2107.06829
- Isaac ROS Nvblox docs: https://nvidia-isaac-ros.github.io/v/release-3.1/repositories_and_packages/isaac_ros_nvblox/index.html
- Nav2 ROS 2 package docs: https://docs.ros.org/en/humble/p/navigation2/
- slam_toolbox ROS 2 docs: https://docs.ros.org/en/ros2_packages/jazzy/api/slam_toolbox/
- PX4 Offboard docs: https://docs.px4.io/main/en/flight_modes/offboard
- Unrelated DIMOS human-motion repo, not the robotics OS candidate: https://github.com/zkf1997/DIMOS
